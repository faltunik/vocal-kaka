import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useAsyncData } from '@/hooks/useAsyncData';

describe('useAsyncData', () => {
    it('loads data and clears loading', async () => {
        const fetcher = jest.fn().mockResolvedValue(42);

        const { result } = renderHook(() => useAsyncData('key', fetcher, { initialData: 0 }));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.data).toBe(42);
        expect(result.current.error).toBeNull();
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('ignores a stale response after the key changes', async () => {
        const resolvers: Array<(value: number) => void> = [];
        const fetcher = jest.fn(() => new Promise<number>((resolve) => resolvers.push(resolve)));

        const { result, rerender } = renderHook(
            ({ key }: { key: string }) => useAsyncData(key, fetcher, { initialData: -1 }),
            { initialProps: { key: 'a' } }
        );

        rerender({ key: 'b' });

        await act(async () => {
            resolvers[1]?.(2);
            await Promise.resolve();
        });
        await act(async () => {
            resolvers[0]?.(1);
            await Promise.resolve();
        });

        expect(result.current.data).toBe(2);
    });

    it('does not fetch when disabled and resets to the initial data', async () => {
        const fetcher = jest.fn().mockResolvedValue(99);

        const { result } = renderHook(() =>
            useAsyncData('key', fetcher, { initialData: 7, enabled: false })
        );

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(fetcher).not.toHaveBeenCalled();
        expect(result.current.data).toBe(7);
    });
});
