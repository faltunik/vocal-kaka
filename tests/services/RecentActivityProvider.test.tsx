import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { RecentActivityProvider, useRecentActivity } from '@/services/RecentActivityContext';

let mockUser: { id: string } | null = { id: 'u1' };
let mockStoreId: string | null = 'store-a';
const mockGetRecentEvents = jest.fn();
const mockApplyCorrection = jest.fn().mockResolvedValue(true);

jest.mock('@/services/AuthContext', () => ({
    useAuth: () => ({ user: mockUser, isGuest: false }),
}));

jest.mock('@/hooks/useStoreScope', () => ({
    useStoreScope: () => ({ storeId: mockStoreId }),
}));

jest.mock('@/services/Container', () => ({
    container: {
        inventoryRepository: {
            getRecentEvents: (...args: unknown[]) => mockGetRecentEvents(...args),
        },
        inventoryService: {
            applyCorrection: (...args: unknown[]) => mockApplyCorrection(...args),
            voidEvent: jest.fn().mockResolvedValue(true),
        },
    },
}));

const eventA = {
    event_id: 'a1',
    user_id: 'u1',
    store_id: 'store-a',
    type: 'SOLD',
    payload: { product: 'Sugar', quantity: 1, unit: 'kg', price: 40 },
    ledger_event_id: 'l1',
    created_at: new Date().toISOString(),
};

const eventB = {
    ...eventA,
    event_id: 'b1',
    store_id: 'store-b',
    payload: { product: 'Milk', quantity: 2, unit: 'l', price: 30 },
};

const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(RecentActivityProvider, null, children);

describe('RecentActivityProvider store scoping', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUser = { id: 'u1' };
        mockStoreId = 'store-a';
        mockGetRecentEvents.mockImplementation((scope: { storeId?: string | null }) =>
            Promise.resolve(scope.storeId === 'store-a' ? [eventA] : [eventB]));
    });

    it('clears and replaces the feed when the store switches', async () => {
        const { result, rerender } = renderHook(() => useRecentActivity(), { wrapper });

        await waitFor(() => expect(result.current.activities[0]?.id).toBe('a1'));

        mockStoreId = 'store-b';
        rerender({});

        await waitFor(() => expect(result.current.activities[0]?.id).toBe('b1'));
        expect(result.current.activities).toHaveLength(1);
        expect(result.current.activities.some(item => item.id === 'a1')).toBe(false);
    });

    it('dedupes an optimistic row when its persisted twin arrives', async () => {
        mockGetRecentEvents.mockResolvedValue([eventA]);

        const { result } = renderHook(() => useRecentActivity(), { wrapper });
        await waitFor(() => expect(result.current.activities).toHaveLength(1));

        act(() => {
            result.current.addActivity({
                intent: 'SALE',
                item: 'Sugar',
                quantity: 1,
                unit: 'kg',
                timestamp: Date.now(),
                amount: '₹40',
                title: 'Sold 1 kg Sugar',
                subtitle: 'Just now',
            });
        });
        expect(result.current.activities).toHaveLength(2);

        act(() => {
            result.current.refresh();
        });

        await waitFor(() => {
            expect(result.current.activities).toHaveLength(1);
            expect(result.current.activities[0].id).toBe('a1');
        });
    });

    it('keeps optimistic rows when a refresh returns server events', async () => {
        mockGetRecentEvents.mockResolvedValue([eventA]);

        const { result } = renderHook(() => useRecentActivity(), { wrapper });
        await waitFor(() => expect(result.current.activities).toHaveLength(1));

        act(() => {
            result.current.addActivity({
                intent: 'PURCHASE',
                item: 'Sugar',
                quantity: 5,
                unit: 'kg',
                timestamp: Date.now(),
                amount: '₹0',
                title: 'Added 5 kg Sugar',
                subtitle: 'Scanned',
            });
        });
        expect(result.current.activities).toHaveLength(2);

        act(() => {
            result.current.refresh();
        });

        await waitFor(() => {
            expect(result.current.activities.some(item => item.id === 'a1')).toBe(true);
            expect(result.current.activities.some(item => !item.persisted)).toBe(true);
            expect(result.current.activities).toHaveLength(2);
        });
    });

    it('reuses the raw ledger amount when correcting a transaction', async () => {
        const priced = {
            ...eventA,
            payload: { product: 'Sugar', quantity: 1.5, unit: 'kg', amount_spent: 98.25, price: 65.5 },
        };
        mockGetRecentEvents.mockResolvedValue([priced]);

        const { result } = renderHook(() => useRecentActivity(), { wrapper });
        await waitFor(() => expect(result.current.activities).toHaveLength(1));

        act(() => {
            result.current.updateActivity('a1', { subtitle: 'Edited' });
        });

        await waitFor(() => expect(mockApplyCorrection).toHaveBeenCalled());
        const payload = mockApplyCorrection.mock.calls[0][3] as { price?: number };
        // 98.25 / 1.5 = 65.5 — must not be recomputed from the ₹98 display string.
        expect(payload.price).toBeCloseTo(65.5, 3);
    });

    it('expires optimistic rows that never persist', async () => {
        jest.useFakeTimers();
        mockGetRecentEvents.mockResolvedValue([]);

        const { result } = renderHook(() => useRecentActivity(), { wrapper });
        await act(async () => { await Promise.resolve(); });

        act(() => {
            result.current.addActivity({
                intent: 'SALE',
                item: 'Sugar',
                quantity: 1,
                unit: 'kg',
                timestamp: Date.now(),
                amount: '₹40',
                title: 'Sold 1 kg Sugar',
                subtitle: 'Just now',
            });
        });
        expect(result.current.activities).toHaveLength(1);

        act(() => {
            jest.advanceTimersByTime(45_000);
        });
        expect(result.current.activities).toHaveLength(0);

        jest.useRealTimers();
    });
});
