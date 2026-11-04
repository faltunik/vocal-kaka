import { IInventoryRepository, InventoryItem, LedgerEventInput, LedgerEventType, ScopeInput, resolveScope } from '@/core/interfaces/IInventoryRepository';
import { OfflineQueueService } from '@/services/offline/OfflineQueueService';
import { normalizeInventoryCategory } from '@/utils/categories';
import { devWarn } from '@/utils/devLog';
import { parsePositiveQuantity } from '@/utils/quantity';
import { createUuidV4 } from '@/utils/uuid';

export const GUEST_USER_ID = 'guest';

export function isGuestUser(userId: string): boolean {
    return userId === GUEST_USER_ID || userId === 'demo-user';
}

export interface ProductCreationInput {
    name: string;
    unit?: string;
    barcode?: string;
    quantity?: number;
    category?: string;
    aliases?: string[];
    baseUnit?: string;
    secondaryUnit?: string | null;
    conversionFactor?: number | null;
    costPrice?: number | null;
    sellingPrice?: number | null;
    lowStockThreshold?: number | null;
}

export interface StockEventInput {
    item: string;
    quantity: number;
    unit?: string;
    price?: number;
    productId?: string;
    ledgerEventId?: string;
}

function normalizeItemName(name: string): string {
    return name.trim().replace(/\s+/g, ' ');
}

/**
 * Client-side inventory service. All stock movements are appended to the
 * event ledger; the database trigger materializes quantities atomically, so
 * no client-side stock math is trusted.
 *
 * Every method takes a ScopeInput: a store scope shares one catalog across
 * the owner and staff, while a plain user id keeps the legacy per-user scope.
 */
export class InventoryService {
    private repository: IInventoryRepository;
    private offlineQueue?: OfflineQueueService;
    private mutationLocks = new Map<string, Promise<unknown>>();

    constructor(repository: IInventoryRepository, offlineQueue?: OfflineQueueService) {
        this.repository = repository;
        this.offlineQueue = offlineQueue;
    }

    /** Guest/demo scopes never touch the database. */
    private isGuestScope(scope: ScopeInput): boolean {
        return isGuestUser(resolveScope(scope).userId);
    }

    private async withItemLock<T>(key: string, task: () => Promise<T>): Promise<T> {
        const previous = this.mutationLocks.get(key) ?? Promise.resolve();
        const run = previous.then(task, task);
        const stored = run.catch(() => undefined);
        this.mutationLocks.set(key, stored);

        void stored.finally(() => {
            if (this.mutationLocks.get(key) === stored) {
                this.mutationLocks.delete(key);
            }
        });

        return run;
    }

    async recordEvent(
        scope: ScopeInput,
        type: LedgerEventType,
        payload: Record<string, unknown>,
        ledgerEventId?: string
    ): Promise<boolean> {
        const { userId, storeId } = resolveScope(scope);
        if (isGuestUser(userId)) return true;

        const event: LedgerEventInput = {
            user_id: userId,
            ...(storeId ? { store_id: storeId } : {}),
            type,
            payload,
            ledger_event_id: ledgerEventId || createUuidV4(),
        };

        let appended = false;
        try {
            appended = await this.repository.appendEvents([event]);
        } catch (error) {
            devWarn('[InventoryService] appendEvents failed, queueing for retry', error);
        }
        if (appended) return true;

        // Zero-loss offline resilience: keep the exact event (with its
        // idempotency key) and report optimistic success to the UI.
        if (this.offlineQueue) {
            await this.offlineQueue.enqueue([event]);
            return true;
        }

        return false;
    }

    /** Retries queued counter/scanner events in order. Returns applied count. */
    async flushOfflineQueue(): Promise<number> {
        if (!this.offlineQueue) return 0;
        return this.offlineQueue.flush(events => this.repository.appendEvents(events));
    }

    async pendingOfflineCount(): Promise<number> {
        return this.offlineQueue ? this.offlineQueue.pendingCount() : 0;
    }

    /** Subscribes to pending ledger-queue changes for offline badges. */
    subscribeOfflineQueue(listener: (count: number) => void): () => void {
        return this.offlineQueue ? this.offlineQueue.subscribe(listener) : () => undefined;
    }

    /**
     * Starts the automatic reconnect/foreground flush loop for queued ledger
     * events. Returns a cleanup function.
     */
    startOfflineAutoFlush(): () => void {
        if (!this.offlineQueue) return () => undefined;
        return this.offlineQueue.startAutoFlush(events => this.repository.appendEvents(events));
    }

