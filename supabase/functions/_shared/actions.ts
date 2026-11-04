import { CATEGORY_MARGIN_BENCHMARKS, classifyCategory } from './categories.ts';

export interface UnitResolution {
    quantity: number;
    unit: string | null;
    baseUnit: string | null;
    recognized: boolean;
    originalQuantity: number;
    originalUnit: string | null;
}

export interface UnitNormalizer {
    resolve(quantity: number, unit?: string | null): UnitResolution;
    isRecognized?(unit?: string | null): boolean;
}

export type Intent =
    | 'ADD_STOCK'
    | 'SALE'
    | 'CHECK_STOCK'
    | 'CHECK_PROFIT'
    | 'WRITE_OFF'
    | 'CUSTOMER_RETURN'
    | 'VENDOR_RETURN'
    | 'LOG_EXPENSE'
    | 'CHECK_LOW_STOCK'
    | 'CHECK_OUT_OF_STOCK'
    | 'UNKNOWN';

export interface ParsedAction {
    intent: Intent;
    item?: string | null;
    quantity?: number | null;
    unit?: string | null;
    amount?: number | null;
    original_text?: string;
}

export interface EventInsert {
    type: string;
    payload: Record<string, unknown>;
}

export interface CommodityBenchmark {
    commodityKey: string;
    canonicalName: string;
    baseUnit: string;
    benchmarkPrice: number;
    aliases: string[];
}

export const DEFAULT_COMMODITY_REGISTRY: CommodityBenchmark[] = [
    { commodityKey: 'sugar', canonicalName: 'Sugar', baseUnit: 'kg', benchmarkPrice: 44.00, aliases: ['cheeni', 'chini', 'shakkar', 'sakhar', 'चीनी', 'शक्कर'] },
    { commodityKey: 'cumin', canonicalName: 'Cumin', baseUnit: 'kg', benchmarkPrice: 420.00, aliases: ['jeera', 'jira', 'zeera', 'जीरा'] },
    { commodityKey: 'mustard_oil', canonicalName: 'Mustard Oil', baseUnit: 'l', benchmarkPrice: 145.00, aliases: ['sarson tel', 'sarson ka tel', 'rai tel', 'सरसों तेल'] },
    { commodityKey: 'oil', canonicalName: 'Oil', baseUnit: 'l', benchmarkPrice: 140.00, aliases: ['tel', 'cooking oil', 'edible oil', 'तेल'] },
    { commodityKey: 'wheat_flour', canonicalName: 'Atta', baseUnit: 'kg', benchmarkPrice: 38.00, aliases: ['aata', 'aashirvaad aata', 'gehu aata', 'आटा'] },
    { commodityKey: 'rice', canonicalName: 'Rice', baseUnit: 'kg', benchmarkPrice: 52.00, aliases: ['chawal', 'basmati', 'kolam', 'चावल'] },
    { commodityKey: 'toor_dal', canonicalName: 'Toor Dal', baseUnit: 'kg', benchmarkPrice: 160.00, aliases: ['arhar dal', 'tuvar dal', 'toor daal', 'अरहर दाल'] },
    { commodityKey: 'moong_dal', canonicalName: 'Moong Dal', baseUnit: 'kg', benchmarkPrice: 120.00, aliases: ['mung dal', 'peeli dal', 'मूंग दाल'] },
    { commodityKey: 'besan', canonicalName: 'Besan', baseUnit: 'kg', benchmarkPrice: 85.00, aliases: ['gram flour', 'chana besan', 'बेसन'] },
    { commodityKey: 'paneer', canonicalName: 'Paneer', baseUnit: 'kg', benchmarkPrice: 360.00, aliases: ['fresh paneer', 'cottage cheese', 'पनीर'] },
    { commodityKey: 'cashew', canonicalName: 'Cashew', baseUnit: 'kg', benchmarkPrice: 850.00, aliases: ['kaju', 'काजू'] },
    { commodityKey: 'coriander_powder', canonicalName: 'Coriander Powder', baseUnit: 'kg', benchmarkPrice: 240.00, aliases: ['dhaniya powder', 'dhaniya patti', 'धनिया'] },
    { commodityKey: 'onion', canonicalName: 'Onion', baseUnit: 'kg', benchmarkPrice: 35.00, aliases: ['pyaaz', 'kanda', 'प्याज'] },
    { commodityKey: 'potato', canonicalName: 'Potato', baseUnit: 'kg', benchmarkPrice: 25.00, aliases: ['aloo', 'alu', 'आलू'] },
];

