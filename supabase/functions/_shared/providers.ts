import { buildUserPrompt, SYSTEM_INSTRUCTION } from './prompt.ts';
import { extractJsonObject } from './json.ts';
import { metaAvailable, parseWithMeta, resolveMetaTransport, transcribeWithMeta } from './meta.ts';

export { extractJsonObject };

export interface SecretKeys {
    /** Meta Model API key (direct transport). Vault `model_api_key` or MODEL_API_KEY. */
    meta?: string;
    groq?: string;
    openrouter?: string;
}

export interface AsrResult {
    text: string;
    provider: string;
    latencyMs?: number;
    /** Language the provider detected (or was forced to). Diagnostic only. */
    language?: string;
}

export interface ParseResult {
    actions: unknown;
    provider: string;
    latencyMs?: number;
}

export const GROQ_WHISPER_MODEL = 'whisper-large-v3';
export const OPENROUTER_ASR_MODEL = 'nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b';
export const GROQ_INTENT_MODEL = 'openai/gpt-oss-120b';
/** Meta open weights, served by OpenRouter. Tier 2 of the parse chain. */
export const LLAMA_FALLBACK_MODEL = 'meta-llama/llama-3.3-70b-instruct';
const LLAMA_TIMEOUT_MS = 12_000;
export const OPENROUTER_INTENT_MODELS = [
    'liquid/lfm-2.5-2.6b:free',
    'nvidia/nemotron-3-super-120b-a12b:free',
    'inclusionai/ling-3.1-flash',
    'apodex/apodex-1.1-mini:free',
] as const;

const GROQ_ASR_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const OPENROUTER_ASR_URL = 'https://openrouter.ai/api/v1/audio/transcriptions';
const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

const ASR_TIMEOUT_MS = 60_000;
const LLM_TIMEOUT_MS = 45_000;

const MODELS_WITHOUT_JSON_MODE = new Set<string>(['inclusionai/ling-3.1-flash']);

// Biases ASR toward kirana Hinglish so short commands transcribe consistently.
// Action verbs are included on purpose: a dropped verb turns a valid command
// into UNKNOWN, because the parser refuses to guess a direction.
const ASR_CONTEXT_PROMPT =
    'Kirana inventory command in Hinglish. Keep every word, especially the action verb. ' +
    'Verbs: kharida, kharid liya, aaya, aayi, aaye, becha, bech do, bech diya, khatam, waste, return. ' +
    'Numbers: ek, do, teen, chaar, paanch, das, bees. ' +
    'Units: kilo, gram, litre, packet, bora, bori, peti, crate, bottle, dozen, paav. ' +
    'Items: cheeni, chawal, atta, tel, namak, dahi, doodh, jeera, mirchi, tamatar, pyaz, aloo.';

function errMessage(error: unknown): string {
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

/**
 * Transcribes audio bytes, preferring Meta (WAV only), then Groq Whisper, then
 * the OpenRouter Nemotron ASR model. Throws when no provider succeeds.
 */
export async function transcribeAudio(
    audio: Blob,
    filename: string,
    keys: SecretKeys,
    options: { keywords?: string[] } = {},
): Promise<AsrResult> {
    const errors: string[] = [];

    const metaCfg = resolveMetaTransport(keys);
    if (metaCfg?.asrUrl && metaAvailable() && /\.wav$/i.test(filename)) {
        try {
            return await transcribeWithMeta(audio, filename, metaCfg, { sessionId: filename, keywords: options.keywords });
        } catch (error) {
            errors.push(`meta: ${errMessage(error)}`);
        }
    }

    if (keys.groq) {
        try {
            const startedAt = Date.now();
            const result = await withTimeout(async signal => {
                const form = new FormData();
                form.append('file', audio, filename);
                form.append('model', GROQ_WHISPER_MODEL);
                // No forced language: Hinglish is code-switched, and forcing
                // 'hi' made Whisper translate to English (dropping verbs).
                // Auto-detect reports the real language in verbose_json.
                form.append('prompt', ASR_CONTEXT_PROMPT);
                form.append('response_format', 'verbose_json');
                const response = await fetch(GROQ_ASR_URL, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${keys.groq}` },
                    body: form,
                    signal,
                });
                if (!response.ok) {
                    throw new Error(`groq ${response.status}: ${(await response.text()).slice(0, 200)}`);
                }
                const data = await response.json();
                const value = typeof data?.text === 'string' ? data.text.trim() : '';
                if (!value) throw new Error('groq returned an empty transcript');
                return {
                    text: value,
                    language: typeof data?.language === 'string' ? data.language : undefined,
                };
            }, ASR_TIMEOUT_MS);

            return {
                text: result.text,
                provider: 'groq',
                latencyMs: Date.now() - startedAt,
                language: result.language,
            };
        } catch (error) {
            errors.push(`groq: ${errMessage(error)}`);
        }
    }

    if (keys.openrouter) {
        try {
            const startedAt = Date.now();
            const text = await withTimeout(async signal => {
                const form = new FormData();
                form.append('file', audio, filename);
                form.append('model', OPENROUTER_ASR_MODEL);
                form.append('language', 'hi');
                form.append('prompt', ASR_CONTEXT_PROMPT);
                const response = await fetch(OPENROUTER_ASR_URL, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${keys.openrouter}`,
                        'HTTP-Referer': 'https://vocalstock.app',
                        'X-Title': 'VocalStock',
                    },
                    body: form,
                    signal,
                });
                if (!response.ok) {
                    throw new Error(`openrouter ${response.status}: ${(await response.text()).slice(0, 200)}`);
                }
                const data = await response.json();
                const value = typeof data?.text === 'string' ? data.text.trim() : '';
                if (!value) throw new Error('openrouter returned an empty transcript');
                return value;
            }, ASR_TIMEOUT_MS);

            return { text, provider: 'openrouter', latencyMs: Date.now() - startedAt };
        } catch (error) {
            errors.push(`openrouter: ${errMessage(error)}`);
        }
    }

    throw new Error(errors.join(' | ') || 'no ASR provider configured');
}