    async addStockEvent(scope: ScopeInput, input: StockEventInput): Promise<boolean> {
        const name = normalizeItemName(input.item);
        const quantity = parsePositiveQuantity(input.quantity);
        if (!name || quantity == null) return false;

        return await this.recordEvent(scope, 'PURCHASED', {
            product: name,
            quantity,
            unit: input.unit || 'units',
            ...(input.productId ? { product_id: input.productId } : {}),
            ...(input.price != null ? { price: input.price } : {}),
        }, input.ledgerEventId);
    }

    async saleEvent(scope: ScopeInput, input: StockEventInput): Promise<boolean> {
        const name = normalizeItemName(input.item);
        const quantity = parsePositiveQuantity(input.quantity);
        if (!name || quantity == null) return false;

        return await this.recordEvent(scope, 'SOLD', {
            product: name,
            quantity,
            unit: input.unit || 'units',
            ...(input.price != null ? { price: input.price } : {}),
        }, input.ledgerEventId);
    }

    async writeOffEvent(scope: ScopeInput, input: StockEventInput): Promise<boolean> {
        return await this.stockOutEvent(scope, 'WRITE_OFF', input);
    }

    async vendorReturnEvent(scope: ScopeInput, input: StockEventInput): Promise<boolean> {
        return await this.stockOutEvent(scope, 'VENDOR_RETURN', input);
    }

    async customerReturnEvent(scope: ScopeInput, input: StockEventInput): Promise<boolean> {
        const name = normalizeItemName(input.item);
        const quantity = parsePositiveQuantity(input.quantity);
        if (!name || quantity == null) return false;

        return await this.recordEvent(scope, 'CUSTOMER_RETURN', {
            product: name,
            quantity,
            unit: input.unit || 'units',
            ...(input.price != null ? { price: input.price } : {}),
        }, input.ledgerEventId);
    }

    async adjustEvent(scope: ScopeInput, item: string, delta: number, ledgerEventId?: string): Promise<boolean> {
        const name = normalizeItemName(item);
        if (!name || !Number.isFinite(delta) || delta === 0) return false;

        return await this.recordEvent(scope, 'ADJUSTED', { product: name, delta }, ledgerEventId);
    }

    /**
     * Reconciles the recorded balance with a physical count by appending an
     * ADJUSTED event for the difference. The delta is computed against the
     * latest atomic balance fetched inside the lock, never against a stale
     * client-side snapshot.
     */
    async auditStock(scope: ScopeInput, itemId: string, physicalCount: number): Promise<boolean> {
        const { userId } = resolveScope(scope);
        if (isGuestUser(userId)) return true;
        if (!itemId || !Number.isFinite(physicalCount)) return false;

        return this.withItemLock(`item-update:${itemId}`, async () => {
            const latest = await this.repository.getItemById(scope, itemId);
            if (!latest) return false;

            const delta = Math.round((physicalCount - Number(latest.quantity ?? 0)) * 1000) / 1000;
            if (delta === 0) return true;

            return await this.recordEvent(scope, 'ADJUSTED', { product: latest.name, delta });
        });
    }

    async expenseEvent(scope: ScopeInput, amount: number, note?: string, ledgerEventId?: string): Promise<boolean> {
        const parsed = parsePositiveQuantity(amount);
        if (parsed == null) return false;

        return await this.recordEvent(scope, 'EXPENSE', { amount: parsed, note: note ?? '' }, ledgerEventId);
    }

    async voidEvent(scope: ScopeInput, eventId: string, ledgerEventId?: string): Promise<boolean> {
        if (!eventId) return false;
        // Deterministic ledger id: voiding the same event twice is a no-op
        return await this.recordEvent(scope, 'VOID', { voided_event_id: eventId }, ledgerEventId ?? `void-${eventId}`);
    }

    /**
     * Atomically voids an event and appends its replacement via the
     * apply_correction RPC, so a failed replacement can never lose the original.
     */
    async applyCorrection(
        scope: ScopeInput,
        voidedEventId: string,
        replacementType: LedgerEventType | null,
        replacementPayload: Record<string, unknown> | null
    ): Promise<boolean> {
        if (!voidedEventId) return false;
        const { userId } = resolveScope(scope);
        if (isGuestUser(userId)) return true;
        return await this.repository.applyCorrection(voidedEventId, replacementType, replacementPayload);
    }

