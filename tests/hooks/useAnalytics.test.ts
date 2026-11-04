import {
    aggregateTopSellers,
    buildAnalytics,
    computeCategoryMix,
    computeDailyTrend,
    computeDeadStock,
    computePeakHours,
    AnalyticsEvent,
    AnalyticsInventoryRow,
} from '@/hooks/useAnalytics';

const DAY_MS = 24 * 60 * 60 * 1000;
// Fixed midday timestamp so IST day buckets are deterministic at any run time.
const now = new Date(2026, 9, 7, 14, 0, 0);

const inventory: AnalyticsInventoryRow[] = [
    { name: 'Sugar', quantity: 10, unit: 'kg', base_unit: 'kg', selling_price: 44, category: 'STAPLES' },
    { name: 'Colgate', quantity: 3, unit: 'pcs', base_unit: 'pcs', selling_price: 50, category: 'FMCG' },
    { name: 'Rare Item', quantity: 8, unit: 'pcs', base_unit: 'pcs', selling_price: 20, category: 'GENERAL' },
    { name: 'Empty Shelf', quantity: 0, unit: 'pcs', base_unit: 'pcs', selling_price: 10, category: 'GENERAL' },
    { name: 'Negative Row', quantity: -3, unit: 'kg', base_unit: 'kg', selling_price: 10, category: 'GENERAL' },
];

const events: AnalyticsEvent[] = [
    {
        type: 'SOLD',
        payload: { product: 'Sugar', quantity: 2, price: 44 },
        created_at: new Date(now.getTime() - 1000).toISOString(),
    },
    {
        type: 'SOLD',
        payload: { product: 'Sugar', quantity: 1, amount_spent: 44 },
        created_at: new Date(now.getTime() - 2 * DAY_MS).toISOString(),
    },
    {
        type: 'SOLD',
        payload: { product: 'Colgate', quantity: 1, price: 50 },
        created_at: new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString(),
    },
    {
        type: 'CUSTOMER_RETURN',
        payload: { product: 'Sugar', quantity: 1, price: 44 },
        created_at: now.toISOString(),
    },
];

describe('useAnalytics aggregations', () => {
    it('ranks top sellers by net revenue after customer returns', () => {
        const top = aggregateTopSellers(events, inventory, 5);

        expect(top[0]).toEqual({ name: 'Sugar', quantity: 2, revenue: 88 });
        expect(top[1]).toEqual({ name: 'Colgate', quantity: 1, revenue: 50 });
    });

    it('flags only stocked items with zero sales as dead stock', () => {
        const dead = computeDeadStock(inventory, events);

        expect(dead.map(item => item.name)).toEqual(['Rare Item']);
        expect(dead[0].quantity).toBe(8);
    });

    it('builds a 7-day net trend ending today', () => {
        const trend = computeDailyTrend(events, 7, now);

        expect(trend).toHaveLength(7);
        expect(trend[6].revenue).toBe(94);
        expect(trend.reduce((sum, point) => sum + point.revenue, 0)).toBe(138);
    });

    it('computes category net revenue shares', () => {
        const mix = computeCategoryMix(events, inventory);

        expect(mix[0].category).toBe('STAPLES');
        expect(mix[0].revenue).toBe(88);
        expect(mix[0].share).toBeCloseTo(88 / 138, 3);
        expect(mix[1].category).toBe('FMCG');
    });

    it('detects peak sales hours', () => {
        const peaks = computePeakHours(events);

        expect(peaks.length).toBeGreaterThan(0);
        expect(peaks[0].count).toBeGreaterThanOrEqual(1);
    });

    it('does not invent revenue when amount_spent is explicitly zero', () => {
        const data = buildAnalytics(
            [{
                type: 'SOLD',
                payload: { product: 'Freebie', quantity: 1, amount_spent: 0, price: 100 },
                created_at: now.toISOString(),
            }],
            []
        );

        expect(data.totalRevenue).toBe(0);
        expect(data.topSellers[0]).toEqual({ name: 'Freebie', quantity: 1, revenue: 0 });
    });

    it('renders empty analytics safely when there is no data', () => {
        const data = buildAnalytics([], []);

        expect(data.topSellers).toEqual([]);
        expect(data.deadStock).toEqual([]);
        expect(data.categoryMix).toEqual([]);
        expect(data.peakHours).toEqual([]);
        expect(data.totalRevenue).toBe(0);
        expect(data.totalTransactions).toBe(0);
        expect(data.trend).toHaveLength(7);
    });

    it('values an unpriced voice sale at the catalog price, not zero', () => {
        // A voice sale without a spoken price stores quantity only. History and
        // the profit card value it at the catalog price; analytics must agree.
        const data = buildAnalytics(
            [{ type: 'SOLD', payload: { product: 'Sugar', quantity: 3 }, created_at: now.toISOString() }],
            inventory
        );

        expect(data.totalRevenue).toBe(132); // 3 kg x Rs 44
        expect(data.topSellers[0]).toEqual({ name: 'Sugar', quantity: 3, revenue: 132 });
    });
});
