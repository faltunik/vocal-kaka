import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const CORS_HEADERS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const VALID_CATEGORIES = new Set(['MASS', 'VOLUME', 'COUNT', 'LENGTH']);
const VALID_BASE_UNITS = new Set(['kg', 'l', 'pcs', 'm']);

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const GROQ_UNIT_MODEL = 'openai/gpt-oss-20b';
const OPENROUTER_UNIT_MODELS = ['meta-llama/llama-3.1-8b-instruct', 'liquid/lfm-2.5-2.6b:free'];

const LLM_TIMEOUT_MS = 20_000;
const MAX_CONVERSION_FACTOR = 1_000_000;

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function withTimeout<T>(task: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        return await task(controller.signal);
    } finally {
        clearTimeout(timer);
    }
}

function slugify(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40) || 'custom_unit';
}

function extractJsonObject(text: string): Record<string, unknown> | null {
    try {
        return JSON.parse(text) as Record<string, unknown>;
    } catch {
        // fall through
    }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
        try {
            return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
        } catch {
            return null;
        }
    }
    return null;
}

interface RegistryRow {
    code: string;
    name: string;
    vernacular_name: string | null;
    category: string;
    base_unit: string;
    conversion_factor: number;
    aliases: string[];
    source: string;
}

function toDefinition(row: RegistryRow) {
    return {
        code: row.code,
        name: row.name,
        vernacularName: row.vernacular_name,
        category: row.category,
        baseUnit: row.base_unit,
        conversionFactor: Number(row.conversion_factor),
        aliases: row.aliases ?? [],
    };
}

async function lookupUnit(admin: SupabaseClient, spoken: string): Promise<RegistryRow | null> {
    const key = spoken.trim().toLowerCase();
    const { data } = await admin.from('unit_registry').select('*').order('code', { ascending: true }).limit(1000);
    const rows = (data ?? []) as RegistryRow[];

    return rows.find(row =>
        row.code.toLowerCase() === key
        || (row.aliases ?? []).some(alias => String(alias).trim().toLowerCase() === key)
    ) ?? null;
}

/** Aliases already owned by other registry rows are never re-pointed. */
async function filterTakenAliases(
    admin: SupabaseClient,
    code: string,
    aliases: string[]
): Promise<string[]> {
    const { data: others } = await admin
        .from('unit_registry')
        .select('code, aliases')
        .neq('code', code);
    const taken = new Set(
        (others ?? []).flatMap(other =>
            (Array.isArray(other.aliases) ? other.aliases : []).map(alias => String(alias).trim().toLowerCase())
        )
    );
    return aliases.filter(alias => !taken.has(alias.trim().toLowerCase()));
}

function buildPrompt(spoken: string, itemHint?: string, context?: string): string {
    return `You are a unit-resolution engine for an Indian kirana (grocery) inventory app.
Classify the unknown spoken unit into a physical dimension and its canonical base unit.

Return PURE JSON only, no markdown:
{
  "code": string,          // short lowercase slug, e.g. "jholi"
  "name": string,          // English display name
  "vernacularName": string | null,
  "category": "MASS" | "VOLUME" | "COUNT" | "LENGTH",
  "baseUnit": "kg" | "l" | "pcs" | "m",
  "conversionFactor": number, // how many base units one spoken unit equals (> 0)
  "aliases": string[]      // must include the spoken word exactly
}

Rules:
- MASS -> kg (grains, spices, sacks, loose goods); VOLUME -> l (liquids, oils, milk);
  COUNT -> pcs (discrete items, packets, bundles); LENGTH -> m (fabric, rope, wire).
- Use the item hint to decide (e.g. "chawal"/"rice" implies MASS).
- Estimate a realistic factor: a sack-like bag of grain is 10-50 kg; a small pouch is 0.5-2 kg.
- If you are not confident, use COUNT/pcs with conversionFactor 1.

Spoken unit: "${spoken}"
Item hint: "${itemHint ?? 'unknown'}"
Context: "${context ?? ''}"`;
}

async function callGroq(apiKey: string, prompt: string): Promise<string> {
    return await withTimeout(async signal => {
        const response = await fetch(GROQ_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: GROQ_UNIT_MODEL,
                temperature: 0,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: 'You resolve spoken units to canonical base units. Return pure JSON.' },
                    { role: 'user', content: prompt },
                ],
            }),
            signal,
        });
        if (!response.ok) throw new Error(`groq ${response.status}: ${(await response.text()).slice(0, 200)}`);
        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) throw new Error('groq returned empty content');
        return content;
    }, LLM_TIMEOUT_MS);
}

