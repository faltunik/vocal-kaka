// Test/eval only: the app uploads recordings and transcribes server-side
// through the process-recording Edge Function.
export type TranscriptionProvider = 'groq' | 'openrouter';

export interface TranscriptionResult {
    text: string;
    provider: TranscriptionProvider;
}

/**
 * File-bytes source used by Node-based evals. The app itself passes a URI.
 */
export interface BlobTranscriptionSource {
    blob: Blob;
    filename?: string;
    mimeType?: string;
}

export type TranscriptionSource = string | BlobTranscriptionSource;

const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const OPENROUTER_TRANSCRIPTION_URL = 'https://openrouter.ai/api/v1/audio/transcriptions';

export const GROQ_WHISPER_MODEL = 'whisper-large-v3';
export const OPENROUTER_ASR_MODEL = 'nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b';

const TRANSCRIPTION_TIMEOUT_MS = 20000;
const DEFAULT_FILENAME = 'recording.m4a';

const MIME_TYPES: Record<string, string> = {
    wav: 'audio/wav',
    mp3: 'audio/mpeg',
    m4a: 'audio/m4a',
    mp4: 'audio/mp4',
    ogg: 'audio/ogg',
    webm: 'audio/webm',
    flac: 'audio/flac',
};

export function resolveMimeType(filename?: string, explicit?: string): string {
    if (explicit) return explicit;
    const extension = filename?.split('.').pop()?.toLowerCase();
    return (extension && MIME_TYPES[extension]) || 'audio/m4a';
}

function buildFormData(source: TranscriptionSource, model: string): FormData {
    const formData = new FormData();

    if (typeof source === 'string') {
        // React Native/Expo FormData expects a 'uri' file descriptor, not a Blob
        formData.append('file', {
            uri: source,
            name: DEFAULT_FILENAME,
            type: resolveMimeType(DEFAULT_FILENAME),
        } as unknown as Blob);
    } else {
        const filename = source.filename ?? DEFAULT_FILENAME;
        const mimeType = resolveMimeType(filename, source.mimeType);
        const file = source.blob.type ? source.blob : new Blob([source.blob], { type: mimeType });
        // DOM FormData accepts an optional third filename argument
        (formData.append as unknown as (name: string, value: Blob, fileName: string) => void)(
            'file',
            file,
            filename
        );
    }

    formData.append('model', model);
    return formData;
}

async function postTranscription(url: string, headers: Record<string, string>, source: TranscriptionSource, model: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TRANSCRIPTION_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: buildFormData(source, model),
            signal: controller.signal,
        });

        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            throw new Error(`${model} failed (${response.status}): ${detail.slice(0, 200)}`);
        }

        const data = await response.json();
        const text = data?.text;
        if (typeof text !== 'string' || !text.trim()) {
            throw new Error(`${model} returned an empty transcript`);
        }

        return text.trim();
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Transcribes a recording, preferring Groq Whisper and falling back to the
 * OpenRouter NVIDIA Nemotron ASR model. Accepts an app file URI or raw bytes
 * (used by Node-based evals). Throws when no provider succeeds.
 */
export async function transcribeRecording(source: TranscriptionSource): Promise<TranscriptionResult> {
    const errors: string[] = [];

    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey) {
        try {
            const text = await postTranscription(
                GROQ_TRANSCRIPTION_URL,
                { Authorization: `Bearer ${groqKey}` },
                source,
                GROQ_WHISPER_MODEL
            );
            return { text, provider: 'groq' };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(message);
            console.warn('[Transcription] Groq failed, falling back to OpenRouter:', message);
        }
    } else {
        console.warn('[Transcription] Groq API key missing, using OpenRouter fallback');
    }

    const openRouterKey = process.env.OPENROUTER_API_KEY;
    if (openRouterKey) {
        try {
            const text = await postTranscription(
                OPENROUTER_TRANSCRIPTION_URL,
                {
                    Authorization: `Bearer ${openRouterKey}`,
                    'HTTP-Referer': 'https://vocalstock.app',
                    'X-Title': 'VocalStock',
                },
                source,
                OPENROUTER_ASR_MODEL
            );
            return { text, provider: 'openrouter' };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(message);
        }
    } else {
        errors.push('OpenRouter API key missing');
    }

    throw new Error(errors.join(' | ') || 'No transcription provider configured');
}
