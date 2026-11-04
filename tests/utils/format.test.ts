import { formatActivityTitle, formatCurrency, formatFriendlyQuantity, formatProfitAnswer, formatStockAnswer, formatStockListAnswer, formatTransactionTitle } from '@/utils/format';

describe('formatActivityTitle', () => {
    it('renders the canonical title used by the optimistic and persisted paths', () => {
        expect(formatActivityTitle('SALE', 2, 'kg', 'Sugar')).toBe('Sold 2 kg Sugar');
        expect(formatActivityTitle('PURCHASE', 5, 'packet', 'Maggi')).toBe('Added 5 packet Maggi');
    });

    it('renders verbs for the extended activity intents', () => {
        expect(formatActivityTitle('WRITE_OFF', 3, 'piece', 'Egg')).toBe('Wrote off 3 piece Egg');
        expect(formatActivityTitle('CUSTOMER_RETURN', 1, 'packet', 'Curd')).toBe('Customer returned 1 packet Curd');
        expect(formatActivityTitle('VENDOR_RETURN', 10, 'packet', 'Chips')).toBe('Returned to vendor 10 packet Chips');
        expect(formatActivityTitle('EXPENSE', 1, '', 'Expense')).toBe('Spent 1 units Expense');
    });

    it('accepts string quantities and trims item/unit', () => {
        expect(formatActivityTitle('SALE', '3', ' packet ', ' Namak ')).toBe('Sold 3 packet Namak');
    });

    it('defaults missing quantity, unit and item', () => {
        expect(formatActivityTitle('PURCHASE', null, '', '')).toBe('Added 1 units Unknown Item');
    });

    it('matches formatTransactionTitle output', () => {
        expect(formatActivityTitle('SALE', 2, 'kg', 'Sugar'))
            .toBe(formatTransactionTitle('SALE', 2, 'kg', 'Sugar'));
    });
});

describe('formatCurrency', () => {
    it('uses Indian digit grouping with the rupee symbol', () => {
        expect(formatCurrency(1234)).toBe('₹1,234');
        expect(formatCurrency(0)).toBe('₹0');
    });

    it('falls back to zero for non-finite values', () => {
        expect(formatCurrency(NaN)).toBe('₹0');
        expect(formatCurrency(Infinity)).toBe('₹0');
    });
});

describe('formatStockAnswer', () => {
    it('includes the unit when present', () => {
        expect(formatStockAnswer('Sugar', 2.5, 'kg')).toBe('Sugar: 2.5 kg');
    });

    it('omits a missing unit', () => {
        expect(formatStockAnswer('Sugar', 7, undefined)).toBe('Sugar: 7');
    });
});

describe('formatStockListAnswer', () => {
    it('lists up to five items with quantity and unit', () => {
        expect(formatStockListAnswer('Low stock', [
            { name: 'Sugar', quantity: 2, unit: 'kg' },
            { name: 'Salt', quantity: 1, unit: 'packet' },
        ])).toBe('Low stock: Sugar (2 kg), Salt (1 packet)');
    });

    it('summarizes extras beyond five items', () => {
        const items = Array.from({ length: 7 }, (_, index) => ({
            name: `Item ${index + 1}`,
            quantity: 1,
            unit: 'packet',
        }));

        expect(formatStockListAnswer('Low stock', items)).toBe(
            'Low stock: Item 1 (1 packet), Item 2 (1 packet), Item 3 (1 packet), Item 4 (1 packet), Item 5 (1 packet) +2 more'
        );
    });

    it('reports none when the list is empty', () => {
        expect(formatStockListAnswer('Out of stock', [])).toBe('Out of stock: none');
    });
});

describe('formatProfitAnswer', () => {
    it('formats sales, profit and count', () => {
        expect(formatProfitAnswer({ sales: 600, profit: 120, transactionCount: 3 }))
            .toBe('Today: ₹600 sales, ₹120 profit (3 sales)');
    });

    it('uses the singular for one sale', () => {
        expect(formatProfitAnswer({ sales: 50, profit: 10, transactionCount: 1 }))
            .toBe('Today: ₹50 sales, ₹10 profit (1 sale)');
    });
});

describe('formatFriendlyQuantity', () => {
    it('formats kilograms with grams', () => {
        expect(formatFriendlyQuantity(47.75, 'kg')).toBe('47 kg 750 g');
        expect(formatFriendlyQuantity(4.9, 'kg')).toBe('4 kg 900 g');
        expect(formatFriendlyQuantity(50, 'kg')).toBe('50 kg');
        expect(formatFriendlyQuantity(0.5, 'kg')).toBe('500 g');
    });

    it('formats litres with millilitres', () => {
        expect(formatFriendlyQuantity(1.25, 'l')).toBe('1 L 250 ml');
        expect(formatFriendlyQuantity(15, 'l')).toBe('15 L');
    });

    it('formats pcs with a secondary packaging unit', () => {
        expect(formatFriendlyQuantity(52, 'pcs', { secondaryUnit: 'peti', conversionFactor: 24 }))
            .toBe('2 petis & 4 pkts (52 pcs)');
        expect(formatFriendlyQuantity(26, 'pcs', { secondaryUnit: 'dozen', conversionFactor: 12 }))
            .toBe('2 dozen & 2 pcs');
        expect(formatFriendlyQuantity(48, 'pcs', { secondaryUnit: 'peti', conversionFactor: 24 }))
            .toBe('2 petis (48 pcs)');
        expect(formatFriendlyQuantity(26, 'pcs', { secondaryUnit: 'box', conversionFactor: 12 }))
            .toBe('2 boxes & 2 pkts (26 pcs)');
        expect(formatFriendlyQuantity(60, 'pcs', { secondaryUnit: 'carton', conversionFactor: 24 }))
            .toBe('2 cartons & 12 pkts (60 pcs)');
    });

    it('falls back to plain formatting', () => {
        expect(formatFriendlyQuantity(7, 'pcs')).toBe('7 pcs');
        expect(formatFriendlyQuantity(3, 'bori')).toBe('3 bori');
        expect(formatFriendlyQuantity(-2, 'kg')).toBe('-2 kg');
    });

    it('renders zero-safe output for NaN/Infinity instead of crashing', () => {
        expect(formatFriendlyQuantity(NaN, 'kg')).toBe('0 kg');
        expect(formatFriendlyQuantity(Infinity, 'l')).toBe('0 l');
        expect(formatFriendlyQuantity(NaN, null)).toBe('0');
    });

    it('renders zero in the base unit instead of the sub-unit', () => {
        expect(formatFriendlyQuantity(0, 'kg')).toBe('0 kg');
        expect(formatFriendlyQuantity(0, 'l')).toBe('0 l');
        expect(formatFriendlyQuantity(0, 'm')).toBe('0 m');
    });
});
