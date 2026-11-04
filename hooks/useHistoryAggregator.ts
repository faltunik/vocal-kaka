import { useStoreScope } from '@/hooks/useStoreScope';
import { container } from '@/services/Container';
import { useAuth } from '@/services/AuthContext';
import { mapEventToActivity, TransactionItem, useRecentActivity } from '@/services/RecentActivityContext';
import { isSameLocalDay } from '@/utils/format';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';

export type HistoryTab = 'ALL' | 'SALE' | 'PURCHASE' | 'WRITE_OFF' | 'EXPENSE' | 'ADJUSTMENT';
export type HistoryRangeMode = 'DAY' | 'WEEK';

export interface AggregatedItem {
    name: string;
    unit: string;
    intent: TransactionItem['intent'];
    totalQty: number;
    count: number;
    items: TransactionItem[];
}

/** Intents shown under each non-ALL tab (FEAT-06 audit feed). */
const TAB_INTENTS: Record<Exclude<HistoryTab, 'ALL'>, ReadonlyArray<TransactionItem['intent']>> = {
    SALE: ['SALE'],
    PURCHASE: ['PURCHASE'],
    WRITE_OFF: ['WRITE_OFF'],
    EXPENSE: ['EXPENSE'],
    ADJUSTMENT: ['CUSTOMER_RETURN', 'VENDOR_RETURN', 'ADJUSTMENT'],
};

export function startOfLocalDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

export function endOfLocalDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

