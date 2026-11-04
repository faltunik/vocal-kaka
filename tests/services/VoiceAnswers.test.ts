import {
    CATEGORY_MARGIN_BENCHMARKS,
    classifyCategory,
    computeProfitSnapshot,
    estimateCostPrice,
} from '@/supabase/functions/_shared/categories';

describe('Voice answer cost parity with the dashboard', () => {
    it('uses the same category margin benchmarks', () => {
        expect(CATEGORY_MARGIN_BENCHMARKS.FMCG).toBe(0.12);
        expect(CATEGORY_MARGIN_BENCHMARKS.STAPLES).toBe(0.06);
        expect(CATEGORY_MARGIN_BENCHMARKS.DAIRY_BAKERY).toBe(0.08);
        expect(CATEGORY_MARGIN_BENCHMARKS.SPICES).toBe(0.08);
        expect(CATEGORY_MARGIN_BENCHMARKS.GENERAL).toBe(0.10);
    });

    it('classifies items like the client dashboard', () => {
        expect(classifyCategory('Amul Taaza Milk 500ml')).toBe('DAIRY_BAKERY');
        expect(classifyCategory('Madhur Pure Sugar')).toBe('STAPLES');
        expect(classifyCategory('Fortune Mustard Oil 1L')).toBe('STAPLES');
        expect(classifyCategory('Maggi 2-Minute Masala Noodles')).toBe('FMCG');
        expect(classifyCategory('Cello Ball Pen')).toBe('GENERAL');
    });

    it('estimates cost with the same benchmark cascade as the dashboard', () => {
        expect(estimateCostPrice(100, 'FMCG')).toBe(88);
        expect(estimateCostPrice(100, 'STAPLES')).toBe(94);
        expect(estimateCostPrice(100, 'DAIRY_BAKERY')).toBe(92);
        expect(estimateCostPrice(100, 'GENERAL')).toBe(90);
        expect(estimateCostPrice(0, 'FMCG')).toBe(0);
    });
});

describe('Voice profit snapshot parity with the dashboard', () => {
    const inventory = [
        { name: 'Sugar', selling_price: 40, last_purchase_price: 36, category: 'STAPLES' },
    ];

    it('uses amount_spent and known costs for value sales', () => {
        const snapshot = computeProfitSnapshot([
            { type: 'SOLD', payload: { product: 'Sugar', quantity: 0.5, amount_spent: 20, unit_price_used: 40 } },
        ], inventory);

        expect(snapshot.sales).toBe(20);
        expect(snapshot.profit).toBe(2);
        expect(snapshot.transactionCount).toBe(1);
    });

    it('deducts expenses from profit', () => {
        const snapshot = computeProfitSnapshot([
            { type: 'SOLD', payload: { product: 'Sugar', quantity: 5, price: 40 } },
            { type: 'EXPENSE', payload: { amount: 15 } },
        ], inventory);

        expect(snapshot.sales).toBe(200);
        expect(snapshot.profit).toBe(5);
    });

    it('deducts customer returns at the sale rate', () => {
        const snapshot = computeProfitSnapshot([
            { type: 'SOLD', payload: { product: 'Sugar', quantity: 2, price: 50 } },
            { type: 'CUSTOMER_RETURN', payload: { product: 'Sugar', quantity: 1, price: 50 } },
        ], [{ name: 'Sugar', selling_price: 50, last_purchase_price: 40, category: 'STAPLES' }]);

        expect(snapshot.sales).toBe(50);
        expect(snapshot.profit).toBe(10);
        expect(snapshot.transactionCount).toBe(1);
    });

    it('estimates missing costs from category margins instead of reporting fake profit', () => {
        const snapshot = computeProfitSnapshot([
            { type: 'SOLD', payload: { product: 'Maggi Noodles', quantity: 1, price: 100 } },
        ], [{ name: 'Maggi Noodles', selling_price: 100, last_purchase_price: null, category: 'FMCG' }]);

        expect(snapshot.sales).toBe(100);
        expect(snapshot.profit).toBe(12);
    });
});
