// Test/eval only: the app pipeline runs server-side (process-recording Edge Function).
export interface ChatMessage {
    role: 'system' | 'user';
    content: string;
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_TIMEOUT_MS = 20000;

const API_KEY = process.env.OPENROUTER_API_KEY || '';

/**
 * Free text-only OpenRouter models, tried in order.
 * Groq stays the primary provider; these are the fallback chain.
 */
export const OPENROUTER_INTENT_MODELS = [
    'liquid/lfm-2.5-2.6b:free',
    'nvidia/nemotron-3-super-120b-a12b:free',
    'inclusionai/ling-3.1-flash',
    'apodex/apodex-1.1-mini:free',
] as const;

// Models that do not advertise response_format/json mode support
const MODELS_WITHOUT_JSON_MODE = new Set<string>([
    'inclusionai/ling-3.1-flash',
]);

export const hasOpenRouterKey = (): boolean => API_KEY.length > 0;

/**
 * Extracts a JSON object from a model response, tolerating markdown fences
 * and surrounding prose (needed for models without JSON mode).
 */
export function extractJsonObject(text: string): unknown | null {
    const direct = tryParse(text);
    if (direct !== undefined) return direct;

    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
        const parsed = tryParse(fenced[1].trim());
        if (parsed !== undefined) return parsed;
    }

    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
        const parsed = tryParse(text.slice(start, end + 1));
        if (parsed !== undefined) return parsed;
    }

    return null;
}

function tryParse(value: string): unknown | undefined {
    try {
        return JSON.parse(value);
    } catch {
        return undefined;
    }
}

export async function callOpenRouter(messages: ChatMessage[], model: string): Promise<string> {
    if (!API_KEY) {
        throw new Error('Missing OPENROUTER_API_KEY');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);

    try {
        const body: Record<string, unknown> = {
            model,
            messages,
            temperature: 0,
        };
        if (!MODELS_WITHOUT_JSON_MODE.has(model)) {
            body.response_format = { type: 'json_object' };
        }

        const response = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://vocalstock.app',
                'X-Title': 'VocalStock',
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            throw new Error(`${model} failed (${response.status}): ${detail.slice(0, 200)}`);
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) {
            throw new Error(`${model} returned an empty response`);
        }

        return content;
    } finally {
        clearTimeout(timer);
    }
}
