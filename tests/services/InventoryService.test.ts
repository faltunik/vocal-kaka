import { InventoryService } from '@/services/InventoryService';
import { IInventoryRepository } from '@/core/interfaces/IInventoryRepository';
import { OfflineQueueService } from '@/services/offline/OfflineQueueService';

const createMockRepository = (): jest.Mocked<IInventoryRepository> => ({
    findItemByName: jest.fn(),
    findItemByBarcode: jest.fn(),
    getItemById: jest.fn().mockResolvedValue(null),
    listItems: jest.fn().mockResolvedValue([]),
    createItem: jest.fn().mockResolvedValue(null),
    updateItemBarcode: jest.fn().mockResolvedValue(true),
    deleteItem: jest.fn().mockResolvedValue(true),
    getLowStockItems: jest.fn(),
    appendEvents: jest.fn().mockResolvedValue(true),
    getRecentEvents: jest.fn(),
    getEventsForDateRange: jest.fn().mockResolvedValue([]),
    applyCorrection: jest.fn().mockResolvedValue(true),
    resolveUnpricedSale: jest.fn().mockResolvedValue(true),
});

describe('InventoryService', () => {
    let repository: jest.Mocked<IInventoryRepository>;
    let service: InventoryService;
    const userId = 'test-user-123';

    beforeEach(() => {
        jest.clearAllMocks();
        repository = createMockRepository();
        service = new InventoryService(repository);
    });

    describe('event recording', () => {
        it('appends a PURCHASED event with a generated ledger id', async () => {
            const result = await service.addStockEvent(userId, { item: 'Milk', quantity: 2, unit: 'packet' });

            expect(result).toBe(true);
            expect(repository.appendEvents).toHaveBeenCalledWith([
                expect.objectContaining({
                    user_id: userId,
                    type: 'PURCHASED',
                    payload: { product: 'Milk', quantity: 2, unit: 'packet' },
                    ledger_event_id: expect.stringMatching(
                        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
                    ),
                }),
            ]);
        });

        it('appends SOLD with a unit price when an amount is given', async () => {
            await service.saleEvent(userId, { item: 'Sugar', quantity: 2, unit: 'kg', price: 60 });

            expect(repository.appendEvents).toHaveBeenCalledWith([
                expect.objectContaining({
                    type: 'SOLD',
                    payload: { product: 'Sugar', quantity: 2, unit: 'kg', price: 60 },
                }),
            ]);
        });

        it('normalizes item names and rejects invalid input', async () => {
            const invalidQty = await service.addStockEvent(userId, { item: 'Milk', quantity: 0 });
            const invalidItem = await service.addStockEvent(userId, { item: '   ', quantity: 2 });

            expect(invalidQty).toBe(false);
            expect(invalidItem).toBe(false);
            expect(repository.appendEvents).not.toHaveBeenCalled();
        });

        it('appends WRITE_OFF, CUSTOMER_RETURN and VENDOR_RETURN events', async () => {
            await service.writeOffEvent(userId, { item: 'Egg', quantity: 3, unit: 'piece' });
            await service.customerReturnEvent(userId, { item: 'Curd', quantity: 1, unit: 'packet' });
            await service.vendorReturnEvent(userId, { item: 'Chips', quantity: 10, unit: 'packet' });

            expect(repository.appendEvents).toHaveBeenNthCalledWith(1, [expect.objectContaining({ type: 'WRITE_OFF' })]);
            expect(repository.appendEvents).toHaveBeenNthCalledWith(2, [expect.objectContaining({ type: 'CUSTOMER_RETURN' })]);
            expect(repository.appendEvents).toHaveBeenNthCalledWith(3, [expect.objectContaining({ type: 'VENDOR_RETURN' })]);
        });

        it('appends EXPENSE with the amount and note', async () => {
            await service.expenseEvent(userId, 1500, 'Bijli ka bill');

            expect(repository.appendEvents).toHaveBeenCalledWith([
                expect.objectContaining({
                    type: 'EXPENSE',
                    payload: { amount: 1500, note: 'Bijli ka bill' },
                }),
            ]);
        });

        it('appends VOID with a deterministic id referencing the original event', async () => {
            await service.voidEvent(userId, 'event-abc');

            expect(repository.appendEvents).toHaveBeenCalledWith([
                expect.objectContaining({
                    type: 'VOID',
                    payload: { voided_event_id: 'event-abc' },
                    ledger_event_id: 'void-event-abc',
                }),
            ]);
        });

        it('applies corrections through the atomic repository RPC', async () => {
            const result = await service.applyCorrection(userId, 'event-abc', 'SOLD', { product: 'Sugar', quantity: 2 });

            expect(result).toBe(true);
            expect(repository.applyCorrection).toHaveBeenCalledWith('event-abc', 'SOLD', { product: 'Sugar', quantity: 2 });
        });

        it('simulates corrections in guest mode without touching the repository', async () => {
            const result = await service.applyCorrection('guest', 'event-abc', null, null);

            expect(result).toBe(true);
            expect(repository.applyCorrection).not.toHaveBeenCalled();
        });

        it('delegates unpriced rate resolution to the repository RPC', async () => {
            repository.resolveUnpricedSale.mockResolvedValue(true);

            const result = await service.resolveUnpricedSale(userId, 'event-abc', 40);

            expect(result).toBe(true);
            expect(repository.resolveUnpricedSale).toHaveBeenCalledWith('event-abc', 40);
        });

        it('rejects invalid rate resolutions before touching the repository', async () => {
            await expect(service.resolveUnpricedSale(userId, 'event-abc', 0)).resolves.toBe(false);
            await expect(service.resolveUnpricedSale(userId, '', 40)).resolves.toBe(false);

            expect(repository.resolveUnpricedSale).not.toHaveBeenCalled();
        });

        it('simulates rate resolution in guest mode', async () => {
            await expect(service.resolveUnpricedSale('guest', 'event-abc', 40)).resolves.toBe(true);
            expect(repository.resolveUnpricedSale).not.toHaveBeenCalled();
        });

        it('uses a caller supplied ledger id so retries stay idempotent', async () => {
            await service.addStockEvent(userId, { item: 'Milk', quantity: 1, ledgerEventId: 'rec-1:0' });

            expect(repository.appendEvents).toHaveBeenCalledWith([
                expect.objectContaining({ ledger_event_id: 'rec-1:0' }),
            ]);
        });

        it('returns false when the repository cannot append', async () => {
            repository.appendEvents.mockResolvedValue(false);

            const result = await service.saleEvent(userId, { item: 'Milk', quantity: 1 });

            expect(result).toBe(false);
        });

        it('simulates events in guest mode without touching the repository', async () => {
            const purchase = await service.addStockEvent('guest', { item: 'Milk', quantity: 1 });
            const expense = await service.expenseEvent('guest', 100);

            expect(purchase).toBe(true);
            expect(expense).toBe(true);
            expect(repository.appendEvents).not.toHaveBeenCalled();
        });
    });

    describe('createProduct', () => {
        it('creates the row at zero then logs a PURCHASED event for the quantity', async () => {
            repository.findItemByName
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({ id: 'item-1', name: 'Bread', quantity: 5, unit: 'packet' } as any);
            repository.createItem.mockResolvedValue({ id: 'item-1' } as any);

            const result = await service.createProduct(userId, { name: 'Bread', quantity: 5, unit: 'packet' });

            expect(repository.createItem).toHaveBeenCalledWith(
                userId, 'Bread', 0, 'packet', undefined, { base_unit: 'packet' }
            );
            expect(repository.appendEvents).toHaveBeenCalledWith([
                expect.objectContaining({
                    type: 'PURCHASED',
                    ledger_event_id: 'create-item-1',
                    payload: { product: 'Bread', quantity: 5, unit: 'packet' },
                }),
            ]);
            expect(result).toEqual({ id: 'item-1', name: 'Bread', quantity: 5, unit: 'packet' });
        });

        it('deletes the row when the initial event cannot be logged', async () => {
            repository.findItemByName.mockResolvedValue(null);
            repository.createItem.mockResolvedValue({ id: 'item-new' } as any);
            repository.appendEvents.mockResolvedValue(false);

            const result = await service.createProduct(userId, { name: 'Bread', quantity: 5, unit: 'packet' });

            expect(result).toBeNull();
            expect(repository.deleteItem).toHaveBeenCalledWith(userId, 'item-new');
        });

        it('refuses a name that already exists', async () => {
            repository.findItemByName.mockResolvedValue({ id: 'item-1' } as any);

            const result = await service.createProduct(userId, { name: 'Bread', quantity: 1 });

            expect(result).toBeNull();
            expect(repository.createItem).not.toHaveBeenCalled();
        });

        it('refuses a barcode that is already registered', async () => {
            repository.findItemByBarcode.mockResolvedValue({ id: 'item-9' } as any);

            const result = await service.createProduct(userId, { name: 'Bread', quantity: 1, barcode: '123' });

            expect(result).toBeNull();
            expect(repository.createItem).not.toHaveBeenCalled();
        });

        it('normalizes legacy category labels before they reach the database', async () => {
            repository.findItemByName.mockResolvedValue(null);
            repository.createItem.mockResolvedValue({ id: 'item-x' } as any);
            repository.appendEvents.mockResolvedValue(true);

            await service.createProduct(userId, {
                name: 'Haldi',
                quantity: 1,
                unit: 'kg',
                category: 'Spices',
            });

            expect(repository.createItem).toHaveBeenCalledWith(
                userId,
                'Haldi',
                0,
                'kg',
                undefined,
                expect.objectContaining({ category: 'SPICES' })
            );
        });

        it('returns null for guests', async () => {
            const result = await service.createProduct('guest', { name: 'Bread', quantity: 1 });

            expect(result).toBeNull();
            expect(repository.createItem).not.toHaveBeenCalled();
        });
    });

    describe('findOrCreateProduct', () => {
        it('returns the existing item by barcode before the name lookup', async () => {
            repository.findItemByBarcode.mockResolvedValue({ id: 'item-9', barcode: '123' } as any);

            const result = await service.findOrCreateProduct(userId, { name: 'Milk', barcode: '123' });

            expect(result).toEqual({ id: 'item-9', barcode: '123' });
            expect(repository.findItemByName).not.toHaveBeenCalled();
        });

        it('links a barcode to an existing name', async () => {
            repository.findItemByBarcode.mockResolvedValue(null);
            repository.findItemByName.mockResolvedValue({ id: 'item-1', name: 'Milk' } as any);
            repository.updateItemBarcode.mockResolvedValue(true);

            const result = await service.findOrCreateProduct(userId, { name: 'Milk', barcode: '123' });

            expect(repository.updateItemBarcode).toHaveBeenCalledWith(userId, 'item-1', '123');
            expect(result).toEqual({ id: 'item-1', name: 'Milk', barcode: '123' });
        });

        it('rejects a same-named item with a different barcode', async () => {
            repository.findItemByBarcode.mockResolvedValue(null);
            repository.findItemByName.mockResolvedValue({ id: 'item-1', name: 'Milk', barcode: '999' } as any);

            const result = await service.findOrCreateProduct(userId, { name: 'Milk', barcode: '123' });

            expect(result).toBeNull();
        });

        it('creates a new item when neither lookup succeeds', async () => {
            repository.findItemByBarcode.mockResolvedValue(null);
            repository.findItemByName.mockResolvedValue(null);
            repository.createItem.mockResolvedValue({ id: 'item-1' } as any);

            await service.findOrCreateProduct(userId, { name: '  Milk   Powder  ', unit: 'pcs', barcode: '123' });

            expect(repository.createItem).toHaveBeenCalledWith(
                userId, 'Milk Powder', 0, 'pcs', '123', { base_unit: 'pcs' }
            );
        });

        it('creates at zero then logs a PURCHASED event for an initial quantity', async () => {
            repository.findItemByBarcode.mockResolvedValue(null);
            repository.findItemByName
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({ id: 'item-5', name: 'Rice', quantity: 5, unit: 'kg' } as any);
            repository.createItem.mockResolvedValue({ id: 'item-5', name: 'Rice', quantity: 0 } as any);
            repository.appendEvents.mockResolvedValue(true);

            const result = await service.findOrCreateProduct(userId, { name: 'Rice', quantity: 5, unit: 'kg' });

            expect(repository.createItem).toHaveBeenCalledWith(
                userId, 'Rice', 0, 'kg', undefined, { base_unit: 'kg' }
            );
            expect(repository.appendEvents).toHaveBeenCalledWith([
                expect.objectContaining({
                    type: 'PURCHASED',
                    ledger_event_id: 'create-item-5',
                    payload: { product: 'Rice', quantity: 5, unit: 'kg', product_id: 'item-5' },
                }),
            ]);
            expect(result).toEqual({ id: 'item-5', name: 'Rice', quantity: 5, unit: 'kg' });
        });

        it('creates a new item forwarding extra attributes when provided', async () => {
            repository.findItemByBarcode.mockResolvedValue(null);
            repository.findItemByName.mockResolvedValue(null);
            repository.createItem.mockResolvedValue({ id: 'item-2' } as any);

            await service.findOrCreateProduct(userId, {
                name: 'Toor Dal',
                unit: 'kg',
                category: 'Staples',
                sellingPrice: 150,
                costPrice: 120,
                secondaryUnit: 'bori',
                conversionFactor: 50,
            });

            expect(repository.createItem).toHaveBeenCalledWith(
                userId,
                'Toor Dal',
                0,
                'kg',
                undefined,
                {
                    category: 'STAPLES',
                    base_unit: 'kg',
                    selling_price: 150,
                    last_purchase_price: 120,
                    secondary_unit: 'bori',
                    conversion_factor: 50,
                }
            );
        });

        it('returns null for guests (both guest and demo-user)', async () => {
            const resultGuest = await service.findOrCreateProduct('guest', { name: 'Milk' });
            expect(resultGuest).toBeNull();

            const resultDemo = await service.findOrCreateProduct('demo-user', { name: 'Milk' });
            expect(resultDemo).toBeNull();

            expect(repository.createItem).not.toHaveBeenCalled();
        });
    });

    describe('store-scoped sharing', () => {
        const staffScope = { userId: 'staff-aman', storeId: 'store-kirana-1' };

        it('stamps events with the active store while keeping the acting user', async () => {
            await service.saleEvent(staffScope, { item: 'Sugar', quantity: 2, unit: 'kg', price: 60 });

            expect(repository.appendEvents).toHaveBeenCalledWith([
                expect.objectContaining({
                    user_id: 'staff-aman',
                    store_id: 'store-kirana-1',
                    type: 'SOLD',
                }),
            ]);
        });

        it('passes the store scope through product lookups and creation', async () => {
            repository.findItemByBarcode.mockResolvedValue(null);
            repository.findItemByName.mockResolvedValue(null);
            repository.createItem.mockResolvedValue({ id: 'item-9' } as any);

            await service.findOrCreateProduct(staffScope, { name: 'Milk', unit: 'pcs' });

            expect(repository.findItemByName).toHaveBeenCalledWith(staffScope, 'Milk');
            expect(repository.createItem).toHaveBeenCalledWith(
                staffScope, 'Milk', 0, 'pcs', undefined, { base_unit: 'pcs' }
            );
        });

        it('scopes stock reads to the store', async () => {
            repository.findItemByName.mockResolvedValue({ quantity: 12, unit: 'kg' } as any);

            await expect(service.checkStock(staffScope, 'Rice')).resolves.toEqual({ quantity: 12, unit: 'kg' });
            expect(repository.findItemByName).toHaveBeenCalledWith(staffScope, 'Rice');
        });

        it('simulates store events for demo users without touching the repository', async () => {
            const result = await service.addStockEvent(
                { userId: 'demo-user', storeId: 'demo-store-default' },
                { item: 'Milk', quantity: 1 }
            );

            expect(result).toBe(true);
            expect(repository.appendEvents).not.toHaveBeenCalled();
        });
    });

    describe('reads', () => {
        it('checkStock returns quantity and unit', async () => {
            repository.findItemByName.mockResolvedValue({ quantity: 42, unit: 'kg' } as any);

            await expect(service.checkStock(userId, 'Rice')).resolves.toEqual({ quantity: 42, unit: 'kg' });
        });

        it('checkStock returns null when the item is missing', async () => {
            repository.findItemByName.mockResolvedValue(null);

            await expect(service.checkStock(userId, 'Gold')).resolves.toBeNull();
        });

        it('getLowStockItems delegates with the threshold', async () => {
            repository.getLowStockItems.mockResolvedValue([]);

            await service.getLowStockItems(userId, 7);

            expect(repository.getLowStockItems).toHaveBeenCalledWith(userId, 7);
        });

        it('getOutOfStockItems delegates with threshold 0', async () => {
            repository.getLowStockItems.mockResolvedValue([]);

            await service.getOutOfStockItems(userId);

            expect(repository.getLowStockItems).toHaveBeenCalledWith(userId, 0);
        });

        it('getProductByBarcode returns null for guests', async () => {
            const result = await service.getProductByBarcode('guest', '123');

            expect(result).toBeNull();
            expect(repository.findItemByBarcode).not.toHaveBeenCalled();
        });
    });

    describe('auditStock', () => {
        it('computes the delta against the latest fetched balance', async () => {
            repository.getItemById.mockResolvedValue({ id: 'item-1', name: 'Sugar', quantity: 40 } as any);

            const ok = await service.auditStock(userId, 'item-1', 37);

            expect(ok).toBe(true);
            expect(repository.getItemById).toHaveBeenCalledWith(userId, 'item-1');
            expect(repository.appendEvents).toHaveBeenCalledWith([
                expect.objectContaining({
                    type: 'ADJUSTED',
                    payload: { product: 'Sugar', delta: -3 },
                }),
            ]);
        });

        it('is a no-op when the physical count matches the ledger', async () => {
            repository.getItemById.mockResolvedValue({ id: 'item-1', name: 'Sugar', quantity: 40 } as any);

            const ok = await service.auditStock(userId, 'item-1', 40);

            expect(ok).toBe(true);
            expect(repository.appendEvents).not.toHaveBeenCalled();
        });

        it('fails when the product no longer exists', async () => {
            repository.getItemById.mockResolvedValue(null);

            await expect(service.auditStock(userId, 'missing', 5)).resolves.toBe(false);
        });
    });

    describe('offline queue resilience', () => {
        it('queues the exact event when the network append fails and reports optimistic success', async () => {
            const queued: unknown[] = [];
            const fakeQueue = new OfflineQueueService('test-inventory-offline-queue', 50);
            const queueSpy = jest.spyOn(fakeQueue, 'enqueue').mockImplementation(async (events) => {
                queued.push(...events);
            });
            const offlineService = new InventoryService(repository, fakeQueue);
            repository.appendEvents.mockResolvedValue(false);

            const result = await offlineService.saleEvent(
                { userId, storeId: 'store-1' },
                { item: 'Sugar', quantity: 1 }
            );

            expect(result).toBe(true);
            expect(queueSpy).toHaveBeenCalledTimes(1);
            expect(queued).toHaveLength(1);
            expect(queued[0]).toMatchObject({ store_id: 'store-1', type: 'SOLD' });
        });

        it('queues when the repository throws a transport failure', async () => {
            const queued: unknown[] = [];
            const fakeQueue = new OfflineQueueService('test-inventory-throw-queue', 50);
            jest.spyOn(fakeQueue, 'enqueue').mockImplementation(async (events) => {
                queued.push(...events);
            });
            const offlineService = new InventoryService(repository, fakeQueue);
            repository.appendEvents.mockRejectedValue(new Error('Network request failed'));

            const result = await offlineService.saleEvent(
                { userId, storeId: 'store-1' },
                { item: 'Sugar', quantity: 1 }
            );

            expect(result).toBe(true);
            expect(queued).toHaveLength(1);
        });

        it('flushes queued events through the repository', async () => {
            const fakeQueue = new OfflineQueueService('test-inventory-flush-queue', 50);
            const offlineService = new InventoryService(repository, fakeQueue);
            const flushSpy = jest.spyOn(fakeQueue, 'flush').mockResolvedValue(2);

            await expect(offlineService.flushOfflineQueue()).resolves.toBe(2);
            expect(flushSpy).toHaveBeenCalledTimes(1);
        });
    });
});
