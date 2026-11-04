import { LedgerEvent, LedgerEventType } from '@/core/interfaces/IInventoryRepository';
import { ActivityIntent, formatActivityTitle, formatClockTime, formatCurrency, formatDayLabel } from '@/utils/format';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { toScope } from '@/core/interfaces/IInventoryRepository';
import { useStoreScope } from '@/hooks/useStoreScope';
import { useAuth } from './AuthContext';
import { container } from './Container';

export interface TransactionItem {
    id: string;
    intent: ActivityIntent;
    item: string;
    quantity: number;
    unit: string;
    timestamp: number;
    amount: string;
    title: string;
    subtitle: string;
    needsReview?: boolean;
    persisted?: boolean;
    eventId?: string;
    /** Store the event belongs to (null for legacy per-user rows). */
    storeId?: string | null;
    payload?: Record<string, unknown>;
}

interface RecentActivityContextType {
    activities: TransactionItem[];
    loading: boolean;
    error: Error | null;
    addActivity: (activity: Omit<TransactionItem, 'id'>) => void;
    updateActivity: (id: string, updates: Partial<TransactionItem>) => void;
    deleteActivity: (id: string) => void;
    refresh: () => void;
}

const RECENT_EVENTS_LIMIT = 100;

const EVENT_TO_ACTIVITY: Partial<Record<LedgerEventType, ActivityIntent>> = {
    PURCHASED: 'PURCHASE',
    SOLD: 'SALE',
    WRITE_OFF: 'WRITE_OFF',
    CUSTOMER_RETURN: 'CUSTOMER_RETURN',
    VENDOR_RETURN: 'VENDOR_RETURN',
    ADJUSTED: 'ADJUSTMENT',
    EXPENSE: 'EXPENSE',
};

function parseAmountString(value: string): number {
    return Number(String(value).replace(/[^\d.]/g, '')) || 0;
}

/**
 * Exact numeric amount for corrections. Prefers the raw ledger payload over
 * the display string, whose ₹-formatting rounds paise away.
 */
function resolveRawAmount(item: TransactionItem): number {
    const fromPayload = Number(item.payload?.amount_spent ?? item.payload?.amount);
    if (Number.isFinite(fromPayload) && fromPayload > 0) {
        return fromPayload;
    }
    return parseAmountString(item.amount);
}

/**
 * Semantic identity for optimistic/twin matching: a persisted ledger row and
 * its optimistic echo share intent, item, quantity and unit (or expense value).
 */
function activityMatchKey(item: TransactionItem): string {
    const name = item.item.trim().toLowerCase();
    const unit = (item.unit || '').trim().toLowerCase();
    if (item.intent === 'EXPENSE') {
        return `EXPENSE|${name}|${item.amount}`;
    }
    return `${item.intent}|${name}|${Number(item.quantity) || 0}|${unit}`;
}

/**
 * Maps a ledger event to a feed row. Non-feed events (ADJUSTED, PRICE_UPDATED,
 * VOID) return null and stay out of the activity list.
 */
export function mapEventToActivity(event: LedgerEvent): TransactionItem | null {
    const intent = EVENT_TO_ACTIVITY[event.type];
    if (!intent) return null;

    const payload = event.payload ?? {};
    const isExpense = intent === 'EXPENSE';
    const isAdjustment = intent === 'ADJUSTMENT';
    const item = String(payload.product ?? payload.note ?? 'Expense') || 'Expense';
    // Adjustments carry a signed delta; other events carry a quantity.
    const rawQuantity = isAdjustment ? payload.delta : payload.quantity;
    const parsedQuantity = Number(rawQuantity);
    const quantity = rawQuantity != null && Number.isFinite(parsedQuantity) ? parsedQuantity : 1;
    const unit = String(payload.unit ?? (isExpense ? '' : 'units'));
    const price = Number(payload.price) || Number(payload.unit_price_used) || 0;
    const rawAmount = Number(payload.amount_spent ?? payload.amount);
    const amount = isExpense 
        ? (Number(payload.amount) || 0) 
        : (rawAmount > 0 ? rawAmount : price * quantity);
    const date = new Date(event.created_at);
    const adjustmentTitle = `Adjusted ${quantity > 0 ? '+' : ''}${quantity}${unit ? ` ${unit}` : ''} ${item}`
        .replace(/\s+/g, ' ')
        .trim();

    return {
        id: event.event_id,
        intent,
        item,
        quantity,
        unit,
        timestamp: date.getTime(),
        amount: formatCurrency(amount),
        title: isExpense
            ? `Spent ${formatCurrency(amount)}${payload.note ? ` on ${String(payload.note)}` : ''}`
            : isAdjustment
                ? adjustmentTitle
                : formatActivityTitle(intent, quantity, unit, item),
        subtitle: `${formatDayLabel(date)}, ${formatClockTime(date)}`,
        persisted: true,
        eventId: event.event_id,
        storeId: event.store_id ?? null,
        needsReview: payload.needs_weight_review === true || payload.pricing_unresolved === true,
        payload,
    };
}