async function callOpenRouter(apiKey: string, model: string, prompt: string): Promise<string> {
    return await withTimeout(async signal => {
        const response = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://vocalstock.app',
                'X-Title': 'VocalStock',
            },
            body: JSON.stringify({
                model,
                temperature: 0,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: 'You resolve spoken units to canonical base units. Return pure JSON.' },
                    { role: 'user', content: prompt },
                ],
            }),
            signal,
        });
        if (!response.ok) throw new Error(`${model} ${response.status}: ${(await response.text()).slice(0, 200)}`);
        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) throw new Error(`${model} returned empty content`);
        return content;
    }, LLM_TIMEOUT_MS);
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: CORS_HEADERS });
    }

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        if (!supabaseUrl || !anonKey || !serviceKey) {
            return json({ error: 'server misconfigured' }, 500);
        }

        const authHeader = req.headers.get('Authorization') ?? '';
        if (!authHeader) return json({ error: 'missing authorization' }, 401);

        // Internal pipeline calls authenticate with the service-role key.
        // GoTrue rejects that key on /auth/v1/user, so detect it explicitly
        // instead of running the user-token verification path.
        const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
        const isServiceCall = bearer.length > 0 && bearer === serviceKey;

        if (!isServiceCall) {
            // This function writes into the GLOBAL unit registry and spends
            // provider quota. Only the internal pipeline (service role) may
            // call it; client tokens must never teach units directly.
            return json({ error: 'forbidden' }, 403);
        }

        const body = await req.json().catch(() => ({})) as {
            unit?: string;
            itemHint?: string;
            context?: string;
        };
        const spoken = typeof body.unit === 'string' ? body.unit.trim() : '';
        if (!spoken) return json({ error: 'unit is required' }, 400);

        const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

        // Fast path: already known in the registry
        const existing = await lookupUnit(admin, spoken);
        if (existing) {
            return json({ unit: toDefinition(existing), fromCache: true, provider: 'db' });
        }

        // Slow path: ask the LLM
        const { data: groqKey } = await admin.rpc('get_app_secret', { secret_name: 'groq_api_key' });
        const { data: openRouterKey } = await admin.rpc('get_app_secret', { secret_name: 'openrouter_api_key' });

        const prompt = buildPrompt(spoken, body.itemHint, body.context);
        let content: string | null = null;
        let provider = 'none';
        const errors: string[] = [];

        if (typeof groqKey === 'string' && groqKey) {
            try {
                content = await callGroq(groqKey, prompt);
                provider = `groq:${GROQ_UNIT_MODEL}`;
            } catch (error) {
                errors.push(`groq: ${errorMessage(error)}`);
            }
        }

        if (!content && typeof openRouterKey === 'string' && openRouterKey) {
            for (const model of OPENROUTER_UNIT_MODELS) {
                try {
                    content = await callOpenRouter(openRouterKey, model, prompt);
                    provider = `openrouter:${model}`;
                    break;
                } catch (error) {
                    errors.push(`${model}: ${errorMessage(error)}`);
                }
            }
        }

        if (!content) {
            console.error('[resolve-unit] all providers failed:', errors.join(' | '));
            return json({ error: 'could not resolve unit' }, 502);
        }

        const parsed = extractJsonObject(content) ?? {};
        const category = VALID_CATEGORIES.has(String(parsed.category)) ? String(parsed.category) : 'COUNT';
        const baseUnit = VALID_BASE_UNITS.has(String(parsed.baseUnit)) ? String(parsed.baseUnit) : 'pcs';
        const rawFactor = Number(parsed.conversionFactor);
        const conversionFactor = Number.isFinite(rawFactor) && rawFactor > 0 && rawFactor <= MAX_CONVERSION_FACTOR
            ? rawFactor
            : 1;
        const code = slugify(typeof parsed.code === 'string' && parsed.code.trim() ? parsed.code : spoken);
        const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : spoken;
        const vernacularName = typeof parsed.vernacularName === 'string' ? parsed.vernacularName : null;
        const aliases = [...new Set([
            spoken,
            ...(Array.isArray(parsed.aliases) ? parsed.aliases.map(String) : []),
        ])].filter(Boolean);

        // Never overwrite a seeded unit; attach the alias instead. Aliases
        // already owned by a different unit are never re-pointed.
        const byCode = await admin.from('unit_registry').select('*').eq('code', code).maybeSingle();
        if (byCode.data) {
            const row = byCode.data as RegistryRow;
            const safeAliases = await filterTakenAliases(admin, code, aliases);
            const merged = [...new Set([...(row.aliases ?? []), ...safeAliases])];
            const { data: updated } = await admin
                .from('unit_registry')
                .update({ aliases: merged })
                .eq('code', code)
                .select('*')
                .single();
            return json({ unit: toDefinition((updated ?? row) as RegistryRow), fromCache: false, provider });
        }

        const { data: inserted, error: insertError } = await admin
            .from('unit_registry')
            .insert({
                code,
                name,
                vernacular_name: vernacularName,
                category,
                base_unit: baseUnit,
                conversion_factor: conversionFactor,
                aliases: await filterTakenAliases(admin, code, aliases),
                is_fixed: false,
                source: 'ai',
            })
            .select('*')
            .single();

        if (insertError || !inserted) {
            console.error('[resolve-unit] registry insert failed:', insertError?.message);
            return json({ error: 'could not store unit' }, 500);
        }

        return json({ unit: toDefinition(inserted as RegistryRow), fromCache: false, provider });
    } catch (error) {
        console.error('[resolve-unit] failed:', errorMessage(error));
        return json({ error: 'unit resolution failed' }, 500);
    }
});
