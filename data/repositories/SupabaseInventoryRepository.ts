import {
    IInventoryRepository,
    InventoryItem,
    LedgerEvent,
    LedgerEventInput,
    LedgerEventType,
    ScopeInput,
    resolveScope,
} from '@/core/interfaces/IInventoryRepository';
import { supabase } from '@/lib/supabase';

import { escapeLikePattern } from '@/utils/escapeLike';
import { isNetworkError } from '@/utils/network';

/** Columns needed to hydrate an InventoryItem (avoids SELECT *). */
const INVENTORY_COLUMNS = 'id, user_id, store_id, product_id, name, quantity, unit, barcode, last_purchase_price, selling_price, low_stock_threshold, base_unit, secondary_unit, conversion_factor, category, aliases';
/** Columns returned after an insert (last_purchase_price is column-privileged). */
const INSERT_RETURN_COLUMNS = 'id, user_id, store_id, product_id, name, quantity, unit, barcode, selling_price, low_stock_threshold, base_unit, secondary_unit, conversion_factor, category, aliases';
/** Columns needed to hydrate a LedgerEvent. */
const EVENT_COLUMNS = 'event_id, user_id, store_id, type, payload, ledger_event_id, created_at';

/**
 * Member-scoped inventory reads go through the cost-masked secure view so a
 * staff token can never see wholesale costs (RLS + column privileges back it).
 */
const INVENTORY_SOURCE = 'staff_inventory';

/** Applies store scope when active, otherwise the strict legacy per-user scope. */
export function applyScopeFilter<T>(query: T, scope: { userId: string; storeId: string | null }): T {
    const filterable = query as unknown as {
        eq: (column: string, value: string) => unknown;
    };
    if (scope.storeId) {
        return filterable.eq('store_id', scope.storeId) as T;
    }
    // Legacy scope only matches rows without a store: without this, a user who
    // belongs to stores could read store rows through a personal-scope query.
    const withUser = filterable.eq('user_id', scope.userId) as { is: (column: string, value: null) => T };
    return withUser.is('store_id', null);
}

export class SupabaseInventoryRepository implements IInventoryRepository {

    async findItemByName(scope: ScopeInput, name: string): Promise<InventoryItem | null> {
        const { userId, storeId } = resolveScope(scope);

        const query = applyScopeFilter(
            supabase.from(INVENTORY_SOURCE).select(INVENTORY_COLUMNS),
            { userId, storeId }
        );

        const { data, error } = await query
            .ilike('name', escapeLikePattern(name))
            .order('id', { ascending: true })
            .limit(1);

        if (error) {
            console.error('Error finding item by name:', error);
            throw error;
        }

        return (data as InventoryItem[] | null)?.[0] ?? null;
    }

    async findItemByBarcode(scope: ScopeInput, barcode: string): Promise<InventoryItem | null> {
        const { userId, storeId } = resolveScope(scope);

        const query = applyScopeFilter(
            supabase.from(INVENTORY_SOURCE).select(INVENTORY_COLUMNS),
            { userId, storeId }
        );

        const { data, error } = await query
            .eq('barcode', barcode)
            .order('id', { ascending: true })
            .limit(1);

        if (error) {
            console.error('Error finding item by barcode:', error);
            throw error;
        }

        return (data as InventoryItem[] | null)?.[0] ?? null;
    }

    async getItemById(scope: ScopeInput, id: string): Promise<InventoryItem | null> {
        const { userId, storeId } = resolveScope(scope);

        const query = applyScopeFilter(
            supabase.from(INVENTORY_SOURCE).select(INVENTORY_COLUMNS),
            { userId, storeId }
        );

        const { data, error } = await query.eq('id', id).limit(1);

        if (error) {
            console.error('Error finding item by id:', error);
            throw error;
        }

        return (data as InventoryItem[] | null)?.[0] ?? null;
    }

    async listItems(scope: ScopeInput): Promise<InventoryItem[]> {
        const { userId, storeId } = resolveScope(scope);

        const query = applyScopeFilter(
            supabase.from(INVENTORY_SOURCE).select(INVENTORY_COLUMNS),
            { userId, storeId }
        );

        const { data, error } = await query.order('name', { ascending: true });

        if (error) {
            console.error('Error listing inventory:', error);
            throw error;
        }

        return (data as InventoryItem[]) ?? [];
    }

