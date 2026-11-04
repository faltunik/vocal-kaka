import { SupabaseInventoryRepository, applyScopeFilter } from '@/data/repositories/SupabaseInventoryRepository';

let mockFrom: jest.Mock = jest.fn();
let mockRpc: jest.Mock = jest.fn();

jest.mock('@/lib/supabase', () => ({
    supabase: {
        from: (...args: unknown[]) => mockFrom(...args),
        rpc: (...args: unknown[]) => mockRpc(...args),
    },
}));

interface QueryResult {
    data?: unknown;
    error?: unknown;
    status?: number;
}

const makeQuery = (result: QueryResult) => {
    const query: any = {};
    ['select', 'insert', 'update', 'delete', 'upsert', 'eq', 'is', 'ilike', 'lt', 'lte', 'gte', 'order', 'limit', 'range'].forEach((method) => {
        query[method] = jest.fn(() => query);
    });
    query.single = jest.fn(() => Promise.resolve(result));
    query.maybeSingle = jest.fn(() => Promise.resolve(result));
    query.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
    return query;
};

describe('SupabaseInventoryRepository', () => {
    let repository: SupabaseInventoryRepository;

    const setup = (result: QueryResult) => {
        const query = makeQuery(result);
        mockFrom.mockReturnValue(query);
        return query;
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockFrom = jest.fn();
        mockRpc = jest.fn().mockResolvedValue({ data: true, error: null });
        repository = new SupabaseInventoryRepository();
    });

    it('findItemByName scopes by user_id and returns the first row', async () => {
        const query = setup({ data: [{ id: '1', name: 'Milk' }], error: null });

        const result = await repository.findItemByName('u1', 'Milk');

        expect(mockFrom).toHaveBeenCalledWith('staff_inventory');
        expect(query.eq).toHaveBeenCalledWith('user_id', 'u1');
        expect(query.ilike).toHaveBeenCalledWith('name', 'Milk');
        expect(query.order).toHaveBeenCalledWith('id', { ascending: true });
        expect(query.limit).toHaveBeenCalledWith(1);
        expect(result).toEqual({ id: '1', name: 'Milk' });
    });

    it('findItemByName escapes LIKE wildcards', async () => {
        const query = setup({ data: [], error: null });

        await repository.findItemByName('u1', '50%_*\\');

        expect(query.ilike).toHaveBeenCalledWith('name', '50\\%\\_\\*\\\\');
    });

    it('findItemByName throws on error even when rows are present', async () => {
        setup({ data: [{ id: '1', name: 'Milk' }], error: { message: 'boom' } });
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

        await expect(repository.findItemByName('u1', 'Milk')).rejects.toEqual({ message: 'boom' });

        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it('createItem scopes by user_id and returns the created row', async () => {
        const query = setup({ data: { id: 'item-1', user_id: 'u1' }, error: null });

        const result = await repository.createItem('u1', 'Milk', 3, 'pcs', '123');

        expect(mockFrom).toHaveBeenCalledWith('inventory');
        expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({
            user_id: 'u1',
            name: 'Milk',
            quantity: 3,
            unit: 'pcs',
            barcode: '123',
        }));
        expect(query.single).toHaveBeenCalled();
        expect(result).toEqual({ id: 'item-1', user_id: 'u1' });
    });

    it('findItemByBarcode scopes by user_id and barcode', async () => {
        const query = setup({ data: [{ id: '1', barcode: '123' }], error: null });

        const result = await repository.findItemByBarcode('u1', '123');

        expect(query.eq).toHaveBeenCalledWith('user_id', 'u1');
        expect(query.eq).toHaveBeenCalledWith('barcode', '123');
        expect(query.order).toHaveBeenCalledWith('id', { ascending: true });
        expect(result).toEqual({ id: '1', barcode: '123' });
    });

    it('listItems scopes by user_id and orders by name', async () => {
        const query = setup({ data: [{ id: '1', name: 'Milk' }], error: null });

        const result = await repository.listItems('u1');

        expect(mockFrom).toHaveBeenCalledWith('staff_inventory');
        expect(query.eq).toHaveBeenCalledWith('user_id', 'u1');
        expect(query.order).toHaveBeenCalledWith('name', { ascending: true });
        expect(result).toEqual([{ id: '1', name: 'Milk' }]);
    });

    it('getItemById reads the cost-masked view for the scoped tenant', async () => {
        const query = setup({ data: [{ id: 'item-1', name: 'Milk', quantity: 4 }], error: null });

        const result = await repository.getItemById('u1', 'item-1');

        expect(mockFrom).toHaveBeenCalledWith('staff_inventory');
        expect(query.eq).toHaveBeenCalledWith('id', 'item-1');
        expect(query.eq).toHaveBeenCalledWith('user_id', 'u1');
        expect(result).toEqual({ id: 'item-1', name: 'Milk', quantity: 4 });
    });

    it('updateItemBarcode scopes by user_id and reports success', async () => {
        const query = setup({ data: [{ id: 'item-1' }], error: null });

        const result = await repository.updateItemBarcode('u1', 'item-1', '999');

        expect(query.update).toHaveBeenCalledWith({ barcode: '999' });
        expect(query.eq).toHaveBeenCalledWith('id', 'item-1');
        expect(query.eq).toHaveBeenCalledWith('user_id', 'u1');
        expect(result).toBe(true);
    });

    it('updateProduct routes cost changes through set_product_cost', async () => {
        const query = setup({ data: [{ id: 'item-1' }], error: null });
        mockRpc.mockResolvedValue({ data: true, error: null });

        const result = await repository.updateProduct('u1', 'item-1', {
            name: 'Sugar',
            last_purchase_price: 42,
        });

        expect(mockRpc).toHaveBeenCalledWith('set_product_cost', { p_item_id: 'item-1', p_cost: 42 });
        expect(query.update).toHaveBeenCalledWith({ name: 'Sugar' });
        expect(result).toBe(true);
    });

    it('updateProduct fails when the cost RPC rejects the caller', async () => {
        const query = setup({ data: [{ id: 'item-1' }], error: null });
        mockRpc.mockResolvedValue({ data: null, error: { message: 'not authorized' } });
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

        const result = await repository.updateProduct('u1', 'item-1', { last_purchase_price: 1 });

        expect(result).toBe(false);
        expect(query.update).not.toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it('deleteItem scopes by id and user_id and reports success for exactly one row', async () => {
        const query = setup({ data: [{ id: 'item-1' }], error: null });

        const result = await repository.deleteItem('u1', 'item-1');

        expect(mockFrom).toHaveBeenCalledWith('inventory');
        expect(query.delete).toHaveBeenCalled();
        expect(query.eq).toHaveBeenCalledWith('id', 'item-1');
        expect(query.eq).toHaveBeenCalledWith('user_id', 'u1');
        expect(result).toBe(true);
    });

    it('getLowStockItems scopes by user_id and uses <= threshold', async () => {
        const query = setup({ data: [], error: null });

        await repository.getLowStockItems('u1', 5);

        expect(query.eq).toHaveBeenCalledWith('user_id', 'u1');
        expect(query.lte).toHaveBeenCalledWith('quantity', 5);
        expect(query.order).toHaveBeenCalledWith('quantity', { ascending: true });
    });

    it('getLowStockItems throws on error even when rows are present', async () => {
        const query = setup({ data: [{ id: '1' }], error: { message: 'boom' } });
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

        await expect(repository.getLowStockItems('u1', 5)).rejects.toEqual({ message: 'boom' });

        expect(query.eq).toHaveBeenCalledWith('user_id', 'u1');
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it('appendEvents upserts with idempotent conflict handling', async () => {
        const query = setup({ data: null, error: null });

        const result = await repository.appendEvents([
            { user_id: 'u1', type: 'PURCHASED', payload: { product: 'Milk', quantity: 2 }, ledger_event_id: 'rec-1:0' },
        ]);

        expect(mockFrom).toHaveBeenCalledWith('events');
        expect(query.upsert).toHaveBeenCalledWith(
            [expect.objectContaining({ ledger_event_id: 'rec-1:0', type: 'PURCHASED' })],
            { onConflict: 'user_id,ledger_event_id', ignoreDuplicates: true }
        );
        expect(result).toBe(true);
    });

    it('appendEvents returns true without a query for an empty list', async () => {
        const result = await repository.appendEvents([]);

        expect(result).toBe(true);
        expect(mockFrom).not.toHaveBeenCalled();
    });

    it('appendEvents returns false on error', async () => {
        setup({ data: null, error: { message: 'nope' } });
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

        const result = await repository.appendEvents([
            { user_id: 'u1', type: 'SOLD', payload: { product: 'Milk', quantity: 1 }, ledger_event_id: 'rec-2:0' },
        ]);

        expect(result).toBe(false);
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it('appendEvents rethrows transport failures so offline queues can retry', async () => {
        setup({ data: null, error: { message: 'Network request failed' } });

        await expect(repository.appendEvents([
            { user_id: 'u1', type: 'SOLD', payload: { product: 'Milk', quantity: 1 }, ledger_event_id: 'rec-3:0' },
        ])).rejects.toEqual({ message: 'Network request failed' });
    });

    it('appendEvents retries transient server responses (5xx/429/408)', async () => {
        setup({ data: null, error: { message: '<html>503 Service Temporarily Unavailable</html>' }, status: 503 });

        await expect(repository.appendEvents([
            { user_id: 'u1', type: 'SOLD', payload: { product: 'Milk', quantity: 1 }, ledger_event_id: 'rec-4:0' },
        ])).rejects.toEqual({ message: '<html>503 Service Temporarily Unavailable</html>' });

        setup({ data: null, error: { message: 'rate limited' }, status: 429 });

        await expect(repository.appendEvents([
            { user_id: 'u1', type: 'SOLD', payload: { product: 'Milk', quantity: 1 }, ledger_event_id: 'rec-5:0' },
        ])).rejects.toEqual({ message: 'rate limited' });
    });

    it('getRecentEvents reads the void-filtered view scoped by user_id', async () => {
        const query = setup({ data: [{ event_id: 'e1' }], error: null });

        const result = await repository.getRecentEvents('u1', 50);

        expect(mockFrom).toHaveBeenCalledWith('active_events');
        expect(query.eq).toHaveBeenCalledWith('user_id', 'u1');
        expect(query.order).toHaveBeenCalledWith('created_at', { ascending: false });
        expect(query.limit).toHaveBeenCalledWith(50);
        expect(result).toEqual([{ event_id: 'e1' }]);
    });

    it('getRecentEvents throws on error', async () => {
        setup({ data: null, error: { message: 'boom' } });
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

        await expect(repository.getRecentEvents('u1', 50)).rejects.toEqual({ message: 'boom' });

        consoleSpy.mockRestore();
    });

    it('getEventsForDateRange filters active_events by the inclusive ISO window', async () => {
        const query = setup({ data: [{ event_id: 'e1' }], error: null });

        const result = await repository.getEventsForDateRange(
            'u1',
            '2026-10-01T00:00:00.000Z',
            '2026-10-01T23:59:59.999Z'
        );

        expect(mockFrom).toHaveBeenCalledWith('active_events');
        expect(query.eq).toHaveBeenCalledWith('user_id', 'u1');
        expect(query.gte).toHaveBeenCalledWith('created_at', '2026-10-01T00:00:00.000Z');
        expect(query.lte).toHaveBeenCalledWith('created_at', '2026-10-01T23:59:59.999Z');
        expect(query.order).toHaveBeenCalledWith('created_at', { ascending: false });
        expect(query.range).toHaveBeenCalledWith(0, 999);
        expect(result).toEqual([{ event_id: 'e1' }]);
    });

    it('applyCorrection calls the atomic RPC', async () => {
        const result = await repository.applyCorrection('e1', 'SOLD', { product: 'Sugar', quantity: 2 });

        expect(mockRpc).toHaveBeenCalledWith('apply_correction', {
            p_voided_event_id: 'e1',
            p_replacement_type: 'SOLD',
            p_replacement_payload: { product: 'Sugar', quantity: 2 },
        });
        expect(result).toBe(true);
    });

    it('applyCorrection supports a void-only correction', async () => {
        await repository.applyCorrection('e1', null, null);

        expect(mockRpc).toHaveBeenCalledWith('apply_correction', {
            p_voided_event_id: 'e1',
            p_replacement_type: null,
            p_replacement_payload: null,
        });
    });

    it('applyCorrection returns false on error', async () => {
        mockRpc.mockResolvedValue({ data: null, error: { message: 'nope' } });
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

        const result = await repository.applyCorrection('e1', null, null);

        expect(result).toBe(false);
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    describe('scope filter helper', () => {
        it('targets store_id when a store is active and user_id + null store otherwise', () => {
            const storeQuery: any = { eq: jest.fn(function (this: any) { return this; }) };
            applyScopeFilter(storeQuery, { userId: 'u1', storeId: 'store-1' });
            expect(storeQuery.eq).toHaveBeenCalledWith('store_id', 'store-1');

            const userQuery: any = {
                eq: jest.fn(function (this: any) { return this; }),
                is: jest.fn(function (this: any) { return this; }),
            };
            applyScopeFilter(userQuery, { userId: 'u1', storeId: null });
            expect(userQuery.eq).toHaveBeenCalledWith('user_id', 'u1');
            expect(userQuery.is).toHaveBeenCalledWith('store_id', null);
        });
    });

    describe('store-scoped data isolation', () => {
        const storeScope = { userId: 'u1', storeId: 'store-kirana-1' };

        it('findItemByName filters by store_id when a store scope is given', async () => {
            const query = setup({ data: [{ id: '1', name: 'Milk', store_id: 'store-kirana-1' }], error: null });

            const result = await repository.findItemByName(storeScope, 'Milk');

            expect(query.eq).toHaveBeenCalledWith('store_id', 'store-kirana-1');
            expect(query.eq).not.toHaveBeenCalledWith('user_id', 'u1');
            expect(result).toEqual({ id: '1', name: 'Milk', store_id: 'store-kirana-1' });
        });

        it('listItems filters by store_id for shared catalogs', async () => {
            const query = setup({ data: [], error: null });

            await repository.listItems(storeScope);

            expect(query.eq).toHaveBeenCalledWith('store_id', 'store-kirana-1');
            expect(query.order).toHaveBeenCalledWith('name', { ascending: true });
        });

        it('createItem writes both acting user_id and store_id', async () => {
            const query = setup({ data: { id: 'item-1' }, error: null });

            await repository.createItem(storeScope, 'Sugar', 10, 'kg', undefined, {
                selling_price: 44,
            });

            expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({
                user_id: 'u1',
                store_id: 'store-kirana-1',
                name: 'Sugar',
                quantity: 10,
                unit: 'kg',
                selling_price: 44,
            }));
        });

        it('deleteItem scopes mutations to the store', async () => {
            const query = setup({ data: [{ id: 'item-1' }], error: null });

            await repository.deleteItem(storeScope, 'item-1');

            expect(query.eq).toHaveBeenCalledWith('id', 'item-1');
            expect(query.eq).toHaveBeenCalledWith('store_id', 'store-kirana-1');
            expect(query.delete).toHaveBeenCalled();
        });

        it('getRecentEvents reads the void-filtered view scoped by store_id', async () => {
            const query = setup({ data: [{ event_id: 'e1', store_id: 'store-kirana-1' }], error: null });

            const result = await repository.getRecentEvents(storeScope, 25);

            expect(mockFrom).toHaveBeenCalledWith('active_events');
            expect(query.eq).toHaveBeenCalledWith('store_id', 'store-kirana-1');
            expect(query.limit).toHaveBeenCalledWith(25);
            expect(result).toEqual([{ event_id: 'e1', store_id: 'store-kirana-1' }]);
        });

        it('appendEvents forwards store-scoped ledger rows', async () => {
            const query = setup({ data: null, error: null });

            await repository.appendEvents([
                {
                    user_id: 'staff-aman',
                    store_id: 'store-kirana-1',
                    type: 'SOLD',
                    payload: { product: 'Milk', quantity: 2 },
                    ledger_event_id: 'rec-3:0',
                },
            ]);

            expect(query.upsert).toHaveBeenCalledWith(
                [expect.objectContaining({ user_id: 'staff-aman', store_id: 'store-kirana-1' })],
                { onConflict: 'store_id,ledger_event_id', ignoreDuplicates: true }
            );
        });
    });
});