    /**
     * Resolves a flagged value-based sale (Tier 4) by rate per unit. The DB
     * procedure voids the unresolved entry and appends the finalized SOLD event.
     */
    async resolveUnpricedSale(scope: ScopeInput, eventId: string, ratePerUnit: number): Promise<boolean> {
        if (!eventId || !Number.isFinite(ratePerUnit) || ratePerUnit <= 0) return false;
        const { userId } = resolveScope(scope);
        if (isGuestUser(userId)) return true;
        return await this.repository.resolveUnpricedSale(eventId, ratePerUnit);
    }

    private async stockOutEvent(scope: ScopeInput, type: LedgerEventType, input: StockEventInput): Promise<boolean> {
        const name = normalizeItemName(input.item);
        const quantity = parsePositiveQuantity(input.quantity);
        if (!name || quantity == null) return false;

        return await this.recordEvent(scope, type, {
            product: name,
            quantity,
            unit: input.unit || 'units',
        }, input.ledgerEventId);
    }

    /**
     * Finds a catalogue entry by barcode/name and links the barcode when missing.
     * Returns null when a same-named item already has a different barcode (conflict),
     * or when neither lookup nor creation succeeds.
     */
    async findOrCreateProduct(scope: ScopeInput, input: ProductCreationInput): Promise<InventoryItem | null> {
        if (this.isGuestScope(scope)) return null;

        const name = normalizeItemName(input.name);
        if (!name) return null;

        const lockKey = input.barcode ? `barcode:${input.barcode}` : `item:${name.toLowerCase()}`;

        return this.withItemLock(lockKey, async () => {
            if (input.barcode) {
                const byBarcode = await this.repository.findItemByBarcode(scope, input.barcode);
                if (byBarcode) return byBarcode;
            }

            const byName = await this.repository.findItemByName(scope, name);
            if (byName) {
                if (!byName.barcode && input.barcode) {
                    const linked = await this.repository.updateItemBarcode(scope, byName.id, input.barcode);
                    return linked ? { ...byName, barcode: input.barcode } : null;
                }
                if (byName.barcode === input.barcode) return byName;
                // Same name, different barcode: cannot reuse safely
                return null;
            }

            const hasExtra =
                input.category !== undefined ||
                input.aliases !== undefined ||
                input.baseUnit !== undefined ||
                input.unit !== undefined ||
                input.secondaryUnit !== undefined ||
                input.conversionFactor !== undefined ||
                input.sellingPrice !== undefined ||
                input.costPrice !== undefined ||
                input.lowStockThreshold !== undefined;

            const extra: Partial<InventoryItem> | undefined = hasExtra
                ? {
                      ...(input.category ? { category: normalizeInventoryCategory(input.category) } : {}),
                      ...(input.aliases ? { aliases: input.aliases } : {}),
                      ...(input.baseUnit || input.unit ? { base_unit: input.baseUnit || input.unit } : {}),
                      ...(input.secondaryUnit !== undefined ? { secondary_unit: input.secondaryUnit } : {}),
                      ...(input.conversionFactor !== undefined ? { conversion_factor: input.conversionFactor } : {}),
                      ...(input.sellingPrice !== undefined ? { selling_price: input.sellingPrice } : {}),
                      ...(input.costPrice !== undefined ? { last_purchase_price: input.costPrice } : {}),
                      ...(input.lowStockThreshold !== undefined ? { low_stock_threshold: input.lowStockThreshold ?? undefined } : {}),
                  }
                : undefined;

            const unit = input.unit || 'pcs';
            const created = await this.repository.createItem(
                scope,
                name,
                0,
                unit,
                input.barcode,
                ...(extra ? [extra] : [])
            );
            if (!created) return null;

            // Balances are ledger-derived: initial stock only lands through a
            // PURCHASED event, never through a direct quantity write.
            if (input.quantity != null && input.quantity > 0) {
                const logged = await this.addStockEvent(scope, {
                    item: name,
                    quantity: input.quantity,
                    unit,
                    productId: created.id,
                    price: input.costPrice ?? undefined,
                    ledgerEventId: `create-${created.id}`,
                });
                if (!logged) {
                    await this.repository.deleteItem(scope, created.id);
                    return null;
                }
                return await this.repository.findItemByName(scope, name) ?? created;
            }

            return created;
        });
    }

