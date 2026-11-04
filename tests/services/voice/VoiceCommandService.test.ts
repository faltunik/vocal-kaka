import { bytesToArrayBuffer, isNetworkError } from '@/services/voice/VoiceCommandService';

describe('bytesToArrayBuffer', () => {
    it('returns the full buffer for a complete view', () => {
        const bytes = new Uint8Array([1, 2, 3, 4]);

        const buffer = bytesToArrayBuffer(bytes);

        expect(buffer.byteLength).toBe(4);
        expect(Array.from(new Uint8Array(buffer))).toEqual([1, 2, 3, 4]);
    });

    it('slices views with an offset instead of sharing the backing buffer', () => {
        const backing = new Uint8Array([0, 1, 2, 3, 4, 5]);
        const view = backing.subarray(2, 5);

        const buffer = bytesToArrayBuffer(view);

        expect(buffer.byteLength).toBe(3);
        expect(Array.from(new Uint8Array(buffer))).toEqual([2, 3, 4]);
    });
});

describe('isNetworkError', () => {
    it('detects common network failures', () => {
        expect(isNetworkError(new Error('Network request failed'))).toBe(true);
        expect(isNetworkError(new Error('TypeError: fetch failed'))).toBe(true);
        expect(isNetworkError(new Error('The operation was aborted'))).toBe(true);
        expect(isNetworkError(new Error('request timeout'))).toBe(true);
        expect(isNetworkError(new Error('connection lost'))).toBe(true);
    });

    it('does not flag server or validation errors', () => {
        expect(isNetworkError(new Error('500 internal server error'))).toBe(false);
        expect(isNetworkError(new Error('invalid audio path'))).toBe(false);
        expect(isNetworkError(new Error('daily recording limit reached'))).toBe(false);
    });
});
