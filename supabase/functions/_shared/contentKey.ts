/** Stable, order-independent ledger keys for voice-applied events. */

export interface ContentEvent {
    type: string;
    payload: Record<string, unknown>;
}

export function stablePayloadKey(payload: Record<string, unknown>): string {
    return Object.keys(payload)
        .sort()
        .map(key => `${key}=${String(payload[key])}`)
        .join('|');
}

/** FNV-1a 32-bit hash, good enough for idempotency content keys. */
export function fnv1aHash(value: string): string {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
}

/**
 * Occurrence-based content keys: a retry that re-parses the same actions in a
 * different order still produces the same ledger ids, while genuinely
 * repeated identical actions remain distinct.
 */
export function contentLedgerIds(events: ContentEvent[], recordingId: string): string[] {
    const occurrences = new Map<string, number>();
    return events.map(event => {
        const contentKey = fnv1aHash(`${event.type}|${stablePayloadKey(event.payload)}`);
        const occurrence = occurrences.get(contentKey) ?? 0;
        occurrences.set(contentKey, occurrence + 1);
        return `${recordingId}:${contentKey}:${occurrence}`;
    });
}
