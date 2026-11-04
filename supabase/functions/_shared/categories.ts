/**
 * Category margin benchmarks shared with the client dashboard
 * (`hooks/useDashboardStats.ts`) so spoken and displayed figures agree.
 * Pure module: no Deno/DB imports, safe to unit test.
 */
export const CATEGORY_MARGIN_BENCHMARKS: Record<string, number> = {
    DAIRY_BAKERY: 0.08,
    STAPLES: 0.06,
    FMCG: 0.12,
    SPICES: 0.08,
    GENERAL: 0.10,
};

export function classifyCategory(name: string, unit?: string | null): string {
    const norm = (name || '').toLowerCase();
    const u = (unit || '').toLowerCase();

    // "pav bhaji masala" is a spice blend, not bakery (matches DB classifier).
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

export function estimateCostPrice(sellPrice: number, category: string): number {
    if (sellPrice <= 0) return 0;
    const margin = CATEGORY_MARGIN_BENCHMARKS[category] ?? CATEGORY_MARGIN_BENCHMARKS.GENERAL;
    return sellPrice * (1.0 - margin);
}

export interface ProfitInventoryRow {
    name: string;
    selling_price: number | null;
    last_purchase_price: number | null;
    category?: string | null;
}

export interface ProfitEventRow {
    type?: string | null;
    payload?: Record<string, unknown> | null;
}

export interface ProfitSnapshot {
    sales: number;
    profit: number;
    transactionCount: number;
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

/**
 * Net daily figures from the ledger, identical to the client dashboard:
 * expenses and customer returns reduce profit, value sales use amount_spent,
 * and missing costs fall back to category margin benchmarks.
 */
export function computeProfitSnapshot(
    events: ProfitEventRow[],
    inventory: ProfitInventoryRow[]
): ProfitSnapshot {
    const byName = new Map(inventory.map(row => [row.name.toLowerCase(), row]));

    let sales = 0;
    let profit = 0;
    let count = 0;

    for (const event of events) {
        const payload = event.payload ?? {};
        const eventType = event.type ?? 'SOLD';

        if (eventType === 'EXPENSE') {
            const expenseAmt = Number(payload.amount ?? payload.price) || 0;
            if (expenseAmt > 0) profit -= expenseAmt;
            continue;
        }

        const productName = String(payload.product ?? '').trim();
        const quantity = Number(payload.calculated_quantity ?? payload.quantity) || 0;
        const directAmount = Number(payload.amount_spent ?? payload.amount) || 0;

        if (!productName && directAmount <= 0) continue;
        if (quantity <= 0 && directAmount <= 0) continue;

        const inventoryRow = productName ? byName.get(productName.toLowerCase()) : undefined;
        const sellPrice = Number(payload.unit_price_used)
            || Number(payload.price)
            || Number(inventoryRow?.selling_price)
            || 0;
        let costPrice = Number(inventoryRow?.last_purchase_price) || 0;

        const effectiveQty = quantity > 0
            ? quantity
            : (sellPrice > 0 ? directAmount / sellPrice : 0);

        const category = (inventoryRow?.category && inventoryRow.category !== 'GENERAL')
            ? inventoryRow.category
            : (classifyCategory(productName, typeof payload.unit === 'string' ? payload.unit : null) || inventoryRow?.category || 'GENERAL');

        if (costPrice <= 0 && sellPrice > 0) {
            costPrice = estimateCostPrice(sellPrice, category);
        } else if (sellPrice > 0 && costPrice > sellPrice * 2.5) {
            // Anomaly guard against unnormalized sack/box wholesale prices
            costPrice = estimateCostPrice(sellPrice, category);
        }

        const lineSale = directAmount > 0 ? directAmount : (effectiveQty * sellPrice);
        const lineCost = effectiveQty * costPrice;

        if (eventType === 'CUSTOMER_RETURN') {
            sales -= lineSale;
            profit -= (lineSale - lineCost);
        } else {
            sales += lineSale;
            profit += (lineSale - lineCost);
            count++;
        }
    }

    return {
        sales: round2(sales),
        profit: round2(profit),
        transactionCount: count,
    };
}
