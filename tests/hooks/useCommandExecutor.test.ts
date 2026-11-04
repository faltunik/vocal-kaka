import { renderHook } from '@testing-library/react-native';
import { useCommandExecutor } from '@/hooks/useCommandExecutor';

const mockRefresh = jest.fn();

jest.mock('@/services/AuthContext', () => ({
    useAuth: () => ({ user: { id: 'u1' }, isGuest: false }),
}));

jest.mock('@/services/RecentActivityContext', () => ({
    useRecentActivity: () => ({ refresh: mockRefresh }),
}));

describe('useCommandExecutor', () => {
    beforeEach(() => jest.clearAllMocks());

    it('refreshes the feed for applied actions and returns answers', async () => {
        const { result } = renderHook(() => useCommandExecutor());

        const answers = await result.current.execute({
            transcript: 'do kilo sugar becha',
            actions: [{ intent: 'SALE', item: 'Sugar', quantity: 2, unit: 'kg', amount: 80 }],
            applied: 1,
            answers: [{ intent: 'CHECK_STOCK', text: 'Sugar: 10 kg' }],
        });

        expect(mockRefresh).toHaveBeenCalledTimes(1);
        expect(answers).toEqual([{ intent: 'CHECK_STOCK', text: 'Sugar: 10 kg' }]);
    });

    it('does not refresh when nothing was applied', async () => {
        const { result } = renderHook(() => useCommandExecutor());

        await result.current.execute({
            transcript: 'aaj ka profit',
            actions: [{ intent: 'CHECK_PROFIT' }],
            applied: 0,
            answers: [{ intent: 'CHECK_PROFIT', text: 'Today: ₹0' }],
        });

        expect(mockRefresh).not.toHaveBeenCalled();
    });

    it('ignores queued results (offline voice queue owns the retry)', async () => {
        const { result } = renderHook(() => useCommandExecutor());

        const answers = await result.current.execute({
            transcript: '',
            actions: [],
            applied: 0,
            answers: [],
            queued: true,
        });

        expect(answers).toEqual([]);
        expect(mockRefresh).not.toHaveBeenCalled();
    });
});
