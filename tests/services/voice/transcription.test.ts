import {
    GROQ_WHISPER_MODEL,
    OPENROUTER_ASR_MODEL,
    resolveMimeType,
    transcribeRecording,
} from '@/tests/eval/support/transcription';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const okJson = (payload: unknown) => ({
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
});

const errorResponse = (status: number, body = 'provider error') => ({
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
});

describe('transcribeRecording', () => {
    const originalGroqKey = process.env.GROQ_API_KEY;
    const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;

    beforeEach(() => {
        jest.clearAllMocks();
        mockFetch.mockReset();
        process.env.GROQ_API_KEY = 'test-groq-key';
        process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
    });

    afterAll(() => {
        process.env.GROQ_API_KEY = originalGroqKey;
        process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
    });

    it('uses Groq Whisper when it succeeds', async () => {
        mockFetch.mockResolvedValueOnce(okJson({ text: 'add 5 milk' }));

        const result = await transcribeRecording('file:///recording.m4a');

        expect(result).toEqual({ text: 'add 5 milk', provider: 'groq' });
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockFetch.mock.calls[0][0]).toContain('api.groq.com');
        expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer test-groq-key');
        expect(GROQ_WHISPER_MODEL).toBe('whisper-large-v3');
    });

    it('accepts raw bytes so Node-based evals can call the real API', async () => {
        mockFetch.mockResolvedValueOnce(okJson({ text: 'add 5 milk' }));

        const result = await transcribeRecording({
            blob: new Blob([new Uint8Array([1, 2, 3])]),
            filename: 'clip.wav',
        });

        expect(result).toEqual({ text: 'add 5 milk', provider: 'groq' });
        const body = mockFetch.mock.calls[0][1].body as FormData;
        expect(body).toBeInstanceOf(FormData);
        expect(body.get('model')).toBe(GROQ_WHISPER_MODEL);

        const file = body.get('file') as Blob & { name?: string };
        expect(file).toBeInstanceOf(Blob);
        expect(file.type).toBe('audio/wav');
        expect(file.name).toBe('clip.wav');
    });

    it('infers the mime type from the filename and honors an explicit override', () => {
        expect(resolveMimeType('clip.wav')).toBe('audio/wav');
        expect(resolveMimeType('clip.MP3')).toBe('audio/mpeg');
        expect(resolveMimeType('clip.unknown')).toBe('audio/m4a');
        expect(resolveMimeType(undefined)).toBe('audio/m4a');
        expect(resolveMimeType('clip.wav', 'application/octet-stream')).toBe('application/octet-stream');
    });

    it('falls back to the OpenRouter Nemotron ASR model when Groq fails', async () => {
        mockFetch
            .mockResolvedValueOnce(errorResponse(500))
            .mockResolvedValueOnce(okJson({ text: 'do litre doodh' }));
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

        const result = await transcribeRecording('file:///recording.m4a');

        expect(result).toEqual({ text: 'do litre doodh', provider: 'openrouter' });
        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(mockFetch.mock.calls[1][0]).toBe('https://openrouter.ai/api/v1/audio/transcriptions');
        expect(mockFetch.mock.calls[1][1].headers.Authorization).toBe('Bearer test-openrouter-key');
        expect(mockFetch.mock.calls[1][1].headers['X-Title']).toBe('VocalStock');
        expect(OPENROUTER_ASR_MODEL).toBe('nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b');
        warnSpy.mockRestore();
    });

    it('falls back when Groq returns an empty transcript', async () => {
        mockFetch
            .mockResolvedValueOnce(okJson({ text: '   ' }))
            .mockResolvedValueOnce(okJson({ text: 'sugar' }));
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

        const result = await transcribeRecording('file:///recording.m4a');

        expect(result.provider).toBe('openrouter');
        warnSpy.mockRestore();
    });

    it('skips Groq entirely when its key is missing', async () => {
        delete process.env.GROQ_API_KEY;
        mockFetch.mockResolvedValueOnce(okJson({ text: 'namak' }));
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

        const result = await transcribeRecording('file:///recording.m4a');

        expect(result).toEqual({ text: 'namak', provider: 'openrouter' });
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockFetch.mock.calls[0][0]).toContain('openrouter.ai');
        warnSpy.mockRestore();
    });

    it('throws with both provider errors when everything fails', async () => {
        mockFetch
            .mockResolvedValueOnce(errorResponse(500, 'groq down'))
            .mockResolvedValueOnce(errorResponse(502, 'upstream failed'));
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

        await expect(transcribeRecording('file:///recording.m4a')).rejects.toThrow(/groq down.*upstream failed/);

        warnSpy.mockRestore();
    });
});