/** Builds the replacement event used when an existing entry is edited. */
export function activityToEvent(
    item: Pick<TransactionItem, 'intent' | 'item' | 'quantity' | 'unit'>,
    amountValue: number
): { type: LedgerEventType; payload: Record<string, unknown> } | null {
    const unitPrice = amountValue > 0 && item.quantity > 0 ? amountValue / item.quantity : null;

    switch (item.intent) {
        case 'SALE':
            return {
                type: 'SOLD',
                payload: {
                    product: item.item,
                    quantity: item.quantity,
                    unit: item.unit,
                    ...(unitPrice != null ? { price: unitPrice } : {}),
                },
            };
        case 'PURCHASE':
            return {
                type: 'PURCHASED',
                payload: {
                    product: item.item,
                    quantity: item.quantity,
                    unit: item.unit,
                    ...(unitPrice != null ? { price: unitPrice } : {}),
                },
            };
        case 'CUSTOMER_RETURN':
            return {
                type: 'CUSTOMER_RETURN',
                payload: {
                    product: item.item,
                    quantity: item.quantity,
                    unit: item.unit,
                    // Preserve value so returns deduct at the true rate, not
                    // whatever the current catalog price happens to be.
                    ...(unitPrice != null ? { price: unitPrice } : {}),
                },
            };
        case 'WRITE_OFF':
        case 'VENDOR_RETURN':
            return {
                type: item.intent,
                payload: { product: item.item, quantity: item.quantity, unit: item.unit },
            };
        case 'ADJUSTMENT':
            return {
                type: 'ADJUSTED',
                payload: {
                    product: item.item,
                    delta: item.quantity,
                    ...(item.unit ? { unit: item.unit } : {}),
                },
            };
        case 'EXPENSE':
            return {
                type: 'EXPENSE',
                payload: { amount: amountValue, note: item.item === 'Expense' ? '' : item.item },
            };
        default:
            return null;
    }
}

const RecentActivityContext = createContext<RecentActivityContextType | null>(null);

/** Optimistic rows that never persist are dropped after this TTL. */
const OPTIMISTIC_TTL_MS = 45_000;

