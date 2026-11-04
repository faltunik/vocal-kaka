import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useHistoryAggregator } from '@/hooks/useHistoryAggregator';
import { TransactionItem } from '@/services/RecentActivityContext';
import { container } from '@/services/Container';
import { LedgerEvent } from '@/core/interfaces/IInventoryRepository';

let mockActivities: TransactionItem[] = [];

jest.mock('@/services/RecentActivityContext', () => {
    const actual = jest.requireActual('@/services/RecentActivityContext');
    return {
        ...actual,
        useRecentActivity: () => ({ activities: mockActivities, refresh: jest.fn() }),
    };
});

jest.mock('@/services/AuthContext', () => ({
    useAuth: () => ({ user: { id: 'user-1' }, isGuest: false }),
}));

jest.mock('@/hooks/useStoreScope', () => {
    // Stable function identities: a new currentScope per render would retrigger
    // the historical-fetch effect indefinitely.
    const currentScope = () => 'user-1';
    const currentStoreId = () => null;
    return {
        useStoreScope: () => ({
            scope: 'user-1',
            scopeKey: 'user-1',
            storeId: null,
            userId: 'user-1',
            currentScope,
            currentStoreId,
        }),
    };
});

function activity(partial: Partial<TransactionItem>): TransactionItem {
    return {
        id: Math.random().toString(36).slice(2),
        intent: 'SALE',
        item: 'Sugar',
        quantity: 1,
        unit: 'kg',
        timestamp: Date.now(),
        amount: '₹10',
        title: 'Sold 1 kg Sugar',
        subtitle: 'Today',
        persisted: true,
        ...partial,
    };
}

describe('useHistoryAggregator', () => {
    beforeEach(() => {
        mockActivities = [];
    });

    it('merges case/space variants of the same item', () => {
        mockActivities = [
            activity({ item: 'Sugar', quantity: 2 }),
            activity({ item: 'sugar ', quantity: 3 }),
        ];

        const { result } = renderHook(() => useHistoryAggregator());

        expect(result.current.aggregatedData).toHaveLength(1);
        expect(result.current.aggregatedData[0].totalQty).toBe(5);
        expect(result.current.aggregatedData[0].count).toBe(2);
    });

    it('keeps different units separate', () => {
        mockActivities = [
            activity({ item: 'Sugar', unit: 'kg', quantity: 2 }),
            activity({ item: 'Sugar', unit: 'g', quantity: 500 }),
        ];

        const { result } = renderHook(() => useHistoryAggregator());

        expect(result.current.aggregatedData).toHaveLength(2);
    });

    it('counts sale and purchase totals per tab', () => {
        mockActivities = [
            activity({ intent: 'SALE' }),
            activity({ intent: 'SALE' }),
            activity({ intent: 'PURCHASE' }),
        ];

        const { result } = renderHook(() => useHistoryAggregator());

        expect(result.current.totalStats).toEqual({ totalSales: 2, totalPurchases: 1 });
    });

    it('filters wastage, expenses and adjustments under their audit tabs', () => {
        mockActivities = [
            activity({ intent: 'SALE' }),
            activity({ intent: 'WRITE_OFF', item: 'Tomato' }),
            activity({ intent: 'EXPENSE', item: 'Bijli bill', unit: '', amount: '₹1500' }),
            activity({ intent: 'CUSTOMER_RETURN', item: 'Curd' }),
            activity({ intent: 'VENDOR_RETURN', item: 'Chips' }),
            activity({ intent: 'ADJUSTMENT', item: 'Sugar', quantity: -3 }),
        ];

        const { result } = renderHook(() => useHistoryAggregator());

        act(() => result.current.setActiveTab('WRITE_OFF'));
        expect(result.current.aggregatedData.map(item => item.name)).toEqual(['Tomato']);

        act(() => result.current.setActiveTab('EXPENSE'));
        expect(result.current.aggregatedData.map(item => item.name)).toEqual(['Bijli bill']);

        act(() => result.current.setActiveTab('ADJUSTMENT'));
        expect(result.current.aggregatedData.map(item => item.name)).toEqual(['Curd', 'Chips', 'Sugar']);

        act(() => result.current.setActiveTab('ALL'));
        expect(result.current.aggregatedData).toHaveLength(6);
    });

    it('loads past dates from the database ledger instead of the recent cache', async () => {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        const historicalEvent: LedgerEvent = {
            event_id: 'e-old',
            user_id: 'user-1',
            store_id: null,
            type: 'SOLD',
            payload: { product: 'Oil', quantity: 1, unit: 'l', price: 140 },
            ledger_event_id: 'ledger-old',
            created_at: new Date(
                yesterday.getFullYear(),
                yesterday.getMonth(),
                yesterday.getDate(),
                12
            ).toISOString(),
        };
        const spy = jest
            .spyOn(container.inventoryRepository, 'getEventsForDateRange')
            .mockResolvedValue([historicalEvent]);
        mockActivities = [activity({ item: 'Today Item' })];

        const { result } = renderHook(() => useHistoryAggregator());

        act(() => result.current.setSelectedDate(yesterday));

        await waitFor(() => {
            expect(result.current.rawActivities.some(item => item.item === 'Oil')).toBe(true);
        });
        expect(result.current.rawActivities.some(item => item.item === 'Today Item')).toBe(false);
        expect(spy).toHaveBeenCalledWith('user-1', expect.any(String), expect.any(String));

        spy.mockRestore();
    });

    it('loads the full week (from Monday) in WEEK range mode', async () => {
        const spy = jest
            .spyOn(container.inventoryRepository, 'getEventsForDateRange')
            .mockResolvedValue([]);

        const { result } = renderHook(() => useHistoryAggregator());

        act(() => result.current.setRangeMode('WEEK'));

        await waitFor(() => {
            expect(spy).toHaveBeenCalled();
        });

        const [, startIso, endIso] = spy.mock.calls[0];
        const start = new Date(startIso as string);
        const end = new Date(endIso as string);
        expect(start.getDay()).toBe(1); // Monday
        expect(start.getHours()).toBe(0);
        expect(end.getTime()).toBeGreaterThan(start.getTime());

        spy.mockRestore();
    });
});
