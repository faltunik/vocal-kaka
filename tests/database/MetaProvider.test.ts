import {
    META_ASR_MODEL,
    META_INTENT_MODEL,
    META_INTENT_MODEL_OPENROUTER,
    assertMetaEnvelope,
    buildMetaRequestBody,
    buildMetaTranscribeRequest,
    isWav,
    parseWithMeta,
    resetMetaState,
    resolveMetaTransport,
} from '../../supabase/functions/_shared/meta';

function wavHeader(): Uint8Array {
    const bytes = new Uint8Array(16);
    bytes.set([0x52, 0x49, 0x46, 0x46]); // RIFF
    bytes.set([0x57, 0x41, 0x56, 0x45], 8); // WAVE
    return bytes;
}

describe('meta provider', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        resetMetaState();
        delete process.env.META_TRANSPORT;
        delete process.env.META_MODE;
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    describe('isWav', () => {
        it('accepts a RIFF/WAVE container', () => {
            expect(isWav(wavHeader())).toBe(true);
        });

        it('rejects an m4a/aac container (what the app records)', () => {
            const m4a = new Uint8Array([
                0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20,
            ]);
            expect(isWav(m4a)).toBe(false);
        });

        it('rejects short buffers', () => {
            expect(isWav(new Uint8Array([0x52, 0x49]))).toBe(false);
        });
    });

    describe('transport resolution', () => {
        it('defaults to openrouter when only the OpenRouter key exists', () => {
            const cfg = resolveMetaTransport({ openrouter: 'or-key' });
            expect(cfg?.transport).toBe('openrouter');
            expect(cfg?.model).toBe(META_INTENT_MODEL_OPENROUTER);
            expect(cfg?.asrUrl).toBeNull();
            expect(cfg?.label).toBe('meta:openrouter:muse-spark-1.1');
        });

        it('prefers direct when a Meta key exists', () => {
            const cfg = resolveMetaTransport({ openrouter: 'or-key', meta: 'meta-key' });
            expect(cfg?.transport).toBe('direct');
            expect(cfg?.model).toBe(META_INTENT_MODEL);
            expect(cfg?.asrUrl).toContain('/asr/transcribe');
            expect(cfg?.asrModel).toBe(META_ASR_MODEL);
        });

        it('honours an explicit openrouter switch', () => {
            process.env.META_TRANSPORT = 'openrouter';
            const cfg = resolveMetaTransport({ openrouter: 'or-key', meta: 'meta-key' });
            expect(cfg?.transport).toBe('openrouter');
        });

        it('disables the tier when META_TRANSPORT=off', () => {
            process.env.META_TRANSPORT = 'off';
            expect(resolveMetaTransport({ openrouter: 'or-key', meta: 'meta-key' })).toBeNull();
        });

        it('disables the tier when no key is available', () => {
            expect(resolveMetaTransport({})).toBeNull();
        });

        it('disables the tier when META_MODE=off', () => {
            process.env.META_MODE = 'off';
            expect(resolveMetaTransport({ openrouter: 'or-key' })).toBeNull();
        });
    });

    describe('request bodies', () => {
        it('builds a structured-output chat body without sampling parameters', () => {
            const cfg = resolveMetaTransport({ openrouter: 'or-key' });
            const body = buildMetaRequestBody('do kilo cheeni', ['Sugar'], cfg!);

            expect(body.model).toBe(META_INTENT_MODEL_OPENROUTER);
            expect(body.temperature).toBeUndefined();
            expect(body.reasoning_effort).toBe('low');
            expect((body.response_format as { type: string }).type).toBe('json_schema');
            const messages = body.messages as Array<{ role: string; content: string }>;
            expect(messages[0].role).toBe('developer');
            expect(messages[1].content).toContain('do kilo cheeni');
            expect(messages[1].content).toContain('Sugar');
        });

        it('builds a WAV-only push-to-talk ASR request', () => {
            const body = buildMetaTranscribeRequest({ keywords: ['Sugar'] });
            expect(body.model).toBe(META_ASR_MODEL);
            expect(body.audioEncoding).toBe('WAV');
            expect(body.mode).toBe('PUSH_TO_TALK');
            expect(body.keywords).toEqual(['Sugar']);
        });
    });

    describe('assertMetaEnvelope', () => {
        const valid = {
            actions: [{ intent: 'ADD_STOCK', item: 'Sugar', quantity: 2, unit: 'kg', amount: 120, original_text: 'do kilo cheeni' }],
        };

        it('accepts a well-formed envelope', () => {
            expect(() => assertMetaEnvelope(valid)).not.toThrow();
        });

        it('rejects a missing actions array', () => {
            expect(() => assertMetaEnvelope({})).toThrow('missing actions');
        });

        it('rejects an empty actions array (contract says emit UNKNOWN)', () => {
            expect(() => assertMetaEnvelope({ actions: [] })).toThrow('empty actions');
        });

        it('rejects an unknown intent', () => {
            expect(() => assertMetaEnvelope({ actions: [{ intent: 'SELL', original_text: 'x' }] })).toThrow('unknown intent');
        });

        it('rejects a missing original_text', () => {
            expect(() => assertMetaEnvelope({ actions: [{ intent: 'SALE', original_text: '  ' }] })).toThrow('missing original_text');
        });
    });

    describe('parseWithMeta', () => {
        it('labels the provider so the demo and logs can prove which transport ran', async () => {
            const cfg = resolveMetaTransport({ openrouter: 'or-key' })!;
            const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    choices: [{ message: { content: JSON.stringify({ actions: [{ intent: 'SALE', item: 'Sugar', quantity: 1, unit: 'kg', amount: 60, original_text: 'ek kilo cheeni becha' }] }) } }],
                    usage: { total_tokens: 42 },
                }),
            } as unknown as Response);

            const result = await parseWithMeta('ek kilo cheeni becha', ['Sugar'], cfg);

            expect(result.provider).toBe('meta:openrouter:muse-spark-1.1');
            expect(fetchSpy).toHaveBeenCalledTimes(1);
            fetchSpy.mockRestore();
        });

        it('throws (so the caller falls back) when the model returns no content', async () => {
            const cfg = resolveMetaTransport({ openrouter: 'or-key' })!;
            const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: true,
                status: 200,
                text: async () => JSON.stringify({ choices: [{ message: { content: null } }] }),
            } as unknown as Response);

            await expect(parseWithMeta('x', [], cfg)).rejects.toThrow('empty response');
            fetchSpy.mockRestore();
        });
    });
});
