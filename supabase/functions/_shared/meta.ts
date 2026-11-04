/**
 * Meta Model API providers (Muse Spark for intent, Muse Voice Transcribe for
 * WAV speech) with a transport switch so the same code path can run through
 * OpenRouter (existing funded key) or directly against api.meta.ai.
 *
 * Fallback semantics match providers.ts: every helper throws on failure and the
 * caller records the message, so a Meta outage degrades to the next provider
 * instead of losing the recording.
 */
import { ACTION_INTENTS } from './actions.ts';
import { extractJsonObject } from './json.ts';
import { buildUserPrompt, SYSTEM_INSTRUCTION } from './prompt.ts';

export type MetaTransport = 'openrouter' | 'direct';

export interface MetaTransportConfig {
    transport: MetaTransport;
    baseUrl: string;
    chatUrl: string;
    asrUrl: string | null;
    model: string;
    asrModel: string | null;
    apiKey: string;
    extraHeaders: Record<string, string>;
    /** Value stored in voice_command_logs.parse_provider, e.g. meta:openrouter:muse-spark-1.3 */
    label: string;
    asrLabel: string | null;
}

export interface MetaOptions {
    keywords?: string[];
    languageBias?: string[];
    sessionId?: string;
    timeoutMs?: number;
    safetyIdentifier?: string;
}

export interface MetaResult {
    actions: unknown;
    provider: string;
    latencyMs: number;
}

export interface MetaAsrResult {
    text: string;
    provider: string;
    latencyMs: number;
}

export const META_BASE_URL = 'https://api.meta.ai/v1';
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const META_INTENT_MODEL = 'muse-spark-1.3';
export const META_INTENT_MODEL_OPENROUTER = 'meta/muse-spark-1.3';
export const META_ASR_MODEL = 'muse-voice-transcribe-1.0';

export const LLM_TIMEOUT_MS = 15_000;
export const ASR_TIMEOUT_MS = 20_000;

const LLM_MAX_COMPLETION_TOKENS = 1_500;
const ASR_MAX_KEYWORDS = 30;
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60_000;

const ACTION_ENVELOPE_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['actions'],
    properties: {
        actions: {
            type: 'array',
            minItems: 1,
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['intent', 'item', 'quantity', 'unit', 'amount', 'original_text'],
                properties: {
                    intent: { type: 'string', enum: [...ACTION_INTENTS] },
                    item: { type: ['string', 'null'] },
                    quantity: { type: ['number', 'null'] },
                    unit: { type: ['string', 'null'] },
                    amount: { type: ['number', 'null'] },
                    original_text: { type: 'string' },
                },
            },
        },
    },
} as const;

/** Thrown before any network call when the audio is not a RIFF/WAVE container. */
export class MetaUnsupportedContainerError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'MetaUnsupportedContainerError';
    }
}

export class MetaAsrUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'MetaAsrUnavailableError';
    }
}

let failures = 0;
let openUntil = 0;
let ineligible = false;
let cachedTransport: { cacheKey: string; config: MetaTransportConfig | null } | null = null;

function errMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Deno first, Node second, so the same module runs in the smoke test. */
function readEnv(name: string): string | undefined {
    try {
        const deno = (globalThis as { Deno?: { env?: { get(key: string): string | undefined } } }).Deno;
        const value = deno?.env?.get(name);
        if (value) return value;
    } catch {
        // env access can throw under --allow-env restrictions
    }
    try {
        const node = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
        return node?.env?.[name];
    } catch {
        return undefined;
    }
}

function sniffAscii(bytes: Uint8Array, offset: number, length: number): string {
    let out = '';
    for (let i = offset; i < offset + length && i < bytes.length; i += 1) {
        out += String.fromCharCode(bytes[i]);
    }
    return out;
}

/** RIFF....WAVE sniff — Muse Voice Transcribe accepts WAV only. */
export function isWav(bytes: Uint8Array): boolean {
    if (bytes.length < 12) return false;
    return sniffAscii(bytes, 0, 4) === 'RIFF' && sniffAscii(bytes, 8, 4) === 'WAVE';
}

