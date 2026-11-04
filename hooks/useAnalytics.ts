import { useAsyncData } from '@/hooks/useAsyncData';
import { useStoreScope } from '@/hooks/useStoreScope';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/services/AuthContext';
import { usePrivacy } from '@/services/PrivacyContext';

export interface AnalyticsEvent {
    type?: string | null;
    payload?: Record<string, unknown> | null;
    created_at?: string | null;
}

export interface AnalyticsInventoryRow {
    name?: string | null;
    quantity?: number | null;
    unit?: string | null;
    base_unit?: string | null;
    selling_price?: number | null;
    category?: string | null;
}

export interface TopSeller {
    name: string;
    quantity: number;
    revenue: number;
}

export interface DeadStockItem {
    name: string;
    quantity: number;
    unit: string;
}

export interface DailyTrendPoint {
    label: string;
    revenue: number;
}

export interface CategoryMix {
    category: string;
    revenue: number;
    share: number;
}

export interface PeakHour {
    label: string;
    count: number;
}

export interface AnalyticsData {
    topSellers: TopSeller[];
    deadStock: DeadStockItem[];
    trend: DailyTrendPoint[];
    categoryMix: CategoryMix[];
    peakHours: PeakHour[];
    totalRevenue: number;
    totalTransactions: number;
}

export const EMPTY_ANALYTICS: AnalyticsData = {
    topSellers: [],
    deadStock: [],
    trend: [],
    categoryMix: [],
    peakHours: [],
    totalRevenue: 0,
    totalTransactions: 0,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Dashboard parity: metrics are bucketed in IST (UTC+5:30). */
function istDayKey(date: Date): string {
    const shifted = new Date(date.getTime() + IST_OFFSET_MS);
    return `${shifted.getUTCFullYear()}-${shifted.getUTCMonth()}-${shifted.getUTCDate()}`;
}

function istHour(date: Date): number {
    return new Date(date.getTime() + IST_OFFSET_MS).getUTCHours();
}

function istWeekdayLabel(date: Date): string {
    return new Date(date.getTime() + IST_OFFSET_MS)
        .toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' });
}

function isRevenueEvent(event: AnalyticsEvent): boolean {
    return event.type === 'SOLD' || event.type === 'CUSTOMER_RETURN';
}

/** Positive revenue for a single event (returns are subtracted by callers). */
function eventRevenue(event: AnalyticsEvent, prices?: Map<string, number>): number {
    const payload = event.payload ?? {};
    const direct = payload.amount_spent ?? payload.amount;
    if (direct != null) {
        const parsed = Number(direct);
        if (Number.isFinite(parsed)) return Math.max(0, parsed);
    }
    const price = Number(payload.price ?? payload.unit_price_used);
    const quantity = Number(payload.calculated_quantity ?? payload.quantity);
    if (Number.isFinite(price) && price > 0 && Number.isFinite(quantity) && quantity > 0) {
        return price * quantity;
    }
    // Same fallback the profit card uses: a voice sale without a spoken price
    // is valued at the product's catalog price, never at zero.
    const catalogPrice = prices?.get(productKey(payload.product)) ?? 0;
    if (catalogPrice > 0 && Number.isFinite(quantity) && quantity > 0) {
        return catalogPrice * quantity;
    }
    return 0;
}

function buildPriceMap(inventory: AnalyticsInventoryRow[]): Map<string, number> {
    const prices = new Map<string, number>();
    for (const row of inventory) {
        const price = Number(row.selling_price);
        if (Number.isFinite(price) && price > 0) prices.set(productKey(row.name), price);
    }
    return prices;
}

function signedRevenue(event: AnalyticsEvent, prices?: Map<string, number>): number {
    const revenue = eventRevenue(event, prices);
    return event.type === 'CUSTOMER_RETURN' ? -revenue : revenue;
}

function signedQuantity(event: AnalyticsEvent): number {
    const quantity = Number(event.payload?.calculated_quantity ?? event.payload?.quantity) || 0;
    return event.type === 'CUSTOMER_RETURN' ? -quantity : quantity;
}

function productKey(name: unknown): string {
    return String(name ?? '').trim().toLowerCase();
}

export function aggregateTopSellers(
    events: AnalyticsEvent[],
    inventory: AnalyticsInventoryRow[],
    limit = 5
): TopSeller[] {
    const displayName = new Map(inventory.map(row => [productKey(row.name), String(row.name ?? '')]));
    const prices = buildPriceMap(inventory);
    const totals = new Map<string, TopSeller>();

    for (const event of events) {
        if (!isRevenueEvent(event)) continue;
        const key = productKey(event.payload?.product);
        if (!key) continue;

        const entry = totals.get(key) ?? {
            name: displayName.get(key) ?? String(event.payload?.product ?? ''),
            quantity: 0,
            revenue: 0,
        };
        entry.quantity += signedQuantity(event);
        entry.revenue += signedRevenue(event, prices);
        totals.set(key, entry);
    }

    return [...totals.values()]
        .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity)
        .slice(0, limit);
}

