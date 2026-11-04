import { BarcodeScannerService } from '@/services/BarcodeScannerService';
import { InventoryService } from '@/services/InventoryService';
import { InventoryItem } from '@/core/interfaces/IInventoryRepository';

interface ServiceMock {
    getProductByBarcode: jest.Mock;
    findOrCreateProduct: jest.Mock;
    addStockEvent: jest.Mock;
    checkStock: jest.Mock;
    saleEvent: jest.Mock;
    createProduct: jest.Mock;
}

const makeInventoryService = (): ServiceMock => ({
    getProductByBarcode: jest.fn(),
    findOrCreateProduct: jest.fn(),
    addStockEvent: jest.fn(),
    checkStock: jest.fn(),
    saleEvent: jest.fn(),
    createProduct: jest.fn(),
});

const item = (partial: Partial<InventoryItem> = {}): InventoryItem => ({
    id: 'item-1',
    user_id: 'user-1',
    name: 'Sugar',
    quantity: 10,
    unit: 'kg',
    selling_price: 44,
    ...partial,
});

describe('BarcodeScannerService', () => {
    let inventory: ServiceMock;
    const scope = { userId: 'user-1', storeId: 'store-1' };

    const build = (
        overrides: Partial<{ userId: string | null; isGuest: boolean; lookupExternal: jest.Mock }> = {}
    ) => new BarcodeScannerService({
        inventoryService: inventory as unknown as InventoryService,
        scope: () => scope,
        userId: overrides.userId === undefined ? 'user-1' : overrides.userId,
        isGuest: overrides.isGuest ?? false,
        lookupExternal: overrides.lookupExternal,
    });

    beforeEach(() => {
        jest.clearAllMocks();
        inventory = makeInventoryService();
    });

    it('returns the local catalog row without an external lookup', async () => {
        const local = item();
        inventory.getProductByBarcode.mockResolvedValue(local);
        const lookupExternal = jest.fn();

        const resolution = await build({ lookupExternal }).resolveBarcode('123');

        expect(resolution.product).toEqual(local);
        expect(resolution.canOpen).toBe(true);
        expect(lookupExternal).not.toHaveBeenCalled();
    });

    it('auto-catalogues external products and opens the action modal', async () => {
        inventory.getProductByBarcode.mockResolvedValue(null);
        inventory.findOrCreateProduct.mockResolvedValue(item({ id: 'created-1', name: 'Bread' }));
        const lookupExternal = jest.fn().mockResolvedValue({ name: 'Bread', unit: 'packet' });

        const resolution = await build({ lookupExternal }).resolveBarcode('456');

        expect(inventory.findOrCreateProduct).toHaveBeenCalledWith(
            scope,
            { name: 'Bread', unit: 'pcs', baseUnit: 'pcs', barcode: '456', quantity: 0 }
        );
        expect(resolution.product?.id).toBe('created-1');
    });

    it('canonicalizes mass units from external lookups (g -> kg)', async () => {
        inventory.getProductByBarcode.mockResolvedValue(null);
        inventory.findOrCreateProduct.mockResolvedValue(item({ id: 'created-2', name: 'Suji 500g' }));
        const lookupExternal = jest.fn().mockResolvedValue({ name: 'Suji 500g', unit: 'g' });

        await build({ lookupExternal }).resolveBarcode('321');

        expect(inventory.findOrCreateProduct).toHaveBeenCalledWith(
            scope,
            { name: 'Suji 500g', unit: 'kg', baseUnit: 'kg', barcode: '321', quantity: 0 }
        );
    });

    it('prefills instead of saving when auto-catalogue fails', async () => {
        inventory.getProductByBarcode.mockResolvedValue(null);
        inventory.findOrCreateProduct.mockResolvedValue(null);
        const lookupExternal = jest.fn().mockResolvedValue({ name: 'Lays', unit: 'packet' });

        const resolution = await build({ lookupExternal }).resolveBarcode('789');

        expect(resolution.product).toBeNull();
        expect(resolution.prefilled).toEqual({ name: 'Lays', unit: 'pcs' });
        expect(resolution.canOpen).toBe(true);
    });

    it('never saves external products in guest mode', async () => {
        inventory.getProductByBarcode.mockResolvedValue(null);
        const lookupExternal = jest.fn().mockResolvedValue({ name: 'Milk', unit: 'packet' });

        const resolution = await build({ isGuest: true, lookupExternal }).resolveBarcode('999');

        expect(inventory.findOrCreateProduct).not.toHaveBeenCalled();
        expect(resolution.canOpen).toBe(false);
        expect(resolution.message).toContain('Guest mode');
    });

    it('asks the user to log in when unauthenticated', async () => {
        const resolution = await build({ userId: null }).resolveBarcode('123');

        expect(resolution.canOpen).toBe(false);
        expect(resolution.message).toContain('log in');
        expect(inventory.getProductByBarcode).not.toHaveBeenCalled();
    });

    it('records a cold-start sale with the catalog price', async () => {
        inventory.checkStock.mockResolvedValue({ quantity: 0, unit: 'kg' });
        inventory.saleEvent.mockResolvedValue(true);

        const result = await build().recordSale(item(), 2);

        expect(inventory.saleEvent).toHaveBeenCalledWith(scope, {
            item: 'Sugar',
            quantity: 2,
            unit: 'kg',
            price: 44,
        });
        expect(result).toEqual({ applied: true, coldStart: true });
    });

    it('delegates stock-in and product creation', async () => {
        inventory.addStockEvent.mockResolvedValue(true);
        inventory.createProduct.mockResolvedValue(item({ id: 'new-1' }));

        const service = build();

        await expect(service.addStock(item(), 5)).resolves.toBe(true);
        expect(inventory.addStockEvent).toHaveBeenCalledWith(scope, {
            item: 'Sugar',
            quantity: 5,
            unit: 'kg',
        });

        await expect(service.createProduct('Rice', 1, 'kg', '111')).resolves.toEqual(
            expect.objectContaining({ id: 'new-1' })
        );
    });
});
