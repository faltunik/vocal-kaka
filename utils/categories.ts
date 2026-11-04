/**
 * Canonical inventory categories. These values must match the
 * `inventory_category_check` constraint in the database.
 */
export const INVENTORY_CATEGORIES = [
    'GENERAL',
    'FMCG',
    'STAPLES',
    'DAIRY_BAKERY',
    'SPICES',
] as const;

export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number];

export interface CategoryOption {
    key: InventoryCategory;
    label: string;
}

/** UI order/labels for the catalog forms. */
export const CATEGORY_OPTIONS: CategoryOption[] = [
    { key: 'STAPLES', label: 'Staples' },
    { key: 'FMCG', label: 'FMCG' },
    { key: 'DAIRY_BAKERY', label: 'Dairy & Bakery' },
    { key: 'SPICES', label: 'Spices' },
    { key: 'GENERAL', label: 'General' },
];

/** Form order without the General fallback (used when creating). */
export const CREATABLE_CATEGORY_OPTIONS: CategoryOption[] =
    CATEGORY_OPTIONS.filter(option => option.key !== 'GENERAL');

/** Trade-standard gross margins used when purchase cost is unknown. */
export const CATEGORY_MARGIN_BENCHMARKS: Record<string, number> = {
    DAIRY_BAKERY: 0.08,
    STAPLES: 0.06,
    FMCG: 0.12,
    SPICES: 0.08,
    GENERAL: 0.10,
};

/** Infers a category from the product name/unit when the DB has none. */
export function classifyCategoryClient(name: string, unit?: string | null): InventoryCategory {
    const norm = (name || '').toLowerCase();
    const u = (unit || '').toLowerCase();

    // "pav bhaji masala" is a spice blend, not bakery (DB/edge parity).
    if (/pav\s+bhaji/.test(norm)) {
        return 'STAPLES';
    }

    if (/(maggi|biscuit|biscuits|cookie|cookies|parle|good day|marie|chips|lays|kurkure|soap|sabun|shampoo|paste|toothpaste|colgate|close up|noodle|noodles|chai|tea|patti|coffee|namkeen|bhujia|sev|chocolate|cadbury|dairy milk|kitkat|detergent|surf|rin|tide|ariel|vim|harpic|dove|lux|dettol|oreo|marigold)/.test(norm)) {
        return 'FMCG';
    }
    if (/(milk|doodh|dudh|bread|\bpav\b|dahi|curd|paneer|butter|makkhan|makhan|egg|anda|ande|lassi|chaas|buttermilk|bun|rusk|rusks|amul|mother dairy|nandini|harvest gold|britannia bread|modern|english oven|bakery)/.test(norm)) {
        return 'DAIRY_BAKERY';
    }
    if (/(sugar|cheeni|chini|rice|chawal|atta|aata|flour|maida|sooji|suji|besan|dal|daal|toor|arhar|moong|chana|urad|masoor|oil|tel|sarson|mustard|jeera|cumin|haldi|turmeric|mirch|chilli|namak|salt|ghee|hing|dhaniya|poha|wheat|pulse|pulses)/.test(norm)
        || ['kg', 'g', 'gram', 'grams', 'l', 'ml', 'litre', 'liter', 'litres', 'liters'].includes(u)) {
        return 'STAPLES';
    }
    return 'GENERAL';
}

/** Estimated cost from a selling price and category margin benchmark. */
export function estimateCostPrice(sellPrice: number, category: string): number {
    if (sellPrice <= 0) return 0;
    const margin = CATEGORY_MARGIN_BENCHMARKS[category] ?? CATEGORY_MARGIN_BENCHMARKS.GENERAL;
    return sellPrice * (1.0 - margin);
}

/**
 * Normalizes free-form labels (legacy form values, DB text) into the
 * canonical enum. Falls back to GENERAL for unknown values.
 */
export function normalizeInventoryCategory(value?: string | null): InventoryCategory {
    const key = (value ?? '').trim().toLowerCase();
    switch (key) {
        case 'fmcg':
        case 'packaged':
            return 'FMCG';
        case 'staples':
        case 'staple':
        case 'grains':
        case 'loose_grains':
            return 'STAPLES';
        case 'dairy':
        case 'dairy_bakery':
        case 'bakery':
            return 'DAIRY_BAKERY';
        case 'spices':
        case 'spice':
        case 'masala':
            return 'SPICES';
        case 'general':
        case '':
            return 'GENERAL';
        default:
            return (INVENTORY_CATEGORIES as readonly string[]).includes(key.toUpperCase())
                ? (key.toUpperCase() as InventoryCategory)
                : 'GENERAL';
    }
}
