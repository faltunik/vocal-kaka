import { useAsyncData } from '@/hooks/useAsyncData';
import { useStoreScope } from '@/hooks/useStoreScope';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/services/AuthContext';
import { usePrivacy } from '@/services/PrivacyContext';
import { useEffect } from 'react';

export interface DashboardStats {
    sales: number;
    profit: number;
    transactionCount: number;
    estimatedProfitCount: number;
}

export const EMPTY_STATS: DashboardStats = {
    sales: 0,
    profit: 0,
    transactionCount: 0,
    estimatedProfitCount: 0,
};

import { classifyCategoryClient, estimateCostPrice } from '@/utils/categories';

// Re-exported for backwards compatibility (dashboard tests import them here)
export {
    CATEGORY_MARGIN_BENCHMARKS,
    classifyCategoryClient,
    estimateCostPrice,
} from '@/utils/categories';

/**
 * Calculates start of today in IST (UTC+5:30) to avoid timezone rollover discrepancies.
 */
export function getStartOfTodayIST(): Date {
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(Date.now() + istOffsetMs);
    return new Date(
        Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()) - istOffsetMs
    );
}

/**
 * Today's sales and estimated profit from the event ledger.
 * Revenue uses the per-unit price recorded on SOLD events, falling back to the
 * product's selling price; cost uses the product's last purchase price.
 * When last_purchase_price is missing/null/0 or an unnormalized anomaly, accurately estimates
 * cost price using category benchmark margins instead of corrupting the dashboard with fake profits.
 * Deducts customer returns and operational expenses from net figures.
 */
export function useDashboardStats(options: { enabled?: boolean } = {}) {
    const { user } = useAuth();
    const { scopeKey, storeId } = useStoreScope();
    const { isStaffMode, isHydrated } = usePrivacy();

    // Staff mode must never even issue the profit query (strict role privacy);
    // pre-hydration it is treated as staff until the stored flag is known.
    const enabled = options.enabled !== false && isHydrated && !isStaffMode && !!user;

    const { data, loading, refetch } = useAsyncData(
        scopeKey,
        async () => {
            if (!user) return EMPTY_STATS;

            const startOfToday = getStartOfTodayIST();

            let eventsQuery = supabase
                .from('active_events')
                .select('type, payload')
                .in('type', ['SOLD', 'CUSTOMER_RETURN', 'EXPENSE'])
                .gte('created_at', startOfToday.toISOString());

            // Cost-masked view: owners/admins still get real costs, staff nulls
            let inventoryQuery = supabase
                .from('staff_inventory')
                .select('name, last_purchase_price, selling_price, category');

            if (storeId) {
                eventsQuery = eventsQuery.eq('store_id', storeId);
                inventoryQuery = inventoryQuery.eq('store_id', storeId);
            } else {
                // Strict legacy scope: never mix store rows into per-user reads.
                eventsQuery = eventsQuery.eq('user_id', user.id).is('store_id', null);
                inventoryQuery = inventoryQuery.eq('user_id', user.id).is('store_id', null);
            }

            const [eventsResult, inventoryResult] = await Promise.all([
                eventsQuery,
                inventoryQuery,
            ]);

            if (eventsResult.error) throw eventsResult.error;
            if (inventoryResult.error) throw inventoryResult.error;

            const priceByName = new Map(
                (inventoryResult.data ?? []).map(row => [String(row.name).toLowerCase(), row])
            );

            let sales = 0;
            let profit = 0;
            let count = 0;
            let estimatedCount = 0;

            for (const row of eventsResult.data ?? []) {
                const eventType = row.type ?? 'SOLD';
                const payload = (row.payload ?? {}) as {
                    product?: string;
                    quantity?: number;
                    calculated_quantity?: number;
                    price?: number;
                    unit_price_used?: number;
                    unit?: string;
                    amount?: number;
                    amount_spent?: number;
                };

                if (eventType === 'EXPENSE') {
                    const expenseAmt = Number(payload.amount ?? payload.price) || 0;
                    if (expenseAmt > 0) {
                        profit -= expenseAmt;
                    }
                    continue;
                }

                const productName = String(payload.product ?? '').trim();
                const quantity = Number(payload.calculated_quantity ?? payload.quantity) || 0;
                const directAmount = Number(payload.amount_spent ?? payload.amount) || 0;

                if (!productName && directAmount <= 0) continue;
                if (quantity <= 0 && directAmount <= 0) continue;

                const inventory = productName ? priceByName.get(productName.toLowerCase()) : undefined;
                // Mirror the edge snapshot: a resolved value-sale rate
                // (unit_price_used) outranks the recorded price and catalog price.
                const sellPrice = Number(payload.unit_price_used) || Number(payload.price) || Number(inventory?.selling_price) || 0;
                let costPrice = Number(inventory?.last_purchase_price) || 0;

                const effectiveQty = quantity > 0
                    ? quantity
                    : (sellPrice > 0 ? directAmount / sellPrice : 0);

                const category = (inventory?.category && inventory.category !== 'GENERAL')
                    ? inventory.category
                    : (classifyCategoryClient(productName, payload.unit) || inventory?.category || 'GENERAL');

                // Apply category margin benchmark cascade if cost price is missing/0 or anomalous
                if (costPrice <= 0 && sellPrice > 0) {
                    costPrice = estimateCostPrice(sellPrice, category);
                    if (eventType === 'SOLD') estimatedCount++;
                } else if (sellPrice > 0 && costPrice > sellPrice * 2.5) {
                    // Anomaly guard against unnormalized sack/box wholesale prices
                    costPrice = estimateCostPrice(sellPrice, category);
                    if (eventType === 'SOLD') estimatedCount++;
                }

                const lineSale = directAmount > 0 ? directAmount : (effectiveQty * sellPrice);
                const lineCost = effectiveQty * costPrice;
                const lineProfit = lineSale - lineCost;

                if (eventType === 'CUSTOMER_RETURN') {
                    sales -= lineSale;
                    profit -= lineProfit;
                } else {
                    // SOLD
                    sales += lineSale;
                    profit += lineProfit;
                    count++;
                }
            }

            return {
                sales: Math.round(sales * 100) / 100,
                profit: Math.round(profit * 100) / 100,
                transactionCount: count,
                estimatedProfitCount: estimatedCount,
            };
        },
        { initialData: EMPTY_STATS, enabled, refetchOnFocus: true }
    );

    useEffect(() => {
        if (!user || !enabled) return;

        const tenantFilter = storeId
            ? `store_id=eq.${storeId}`
            : `user_id=eq.${user.id}`;
        const channelName = storeId
            ? `dashboard-stats-store-${storeId}`
            : `dashboard-stats-${user.id}`;

        const channel = supabase
            .channel(channelName)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'events',
                filter: tenantFilter
            }, () => {
                void refetch();
            })
            .subscribe();

        return () => {
            void supabase.removeChannel(channel);
        };
    }, [user, storeId, refetch, enabled]);

    return { ...data, loading: loading && enabled };
}