export function metaStatus(): { failures: number; openUntil: number; ineligible: boolean } {
    return { failures, openUntil, ineligible };
}

/** Test seam: reset the breaker/latch between cases. */
export function resetMetaState(): void {
    failures = 0;
    openUntil = 0;
    ineligible = false;
    cachedTransport = null;
}

export function metaAvailable(): boolean {
    if (readEnv('META_MODE') === 'off') return false;
    if (ineligible) return false;
    return Date.now() >= openUntil;
}

function recordFailure(): void {
    failures += 1;
    if (failures >= BREAKER_THRESHOLD) {
        openUntil = Date.now() + BREAKER_COOLDOWN_MS;
        failures = 0;
        console.warn(`[provider] meta breaker open for ${BREAKER_COOLDOWN_MS}ms`);
    }
}

function recordSuccess(): void {
    failures = 0;
}

function transportFromEnv(): MetaTransport | null {
    const raw = (readEnv('META_TRANSPORT') ?? '').trim().toLowerCase();
    if (!raw || raw === 'off' || raw === 'none' || raw === 'disabled') return null;
    if (raw === 'direct' || raw === 'meta') return 'direct';
    if (raw === 'openrouter') return 'openrouter';
    console.warn(`[provider] meta unknown META_TRANSPORT=${raw} — tier disabled`);
    return null;
}

/**
 * Resolves the active transport once per isolate.
 *
 * Explicit `META_TRANSPORT` always wins. When it is unset we default to
 * OpenRouter if a Meta direct key is absent, so the tier works on the existing
 * funded OpenRouter secret without any new provisioning.
 */
export function resolveMetaTransport(keys: { openrouter?: string; meta?: string }): MetaTransportConfig | null {
    if (!metaAvailable()) return null;

    const cacheKey = `${keys.meta ? 'm' : '-'}${keys.openrouter ? 'o' : '-'}${readEnv('META_TRANSPORT') ?? ''}`;
    if (cachedTransport && cachedTransport.cacheKey === cacheKey) {
        return cachedTransport.config;
    }

    const configured = transportFromEnv();
    const explicitOff = (readEnv('META_TRANSPORT') ?? '').trim().toLowerCase();
    if (explicitOff === 'off') {
        cachedTransport = { cacheKey, config: null };
        return null;
    }

    const transport: MetaTransport | null = configured ?? (keys.meta ? 'direct' : keys.openrouter ? 'openrouter' : null);
    if (!transport) {
        cachedTransport = { cacheKey, config: null };
        return null;
    }

    const modelOverride = readEnv('META_MODEL')?.trim();

    let config: MetaTransportConfig | null = null;
    if (transport === 'direct') {
        if (!keys.meta) {
            console.warn('[provider] meta transport=direct but no model_api_key — tier disabled');
        } else {
            const model = modelOverride || META_INTENT_MODEL;
            config = {
                transport: 'direct',
                baseUrl: META_BASE_URL,
                chatUrl: `${META_BASE_URL}/chat/completions`,
                asrUrl: `${META_BASE_URL}/asr/transcribe`,
                model,
                asrModel: META_ASR_MODEL,
                apiKey: keys.meta,
                extraHeaders: {},
                label: `meta:direct:${model}`,
                asrLabel: `meta:direct:${META_ASR_MODEL}`,
            };
        }
    } else if (!keys.openrouter) {
        console.warn('[provider] meta transport=openrouter but no openrouter_api_key — tier disabled');
    } else {
        const model = modelOverride || META_INTENT_MODEL_OPENROUTER;
        config = {
            transport: 'openrouter',
            baseUrl: OPENROUTER_BASE_URL,
            chatUrl: `${OPENROUTER_BASE_URL}/chat/completions`,
            asrUrl: null,
            model,
            asrModel: null,
            apiKey: keys.openrouter,
            extraHeaders: {
                'HTTP-Referer': 'https://vocalstock.app',
                'X-Title': 'VocalStock',
            },
            label: `meta:openrouter:${model.replace(/^meta\//, '')}`,
            asrLabel: null,
        };
    }

    if (config) {
        console.log(
            `[provider] meta transport=${config.transport} model=${config.model}` +
            (config.asrModel ? ` asr=${config.asrModel}` : ''),
        );
    }

    cachedTransport = { cacheKey, config };
    return config;
}

