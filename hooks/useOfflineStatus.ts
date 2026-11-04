import { useEffect, useState } from 'react';
import { container } from '@/services/Container';

/**
 * Pending-sync status for the ledger queue. A non-zero queue means events are
 * waiting for connectivity/server availability, so the UI can show an offline
 * indicator (FEAT-09).
 */
export function useOfflineStatus(): { pendingCount: number; hasPendingSync: boolean } {
    const [pendingCount, setPendingCount] = useState(0);

    useEffect(() => {
        let mounted = true;

        void container.inventoryService.pendingOfflineCount().then(count => {
            if (mounted) setPendingCount(count);
        }).catch(() => undefined);

        const unsubscribe = container.inventoryService.subscribeOfflineQueue(count => {
            if (mounted) setPendingCount(count);
        });

        return () => {
            mounted = false;
            unsubscribe();
        };
    }, []);

    return { pendingCount, hasPendingSync: pendingCount > 0 };
}
