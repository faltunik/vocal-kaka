import { ScopeInput, toScope } from '@/core/interfaces/IInventoryRepository';
import { useAuth } from '@/services/AuthContext';
import { useStore } from '@/services/StoreContext';
import { useCallback, useRef } from 'react';

export interface StoreScope {
    /** Scope captured for this render. */
    scope: ScopeInput;
    /** Stable key for caches/effects (store id, else user id). */
    scopeKey: string;
    storeId: string | null;
    userId: string | null;
    /** Reads the active store at call time (safe across awaits). */
    currentScope: () => ScopeInput;
    currentStoreId: () => string | null;
}

/**
 * Single source of truth for tenant scoping: the active store when loaded,
 * otherwise the signed-in user (legacy rows), otherwise guest.
 */
export function useStoreScope(): StoreScope {
    const { user } = useAuth();
    const { currentStore } = useStore();

    const userId = user?.id ?? null;
    const storeId = currentStore?.id ?? null;

    const userIdRef = useRef(userId);
    userIdRef.current = userId;
    const storeRef = useRef(currentStore);
    storeRef.current = currentStore;

    const currentScope = useCallback(
        () => toScope(userIdRef.current ?? 'guest', storeRef.current?.id),
        []
    );
    const currentStoreId = useCallback(() => storeRef.current?.id ?? null, []);

    return {
        scope: toScope(userId ?? 'guest', storeId),
        scopeKey: storeId ?? userId ?? 'anonymous',
        storeId,
        userId,
        currentScope,
        currentStoreId,
    };
}
