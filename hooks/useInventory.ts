import { InventoryItem } from '@/core/interfaces/IInventoryRepository';
import { useAuth } from '@/services/AuthContext';
import { useStoreScope } from '@/hooks/useStoreScope';
import { container } from '@/services/Container';
import { useAsyncData } from '@/hooks/useAsyncData';

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

    return { items, loading, error, refetch };
}

export function isLowStock(item: InventoryItem, fallbackThreshold: number = 5): boolean {
    const threshold = Number(item.low_stock_threshold ?? fallbackThreshold);
    return Number(item.quantity) <= threshold;
}
