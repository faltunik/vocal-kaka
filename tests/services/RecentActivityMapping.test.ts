import { mapEventToActivity } from '@/services/RecentActivityContext';
import { LedgerEvent } from '@/core/interfaces/IInventoryRepository';

function makeEvent(overrides: Partial<LedgerEvent>): LedgerEvent {
    return {
        event_id: 'event-1',
        user_id: 'user-1',
        type: 'SOLD',
        payload: { product: 'Milk', quantity: 1, unit: 'l', price: 60 },
        ledger_event_id: 'ledger-1',
        created_at: new Date().toISOString(),
        ...overrides,
    };
}

describe('Recent activity store attribution', () => {
    it('carries the event store onto the feed row', () => {
        const item = mapEventToActivity(makeEvent({ store_id: 'store-kirana-1' }));

        expect(item?.storeId).toBe('store-kirana-1');
    });

    it('keeps legacy rows attributable to null', () => {
        const item = mapEventToActivity(makeEvent({ store_id: null }));

        expect(item?.storeId).toBeNull();
    });

    it('preserves a legitimate zero quantity for unresolved value sales', () => {
        const item = mapEventToActivity(makeEvent({
            payload: {
                product: 'Anjaan Masala',
                quantity: 0,
                amount: 25,
                is_value_based: true,
                pricing_unresolved: true,
                needs_weight_review: true,
            },
        }));

        expect(item?.quantity).toBe(0);
        expect(item?.needsReview).toBe(true);
    });

    it('flags pricing review but not resolved sales', () => {
        const resolved = mapEventToActivity(makeEvent({}));
        expect(resolved?.needsReview).toBe(false);
    });

    it('maps stock adjustments with their signed delta', () => {
        const item = mapEventToActivity(makeEvent({
            type: 'ADJUSTED',
            payload: { product: 'Sugar', delta: -3 },
        }));

        expect(item?.intent).toBe('ADJUSTMENT');
        expect(item?.quantity).toBe(-3);
        expect(item?.title).toBe('Adjusted -3 units Sugar');
    });
});
