interface CryptoLike {
    randomUUID?: () => string;
    getRandomValues?: (array: Uint8Array) => Uint8Array;
}

/**
 * Generates an RFC 4122 version-4 UUID. Prefers the platform crypto API and
 * falls back to Math.random so guest/demo builds never depend on native code.
 */
export function createUuidV4(): string {
    const cryptoApi = (globalThis as unknown as { crypto?: CryptoLike }).crypto;

    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
        return cryptoApi.randomUUID();
    }

    const bytes = new Uint8Array(16);
    if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
        cryptoApi.getRandomValues(bytes);
    } else {
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = Math.floor(Math.random() * 256);
        }
    }

    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
