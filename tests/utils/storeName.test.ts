import { DEFAULT_STORE_NAME, getStoreDisplayName } from '@/utils/storeName';

describe('store display name', () => {
    it('prefers the active store name', () => {
        expect(getStoreDisplayName({
            storeName: 'Shree Krishna Kirana',
            metadataName: 'metadata-name',
            email: 'owner@kirana.in',
        })).toBe('Shree Krishna Kirana');
    });

    it('falls back to metadata, then email local part', () => {
        expect(getStoreDisplayName({ metadataName: 'Mukesh Kirana', email: 'owner@kirana.in' }))
            .toBe('Mukesh Kirana');
        expect(getStoreDisplayName({ email: 'mukesh@kirana.in' })).toBe('mukesh');
    });

    it('uses the default when nothing is available', () => {
        expect(getStoreDisplayName({})).toBe(DEFAULT_STORE_NAME);
        expect(getStoreDisplayName({ storeName: '   ', metadataName: '  ', email: null }))
            .toBe(DEFAULT_STORE_NAME);
    });
});
