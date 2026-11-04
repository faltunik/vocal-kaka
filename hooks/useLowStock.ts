import { InventoryItem } from '@/core/interfaces/IInventoryRepository';
import { useAuth } from '@/services/AuthContext';
import { useStoreScope } from '@/hooks/useStoreScope';
import { container } from '@/services/Container';
import { useAsyncData } from '@/hooks/useAsyncData';
import { isLowStock } from '@/hooks/useInventory';
import { supabase } from '@/lib/supabase';
import { calculateSuggestedReorder } from '@/utils/parchi';
import { useState, useEffect, useCallback } from 'react';

export { calculateSuggestedReorder } from '@/utils/parchi';

export interface LowStockWithVelocity extends InventoryItem {
    isOutOfStock: boolean;
    isNegativeStock: boolean;
    dailyVelocity: number;
    suggestedSecondaryQty: number;
    calculatedBaseQty: number;
    displayUnit: string;
}

/**
 * Low-stock items with 7-day sales velocity, wholesale packaging suggestions,
 * item selection state, and reorder steppers.
 */
export function useLowStock(threshold: number = 5) {
    const { user } = useAuth();
    const { scope, scopeKey, storeId } = useStoreScope();

    const { data, loading, error, refetch } = useAsyncData<{
        items: LowStockWithVelocity[];
        outOfStockCount: number;
        negativeStockCount: number;
        lowStockCount: number;
    }>(
        `${scopeKey}:low-stock-velocity:${threshold}`,
        async () => {
            if (!user) return { items: [], outOfStockCount: 0, negativeStockCount: 0, lowStockCount: 0 };

            // 1. Fetch full inventory for the active store
            const allItems = await container.inventoryRepository.listItems(scope);
            const lowItems = allItems.filter(item => isLowStock(item, threshold));

            if (lowItems.length === 0) {
                return { items: [], outOfStockCount: 0, negativeStockCount: 0, lowStockCount: 0 };
            }

            // 2. Query 7-day sales velocity from active_events
            const velocityMap = new Map<string, number>();
            try {
                const sevenDaysAgo = new Date();
                sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

                let salesQuery = supabase
                    .from('active_events')
                    .select('payload')
                    .eq('type', 'SOLD')
                    .gte('created_at', sevenDaysAgo.toISOString());

                salesQuery = storeId
                    ? salesQuery.eq('store_id', storeId)
                    : salesQuery.eq('user_id', user.id).is('store_id', null);

                const { data: salesEvents } = await salesQuery;

                for (const row of salesEvents ?? []) {
                    const payload = row.payload as { product?: string; quantity?: number };
                    const prodName = String(payload?.product ?? '').trim().toLowerCase();
                    const qty = Number(payload?.quantity) || 0;
                    velocityMap.set(prodName, (velocityMap.get(prodName) ?? 0) + qty);
                }
            } catch {
                // If active_events query fails, gracefully fallback to 0 velocity
            }

            let outOfStockCount = 0;
            let negativeStockCount = 0;
            let lowStockCount = 0;

            const enriched: LowStockWithVelocity[] = lowItems.map(item => {
                const quantity = Number(item.quantity);
                // Physical reality trumps system state: a negative balance means
                // the inward delivery bill has not been recorded yet.
                const isNegativeStock = quantity < 0;
                const isOutOfStock = quantity <= 0;
                if (isNegativeStock) negativeStockCount++;
                else if (isOutOfStock) outOfStockCount++;
                else lowStockCount++;

                const totalSold7d = velocityMap.get(item.name.trim().toLowerCase()) ?? 0;
                const dailyVelocity = totalSold7d / 7;

                const { suggestedSecondaryQty, calculatedBaseQty, displayUnit } =
                    calculateSuggestedReorder(item, dailyVelocity);

                return {
                    ...item,
                    isOutOfStock,
                    isNegativeStock,
                    dailyVelocity,
                    suggestedSecondaryQty,
                    calculatedBaseQty,
                    displayUnit,
                };
            });

            // Sort: Sold-before-inward first, then out of stock, then lowest quantity
            enriched.sort((a, b) => {
                if (a.isNegativeStock && !b.isNegativeStock) return -1;
                if (!a.isNegativeStock && b.isNegativeStock) return 1;
                if (a.isOutOfStock && !b.isOutOfStock) return -1;
                if (!a.isOutOfStock && b.isOutOfStock) return 1;
                return Number(a.quantity) - Number(b.quantity);
            });

            return {
                items: enriched,
                outOfStockCount,
                negativeStockCount,
                lowStockCount,
            };
        },
        {
            initialData: { items: [], outOfStockCount: 0, negativeStockCount: 0, lowStockCount: 0 },
            enabled: !!user,
            refetchOnFocus: true,
        }
    );

    const items = data.items;

    // Item selection state
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [reorderQuantities, setReorderQuantities] = useState<Record<string, number>>({});
    const [initialized, setInitialized] = useState(false);

    // Initialize/sync selections and reorder quantities when items load
    useEffect(() => {
        if (items.length > 0) {
            setSelectedIds(prev => {
                if (!initialized) {
                    return new Set(items.map(i => i.id));
                }
                const next = new Set<string>();
                for (const id of prev) {
                    if (items.some(i => i.id === id)) {
                        next.add(id);
                    }
                }
                return next;
            });

            setReorderQuantities(prev => {
                const next = { ...prev };
                let changed = false;
                for (const item of items) {
                    if (next[item.id] === undefined) {
                        next[item.id] = item.suggestedSecondaryQty;
                        changed = true;
                    }
                }
                return changed ? next : prev;
            });

            setInitialized(true);
        } else if (items.length === 0 && initialized) {
            setSelectedIds(new Set());
            setReorderQuantities({});
            // Allow a fresh select-all once low-stock items reappear
            setInitialized(false);
        }
    }, [items, initialized]);

    const toggleSelect = useCallback((id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    const selectAll = useCallback(() => {
        setSelectedIds(new Set(items.map(i => i.id)));
    }, [items]);

    const deselectAll = useCallback(() => {
        setSelectedIds(new Set());
    }, []);

    const updateQuantity = useCallback((id: string, delta: number) => {
        setReorderQuantities(prev => {
            const item = items.find(i => i.id === id);
            const current = prev[id] ?? item?.suggestedSecondaryQty ?? 1;
            const nextVal = Math.max(1, current + delta);
            return { ...prev, [id]: nextVal };
        });
    }, [items]);

    const setQuantity = useCallback((id: string, qty: number) => {
        setReorderQuantities(prev => ({
            ...prev,
            [id]: Math.max(1, qty),
        }));
    }, []);

    return {
        items,
        count: items.length,
        outOfStockCount: data.outOfStockCount,
        negativeStockCount: data.negativeStockCount,
        lowStockCount: data.lowStockCount,
        loading,
        error,
        refetch,
        selectedIds,
        toggleSelect,
        selectAll,
        deselectAll,
        reorderQuantities,
        updateQuantity,
        setQuantity,
    };
}