export const RecentActivityProvider = ({ children }: { children: React.ReactNode }) => {
    const { user, isGuest } = useAuth();
    const { storeId } = useStoreScope();
    const [activities, setActivities] = useState<TransactionItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const userIdRef = useRef<string | null>(null);
    const storeIdRef = useRef<string | null | undefined>(undefined);
    const requestIdRef = useRef(0);
    const pendingMutationsRef = useRef<Set<string>>(new Set());
    const optimisticTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
    userIdRef.current = user?.id ?? null;

    const fetchActivities = async () => {
        if (!user) {
            // Keep optimistic guest activities: only a real sign-out clears the feed
            if (!isGuest) setActivities([]);
            setLoading(false);
            setError(null);
            return;
        }

        const requestUserId = user.id;
        const requestStoreId = storeId;
        const requestId = ++requestIdRef.current;
        setLoading(true);
        setError(null);

        try {
            const events = await container.inventoryRepository.getRecentEvents(
                toScope(requestUserId, requestStoreId ?? undefined),
                RECENT_EVENTS_LIMIT
            );

            // Ignore responses for a superseded request, account or store
            if (userIdRef.current !== requestUserId
                || requestId !== requestIdRef.current
                || storeIdRef.current !== requestStoreId) {
                return;
            }

            const fetched = events
                .map(mapEventToActivity)
                .filter((item): item is TransactionItem => item !== null);

            // Keep optimistic (not-yet-persisted) rows, but drop ones whose
            // persisted twin already arrived so online actions never double up.
            setActivities(prev => {
                const fetchedIds = new Set(fetched.map(item => item.id));
                const serverKeys = new Map<string, number>();
                for (const item of fetched) {
                    const key = activityMatchKey(item);
                    serverKeys.set(key, (serverKeys.get(key) ?? 0) + 1);
                }

                const pending = prev.filter(item => {
                    if (item.persisted || fetchedIds.has(item.id)) return false;
                    const key = activityMatchKey(item);
                    const available = serverKeys.get(key) ?? 0;
                    if (available > 0) {
                        serverKeys.set(key, available - 1);
                        return false;
                    }
                    return true;
                });

                return [...pending, ...fetched];
            });
        } catch (e) {
            console.error('Failed to fetch activities', e);
            if (requestId === requestIdRef.current) {
                setError(e instanceof Error ? e : new Error(String(e)));
            }
        } finally {
            if (requestId === requestIdRef.current) {
                setLoading(false);
            }
        }
    };

    useEffect(() => {
        const nextStoreId = storeId;
        // Clear immediately on a store switch so the previous store's rows are
        // never shown under the new store while the refetch is in flight.
        if (storeIdRef.current !== undefined && storeIdRef.current !== nextStoreId) {
            setActivities([]);
        }
        storeIdRef.current = nextStoreId;
        fetchActivities();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, isGuest, storeId]);

    useEffect(() => () => {
        for (const timer of optimisticTimersRef.current.values()) {
            clearTimeout(timer);
        }
        optimisticTimersRef.current.clear();
    }, []);

    const addActivity = (activity: Omit<TransactionItem, 'id'>) => {
        const newActivity: TransactionItem = {
            ...activity,
            id: Math.random().toString(36).slice(2, 11),
            persisted: false
        };
        // Optimistic update until the next ledger refresh replaces it
        setActivities(prev => [newActivity, ...prev]);

        const timer = setTimeout(() => {
            optimisticTimersRef.current.delete(newActivity.id);
            setActivities(prev => prev.filter(item => !(item.id === newActivity.id && !item.persisted)));
        }, OPTIMISTIC_TTL_MS);
        optimisticTimersRef.current.set(newActivity.id, timer);
    };

    const updateActivity = (id: string, updates: Partial<TransactionItem>) => {
        const existing = activities.find(item => item.id === id);
        if (!existing) return;

        if (!existing.persisted) {
            Alert.alert('Still syncing', 'This entry is not saved yet. Try again in a moment.');
            return;
        }

        // Prevent a second edit/delete from voiding the same event twice
        if (pendingMutationsRef.current.has(id)) return;

        // Guard BEFORE the optimistic update: an entry that cannot reach the
        // ledger must not appear edited in the feed.
        if (!user || !existing.eventId) {
            Alert.alert('Cannot edit', 'This entry is not saved yet. Try again in a moment.');
            return;
        }

        const resolved: TransactionItem = { ...existing, ...updates };
        setActivities(prev => prev.map(item => item.id === id ? resolved : item));

        pendingMutationsRef.current.add(id);
        void (async () => {
            try {
                // Correct against the event's own store, not the currently
                // selected one (they can differ during/after a store switch).
                const scope = toScope(user.id, existing.storeId ?? storeId);
                const replacement = activityToEvent(resolved, resolveRawAmount(existing));
                const applied = await container.inventoryService.applyCorrection(
                    scope,
                    existing.eventId!,
                    replacement?.type ?? null,
                    replacement?.payload ?? null
                );
                if (!applied) {
                    // Revert the optimistic row so the feed matches the ledger.
                    setActivities(prev => prev.map(item => item.id === id ? existing : item));
                    Alert.alert('Edit failed', 'The change could not be saved.');
                }
                fetchActivities();
            } catch (e) {
                console.error('Failed to apply transaction edit', e);
                setActivities(prev => prev.map(item => item.id === id ? existing : item));
                fetchActivities();
            } finally {
                pendingMutationsRef.current.delete(id);
            }
        })();
    };

    const deleteActivity = (id: string) => {
        const existing = activities.find(item => item.id === id);
        if (!existing) return;

        if (!existing.persisted) {
            Alert.alert('Still syncing', 'This entry is not saved yet. Try again in a moment.');
            return;
        }

        if (pendingMutationsRef.current.has(id)) return;

        // Guard BEFORE the optimistic removal (see updateActivity).
        if (!user || !existing.eventId) {
            Alert.alert('Cannot delete', 'This entry is not saved yet. Try again in a moment.');
            return;
        }

        // Cancel any optimistic-expiry timer for this row
        const optimisticTimer = optimisticTimersRef.current.get(id);
        if (optimisticTimer) {
            clearTimeout(optimisticTimer);
            optimisticTimersRef.current.delete(id);
        }

        setActivities(prev => prev.filter(item => item.id !== id));

        pendingMutationsRef.current.add(id);
        void (async () => {
            try {
                // Void through the atomic RPC so the correction lands in the
                // event's own store and replays are idempotent for all members.
                const scope = toScope(user.id, existing.storeId ?? storeId);
                const voided = await container.inventoryService.applyCorrection(
                    scope,
                    existing.eventId!,
                    null,
                    null
                );
                if (!voided) {
                    // Restore the row if the void never landed.
                    setActivities(prev => (prev.some(item => item.id === id) ? prev : [existing, ...prev]));
                    Alert.alert('Delete failed', 'Could not undo the entry.');
                }
                fetchActivities();
            } catch (e) {
                console.error('Failed to void transaction', e);
                setActivities(prev => (prev.some(item => item.id === id) ? prev : [existing, ...prev]));
                fetchActivities();
            } finally {
                pendingMutationsRef.current.delete(id);
            }
        })();
    };

    return (
        <RecentActivityContext.Provider value={{ activities, loading, error, addActivity, updateActivity, deleteActivity, refresh: fetchActivities }}>
            {children}
        </RecentActivityContext.Provider>
    );
};

export const useRecentActivity = () => {
    const context = useContext(RecentActivityContext);
    if (!context) throw new Error('useRecentActivity must be used within RecentActivityProvider');
    return context;
};