export function computeDeadStock(
    inventory: AnalyticsInventoryRow[],
    events: AnalyticsEvent[],
    limit = 10
): DeadStockItem[] {
    const sold = new Set(
        events.filter(event => event.type === 'SOLD').map(event => productKey(event.payload?.product))
    );

    return inventory
        .filter(row => productKey(row.name) && !sold.has(productKey(row.name)) && Number(row.quantity) > 0)
        .map(row => ({
            name: String(row.name ?? ''),
            quantity: Number(row.quantity) || 0,
            unit: String(row.base_unit ?? row.unit ?? 'pcs'),
        }))
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, limit);
}

export function computeDailyTrend(
    events: AnalyticsEvent[],
    days = 7,
    now: Date = new Date(),
    prices?: Map<string, number>
): DailyTrendPoint[] {
    const buckets: DailyTrendPoint[] = [];
    const index = new Map<string, number>();

    for (let offset = days - 1; offset >= 0; offset--) {
        const date = new Date(now.getTime() - offset * DAY_MS);
        index.set(istDayKey(date), buckets.length);
        buckets.push({
            label: istWeekdayLabel(date),
            revenue: 0,
        });
    }

    for (const event of events) {
        if (!isRevenueEvent(event) || !event.created_at) continue;
        const bucket = index.get(istDayKey(new Date(event.created_at)));
        if (bucket === undefined) continue;
        buckets[bucket].revenue += signedRevenue(event, prices);
    }

    return buckets;
}

export function computeCategoryMix(
    events: AnalyticsEvent[],
    inventory: AnalyticsInventoryRow[]
): CategoryMix[] {
    const categoryByProduct = new Map(
        inventory.map(row => [productKey(row.name), String(row.category ?? 'GENERAL').toUpperCase()])
    );
    const totals = new Map<string, number>();
    const prices = buildPriceMap(inventory);

    for (const event of events) {
        if (!isRevenueEvent(event)) continue;
        const revenue = signedRevenue(event, prices);
        const category = categoryByProduct.get(productKey(event.payload?.product)) ?? 'GENERAL';
        totals.set(category, (totals.get(category) ?? 0) + revenue);
    }

    // Shares use gross-positive revenue so a net-negative mix still reads
    // meaningfully instead of showing 0% for every category.
    const positiveTotal = [...totals.values()].reduce((sum, revenue) => sum + Math.max(0, revenue), 0);

    return [...totals.entries()]
        .map(([category, revenue]) => ({
            category,
            revenue,
            share: positiveTotal > 0 ? Math.max(0, revenue) / positiveTotal : 0,
        }))
        .sort((a, b) => b.revenue - a.revenue);
}