/**
 * Parses a transcript into structured actions, preferring Groq and falling
 * back through the OpenRouter chain. Returns actions: null when every
 * provider fails so the caller can fall back to UNKNOWN.
 */
/** OpenRouter chat call shared by the Llama tier and the legacy model tail. */
async function fetchOpenRouterJson(
    model: string,
    userPrompt: string,
    apiKey: string,
    timeoutMs: number,
): Promise<string> {
    return withTimeout(async signal => {
        const body: Record<string, unknown> = {
            model,
            temperature: 0,
            messages: [
                { role: 'system', content: SYSTEM_INSTRUCTION },
                { role: 'user', content: userPrompt },
            ],
        };
        if (!MODELS_WITHOUT_JSON_MODE.has(model)) {
            body.response_format = { type: 'json_object' };
        }

        const response = await fetch(OPENROUTER_CHAT_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://vocalstock.app',
                'X-Title': 'VocalStock',
            },
            body: JSON.stringify(body),
            signal,
        });
        if (!response.ok) {
            throw new Error(`${model} ${response.status}: ${(await response.text()).slice(0, 200)}`);
        }
        const data = await response.json();
        const value = data?.choices?.[0]?.message?.content;
        if (typeof value !== 'string' || !value.trim()) {
            throw new Error(`${model} returned an empty response`);
        }
        return value;
    }, timeoutMs);
}

/**
 * Parses a transcript into structured actions. Provider order is deliberately
 * Meta-first: Muse Spark, then Meta open weights (Llama on OpenRouter), then
 * Groq, then the remaining OpenRouter tail. Returns actions: null when every
 * provider fails so the caller can fall back to UNKNOWN.
 */
export async function parseTranscript(transcript: string, hints: string[], keys: SecretKeys): Promise<ParseResult> {
    const userPrompt = buildUserPrompt(transcript, hints);
    const errors: string[] = [];

    // 1. Muse Spark over the configured Meta transport (openrouter | direct).
    const metaCfg = resolveMetaTransport(keys);
    if (metaCfg && metaAvailable()) {
        try {
            return await parseWithMeta(transcript, hints, metaCfg);
        } catch (error) {
            errors.push(`meta: ${errMessage(error)}`);
        }
    }

    // 2. Meta open weights through OpenRouter — above Groq on purpose.
    if (keys.openrouter) {
        const startedAt = Date.now();
        try {
            const content = await fetchOpenRouterJson(LLAMA_FALLBACK_MODEL, userPrompt, keys.openrouter, LLAMA_TIMEOUT_MS);
            const parsed = extractJsonObject(content);
            if (!parsed) throw new Error(`${LLAMA_FALLBACK_MODEL} returned invalid JSON`);
            return {
                actions: parsed,
                provider: `openrouter:${LLAMA_FALLBACK_MODEL}`,
                latencyMs: Date.now() - startedAt,
            };
        } catch (error) {
            errors.push(`${LLAMA_FALLBACK_MODEL}: ${errMessage(error)}`);
        }
    }

    // 3. Groq gpt-oss — the reliability floor.
    if (keys.groq) {
        try {
            const startedAt = Date.now();
            const content = await withTimeout(async signal => {
                const response = await fetch(GROQ_CHAT_URL, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${keys.groq}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: GROQ_INTENT_MODEL,
                        temperature: 0,
                        response_format: { type: 'json_object' },
                        messages: [
                            { role: 'system', content: SYSTEM_INSTRUCTION },
                            { role: 'user', content: userPrompt },
                        ],
                    }),
                    signal,
                });
                if (!response.ok) {
                    throw new Error(`groq ${response.status}: ${(await response.text()).slice(0, 200)}`);
                }
                const data = await response.json();
                const value = data?.choices?.[0]?.message?.content;
                if (typeof value !== 'string' || !value.trim()) {
                    throw new Error('groq returned an empty response');
                }
                return value;
            }, LLM_TIMEOUT_MS);

            const parsed = extractJsonObject(content);
            if (!parsed) {
                throw new Error('groq returned invalid JSON');
            }
            return { actions: parsed, provider: 'groq', latencyMs: Date.now() - startedAt };
        } catch (error) {
            errors.push(`groq: ${errMessage(error)}`);
        }
    }

    // 4. Legacy OpenRouter tail.
    if (keys.openrouter) {
        for (const model of OPENROUTER_INTENT_MODELS) {
            try {
                const startedAt = Date.now();
                const content = await fetchOpenRouterJson(model, userPrompt, keys.openrouter, LLM_TIMEOUT_MS);
                const parsed = extractJsonObject(content);
                if (!parsed) throw new Error(`${model} returned invalid JSON`);
                return { actions: parsed, provider: `openrouter:${model}`, latencyMs: Date.now() - startedAt };
            } catch (error) {
                errors.push(`${model}: ${errMessage(error)}`);
            }
        }
    }

    console.error('[providers] all parse providers failed:', errors.join(' | '));
    return { actions: null, provider: 'none' };
}
