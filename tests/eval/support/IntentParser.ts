// Test/eval only: the app processes commands server-side via the
// `process-recording` Edge Function (Supabase Vault holds the provider keys).
import Groq from 'groq-sdk';
import { OPENROUTER_INTENT_MODELS, callOpenRouter, extractJsonObject, hasOpenRouterKey } from './OpenRouterClient';
// Single source of truth: the production prompt (no mirror to drift).
import { SYSTEM_INSTRUCTION } from '@/supabase/functions/_shared/prompt';

export const INTENT_MODEL = 'openai/gpt-oss-120b';
export const INTENT_FALLBACK_MODELS = OPENROUTER_INTENT_MODELS;

// Initialize Groq
// Ensure GROQ_API_KEY is in .env
const API_KEY = process.env.GROQ_API_KEY || '';
const groq = new Groq({
    apiKey: API_KEY,
    dangerouslyAllowBrowser: true // Required for React Native/Expo
});

export type Intent =
    | 'ADD_STOCK'
    | 'SALE'
    | 'CHECK_STOCK'
    | 'CHECK_PROFIT'
    | 'WRITE_OFF'
    | 'CUSTOMER_RETURN'
    | 'VENDOR_RETURN'
    | 'LOG_EXPENSE'
    | 'CHECK_LOW_STOCK'
    | 'CHECK_OUT_OF_STOCK'
    | 'UNKNOWN';

export interface ParsedAction {
    intent: Intent;
    item?: string;
    quantity?: number;
    unit?: string;
    barcode?: string;
    amount?: number;
    original_text?: string;
}

export interface ParserResponse {
    actions: ParsedAction[];
}

const VALID_INTENTS: ReadonlySet<string> = new Set([
    'ADD_STOCK',
    'SALE',
    'CHECK_STOCK',
    'CHECK_PROFIT',
    'WRITE_OFF',
    'CUSTOMER_RETURN',
    'VENDOR_RETURN',
    'LOG_EXPENSE',
    'CHECK_LOW_STOCK',
    'CHECK_OUT_OF_STOCK',
    'UNKNOWN',
]);

function validateActions(parsed: unknown): ParsedAction[] {
    const rawActions = (parsed && typeof parsed === 'object' && Array.isArray((parsed as ParserResponse).actions))
        ? (parsed as ParserResponse).actions
        : [];

    return rawActions.filter(
        (action): action is ParsedAction =>
            !!action
            && typeof action === 'object'
            && typeof (action as ParsedAction).intent === 'string'
            && VALID_INTENTS.has((action as ParsedAction).intent)
    );
}

function buildPrompt(text: string, inventoryHints: string[]): string {
    let prompt = `Inventory Context: [${inventoryHints.join(', ')}]\n\n`;
    prompt += `User Input: "${text}"`;
    return prompt;
}

async function parseWithGroq(prompt: string): Promise<ParsedAction[]> {
    const completion = await groq.chat.completions.create({
        messages: [
                    { role: 'system', content: SYSTEM_INSTRUCTION },
            { role: 'user', content: prompt }
        ],
        model: INTENT_MODEL,
        response_format: { type: 'json_object' },
        temperature: 0,
    });

    const jsonString = completion.choices[0]?.message?.content;
    if (!jsonString) {
        throw new Error('Empty response from Groq');
    }

    return validateActions(JSON.parse(jsonString) as unknown);
}

async function parseWithOpenRouter(prompt: string): Promise<ParsedAction[]> {
    let lastError: unknown = null;

    for (const model of OPENROUTER_INTENT_MODELS) {
        try {
            const content = await callOpenRouter(
                [
            { role: 'system', content: SYSTEM_INSTRUCTION },
                    { role: 'user', content: prompt }
                ],
                model
            );

            const parsed = extractJsonObject(content);
            if (!parsed) {
                throw new Error(`${model} returned invalid JSON`);
            }

            return validateActions(parsed);
        } catch (error) {
            lastError = error;
            console.warn(`[IntentParser] Fallback model ${model} failed, trying next`, error);
        }
    }

    throw lastError ?? new Error('No OpenRouter fallback models available');
}

export const parseIntent = async (
    text: string,
    inventoryHints: string[] = []
): Promise<ParserResponse> => {
    const prompt = buildPrompt(text, inventoryHints);

    // 1. Primary provider: Groq
    if (API_KEY) {
        try {
            return { actions: await parseWithGroq(prompt) };
        } catch (error) {
            const err = error as { status?: number; message?: string } | undefined;
            const message = error instanceof Error ? error.message : String(error);
            console.warn('[IntentParser] Groq failed, falling back to OpenRouter', { status: err?.status, message });
        }
    } else {
        console.warn('[IntentParser] Groq API key missing, using OpenRouter fallback chain');
    }

    // 2. Fallback chain: free OpenRouter models in preference order
    if (hasOpenRouterKey()) {
        try {
            return { actions: await parseWithOpenRouter(prompt) };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error('[IntentParser] All fallback models failed:', message);
        }
    } else {
        console.error('[IntentParser] No OpenRouter API key configured');
    }

    // 3. Last resort: report UNKNOWN
    return { actions: [{ intent: 'UNKNOWN', original_text: text }] };
};