    async createItem(
        scope: ScopeInput,
        name: string,
        quantity: number,
        unit: string,
        barcode?: string,
        extra?: Partial<InventoryItem>
    ): Promise<InventoryItem | null> {
        const { userId, storeId } = resolveScope(scope);

        const payload: Record<string, unknown> = {
            user_id: userId,
            name: name,
            quantity: quantity,
            unit: unit,
            barcode: barcode,
        };

        if (storeId) payload.store_id = storeId;

        if (extra) {
            if (extra.category !== undefined) payload.category = extra.category;
            if (extra.aliases !== undefined) payload.aliases = extra.aliases;
            if (extra.base_unit !== undefined) payload.base_unit = extra.base_unit;
            if (extra.secondary_unit !== undefined) payload.secondary_unit = extra.secondary_unit;
            if (extra.conversion_factor !== undefined) payload.conversion_factor = extra.conversion_factor;
            if (extra.selling_price !== undefined) payload.selling_price = extra.selling_price;
            if (extra.last_purchase_price !== undefined) payload.last_purchase_price = extra.last_purchase_price;
            if (extra.low_stock_threshold !== undefined) payload.low_stock_threshold = extra.low_stock_threshold;
        }

        const { data, error } = await supabase
            .from('inventory')
            .insert(payload)
            .select(INSERT_RETURN_COLUMNS)
            .single();

        if (error) {
            console.error('Error creating item:', JSON.stringify(error, null, 2));
            return null;
        }

        return data as InventoryItem;
    }

    async updateProduct(
        scope: ScopeInput,
        id: string,
        updates: Partial<InventoryItem>
    ): Promise<boolean> {
        const { userId, storeId } = resolveScope(scope);

        const payload: Record<string, unknown> = {};
        if (updates.name !== undefined) payload.name = updates.name;
        if (updates.barcode !== undefined) payload.barcode = updates.barcode;
        if (updates.selling_price !== undefined) payload.selling_price = updates.selling_price;
        if (updates.low_stock_threshold !== undefined) payload.low_stock_threshold = updates.low_stock_threshold;
        if (updates.secondary_unit !== undefined) payload.secondary_unit = updates.secondary_unit;
        if (updates.conversion_factor !== undefined) payload.conversion_factor = updates.conversion_factor;
        if (updates.category !== undefined) payload.category = updates.category;
        if (updates.aliases !== undefined) payload.aliases = updates.aliases;
        if (updates.base_unit !== undefined) payload.base_unit = updates.base_unit;

        // Wholesale cost is column-privileged: only the owner-checked RPC may
        // write it (staff tokens are rejected at the database layer).
        const hasCostUpdate = updates.last_purchase_price !== undefined;

        if (Object.keys(payload).length > 0) {
            const query = applyScopeFilter(
                supabase.from('inventory').update(payload).eq('id', id),
                { userId, storeId }
            );

            const { data, error } = await query.select('id');

            if (error || (data?.length ?? 0) !== 1) {
                console.error('Error updating product:', error ?? 'no row updated');
                return false;
            }
        }

        if (hasCostUpdate) {
            const { data: costApplied, error: costError } = await supabase.rpc('set_product_cost', {
                p_item_id: id,
                p_cost: updates.last_purchase_price,
            });
            if (costError || costApplied === false) {
                console.error('Error updating product cost:', costError ?? 'item not found');
                return false;
            }
        }

        return Object.keys(payload).length > 0 || hasCostUpdate;
    }

    async updateItemBarcode(scope: ScopeInput, id: string, barcode: string): Promise<boolean> {
        const { userId, storeId } = resolveScope(scope);

        const query = applyScopeFilter(
            supabase.from('inventory').update({ barcode }).eq('id', id),
            { userId, storeId }
        );

        const { data, error } = await query.select('id');

        if (error) {
            console.error('Error updating item barcode:', error);
            return false;
        }

        return (data?.length ?? 0) === 1;
    }

    async deleteItem(scope: ScopeInput, id: string): Promise<boolean> {
        const { userId, storeId } = resolveScope(scope);

        const query = applyScopeFilter(
            supabase.from('inventory').delete().eq('id', id),
            { userId, storeId }
        );

        const { data, error } = await query.select('id');

        if (error) {
            console.error('Error deleting item:', error);
            return false;
        }

        return (data?.length ?? 0) === 1;
    }

