import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, type AppStateStatus } from 'react-native';
import { LedgerEventInput } from '@/core/interfaces/IInventoryRepository';
import { devLog, devWarn } from '@/utils/devLog';

export interface QueuedLedgerEvent extends LedgerEventInput {
    queued_at: number;
    attempts: number;
}

export type LedgerEventSender = (events: LedgerEventInput[]) => Promise<boolean>;

export const OFFLINE_LEDGER_QUEUE_KEY = 'vocalstock:pending-ledger-events';

/** Bound the queue so a long offline stretch cannot grow without limit. */
const MAX_QUEUE = 200;
/** Drop poison pills (RLS/server rejections) after this many failed flushes. */
const MAX_ATTEMPTS = 5;
const AUTO_FLUSH_BASE_MS = 5_000;
const AUTO_FLUSH_MAX_MS = 60_000;

/**
 * Exponential backoff for auto-flush retries: 5s, 10s, 20s, 40s, 60s (cap).
 * `failedFlushes` is the number of consecutive failed flush cycles.
 */
export function offlineRetryDelayMs(failedFlushes: number): number {
    const exponent = Math.max(0, Math.min(failedFlushes - 1, 6));
    return Math.min(AUTO_FLUSH_BASE_MS * 2 ** exponent, AUTO_FLUSH_MAX_MS);
}

function tenantKey(event: LedgerEventInput): string {
    return event.store_id ?? event.user_id;
}

/** Tenant + ledger id is the idempotency key the DB enforces. */
function queueKeyOf(event: LedgerEventInput): string {
    return `${tenantKey(event)}:${event.ledger_event_id}`;
}

function toInput(event: QueuedLedgerEvent): LedgerEventInput {
    return {
        user_id: event.user_id,
        ...(event.store_id ? { store_id: event.store_id } : {}),
        type: event.type,
        payload: event.payload,
        ledger_event_id: event.ledger_event_id,
    };
}

/**
 * Durable FIFO queue for ledger events produced while offline (counter sales,
 * scanner stock-in). Events keep their client-generated ledger ids, so flushing
 * is idempotent even if a response was lost after the server committed.
 */
export class OfflineQueueService {
    private queueLock: Promise<unknown> = Promise.resolve();
    private listeners = new Set<(count: number) => void>();

    constructor(
        private readonly storageKey: string = OFFLINE_LEDGER_QUEUE_KEY,
        private readonly maxItems: number = MAX_QUEUE,
        private readonly maxAttempts: number = MAX_ATTEMPTS
    ) {}

    private withLock<T>(task: () => Promise<T>): Promise<T> {
        const run = this.queueLock.then(task, task);
        this.queueLock = run.catch(() => undefined);
        return run;
    }

    private async load(): Promise<QueuedLedgerEvent[]> {
        let raw: string | null = null;
        try {
            raw = await AsyncStorage.getItem(this.storageKey);
        } catch {
            return [];
        }
        if (!raw) return [];

        try {
            const parsed = JSON.parse(raw) as unknown;
            if (!Array.isArray(parsed)) {
                throw new Error('queue payload is not an array');
            }
            return parsed as QueuedLedgerEvent[];
        } catch (error) {
            // Never silently destroy pending transactions: keep the raw value
            // under a recovery key before resetting the live queue.
            devWarn('[OfflineQueue] Corrupt queue preserved for recovery', error);
            try {
                await AsyncStorage.setItem(`${this.storageKey}:corrupt-${Date.now()}`, raw);
                await AsyncStorage.removeItem(this.storageKey);
                // Keep only the two newest recovery snapshots.
                const keys = await AsyncStorage.getAllKeys();
                const snapshots = keys
                    .filter(key => key.startsWith(`${this.storageKey}:corrupt-`))
                    .sort();
                for (const stale of snapshots.slice(0, Math.max(0, snapshots.length - 2))) {
                    await AsyncStorage.removeItem(stale);
                }
            } catch {
                // Recovery copy is best-effort
            }
            return [];
        }
    }

    private async save(items: QueuedLedgerEvent[]): Promise<void> {
        const capped = items.slice(-this.maxItems);
        if (capped.length !== items.length) {
            devWarn(`[OfflineQueue] Queue full (${this.maxItems}); dropped ${items.length - capped.length} oldest event(s)`);
        }
        try {
            await AsyncStorage.setItem(this.storageKey, JSON.stringify(capped));
        } catch {
            // Queue persistence is best-effort; the in-memory return still flushes
        }
    }

