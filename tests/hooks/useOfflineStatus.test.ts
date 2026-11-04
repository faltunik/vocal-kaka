import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useOfflineStatus } from '@/hooks/useOfflineStatus';
import { container } from '@/services/Container';

describe('useOfflineStatus', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('hydrates the pending count and reacts to queue changes', async () => {
        const listeners: Array<(count: number) => void> = [];
        const unsubscribe = jest.fn();
        jest.spyOn(container.inventoryService, 'pendingOfflineCount').mockResolvedValue(2);
        jest.spyOn(container.inventoryService, 'subscribeOfflineQueue').mockImplementation(listener => {
            listeners.push(listener);
            return unsubscribe;
        });

        const { result, unmount } = renderHook(() => useOfflineStatus());

        await waitFor(() => {
            expect(result.current.pendingCount).toBe(2);
        });
        expect(result.current.hasPendingSync).toBe(true);

        act(() => {
            listeners.forEach(listener => listener(0));
        });
        expect(result.current.hasPendingSync).toBe(false);

        unmount();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
});
