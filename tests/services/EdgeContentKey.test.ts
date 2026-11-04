import {
    contentLedgerIds,
    fnv1aHash,
    stablePayloadKey,
} from '@/supabase/functions/_shared/contentKey';

describe('edge content ledger ids', () => {
    it('hashes payloads order-independently', () => {
        expect(stablePayloadKey({ b: 2, a: 1 })).toBe(stablePayloadKey({ a: 1, b: 2 }));
        expect(fnv1aHash('same')).toBe(fnv1aHash('same'));
        expect(fnv1aHash('same')).not.toBe(fnv1aHash('different'));
    });

    it('produces the same ids when actions are re-ordered', () => {
        const sale = { type: 'SOLD', payload: { product: 'Sugar', quantity: 2 } };
        const purchase = { type: 'PURCHASED', payload: { product: 'Milk', quantity: 1 } };

        const forward = contentLedgerIds([sale, purchase], 'rec-1');
        const reversed = contentLedgerIds([purchase, sale], 'rec-1');

        expect(forward[0]).toBe(reversed[1]);
        expect(forward[1]).toBe(reversed[0]);
    });

    it('keeps genuinely repeated identical actions distinct', () => {
        const sale = { type: 'SOLD', payload: { product: 'Sugar', quantity: 2 } };
        const ids = contentLedgerIds([sale, sale, sale], 'rec-2');

        expect(new Set(ids).size).toBe(3);
        expect(ids[0].endsWith(':0')).toBe(true);
        expect(ids[1].endsWith(':1')).toBe(true);
        expect(ids[2].endsWith(':2')).toBe(true);
    });

    it('scopes ids by recording', () => {
        const sale = { type: 'SOLD', payload: { product: 'Sugar', quantity: 2 } };
        expect(contentLedgerIds([sale], 'rec-a')[0]).not.toBe(contentLedgerIds([sale], 'rec-b')[0]);
    });
});