export function computePeakHours(events: AnalyticsEvent[], limit = 4): PeakHour[] {
    const counts = new Map<number, number>();

    for (const event of events) {
        if (event.type !== 'SOLD' || !event.created_at) continue;
        const hour = istHour(new Date(event.created_at));
        counts.set(hour, (counts.get(hour) ?? 0) + 1);
    }

    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([hour, count]) => ({
            label: hour === 0
                ? '12 AM'
                : hour < 12
                    ? `${hour} AM`
                    : hour === 12
                        ? '12 PM'
                        : `${hour - 12} PM`,
            count,
        }));
}

/** Composes every dashboard metric from the raw 30-day ledger window. */
export function buildAnalytics(
    events: AnalyticsEvent[],
    inventory: AnalyticsInventoryRow[]
): AnalyticsData {
    const sold = events.filter(event => event.type === 'SOLD');
    const prices = buildPriceMap(inventory);
    return {
        topSellers: aggregateTopSellers(events, inventory),
        deadStock: computeDeadStock(inventory, events),
        trend: computeDailyTrend(events, 7, new Date(), prices),
        categoryMix: computeCategoryMix(events, inventory),
        peakHours: computePeakHours(events),
        totalRevenue: Math.round(
            events.reduce((sum, event) => sum + (isRevenueEvent(event) ? signedRevenue(event, prices) : 0), 0) * 100
        ) / 100,
        totalTransactions: sold.length,
    };
}

export function useAnalytics(options: { enabled?: boolean } = {}) {
    const { user } = useAuth();
    const { scopeKey, storeId } = useStoreScope();
    const { isStaffMode, isHydrated } = usePrivacy();
    const enabled = options.enabled !== false && isHydrated && !isStaffMode && !!user;

    const { data, loading, error, refetch } = useAsyncData<AnalyticsData>(
        `${scopeKey}:analytics`,
        async () => {
            if (!user) return EMPTY_ANALYTICS;

            const since = new Date(Date.now() - WINDOW_DAYS * DAY_MS).toISOString();

            // Page through the window so high-volume stores are not silently
            // truncated at PostgREST's default row cap.
            const PAGE_SIZE = 1000;
            const MAX_PAGES = 20;
            const fetchAllEvents = async (): Promise<AnalyticsEvent[]> => {
                const all: AnalyticsEvent[] = [];
                for (let page = 0; page < MAX_PAGES; page++) {
                    const from = page * PAGE_SIZE;
                    let pageQuery = supabase
                        .from('active_events')
                        .select('type, payload, created_at')
                        .in('type', ['SOLD', 'CUSTOMER_RETURN'])
                        .gte('created_at', since)
                        .order('created_at', { ascending: false })
                        .order('event_id', { ascending: true })
                        .range(from, from + PAGE_SIZE - 1);

                    pageQuery = storeId
                        ? pageQuery.eq('store_id', storeId)
                        : pageQuery.eq('user_id', user.id).is('store_id', null);

                    const { data, error: pageError } = await pageQuery;
                    if (pageError) throw pageError;

                    const rows = (data ?? []) as AnalyticsEvent[];
                    all.push(...rows);
                    if (rows.length < PAGE_SIZE) break;
                    if (page === MAX_PAGES - 1) {
                        console.warn(`[useAnalytics] event window truncated at ${MAX_PAGES * PAGE_SIZE}`);
                    }
                }
                return all;
            };

            let inventoryQuery = supabase
                .from('staff_inventory')
                .select('name, quantity, unit, base_unit, selling_price, category');

            if (storeId) {
                inventoryQuery = inventoryQuery.eq('store_id', storeId);
            } else {
                inventoryQuery = inventoryQuery.eq('user_id', user.id).is('store_id', null);
            }

            const [events, inventoryResult] = await Promise.all([fetchAllEvents(), inventoryQuery]);
            if (inventoryResult.error) throw inventoryResult.error;

            return buildAnalytics(
                events,
                (inventoryResult.data ?? []) as AnalyticsInventoryRow[]
            );
        },
        { initialData: EMPTY_ANALYTICS, enabled, refetchOnFocus: true }
    );

    return { ...data, loading: loading && enabled, error, refetch };
}