    async getLowStockItems(scope: ScopeInput, threshold: number): Promise<InventoryItem[]> {
        const { userId, storeId } = resolveScope(scope);

        const query = applyScopeFilter(
            supabase.from(INVENTORY_SOURCE).select(INVENTORY_COLUMNS),
            { userId, storeId }
        );

        const { data, error } = await query
            .lte('quantity', threshold)
            .order('quantity', { ascending: true });

        if (error) {
            console.error('Error fetching low stock items:', error);
            throw error;
        }

        return (data as InventoryItem[] || []);
    }

    /**
     * Appends ledger events. Duplicate ledger_event_id values are ignored, so a
     * retried command can never apply its stock movement twice. Shared-store
     * events dedupe per store (across members); legacy rows stay per-user.
     */
    async appendEvents(events: LedgerEventInput[]): Promise<boolean> {
        if (events.length === 0) return true;

        const onConflict = events.some(event => event.store_id)
            ? 'store_id,ledger_event_id'
            : 'user_id,ledger_event_id';

        const { error, status } = await supabase
            .from('events')
            .upsert(events, { onConflict, ignoreDuplicates: true });

        if (error) {
            // Transport failures AND transient server responses are retryable:
            // rethrow so callers queue the events instead of dropping them.
            const retryableStatus = status === 0 || status === 408 || status === 429 || status >= 500;
            if (retryableStatus || isNetworkError(error)) {
                throw error;
            }
            console.error('Error appending ledger events:', error);
            return false;
        }

        return true;
    }

    async getRecentEvents(scope: ScopeInput, limit: number): Promise<LedgerEvent[]> {
        const { userId, storeId } = resolveScope(scope);

        const query = applyScopeFilter(
            supabase.from('active_events').select(EVENT_COLUMNS),
            { userId, storeId }
        );

        const { data, error } = await query
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            console.error('[SupabaseRepo] Error fetching events:', error);
            throw error;
        }

        return data as LedgerEvent[];
    }

    async getEventsForDateRange(scope: ScopeInput, startIso: string, endIso: string): Promise<LedgerEvent[]> {
        const { userId, storeId } = resolveScope(scope);
        const PAGE_SIZE = 1000;
        const MAX_PAGES = 20;
        const all: LedgerEvent[] = [];

        // Page through the window so busy stores are not truncated by the
        // PostgREST row cap (matches the analytics fetch pattern).
        for (let page = 0; page < MAX_PAGES; page++) {
            const from = page * PAGE_SIZE;
            const query = applyScopeFilter(
                supabase.from('active_events').select(EVENT_COLUMNS),
                { userId, storeId }
            );

            const { data, error } = await query
                .gte('created_at', startIso)
                .lte('created_at', endIso)
                .order('created_at', { ascending: false })
                .order('event_id', { ascending: true })
                .range(from, from + PAGE_SIZE - 1);

            if (error) {
                console.error('[SupabaseRepo] Error fetching date-range events:', error);
                throw error;
            }

            const rows = (data as LedgerEvent[] | null) ?? [];
            all.push(...rows);
            if (rows.length < PAGE_SIZE) break;
            if (page === MAX_PAGES - 1) {
                console.warn(`[SupabaseRepo] date-range ledger truncated at ${MAX_PAGES * PAGE_SIZE}`);
            }
        }

        return all;
    }

    async applyCorrection(
        voidedEventId: string,
        replacementType: LedgerEventType | null,
        replacementPayload: Record<string, unknown> | null
    ): Promise<boolean> {
        const { error } = await supabase.rpc('apply_correction', {
            p_voided_event_id: voidedEventId,
            p_replacement_type: replacementType,
            p_replacement_payload: replacementPayload,
        });

        if (error) {
            console.error('Error applying correction:', error);
            return false;
        }

        return true;
    }

    async resolveUnpricedSale(eventId: string, ratePerUnit: number): Promise<boolean> {
        const { error } = await supabase.rpc('resolve_unpriced_sale', {
            p_event_id: eventId,
            p_rate_per_unit: ratePerUnit,
        });

        if (error) {
            console.error('Error resolving unpriced sale:', error);
            return false;
        }

        return true;
    }
}
