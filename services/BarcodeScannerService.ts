import { InventoryItem, ScopeInput } from '@/core/interfaces/IInventoryRepository';
import { InventoryService } from '@/services/InventoryService';
import { OpenFoodFactsService } from '@/services/external/OpenFoodFactsService';

export interface ExternalProductLookup {
    name: string;
    unit?: string | null;
}

export interface BarcodeScannerDeps {
    inventoryService: InventoryService;
    /** Reads the active tenant at call time (safe across awaits). */
    scope: () => ScopeInput;
    userId: string | null;
    isGuest: boolean;
    lookupExternal?: (barcode: string) => Promise<ExternalProductLookup | null>;
}

export interface ScanResolution {
    /** Catalog row when it exists or was just auto-created. */
    product: InventoryItem | null;
    /** External-product data used to prefill the creation form. */
    prefilled: { name: string; unit: string } | null;
    /** Non-fatal note for the scanner toast. */
    message: string | null;
    /** False when the scanner should keep waiting (not logged in / guest). */
    canOpen: boolean;
}

export interface SaleRecordResult {
    applied: boolean;
    coldStart: boolean;
}

const MASS_UNITS = new Set(['g', 'gram', 'grams']);
const VOLUME_UNITS = new Set(['ml', 'milliliter', 'millilitre', 'milliliters', 'millilitres']);
const BASE_UNITS = new Set(['kg', 'l', 'pcs', 'm']);

/**
 * Canonicalizes an external (OpenFoodFacts) or free-text unit to one of the
 * atomic base units. `g`/`ml` collapse to `kg`/`l`; anything unknown becomes
 * `pcs`. This prevents rows whose `unit` dimension never matches `base_unit`.
 */
export function canonicalBaseUnit(unit?: string | null): string {
    const key = (unit ?? '').trim().toLowerCase();
    if (MASS_UNITS.has(key)) return 'kg';
    if (VOLUME_UNITS.has(key)) return 'l';
    if (BASE_UNITS.has(key)) return key;
    return 'pcs';
}

/**
 * Orchestrates barcode resolution: local catalog lookup, external lookup,
 * auto-cataloguing, then stock-in/sale recording. Keeps route files thin.
 */
export class BarcodeScannerService {
    private readonly inventoryService: InventoryService;
    private readonly scope: () => ScopeInput;
    private readonly userId: string | null;
    private readonly isGuest: boolean;
    private readonly lookupExternal: (barcode: string) => Promise<ExternalProductLookup | null>;

    constructor(deps: BarcodeScannerDeps) {
        this.inventoryService = deps.inventoryService;
        this.scope = deps.scope;
        this.userId = deps.userId;
        this.isGuest = deps.isGuest;
        this.lookupExternal = deps.lookupExternal
            ?? ((barcode: string) => OpenFoodFactsService.getProductByBarcode(barcode));
    }

    async resolveBarcode(barcode: string): Promise<ScanResolution> {
        if (!this.userId) {
            return { product: null, prefilled: null, canOpen: false, message: 'Please log in to save items' };
        }

        const activeScope = this.scope();
        const local = await this.inventoryService.getProductByBarcode(activeScope, barcode);
        if (local) {
            return { product: local, prefilled: null, canOpen: true, message: null };
        }

        const external = await this.lookupExternal(barcode);
        if (!external) {
            return { product: null, prefilled: null, canOpen: true, message: null };
        }

        if (this.isGuest) {
            return {
                product: null,
                prefilled: null,
                canOpen: false,
                message: `Guest mode: ${external.name} not saved`,
            };
        }

        const baseUnit = canonicalBaseUnit(external.unit);
        const created = await this.inventoryService.findOrCreateProduct(activeScope, {
            name: external.name,
            unit: baseUnit,
            baseUnit,
            barcode,
            quantity: 0,
        });

        if (!created) {
            return {
                product: null,
                prefilled: { name: external.name, unit: baseUnit },
                canOpen: true,
                message: null,
            };
        }

        return { product: created, prefilled: null, canOpen: true, message: null };
    }

    async addStock(product: InventoryItem, quantity: number): Promise<boolean> {
        if (!this.userId || this.isGuest) return false;

        return this.inventoryService.addStockEvent(this.scope(), {
            item: product.name,
            quantity,
            unit: product.base_unit || product.unit || 'pcs',
        });
    }

    async recordSale(product: InventoryItem, quantity: number): Promise<SaleRecordResult> {
        if (!this.userId || this.isGuest) return { applied: false, coldStart: false };

        const activeScope = this.scope();
        const eventUnit = product.base_unit || product.unit || 'pcs';

        // Cold-start SKU: link the barcode before recording the stock-out
        if (product.barcode && !product.id) {
            try {
                await this.inventoryService.findOrCreateProduct(activeScope, {
                    name: product.name,
                    unit: eventUnit,
                    baseUnit: eventUnit,
                    barcode: product.barcode,
                    quantity: 0,
                });
            } catch (error) {
                console.warn('[BarcodeScanner] Failed linking barcode for cold-start sale:', error);
            }
        }

        const stock = await this.inventoryService.checkStock(activeScope, product.name);
        const existingQty = stock ? Number(stock.quantity) : 0;
        const coldStart = !stock || existingQty <= 0 || existingQty < quantity;

        const applied = await this.inventoryService.saleEvent(activeScope, {
            item: product.name,
            quantity,
            unit: eventUnit,
            price: product.selling_price ?? undefined,
        });

        return { applied, coldStart };
    }

    async createProduct(name: string, quantity: number, unit: string, barcode: string): Promise<InventoryItem | null> {
        if (!this.userId || this.isGuest) return null;

        return this.inventoryService.createProduct(this.scope(), { name, quantity, unit, barcode });
    }
}
