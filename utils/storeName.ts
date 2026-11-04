export const DEFAULT_STORE_NAME = 'Laxmi Kirana Store';

interface StoreNameSources {
    storeName?: string | null;
    metadataName?: unknown;
    email?: string | null;
}

/** Store identity shown in the dashboard header, parchi and PDF report. */
export function getStoreDisplayName({ storeName, metadataName, email }: StoreNameSources): string {
    const fromStore = storeName?.trim();
    if (fromStore) return fromStore;

    if (typeof metadataName === 'string' && metadataName.trim()) {
        return metadataName.trim();
    }

    if (email) {
        const local = email.split('@')[0]?.trim();
        if (local) return local;
    }

    return DEFAULT_STORE_NAME;
}