/** Cheap accessor for the response payload; never triggers resolution. */
export function activeMetaTransport(): MetaTransport | null {
    return cachedTransport?.config?.transport ?? null;
}

export function buildMetaTranscribeRequest(options: MetaOptions = {}): Record<string, unknown> {
    return {
        model: META_ASR_MODEL,
        audioEncoding: 'WAV',
        mode: 'PUSH_TO_TALK',
        languageBias: options.languageBias ?? ['Hindi', 'English'],
        ...(options.keywords?.length ? { keywords: options.keywords.slice(0, ASR_MAX_KEYWORDS) } : {}),
    };
}

export function buildMetaRequestBody(
    transcript: string,
    hints: string[],
    cfg: MetaTransportConfig,
    safetyIdentifier?: string,
): Record<string, unknown> {
    return {
        model: cfg.model,
        messages: [
            { role: 'developer', content: SYSTEM_INSTRUCTION },
            { role: 'user', content: buildUserPrompt(transcript, hints) },
        ],
        reasoning_effort: 'low',
        max_completion_tokens: LLM_MAX_COMPLETION_TOKENS,
        prompt_cache_key: 'vocalstock-intent-v2.4',
        response_format: {
            type: 'json_schema',
            json_schema: { name: 'KakaActions', schema: ACTION_ENVELOPE_SCHEMA },
        },
        ...(safetyIdentifier ? { safety_identifier: safetyIdentifier } : {}),
    };
}

/**
 * Contract check. validateActions() silently drops unknown intents, so a
 * malformed Meta response would become a silent no-op instead of a fallback.
 */
export function assertMetaEnvelope(value: unknown): void {
    const actions = (value as { actions?: unknown })?.actions;
    if (!Array.isArray(actions)) throw new Error('meta: missing actions[]');
    if (actions.length === 0) throw new Error('meta: empty actions[]');
    for (const action of actions) {
        if (!action || typeof action !== 'object') throw new Error('meta: action is not an object');
        const intent = (action as { intent?: unknown }).intent;
        if (typeof intent !== 'string' || !(ACTION_INTENTS as readonly string[]).includes(intent)) {
            throw new Error(`meta: unknown intent ${String(intent)}`);
        }
        const original = (action as { original_text?: unknown }).original_text;
        if (typeof original !== 'string' || !original.trim()) {
            throw new Error('meta: missing original_text');
        }
    }
}

function isIneligibility(responseBody: string): boolean {
    return /ineligibility_reasons|paid-model-training-violation|not available matching your guardrail/i.test(responseBody);
}