export function findCommodityBenchmark(
    name: string,
    registry: CommodityBenchmark[] = DEFAULT_COMMODITY_REGISTRY
): CommodityBenchmark | null {
    if (!name) return null;
    const lower = name.trim().toLowerCase();
    for (const item of registry) {
        if (
            item.canonicalName.toLowerCase() === lower ||
            item.commodityKey.toLowerCase() === lower ||
            item.aliases.some(alias => alias.toLowerCase() === lower)
        ) {
            return item;
        }
    }
    return null;
}

export function round(value: number, decimals: number = 3): number {
    const factor = Math.pow(10, decimals);
    return Math.round((value + Number.EPSILON) * factor) / factor;
}

export interface InventoryPriceRecord {
    selling_price?: number | null;
    last_purchase_price?: number | null;
    base_unit?: string | null;
    unit?: string | null;
    category?: string | null;
}

export type InventoryLookupFn = (
    itemName: string
) => Promise<InventoryPriceRecord | null | undefined> | InventoryPriceRecord | null | undefined;

export type InventoryPriceSource =
    | Record<string, InventoryPriceRecord>
    | InventoryLookupFn;

export interface ExecuteActionsOptions {
    inventory?: InventoryPriceSource;
    commodityRegistry?: CommodityBenchmark[];
    normalizer?: UnitNormalizer;
}

/** Canonical intent list. Exported so provider schemas cannot drift from validation. */
export const ACTION_INTENTS = [
    'ADD_STOCK',
    'SALE',
    'CHECK_STOCK',
    'CHECK_PROFIT',
    'WRITE_OFF',
    'CUSTOMER_RETURN',
    'VENDOR_RETURN',
    'LOG_EXPENSE',
    'CHECK_LOW_STOCK',
    'CHECK_OUT_OF_STOCK',
    'UNKNOWN',
] as const;

const VALID_INTENTS: ReadonlySet<string> = new Set(ACTION_INTENTS);

const QUERY_INTENTS: ReadonlySet<string> = new Set([
    'CHECK_STOCK',
    'CHECK_PROFIT',
    'CHECK_LOW_STOCK',
    'CHECK_OUT_OF_STOCK',
]);

export function validateActions(parsed: unknown): ParsedAction[] {
    const source = parsed && typeof parsed === 'object' && Array.isArray((parsed as { actions?: unknown }).actions)
        ? (parsed as { actions: unknown[] }).actions
        : [];

    return source.filter(
        (action): action is ParsedAction =>
            !!action
            && typeof action === 'object'
            && typeof (action as ParsedAction).intent === 'string'
            && VALID_INTENTS.has((action as ParsedAction).intent)
    );
}

