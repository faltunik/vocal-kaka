export interface InventoryItem {
    id: string;
    /** Acting user. Null once the account is deleted; shared rows remain. */
    user_id: string | null;
    store_id?: string | null;
    name: string;
    quantity: number;
    unit: string;
    barcode?: string;
    product_id?: string;
    low_stock_threshold?: number;
    last_purchase_price?: number | null;
    selling_price?: number | null;
    base_unit?: string;
    secondary_unit?: string | null;
    conversion_factor?: number | null;
    category?: string;
    aliases?: string[];
}

export type LedgerEventType =
    | 'PURCHASED'
    | 'SOLD'
    | 'ADJUSTED'
    | 'WRITE_OFF'
    | 'CUSTOMER_RETURN'
    | 'VENDOR_RETURN'
    | 'PRICE_UPDATED'
    | 'EXPENSE'
    | 'VOID';

export interface LedgerEvent {
    event_id: string;
    /** Acting user. Null once the account is deleted; shared rows remain. */
    user_id: string | null;
    store_id?: string | null;
    type: LedgerEventType;
    payload: Record<string, unknown>;
    ledger_event_id: string;
    created_at: string;
}

export interface LedgerEventInput {
    user_id: string;
    store_id?: string | null;
    type: LedgerEventType;
    payload: Record<string, unknown>;
    ledger_event_id: string;
}

/**
 * A data scope identifies which tenant a read/write belongs to.
 * `storeId` isolates shared store data; when absent the legacy per-user
 * scope is used (guests, demo mode, and pre-migration rows).
 */
export interface DataScope {
    userId: string;
    storeId?: string | null;
}

export type ScopeInput = string | DataScope;

export function resolveScope(scope: ScopeInput): { userId: string; storeId: string | null } {
    if (typeof scope === 'string') {
        return { userId: scope, storeId: null };
    }
    return { userId: scope.userId, storeId: scope.storeId ?? null };
}

/** Builds a scope object only when a store is active, keeping legacy string call sites. */
export function toScope(userId: string, storeId?: string | null): ScopeInput {
    return storeId ? { userId, storeId } : userId;
}

export interface IInventoryRepository {
    findItemByName(scope: ScopeInput, name: string): Promise<InventoryItem | null>;
    findItemByBarcode(scope: ScopeInput, barcode: string): Promise<InventoryItem | null>;
    getItemById(scope: ScopeInput, id: string): Promise<InventoryItem | null>;
    listItems(scope: ScopeInput): Promise<InventoryItem[]>;
    createItem(
        scope: ScopeInput,
        name: string,
        quantity: number,
        unit: string,
        barcode?: string,
        extra?: Partial<InventoryItem>
    ): Promise<InventoryItem | null>;
    updateItemBarcode(scope: ScopeInput, id: string, barcode: string): Promise<boolean>;
    updateProduct?(
        scope: ScopeInput,
        id: string,
        updates: Partial<InventoryItem>
    ): Promise<boolean>;
    deleteItem(scope: ScopeInput, id: string): Promise<boolean>;
    getLowStockItems(scope: ScopeInput, threshold: number): Promise<InventoryItem[]>;

    /** Appends ledger events; the DB trigger materializes inventory. */
    appendEvents(events: LedgerEventInput[]): Promise<boolean>;
    getRecentEvents(scope: ScopeInput, limit: number): Promise<LedgerEvent[]>;
    /** Complete ledger window for audit/history screens (inclusive ISO bounds). */
    getEventsForDateRange(scope: ScopeInput, startIso: string, endIso: string): Promise<LedgerEvent[]>;

    /** Atomically voids an event and appends its replacement (or none). */
    applyCorrection(
        voidedEventId: string,
        replacementType: LedgerEventType | null,
        replacementPayload: Record<string, unknown> | null
    ): Promise<boolean>;

    /** Resolves a flagged value sale by rate: VOID + finalized SOLD event. */
    resolveUnpricedSale(eventId: string, ratePerUnit: number): Promise<boolean>;
}