    async enqueue(events: LedgerEventInput[]): Promise<void> {
        if (events.length === 0) return;

        await this.withLock(async () => {
            const queue = await this.load();
            const known = new Set(queue.map(queueKeyOf));
            for (const event of events) {
                const key = queueKeyOf(event);
                if (known.has(key)) continue;
                known.add(key);
                queue.push({ ...event, queued_at: Date.now(), attempts: 0 });
            }
            await this.save(queue);
        });
        await this.notify();
    }

    async pendingCount(): Promise<number> {
        return (await this.load()).length;
    }

    /**
     * Subscribes to pending-count changes (enqueue/flush). Emits the current
     * count immediately so UI badges hydrate on mount. Returns an unsubscribe.
     */
    subscribe(listener: (count: number) => void): () => void {
        this.listeners.add(listener);
        let active = true;
        void this.pendingCount()
            .then(count => {
                if (active) listener(count);
            })
            .catch(() => undefined);
        return () => {
            active = false;
            this.listeners.delete(listener);
        };
    }

    private async notify(): Promise<void> {
        if (this.listeners.size === 0) return;
        const count = await this.pendingCount();
        for (const listener of this.listeners) {
            try {
                listener(count);
            } catch (error) {
                // One bad subscriber must never break enqueue/flush callers.
                devWarn('[OfflineQueue] listener failed', error);
            }
        }
    }

    /**
     * Sends queued events FIFO via the supplied transport. Stops at the first
     * failure so per-event order is preserved; already-applied events are
     * removed, and replays stay safe thanks to the ledger idempotency keys.
     */
    async flush(send: LedgerEventSender): Promise<number> {
        return this.withLock(async () => {
            const queue = await this.load();
            if (queue.length === 0) return 0;

            const remaining: QueuedLedgerEvent[] = [];
            let applied = 0;
            let stopped = false;

            for (const event of queue) {
                if (stopped) {
                    remaining.push(event);
                    continue;
                }
                if (event.attempts >= this.maxAttempts) {
                    devWarn('[OfflineQueue] Dropping unrecoverable event', queueKeyOf(event));
                    continue;
                }

                let ok = false;
                try {
                    ok = await send([toInput(event)]);
                } catch (error) {
                    // Transport failure: keep the event, preserve FIFO order, and
                    // do NOT penalize attempts — offline time must never drop data.
                    devWarn('[OfflineQueue] Retryable send failure', error);
                    remaining.push(event);
                    stopped = true;
                    continue;
                }

                if (ok) {
                    applied++;
                    continue;
                }

                // Non-retryable rejection (RLS/validation): count it and stop.
                remaining.push({ ...event, attempts: event.attempts + 1 });
                stopped = true;
            }

            await this.save(remaining);
            if (applied > 0 || remaining.length !== queue.length) {
                await this.notify();
            }
            return applied;
        });
    }

    /**
     * Flushes on app foreground and retries on an exponential backoff schedule
     * (5s → 60s) while events remain queued. Returns a cleanup function.
     */
    startAutoFlush(send: LedgerEventSender): () => void {
        let disposed = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let failedFlushes = 0;

        const schedule = (delayMs: number) => {
            if (disposed) return;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                void attempt();
            }, delayMs);
        };

        const attempt = async () => {
            if (disposed) return;
            try {
                const applied = await this.flush(send);
                if (applied > 0) {
                    devLog(`[OfflineQueue] flushed ${applied} event(s)`);
                }
            } catch (error) {
                devWarn('[OfflineQueue] flush failed', error);
            }

            if (disposed) return;
            const remaining = await this.pendingCount();
            failedFlushes = remaining > 0 ? failedFlushes + 1 : 0;
            // Idle (empty) queues poll slowly; pending queues back off per failure.
            schedule(remaining > 0 ? offlineRetryDelayMs(failedFlushes) : AUTO_FLUSH_MAX_MS);
        };

        const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
            if (state !== 'active') return;
            failedFlushes = 0;
            void attempt();
        });

        schedule(AUTO_FLUSH_BASE_MS);

        return () => {
            disposed = true;
            subscription.remove();
            if (timer) clearTimeout(timer);
        };
    }
}

export const offlineQueue = new OfflineQueueService();