function positiveNumber(value: unknown): number | null {
    const parsed = typeof value === 'string' ? Number(value) : value;
    return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function unitPrice(amount: unknown, quantity: number | null): number | null {
    const total = positiveNumber(amount);
    if (total == null || quantity == null) return null;
    return total / quantity;
}

/**
 * Distinguishes an options object from a plain inventory price map. A map
 * keyed by product name may contain arbitrary keys, so only objects with a
 * defined `inventory`, `commodityRegistry` or `normalizer` are options.
 */
function isOptionsObject(value: unknown): value is ExecuteActionsOptions {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as ExecuteActionsOptions;
    return candidate.inventory != null
        || candidate.commodityRegistry != null
        || candidate.normalizer != null;
}

function mapLookup(map: Record<string, InventoryPriceRecord>): InventoryLookupFn {
    return (name: string) => {
        const lower = name.trim().toLowerCase();
        const key = Object.keys(map).find(k => k.trim().toLowerCase() === lower);
        return key ? map[key] : null;
    };
}

function normalizeOptions(
    optionsOrSource?: ExecuteActionsOptions | InventoryPriceSource,
    defaultNormalizer?: UnitNormalizer
): {
    lookup: InventoryLookupFn | null;
    registry: CommodityBenchmark[];
    normalizer?: UnitNormalizer;
} {
    let lookup: InventoryLookupFn | null = null;
    let registry: CommodityBenchmark[] = DEFAULT_COMMODITY_REGISTRY;
    let normalizer = defaultNormalizer;

    if (typeof optionsOrSource === 'function') {
        lookup = optionsOrSource;
    } else if (isOptionsObject(optionsOrSource)) {
        const opts = optionsOrSource;
        if (opts.commodityRegistry) registry = opts.commodityRegistry;
        if (opts.normalizer) normalizer = opts.normalizer;
        if (typeof opts.inventory === 'function') {
            lookup = opts.inventory;
        } else if (opts.inventory && typeof opts.inventory === 'object') {
            lookup = mapLookup(opts.inventory as Record<string, InventoryPriceRecord>);
        }
    } else if (optionsOrSource && typeof optionsOrSource === 'object') {
        lookup = mapLookup(optionsOrSource as Record<string, InventoryPriceRecord>);
    }

    return { lookup, registry, normalizer };
}

interface ResolvedValueSale {
    calcQty: number;
    unitPriceUsed: number | null;
    baseUnit: string;
    priceSource: 'inventory_selling_price' | 'purchase_price_markup' | 'commodity_reference' | 'unresolved';
    pricingUnresolved: boolean;
    needsWeightReview: boolean;
}

function resolveValueSaleFromRecord(
    product: string,
    amount: number,
    itemRecord: InventoryPriceRecord | null | undefined,
    registry: CommodityBenchmark[],
    fallbackUnit: string | null = null
): ResolvedValueSale {
    const sellingPrice = positiveNumber(itemRecord?.selling_price);
    const costPrice = positiveNumber(itemRecord?.last_purchase_price);
    let baseUnit = itemRecord?.base_unit || itemRecord?.unit || fallbackUnit || 'kg';

    // Tier 1: existing selling price
    if (sellingPrice != null && sellingPrice > 0) {
        const unitPriceUsed = sellingPrice;
        return {
            calcQty: round(amount / unitPriceUsed, 3),
            unitPriceUsed,
            baseUnit,
            priceSource: 'inventory_selling_price',
            pricingUnresolved: false,
            needsWeightReview: false,
        };
    }

    // Tier 2: category benchmark markup on the last purchase cost (parity with
    // the DB trigger and the dashboard, not a flat 12%).
    if (costPrice != null && costPrice > 0) {
        const category = itemRecord?.category
            ? String(itemRecord.category).trim().toUpperCase()
            : classifyCategory(product, itemRecord?.base_unit ?? itemRecord?.unit ?? null);
        const margin = CATEGORY_MARGIN_BENCHMARKS[category] ?? CATEGORY_MARGIN_BENCHMARKS.GENERAL;
        const unitPriceUsed = round(costPrice * (1 + margin), 2);
        return {
            calcQty: round(amount / unitPriceUsed, 3),
            unitPriceUsed,
            baseUnit,
            priceSource: 'purchase_price_markup',
            pricingUnresolved: false,
            needsWeightReview: false,
        };
    }

    // Tier 3: benchmark reference registry
    const benchmark = findCommodityBenchmark(product, registry);
    if (benchmark != null && benchmark.benchmarkPrice > 0) {
        const unitPriceUsed = benchmark.benchmarkPrice;
        baseUnit = benchmark.baseUnit || baseUnit;
        return {
            calcQty: round(amount / unitPriceUsed, 3),
            unitPriceUsed,
            baseUnit,
            priceSource: 'commodity_reference',
            pricingUnresolved: false,
            needsWeightReview: false,
        };
    }

    // Tier 4: unresolved pricing (safety net)
    return {
        calcQty: 0,
        unitPriceUsed: null,
        baseUnit,
        priceSource: 'unresolved',
        pricingUnresolved: true,
        needsWeightReview: true,
    };
}

/**
 * Asynchronously processes parsed actions into ledger event inserts and read queries.
 * For value-based sales (amount > 0 and quantity is null), cascades through the 4 pricing tiers:
 *   Tier 1: inventory.selling_price
 *   Tier 2: inventory.last_purchase_price * 1.12 (12% Kirana gross margin)
 *   Tier 3: commodity default rate registry benchmark
 *   Tier 4: unresolved safety net (logged with quantity: 0 and needs_weight_review: true)
 */
export async function executeActions(
    actions: ParsedAction[],
    options?: ExecuteActionsOptions | InventoryPriceSource
): Promise<{ events: EventInsert[]; queries: ParsedAction[] }> {
    const { lookup, registry, normalizer } = normalizeOptions(options);
    const events: EventInsert[] = [];
    const queries: ParsedAction[] = [];

    for (const action of actions) {
        const product = typeof action.item === 'string' ? action.item.trim() : '';
        const rawQuantity = positiveNumber(action.quantity);
        const spokenUnit = typeof action.unit === 'string' && action.unit.trim() ? action.unit.trim() : null;
        const totalAmount = positiveNumber(action.amount);

        const resolution = rawQuantity == null
            ? null
            : normalizer
                ? normalizer.resolve(rawQuantity, spokenUnit)
                : {
                    quantity: rawQuantity,
                    unit: spokenUnit,
                    baseUnit: null,
                    recognized: false,
                    originalQuantity: rawQuantity,
                    originalUnit: spokenUnit,
                };

        const quantity = resolution?.quantity ?? null;
        const price = unitPrice(totalAmount, quantity);
        const unitFields = resolution?.unit ? { unit: resolution.unit } : {};
        const auditFields = resolution?.recognized
            ? { original_unit: resolution.originalUnit, original_quantity: resolution.originalQuantity }
            : {};

        switch (action.intent) {
            case 'ADD_STOCK': {
                if (!product || quantity == null) break;
                events.push({
                    type: 'PURCHASED',
                    payload: {
                        product,
                        quantity,
                        ...unitFields,
                        ...auditFields,
                        ...(price != null ? { price } : {}),
                    },
                });
                break;
            }
            case 'SALE': {
                if (!product) break;
                if (quantity == null && totalAmount == null) break;

                const isValueBased = quantity == null && totalAmount != null;

                if (isValueBased) {
                    const itemRecord = lookup ? await lookup(product) : null;
                    const resolved = resolveValueSaleFromRecord(product, totalAmount, itemRecord, registry, spokenUnit);

                    events.push({
                        type: 'SOLD',
                        payload: {
                            product,
                            quantity: resolved.calcQty,
                            unit: resolved.baseUnit,
                            amount: totalAmount,
                            amount_spent: totalAmount,
                            is_value_based: true,
                            unit_price_used: resolved.unitPriceUsed,
                            price_source: resolved.priceSource,
                            pricing_unresolved: resolved.pricingUnresolved,
                            needs_weight_review: resolved.needsWeightReview,
                            ...(resolved.unitPriceUsed != null ? { price: resolved.unitPriceUsed } : {}),
                            ...(action.original_text ? { original_text: action.original_text } : {}),
                        },
                    });
                } else {
                    // Snapshot the catalog selling price at sale time when the
                    // speaker did not state one. Without it the feed shows a
                    // timestamp instead of money, and profit drifts later when
                    // the catalog price is edited.
                    const catalogRecord = lookup ? await lookup(product) : null;
                    const catalogPrice = Number(catalogRecord?.selling_price);
                    const snapshotPrice = price != null
                        ? price
                        : (Number.isFinite(catalogPrice) && catalogPrice > 0 ? catalogPrice : null);
                    events.push({
                        type: 'SOLD',
                        payload: {
                            product,
                            quantity,
                            ...unitFields,
                            ...auditFields,
                            ...(totalAmount != null ? { amount: totalAmount } : {}),
                            ...(snapshotPrice != null
                                ? { price: snapshotPrice, unit_price_used: snapshotPrice }
                                : {}),
                            ...(action.original_text ? { original_text: action.original_text } : {}),
                        },
                    });
                }
                break;
            }
            case 'WRITE_OFF':
            case 'CUSTOMER_RETURN':
            case 'VENDOR_RETURN': {
                if (!product || quantity == null) break;
                const type = action.intent === 'CUSTOMER_RETURN'
                    ? 'CUSTOMER_RETURN'
                    : action.intent === 'VENDOR_RETURN' ? 'VENDOR_RETURN' : 'WRITE_OFF';
                events.push({ type, payload: { product, quantity, ...unitFields, ...auditFields } });
                break;
            }
            case 'LOG_EXPENSE': {
                if (totalAmount == null) break;
                events.push({ type: 'EXPENSE', payload: { amount: totalAmount, note: action.original_text ?? '' } });
                break;
            }
            default: {
                if (QUERY_INTENTS.has(action.intent)) queries.push(action);
                break;
            }
        }
    }

    return { events, queries };
}

/**
 * Synchronous variant of executeActions using synchronous inventory record maps or registry.
 */
export function executeActionsSync(
    actions: ParsedAction[],
    options?: ExecuteActionsOptions | InventoryPriceSource
): { events: EventInsert[]; queries: ParsedAction[] } {
    const { lookup, registry, normalizer } = normalizeOptions(options);
    const events: EventInsert[] = [];
    const queries: ParsedAction[] = [];

    for (const action of actions) {
        const product = typeof action.item === 'string' ? action.item.trim() : '';
        const rawQuantity = positiveNumber(action.quantity);
        const spokenUnit = typeof action.unit === 'string' && action.unit.trim() ? action.unit.trim() : null;
        const totalAmount = positiveNumber(action.amount);

        const resolution = rawQuantity == null
            ? null
            : normalizer
                ? normalizer.resolve(rawQuantity, spokenUnit)
                : {
                    quantity: rawQuantity,
                    unit: spokenUnit,
                    baseUnit: null,
                    recognized: false,
                    originalQuantity: rawQuantity,
                    originalUnit: spokenUnit,
                };

        const quantity = resolution?.quantity ?? null;
        const price = unitPrice(totalAmount, quantity);
        const unitFields = resolution?.unit ? { unit: resolution.unit } : {};
        const auditFields = resolution?.recognized
            ? { original_unit: resolution.originalUnit, original_quantity: resolution.originalQuantity }
            : {};

        switch (action.intent) {
            case 'ADD_STOCK': {
                if (!product || quantity == null) break;
                events.push({
                    type: 'PURCHASED',
                    payload: {
                        product,
                        quantity,
                        ...unitFields,
                        ...auditFields,
                        ...(price != null ? { price } : {}),
                    },
                });
                break;
            }
            case 'SALE': {
                if (!product) break;
                if (quantity == null && totalAmount == null) break;

                const isValueBased = quantity == null && totalAmount != null;

                if (isValueBased) {
                    const lookupResult = lookup ? lookup(product) : null;
                    const itemRecord = lookupResult instanceof Promise ? null : lookupResult;
                    const resolved = resolveValueSaleFromRecord(product, totalAmount, itemRecord, registry, spokenUnit);

                    events.push({
                        type: 'SOLD',
                        payload: {
                            product,
                            quantity: resolved.calcQty,
                            unit: resolved.baseUnit,
                            amount: totalAmount,
                            amount_spent: totalAmount,
                            is_value_based: true,
                            unit_price_used: resolved.unitPriceUsed,
                            price_source: resolved.priceSource,
                            pricing_unresolved: resolved.pricingUnresolved,
                            needs_weight_review: resolved.needsWeightReview,
                            ...(resolved.unitPriceUsed != null ? { price: resolved.unitPriceUsed } : {}),
                            ...(action.original_text ? { original_text: action.original_text } : {}),
                        },
                    });
                } else {
                    // Same snapshot rule as executeActions, using the sync lookup.
                    const syncRecord = lookup ? lookup(product) : null;
                    const usable = syncRecord instanceof Promise ? null : syncRecord;
                    const catalogPrice = Number(usable?.selling_price);
                    const snapshotPrice = price != null
                        ? price
                        : (Number.isFinite(catalogPrice) && catalogPrice > 0 ? catalogPrice : null);
                    events.push({
                        type: 'SOLD',
                        payload: {
                            product,
                            quantity,
                            ...unitFields,
                            ...auditFields,
                            ...(totalAmount != null ? { amount: totalAmount } : {}),
                            ...(snapshotPrice != null
                                ? { price: snapshotPrice, unit_price_used: snapshotPrice }
                                : {}),
                            ...(action.original_text ? { original_text: action.original_text } : {}),
                        },
                    });
                }
                break;
            }
            case 'WRITE_OFF':
            case 'CUSTOMER_RETURN':
            case 'VENDOR_RETURN': {
                if (!product || quantity == null) break;
                const type = action.intent === 'CUSTOMER_RETURN'
                    ? 'CUSTOMER_RETURN'
                    : action.intent === 'VENDOR_RETURN' ? 'VENDOR_RETURN' : 'WRITE_OFF';
                events.push({ type, payload: { product, quantity, ...unitFields, ...auditFields } });
                break;
            }
            case 'LOG_EXPENSE': {
                if (totalAmount == null) break;
                events.push({ type: 'EXPENSE', payload: { amount: totalAmount, note: action.original_text ?? '' } });
                break;
            }
            default: {
                if (QUERY_INTENTS.has(action.intent)) queries.push(action);
                break;
            }
        }
    }

    return { events, queries };
}

/**
 * Maps parsed actions to ledger events. Query intents produce no events.
 * Backwards-compatible wrapper around executeActionsSync.
 */
export function toEventInserts(
    actions: ParsedAction[],
    normalizer?: UnitNormalizer,
    options?: ExecuteActionsOptions | InventoryPriceSource
): { events: EventInsert[]; queries: ParsedAction[] } {
    let mergedOptions: ExecuteActionsOptions;

    if (options === undefined) {
        mergedOptions = normalizer ? { normalizer } : {};
    } else if (typeof options === 'function') {
        mergedOptions = { inventory: options, ...(normalizer ? { normalizer } : {}) };
    } else if (isOptionsObject(options)) {
        mergedOptions = { ...options, normalizer: normalizer ?? options.normalizer };
    } else {
        // Plain product-price map: wrap it as the inventory source
        mergedOptions = { inventory: options as InventoryPriceSource, ...(normalizer ? { normalizer } : {}) };
    }

    return executeActionsSync(actions, mergedOptions);
}
