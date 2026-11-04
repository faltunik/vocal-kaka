import { InventoryItem } from '@/core/interfaces/IInventoryRepository';
import { useAuth } from '@/services/AuthContext';
import { useStoreScope } from '@/hooks/useStoreScope';
import { container } from '@/services/Container';
import { useAsyncData } from '@/hooks/useAsyncData';
import { useEffect } from 'react';

/**
 * Listeners registered by every mounted `useInventory()` consumer. Voice
 * commands write through the edge function, so no local code knows the
 * catalog changed; without this the Inventory tab stays stale until its next
 * focus refetch.
 */
type InventoryRefreshListener = () => void | Promise<void>;
const inventoryRefreshListeners = new Set<InventoryRefreshListener>();

/** Re-runs every mounted inventory query (used after server-applied writes). */
export function refreshInventory(): void {
    for (const listener of Array.from(inventoryRefreshListeners)) {
        try {
            void listener();
        } catch (error) {
            console.error('[useInventory] Refresh listener failed:', error);
        }
    }
}

/**
 * Full inventory list for the Inventory tab and low-stock filtering.
 * Scoped to the active store so owners and staff share one live catalog.
 */
export function useInventory() {
    const { user } = useAuth();
    const { scope, scopeKey } = useStoreScope();

    const { data: items, loading, error, refetch } = useAsyncData<InventoryItem[]>(
        `${scopeKey}:inventory-list`,
        async () => {
            if (!user) return [];
            return await container.inventoryRepository.listItems(scope);
        },
        { initialData: [], enabled: !!user, refetchOnFocus: true }
    );

    // `refetch` is stable, so this registers once per mounted consumer.
    useEffect(() => {
        inventoryRefreshListeners.add(refetch);
        return () => {
            inventoryRefreshListeners.delete(refetch);
        };
    }, [refetch]);

    return { items, loading, error, refetch };
}

export function isLowStock(item: InventoryItem, fallbackThreshold: number = 5): boolean {
    const threshold = Number(item.low_stock_threshold ?? fallbackThreshold);
    return Number(item.quantity) <= threshold;
}