    /**
     * Creates a product with an initial quantity. The row starts at zero and the
     * quantity is applied through a PURCHASED event, so the ledger stays the
     * single source of truth.
     */
    async createProduct(scope: ScopeInput, input: ProductCreationInput & { quantity: number }): Promise<InventoryItem | null> {
        const { userId } = resolveScope(scope);
        if (userId === GUEST_USER_ID) return null;

        const name = normalizeItemName(input.name);
        if (!name) return null;

        const lockKey = `item:${name.toLowerCase()}`;

        return this.withItemLock(lockKey, async () => {
            if (input.barcode) {
                const byBarcode = await this.repository.findItemByBarcode(scope, input.barcode);
                if (byBarcode) return null;
            }

            const byName = await this.repository.findItemByName(scope, name);
            if (byName) return null;

            const unit = input.baseUnit || input.unit || 'pcs';
            const extra: Partial<InventoryItem> = {
                ...(input.category !== undefined ? { category: normalizeInventoryCategory(input.category) } : {}),
                ...(input.aliases !== undefined ? { aliases: input.aliases } : {}),
                base_unit: input.baseUnit || unit,
                ...(input.secondaryUnit !== undefined ? { secondary_unit: input.secondaryUnit } : {}),
                ...(input.conversionFactor !== undefined ? { conversion_factor: input.conversionFactor } : {}),
                ...(input.sellingPrice !== undefined ? { selling_price: input.sellingPrice } : {}),
                ...(input.costPrice !== undefined ? { last_purchase_price: input.costPrice } : {}),
                ...(input.lowStockThreshold !== undefined ? { low_stock_threshold: input.lowStockThreshold ?? undefined } : {}),
            };

            const hasExtra = input.category !== undefined ||
                input.aliases !== undefined ||
                input.baseUnit !== undefined ||
                input.unit !== undefined ||
                input.secondaryUnit !== undefined ||
                input.conversionFactor !== undefined ||
                input.sellingPrice !== undefined ||
                input.costPrice !== undefined ||
                input.lowStockThreshold !== undefined;

            const created = hasExtra
                ? await this.repository.createItem(scope, name, 0, unit, input.barcode, extra)
                : await this.repository.createItem(scope, name, 0, unit, input.barcode);

            if (!created) return null;

            if (input.quantity > 0) {
                const logged = await this.addStockEvent(scope, {
                    item: name,
                    quantity: input.quantity,
                    unit,
                    price: input.costPrice ?? undefined,
                    ledgerEventId: `create-${created.id}`,
                });
                if (!logged) {
                    await this.repository.deleteItem(scope, created.id);
                    return null;
                }
                return await this.repository.findItemByName(scope, name) ?? created;
            }

            return created;
        });
    }

    async updateProduct(
        scope: ScopeInput,
        id: string,
        updates: Partial<InventoryItem>
    ): Promise<boolean> {
        const { userId } = resolveScope(scope);
        if (isGuestUser(userId)) return true;

        const normalizedUpdates = updates.category !== undefined
            ? { ...updates, category: normalizeInventoryCategory(updates.category) }
            : updates;

        const lockKey = `item-update:${id}`;
        return this.withItemLock(lockKey, async () => {
            if (this.repository.updateProduct) {
                return await this.repository.updateProduct(scope, id, normalizedUpdates);
            }
            return false;
        });
    }

    async deleteProduct(scope: ScopeInput, id: string): Promise<boolean> {
        const { userId } = resolveScope(scope);
        if (isGuestUser(userId)) return true;
        const lockKey = `item-delete:${id}`;
        return this.withItemLock(lockKey, async () => {
            return await this.repository.deleteItem(scope, id);
        });
    }

    async checkStock(scope: ScopeInput, itemName: string): Promise<{ quantity: number; unit: string } | null> {
        const item = await this.repository.findItemByName(scope, itemName);
        return item ? { quantity: item.quantity, unit: item.unit } : null;
    }

    async getProductByBarcode(scope: ScopeInput, barcode: string): Promise<InventoryItem | null> {
        if (this.isGuestScope(scope)) return null;
        return await this.repository.findItemByBarcode(scope, barcode);
    }

    async getLowStockItems(scope: ScopeInput, threshold: number = 5): Promise<InventoryItem[]> {
        return await this.repository.getLowStockItems(scope, threshold);
    }

    async getOutOfStockItems(scope: ScopeInput): Promise<InventoryItem[]> {
        return await this.repository.getLowStockItems(scope, 0);
    }
}
