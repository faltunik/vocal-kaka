import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { executeActions, validateActions, type InventoryLookupFn, type InventoryPriceRecord } from '../_shared/actions.ts';
import { buildAnswers } from '../_shared/answers.ts';
import { contentLedgerIds } from '../_shared/contentKey.ts';
import { parseTranscript, transcribeAudio } from '../_shared/providers.ts';
import { activeMetaTransport } from '../_shared/meta.ts';
import { PROMPT_VERSION } from '../_shared/prompt.ts';
import { loadUnitNormalizer, resolveUnknownUnit } from '../_shared/units.ts';

const CORS_HEADERS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_RECORDINGS_PER_DAY = 300;

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: CORS_HEADERS });
    }

    const startedAt = Date.now();
    let admin: SupabaseClient | null = null;
    let logId: string | undefined;
    let audioPath = '';

    const updateLog = async (patch: Record<string, unknown>) => {
        if (admin && logId) {
            await admin.from('voice_command_logs').update(patch).eq('id', logId);
        }
    };

    /** Private voice data must not outlive processing. */
    const cleanupAudio = async () => {
        if (!admin || !audioPath) return;
        const { error: removeError } = await admin.storage.from('recordings').remove([audioPath]);
        if (removeError) {
            console.warn('[process-recording] could not delete recording:', removeError.message);
        }
    };

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        if (!supabaseUrl || !anonKey || !serviceKey) {
            return json({ error: 'server misconfigured' }, 500);
        }

        const authHeader = req.headers.get('Authorization') ?? '';
        if (!authHeader) return json({ error: 'missing authorization' }, 401);

        const userClient = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: authHeader } },
            auth: { persistSession: false },
        });
        const { data: { user }, error: authError } = await userClient.auth.getUser();
        if (authError || !user) return json({ error: 'unauthorized' }, 401);

        const body = await req.json().catch(() => ({})) as {
            recording_id?: string;
            audio_path?: string;
            duration_ms?: number;
            language?: string;
            store_id?: string;
        };
        const recordingId = typeof body.recording_id === 'string' ? body.recording_id.trim() : '';
        audioPath = typeof body.audio_path === 'string' ? body.audio_path.trim() : '';
        if (!recordingId || !audioPath) {
            return json({ error: 'recording_id and audio_path are required' }, 400);
        }
        if (!/^rec-[A-Za-z0-9-]{4,80}$/.test(recordingId)) {
            return json({ error: 'invalid recording_id' }, 400);
        }

        admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

        // Replay short-circuit: if this recording already produced a result,
        // return it instead of re-running ASR/LLM (a re-parse can drift and
        // duplicate ledger events via different content hash ids).
        const { data: existingLog } = await admin
            .from('voice_command_logs')
            .select('status, command_text, parsed_intents, processed_at')
            .eq('user_id', user.id)
            .eq('recording_id', recordingId)
            .maybeSingle();
        if (
            existingLog
            && (existingLog.status === 'applied' || existingLog.status === 'parsed')
            && existingLog.processed_at
        ) {
            return json({
                recording_id: recordingId,
                transcript: existingLog.command_text ?? '',
                actions: existingLog.parsed_intents ?? [],
                applied: 0,
                answers: [],
                replay: true,
                latency_ms: Date.now() - startedAt,
            });
        }

        // The caller may only process their own recording
        const expectedPath = `${user.id}/${recordingId}.m4a`;
        if (audioPath !== expectedPath) {
            return json({ error: 'invalid audio path' }, 403);
        }

        const durationMs = Number.isInteger(body.duration_ms) && Number(body.duration_ms) >= 0
            ? Number(body.duration_ms)
            : null;

        // Active store (shared counter): the caller must be a member to write
        // into its catalog and ledger. Falls back to the per-user scope.
        const requestedStoreId = typeof body.store_id === 'string' ? body.store_id.trim() : '';
        let storeId: string | null = null;
        let callerRole: string | null = null;
        if (requestedStoreId) {
            const { data: membership } = await admin
                .from('store_members')
                .select('store_id, role')
                .eq('store_id', requestedStoreId)
                .eq('user_id', user.id)
                .maybeSingle();
            if (!membership) {
                return json({ error: 'not a member of this store' }, 403);
            }
            storeId = requestedStoreId;
            callerRole = typeof membership.role === 'string' ? membership.role : null;
        }

        // Per-user daily rate limit
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { count } = await admin
            .from('voice_command_logs')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .gte('created_at', since);
        if ((count ?? 0) >= MAX_RECORDINGS_PER_DAY) {
            return json({ error: 'daily recording limit reached' }, 429);
        }

        // Upsert the recording row first so failures are always recorded
        const { data: logRow, error: logError } = await admin
            .from('voice_command_logs')
            .upsert({
                user_id: user.id,
                recording_id: recordingId,
                audio_path: audioPath,
                duration_ms: durationMs,
                language: body.language ?? null,
                status: 'uploaded',
                error: null,
                // Refresh the timestamp so the daily rate limit counts every
                // invocation, not just the first use of a reused recording id.
                created_at: new Date().toISOString(),
            }, { onConflict: 'user_id,recording_id' })
            .select('id')
            .single();
        if (logError || !logRow) {
            console.error('[process-recording] could not create log row:', logError?.message);
            return json({ error: 'could not start processing' }, 500);
        }
        logId = logRow.id as string;

        // Provider keys live in Vault; only service_role can read them.
        // Meta can also run on an Edge secret (MODEL_API_KEY) so the key can be
        // rotated without a Vault write during the demo.
        const { data: groqKey } = await admin.rpc('get_app_secret', { secret_name: 'groq_api_key' });
        const { data: openRouterKey } = await admin.rpc('get_app_secret', { secret_name: 'openrouter_api_key' });
        const { data: metaKey } = await admin.rpc('get_app_secret', { secret_name: 'model_api_key' });
        const metaSecret = typeof metaKey === 'string' && metaKey
            ? metaKey
            : Deno.env.get('MODEL_API_KEY');
        const keys = {
            meta: typeof metaSecret === 'string' && metaSecret ? metaSecret : undefined,
            groq: typeof groqKey === 'string' && groqKey ? groqKey : undefined,
            openrouter: typeof openRouterKey === 'string' && openRouterKey ? openRouterKey : undefined,
        };

        // Download the uploaded audio
        const { data: audio, error: downloadError } = await admin.storage.from('recordings').download(audioPath);
        if (downloadError || !audio) {
            await updateLog({ status: 'failed', error: `download: ${downloadError?.message ?? 'not found'}` });
            return json({ error: 'audio not found' }, 404);
        }

        // 1. Transcribe
        let asr;
        try {
            asr = await transcribeAudio(audio, audioPath.split('/').pop() || 'recording.m4a', keys);
        } catch (error) {
            await updateLog({ status: 'failed', error: `asr: ${errorMessage(error)}` });
            await cleanupAudio();
            return json({ error: 'transcription failed' }, 502);
        }
        await updateLog({ status: 'transcribed', command_text: asr.text, transcript_provider: asr.provider });

        // 2. Parse with inventory hints from the active store catalog. The same
        // rows feed the value-sale price lookup so spoken prices resolve against
        // the store's real selling/cost prices, not the static benchmarks.
        let hintsQuery = admin
            .from('inventory')
            .select('name, selling_price, last_purchase_price, base_unit, unit, category');
        hintsQuery = storeId
            ? hintsQuery.eq('store_id', storeId)
            : hintsQuery.eq('user_id', user.id);
        const { data: inventoryRows } = await hintsQuery.limit(1000);

        type CatalogRow = InventoryPriceRecord & { name: string };
        const catalog = (inventoryRows ?? []) as CatalogRow[];
        const hints = catalog.slice(0, 200).map(row => row.name);

        const priceByName = new Map(
            catalog.map(row => [row.name.trim().toLowerCase(), row])
        );
        const inventoryLookup: InventoryLookupFn = (itemName: string) =>
            priceByName.get(itemName.trim().toLowerCase()) ?? null;

        const parsed = await parseTranscript(asr.text, hints, keys);
        if (!parsed.actions) {
            await updateLog({
                status: 'failed',
                error: 'all parse providers failed',
                parse_provider: parsed.provider,
                prompt_version: PROMPT_VERSION,
            });
            await cleanupAudio();
            return json({ error: 'parsing failed' }, 502);
        }

        const actions = validateActions(parsed.actions);
        await updateLog({
            status: 'parsed',
            parsed_intents: actions,
            parse_provider: parsed.provider,
            prompt_version: PROMPT_VERSION,
        });

        // 2b. Normalize spoken units to canonical base units. Known units are
        // converted in memory; unknown ones go through the resolve-unit function
        // which learns them in unit_registry.
        const normalizer = await loadUnitNormalizer(admin);
        const unknownUnits = [...new Set(
            actions
                .map(action => action.unit)
                .filter((unit): unit is string => typeof unit === 'string' && unit.trim().length > 0 && !normalizer.isRecognized(unit))
        )];
        // Bound the learning loop: each resolution can hit LLM providers.
        const MAX_UNIT_RESOLUTIONS = 3;
        const UNIT_RESOLUTION_BUDGET_MS = 25_000;
        const unitResolutionStartedAt = Date.now();
        for (const unit of unknownUnits.slice(0, MAX_UNIT_RESOLUTIONS)) {
            if (Date.now() - unitResolutionStartedAt > UNIT_RESOLUTION_BUDGET_MS) {
                console.warn('[process-recording] unit resolution budget exhausted');
                break;
            }
            const hint = actions.find(action => action.unit === unit)?.item ?? undefined;
            const resolved = await resolveUnknownUnit(supabaseUrl, serviceKey, unit, hint ?? undefined);
            if (resolved) {
                normalizer.learn(resolved);
                console.log(`[process-recording] learned unit "${unit}" -> ${resolved.code} (${resolved.baseUnit})`);
            }
        }

        // Re-verify membership right before writing: processing takes seconds
        // and a revoked member must not land events in the store.
        if (storeId) {
            const { data: stillMember } = await admin
                .from('store_members')
                .select('store_id, role')
                .eq('store_id', storeId)
                .eq('user_id', user.id)
                .maybeSingle();
            if (!stillMember) {
                await updateLog({ status: 'failed', error: 'store membership revoked' });
                await cleanupAudio();
                return json({ error: 'not a member of this store' }, 403);
            }
            callerRole = typeof stillMember.role === 'string' ? stillMember.role : callerRole;
        }

        // 3. Apply mutations as ledger events (content-idempotent per recording)
        const { events, queries } = await executeActions(actions, {
            inventory: inventoryLookup,
            normalizer,
        });
        let applied = 0;
        if (events.length > 0) {
            const ledgerIds = contentLedgerIds(events, recordingId);
            const rows = events.map((event, index) => ({
                user_id: user.id,
                ...(storeId ? { store_id: storeId } : {}),
                type: event.type,
                payload: event.payload,
                ledger_event_id: ledgerIds[index],
            }));
            const { data: inserted, error: insertError } = await admin
                .from('events')
                .upsert(rows, {
                    onConflict: storeId ? 'store_id,ledger_event_id' : 'user_id,ledger_event_id',
                    ignoreDuplicates: true,
                })
                .select('event_id');

            if (insertError) {
                await updateLog({ status: 'failed', error: `events: ${insertError.message}` });
                await cleanupAudio();
                return json({ error: 'failed to apply actions' }, 500);
            }
            applied = inserted?.length ?? 0;
        }

        // 4. Answer read-only queries (scoped to the active store). Staff must
        //    never receive profit metrics (Constitution Principle 8).
        const answers = await buildAnswers(admin, { userId: user.id, storeId, role: callerRole }, queries);

        // A refused parse used to return silently, which reads as a broken app.
        // Ask for the missing direction instead of dropping the transaction.
        if (applied === 0 && answers.length === 0 && actions.length > 0
            && actions.every(action => action.intent === 'UNKNOWN')) {
            answers.push({
                intent: 'UNKNOWN',
                text: 'Kharida ya becha? Boliye: "do kilo tamatar kharida" ya "do kilo tamatar becha".',
            });
        }

        // "applied" means work actually landed; a pure no-op stays "parsed".
        await updateLog({
            status: applied > 0 || answers.length > 0 ? 'applied' : 'parsed',
            processed_at: new Date().toISOString(),
        });
        await cleanupAudio();

        return json({
            recording_id: recordingId,
            transcript: asr.text,
            // provider/provider_used are the demo proof that a Meta model ran.
            provider: parsed.provider,
            provider_used: parsed.provider,
            meta_transport: activeMetaTransport(),
            asr_provider: asr.provider,
            parse_provider: parsed.provider,
            prompt_version: PROMPT_VERSION,
            asr_latency_ms: asr.latencyMs ?? null,
            parse_latency_ms: parsed.latencyMs ?? null,
            actions,
            applied,
            answers,
            latency_ms: Date.now() - startedAt,
        });
    } catch (error) {
        console.error('[process-recording] failed:', errorMessage(error));
        await updateLog({ status: 'failed', error: errorMessage(error) });
        await cleanupAudio();
        return json({ error: 'processing failed' }, 500);
    }
});
