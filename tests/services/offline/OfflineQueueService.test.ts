import AsyncStorage from '@react-native-async-storage/async-storage';
import { LedgerEventInput } from '@/core/interfaces/IInventoryRepository';
import { OfflineQueueService, offlineRetryDelayMs } from '@/services/offline/OfflineQueueService';

const event = (ledgerId: string, overrides: Partial<LedgerEventInput> = {}): LedgerEventInput => ({
    user_id: 'user-1',
    store_id: 'store-1',
    type: 'SOLD',
    payload: { product: 'Sugar', quantity: 2, unit: 'kg' },
    ledger_event_id: ledgerId,
    ...overrides,
});

describe('OfflineQueueService', () => {
    let queue: OfflineQueueService;
    let storageKey: string;

    beforeEach(async () => {
        jest.clearAllMocks();
        await AsyncStorage.clear();
        storageKey = `test-ledger-queue-${Math.random().toString(36).slice(2)}`;
        queue = new OfflineQueueService(storageKey, 200, 3);
    });

    it('flushes queued events in order, preserving idempotency keys', async () => {
        await queue.enqueue([event('a'), event('b'), event('c')]);
        const sent: string[] = [];
        const send = jest.fn(async (events: LedgerEventInput[]) => {
            sent.push(events[0].ledger_event_id);
            return true;
        });

        const applied = await queue.flush(send);

        expect(applied).toBe(3);
        expect(sent).toEqual(['a', 'b', 'c']);
        expect(await queue.pendingCount()).toBe(0);
    });

    it('keeps unflushed events (and the queue order) when the network is down', async () => {
        await queue.enqueue([event('a'), event('b')]);
        const send = jest
            .fn<Promise<boolean>, [LedgerEventInput[]]>()
            .mockResolvedValueOnce(false);

        const applied = await queue.flush(send);

        expect(applied).toBe(0);
        expect(await queue.pendingCount()).toBe(2);

        // Reconnection: the first retry is the same head event
        const sent: string[] = [];
        const reconnect = jest.fn(async ([next]: LedgerEventInput[]) => {
            sent.push(next.ledger_event_id);
            return true;
        });
        await queue.flush(reconnect);
        expect(sent).toEqual(['a', 'b']);
        expect(await queue.pendingCount()).toBe(0);
    });

    it('deduplicates the same tenant + ledger id on enqueue', async () => {
        await queue.enqueue([event('a')]);
        await queue.enqueue([event('a')]);

        expect(await queue.pendingCount()).toBe(1);
    });

    it('drops poison pills after the attempt limit instead of blocking the queue', async () => {
        await queue.enqueue([event('bad'), event('good')]);
        const send = jest.fn(async ([next]: LedgerEventInput[]) => next.ledger_event_id === 'good');

        await queue.flush(send);
        await queue.flush(send);
        await queue.flush(send);
        await queue.flush(send);

        expect(await queue.pendingCount()).toBe(0);
        const accepted = send.mock.calls
            .map(([events]) => events[0].ledger_event_id)
            .filter(id => id === 'good');
        expect(accepted).toHaveLength(1);
    });

    it('survives a reload from AsyncStorage (crash/reboot resilience)', async () => {
        await queue.enqueue([event('persisted')]);
        const restored = new OfflineQueueService(storageKey);
        const send = jest.fn().mockResolvedValue(true);

        const applied = await restored.flush(send);

        expect(applied).toBe(1);
        expect(send).toHaveBeenCalledWith([event('persisted')]);
    });

    it('keeps events across long offline stretches (transport throws are not poison pills)', async () => {
        await queue.enqueue([event('a'), event('b')]);
        const send = jest.fn().mockRejectedValue(new Error('Network request failed'));
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

        // Many failed cycles while offline must never drop or reorder events
        for (let cycle = 0; cycle < 12; cycle++) {
            expect(await queue.flush(send)).toBe(0);
        }

        expect(await queue.pendingCount()).toBe(2);

        const sent: string[] = [];
        const reconnect = jest.fn(async ([next]: LedgerEventInput[]) => {
            sent.push(next.ledger_event_id);
            return true;
        });
        await queue.flush(reconnect);
        expect(sent).toEqual(['a', 'b']);
        expect(await queue.pendingCount()).toBe(0);

        warnSpy.mockRestore();
    });

    it('backs retries off exponentially up to a 60s cap', () => {
        expect(offlineRetryDelayMs(1)).toBe(5_000);
        expect(offlineRetryDelayMs(2)).toBe(10_000);
        expect(offlineRetryDelayMs(3)).toBe(20_000);
        expect(offlineRetryDelayMs(4)).toBe(40_000);
        expect(offlineRetryDelayMs(5)).toBe(60_000);
        expect(offlineRetryDelayMs(12)).toBe(60_000);
    });

    it('notifies subscribers with the pending count on enqueue and flush', async () => {
        const counts: number[] = [];
        const unsubscribe = queue.subscribe(count => counts.push(count));

        await queue.enqueue([event('a')]);
        await queue.flush(jest.fn().mockResolvedValue(true));
        unsubscribe();

        // Hydration emits 0, enqueue emits 1, successful flush emits 0
        expect(counts[0]).toBe(0);
        expect(counts).toContain(1);
        expect(counts[counts.length - 1]).toBe(0);
    });

    it('isolates throwing subscribers from enqueue callers', async () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const received: number[] = [];
        queue.subscribe(() => {
            throw new Error('bad listener');
        });
        queue.subscribe(count => received.push(count));

        await expect(queue.enqueue([event('a')])).resolves.toBeUndefined();

        expect(received).toContain(1);
        warnSpy.mockRestore();
    });

    it('preserves a corrupt queue payload for recovery instead of overwriting it', async () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        await AsyncStorage.setItem(storageKey, '{not-json');

        expect(await queue.pendingCount()).toBe(0);

        const keys = await AsyncStorage.getAllKeys();
        expect(keys.some(key => key.startsWith(`${storageKey}:corrupt-`))).toBe(true);
        warnSpy.mockRestore();
    });

    it('auto-flushes on an exponential backoff schedule and stops on cleanup', async () => {
        jest.useFakeTimers();
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            await queue.enqueue([event('a')]);
            const send = jest.fn().mockRejectedValue(new Error('Network request failed'));

            const stop = queue.startAutoFlush(send);

            expect(send).not.toHaveBeenCalled();
            await jest.advanceTimersByTimeAsync(5_000);
            expect(send).toHaveBeenCalledTimes(1);

            await jest.advanceTimersByTimeAsync(10_000);
            expect(send).toHaveBeenCalledTimes(2);

            stop();
            await jest.advanceTimersByTimeAsync(120_000);
            expect(send).toHaveBeenCalledTimes(2);
            expect(await queue.pendingCount()).toBe(1);
        } finally {
            warnSpy.mockRestore();
            jest.useRealTimers();
        }
    });
});