export function useHistoryAggregator(options: { enabled?: boolean } = {}) {
    const { activities, loading: feedLoading, error: feedError, refresh: refreshFeed } = useRecentActivity();
    const { user } = useAuth();
    const { currentScope, scopeKey } = useStoreScope();
    const enabled = options.enabled !== false;

    const [selectedDate, setSelectedDate] = useState(() => new Date());
    const [activeTab, setActiveTab] = useState<HistoryTab>('ALL');
    const [rangeMode, setRangeMode] = useState<HistoryRangeMode>('DAY');
    const [historicalActivities, setHistoricalActivities] = useState<TransactionItem[]>([]);
    const [fetchedScopeKey, setFetchedScopeKey] = useState<string | null>(null);
    const [loadingHistorical, setLoadingHistorical] = useState(false);
    const [historyError, setHistoryError] = useState<Error | null>(null);
    const [historyVersion, setHistoryVersion] = useState(0);

    // Roll the view forward when the screen regains focus (e.g. after
    // midnight), but never discard an explicit past date/week selection.
    useFocusEffect(useCallback(() => {
        setSelectedDate(prev => (isSameLocalDay(prev, new Date()) ? new Date() : prev));
    }, []));

    const isToday = useMemo(() => isSameLocalDay(selectedDate, new Date()), [selectedDate]);
    const userId = user?.id ?? null;

    const rangeStart = useMemo(() => {
        if (rangeMode === 'WEEK') {
            const monday = new Date(selectedDate);
            const offsetFromMonday = (monday.getDay() + 6) % 7;
            monday.setDate(monday.getDate() - offsetFromMonday);
            return startOfLocalDay(monday);
        }
        return startOfLocalDay(selectedDate);
    }, [rangeMode, selectedDate]);

    const rangeEnd = useMemo(() => {
        if (rangeMode === 'WEEK') {
            const sunday = new Date(rangeStart);
            sunday.setDate(sunday.getDate() + 6);
            return endOfLocalDay(sunday);
        }
        return endOfLocalDay(selectedDate);
    }, [rangeMode, rangeStart, selectedDate]);

    // Only today-in-day-mode reads the optimistic feed; every other selection
    // pulls the complete range from the database ledger.
    const useLiveFeed = rangeMode === 'DAY' && isToday;

    useEffect(() => {
        if (!enabled || !userId || useLiveFeed) {
            setLoadingHistorical(false);
            setHistoryError(null);
            setHistoricalActivities(prev => (prev.length === 0 ? prev : []));
            return;
        }

        let cancelled = false;
        setLoadingHistorical(true);
        setHistoryError(null);

        void (async () => {
            try {
                const events = await container.inventoryRepository.getEventsForDateRange(
                    currentScope(),
                    rangeStart.toISOString(),
                    rangeEnd.toISOString()
                );
                if (cancelled) return;
                setHistoricalActivities(
                    events
                        .map(mapEventToActivity)
                        .filter((item): item is TransactionItem => item !== null)
                );
                // Stamp the scope so stale rows from another store are hidden.
                setFetchedScopeKey(scopeKey);
            } catch (error) {
                console.error('[useHistoryAggregator] Failed to load historical ledger:', error);
                if (!cancelled) {
                    setHistoryError(error instanceof Error ? error : new Error(String(error)));
                    setHistoricalActivities(prev => (prev.length === 0 ? prev : []));
                    setFetchedScopeKey(scopeKey);
                }
            } finally {
                if (!cancelled) setLoadingHistorical(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [enabled, userId, currentScope, scopeKey, rangeStart, rangeEnd, useLiveFeed, historyVersion]);

    const refetchHistorical = useCallback(() => setHistoryVersion(version => version + 1), []);
    // The live feed owns its own fetch, so its retry must refresh the feed.
    const refetch = useCallback(() => {
        if (useLiveFeed) {
            refreshFeed();
        } else {
            refetchHistorical();
        }
    }, [useLiveFeed, refreshFeed, refetchHistorical]);

    // Historical rows only render once they belong to the active scope; the
    // live feed covers today-in-day-mode and owns its own loading/error state.
    const historicalSource = fetchedScopeKey === scopeKey ? historicalActivities : [];
    const sourceActivities = enabled && useLiveFeed ? activities : historicalSource;

    const dayActivities = useMemo(
        () => (enabled
            ? sourceActivities.filter(a => {
                if (a.needsReview) return false;
                const timestamp = new Date(a.timestamp).getTime();
                return timestamp >= rangeStart.getTime() && timestamp <= rangeEnd.getTime();
            })
            : []),
        [sourceActivities, rangeStart, rangeEnd, enabled]
    );

    const filteredData = useMemo(() => {
        if (activeTab === 'ALL') return dayActivities;
        const intents = TAB_INTENTS[activeTab];
        return dayActivities.filter(item => intents.includes(item.intent));
    }, [dayActivities, activeTab]);

    const aggregatedData = useMemo(() => {
        const map = new Map<string, AggregatedItem>();

        filteredData.forEach(item => {
            // Intent is part of the key so an "All" feed never merges a sale
            // with a purchase of the same product.
            const key = `${item.intent}::${item.item.trim().toLowerCase()}::${(item.unit || '').trim().toLowerCase()}`;
            if (!map.has(key)) {
                map.set(key, {
                    name: item.item,
                    unit: item.unit,
                    intent: item.intent,
                    totalQty: 0,
                    count: 0,
                    items: []
                });
            }
            const entry = map.get(key)!;
            entry.totalQty += Number(item.quantity) || 0;
            entry.count += 1;
            entry.items.push(item);
        });

        return Array.from(map.values());
    }, [filteredData]);

    const totalStats = useMemo(() => {
        if (!enabled) return { totalSales: 0, totalPurchases: 0 };
        const totalSales = dayActivities.filter(a => a.intent === 'SALE').length;
        const totalPurchases = dayActivities.filter(a => a.intent === 'PURCHASE').length;
        return { totalSales, totalPurchases };
    }, [dayActivities, enabled]);

    return {
        activeTab,
        setActiveTab,
        selectedDate,
        setSelectedDate,
        rangeMode,
        setRangeMode,
        isToday,
        aggregatedData,
        rawActivities: dayActivities,
        totalStats,
        loading: useLiveFeed ? feedLoading : loadingHistorical,
        error: useLiveFeed ? feedError : historyError,
        refetch,
    };
}