async function postJson(
    url: string,
    headers: Record<string, string>,
    body: Record<string, unknown>,
    timeoutMs: number,
): Promise<{ status: number; ok: boolean; payload: unknown; text: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        const text = await response.text();
        let payload: unknown = null;
        try {
            payload = text ? JSON.parse(text) : null;
        } catch {
            payload = null;
        }
        return { status: response.status, ok: response.ok, payload, text };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Parses a transcript with Muse Spark. Retries with progressively simpler
 * bodies when the server rejects an optional parameter (400), because a schema
 * or `reasoning_effort` rejection must not cost the whole Meta tier.
 */
export async function parseWithMeta(
    transcript: string,
    hints: string[],
    cfg: MetaTransportConfig,
    options: Pick<MetaOptions, 'timeoutMs' | 'safetyIdentifier'> = {},
): Promise<MetaResult> {
    const startedAt = Date.now();
    const timeoutMs = options.timeoutMs ?? LLM_TIMEOUT_MS;
    const full = buildMetaRequestBody(transcript, hints, cfg, options.safetyIdentifier);

    const ladder: Record<string, unknown>[] = [
        full,
        {
            model: cfg.model,
            messages: full.messages,
            max_completion_tokens: LLM_MAX_COMPLETION_TOKENS,
            response_format: { type: 'json_object' },
        },
        { model: cfg.model, messages: full.messages, max_completion_tokens: LLM_MAX_COMPLETION_TOKENS },
    ];

    let lastError = 'meta: no attempt made';
    for (let i = 0; i < ladder.length; i += 1) {
        const result = await postJson(cfg.chatUrl, { Authorization: `Bearer ${cfg.apiKey}`, ...cfg.extraHeaders }, ladder[i], timeoutMs);

        if (!result.ok) {
            lastError = `meta ${result.status}: ${result.text.slice(0, 200)}`;
            if (isIneligibility(result.text)) {
                ineligible = true;
                console.warn('[provider] meta endpoint ineligible for this account — tier disabled for this isolate');
                break;
            }
            // Only a 400 is worth retrying with a simpler body.
            if (result.status !== 400) break;
            continue;
        }

        const payload = result.payload as {
            choices?: Array<{ message?: { content?: string | null } }>;
            usage?: { total_tokens?: number };
        };
        const content = payload?.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) {
            lastError = 'meta returned an empty response';
            break;
        }

        const parsed = extractJsonObject(content);
        assertMetaEnvelope(parsed);
        recordSuccess();

        const latencyMs = Date.now() - startedAt;
        console.log(
            `[provider] meta parse ok transport=${cfg.transport} model=${cfg.model} ` +
            `attempt=${i} ms=${latencyMs} tokens=${payload?.usage?.total_tokens ?? 'n/a'}`,
        );
        return { actions: parsed, provider: cfg.label, latencyMs };
    }

    recordFailure();
    throw new Error(lastError);
}

/** Muse Voice Transcribe. Direct transport only; WAV containers only. */
export async function transcribeWithMeta(
    audio: Blob,
    filename: string,
    cfg: MetaTransportConfig,
    options: MetaOptions = {},
): Promise<MetaAsrResult> {
    if (!cfg.asrUrl || !cfg.asrModel) {
        throw new MetaAsrUnavailableError('meta ASR is not available on the openrouter transport');
    }

    const bytes = new Uint8Array(await audio.arrayBuffer());
    if (!isWav(bytes) && readEnv('META_ASR_FORCE') !== '1') {
        throw new MetaUnsupportedContainerError('not a RIFF/WAVE container');
    }

    const startedAt = Date.now();
    const form = new FormData();
    form.append(
        'request',
        new Blob([JSON.stringify(buildMetaTranscribeRequest(options))], { type: 'application/json' }),
        'request.json',
    );
    form.append('audio', new Blob([bytes], { type: 'audio/wav' }), filename.replace(/\.[^.]+$/, '') + '.wav');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? ASR_TIMEOUT_MS);
    try {
        const url = options.sessionId
            ? `${cfg.asrUrl}?sessionId=${encodeURIComponent(options.sessionId)}`
            : cfg.asrUrl;
        const response = await fetch(url, {
            method: 'POST',
            headers: { Authorization: `Bearer ${cfg.apiKey}`, Accept: 'application/json', ...cfg.extraHeaders },
            body: form,
            signal: controller.signal,
        });
        if (!response.ok) {
            const text = await response.text();
            if (isIneligibility(text)) ineligible = true;
            throw new Error(`meta asr ${response.status}: ${text.slice(0, 200)}`);
        }
        const data = await response.json() as { transcript?: string; audioDurationMs?: number };
        const text = typeof data?.transcript === 'string' ? data.transcript.trim() : '';
        if (!text) throw new Error('meta asr returned an empty transcript');
        recordSuccess();
        return { text, provider: cfg.asrLabel ?? `meta:${cfg.asrModel}`, latencyMs: Date.now() - startedAt };
    } catch (error) {
        if (!(error instanceof MetaUnsupportedContainerError)) recordFailure();
        throw error;
    } finally {
        clearTimeout(timer);
    }
}
