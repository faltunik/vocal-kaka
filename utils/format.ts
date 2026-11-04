import { parsePositiveQuantity } from './quantity';

const inrFormatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
});

export function formatCurrency(amount: number): string {
    return inrFormatter.format(Number.isFinite(amount) ? amount : 0);
}

export type ActivityIntent =
    | 'SALE'
    | 'PURCHASE'
    | 'ADD_STOCK'
    | 'WRITE_OFF'
    | 'CUSTOMER_RETURN'
    | 'VENDOR_RETURN'
    | 'EXPENSE'
    | 'ADJUSTMENT';

const ACTIVITY_VERBS: Record<ActivityIntent, string> = {
    SALE: 'Sold',
    PURCHASE: 'Added',
    ADD_STOCK: 'Added',
    WRITE_OFF: 'Wrote off',
    CUSTOMER_RETURN: 'Customer returned',
    VENDOR_RETURN: 'Returned to vendor',
    EXPENSE: 'Spent',
    ADJUSTMENT: 'Adjusted',
};

export function formatTransactionTitle(
    intent: ActivityIntent,
    quantity: number,
    unit: string | undefined,
    item: string
): string {
    const verb = ACTIVITY_VERBS[intent] ?? 'Updated';
    const amount = [quantity, unit].filter(Boolean).join(' ');
    return `${verb} ${amount} ${item}`.replace(/\s+/g, ' ').trim();
}

/**
 * Single source of truth for the activity row title.
 * Both the optimistic (voice command) and the persisted (DB fetch) paths use
 * this so a row does not change appearance after the next refresh.
 */
export function formatActivityTitle(
    intent: ActivityIntent,
    quantity: unknown,
    unit: unknown,
    item: unknown
): string {
    const qty = parsePositiveQuantity(quantity) ?? 1;
    const resolvedUnit = typeof unit === 'string' && unit.trim() ? unit.trim() : 'units';
    const resolvedItem = typeof item === 'string' && item.trim() ? item.trim() : 'Unknown Item';
    return formatTransactionTitle(intent, qty, resolvedUnit, resolvedItem);
}

export function formatStockAnswer(item: string, quantity: number, unit?: string): string {
    const amount = [quantity, unit].filter(Boolean).join(' ');
    return `${item}: ${amount}`.trim();
}

export function formatStockListAnswer(
    label: string,
    items: Array<{ name: string; quantity: number; unit?: string }>
): string {
    if (items.length === 0) return `${label}: none`;

    const shown = items
        .slice(0, 5)
        .map(item => `${item.name} (${item.quantity}${item.unit ? ` ${item.unit}` : ''})`)
        .join(', ');
    const extra = items.length > 5 ? ` +${items.length - 5} more` : '';
    return `${label}: ${shown}${extra}`;
}

export function formatProfitAnswer(snapshot: { sales: number; profit: number; transactionCount: number }): string {
    const salesLabel = snapshot.transactionCount === 1 ? 'sale' : 'sales';
    return `Today: ${formatCurrency(snapshot.sales)} sales, ${formatCurrency(snapshot.profit)} profit (${snapshot.transactionCount} ${salesLabel})`;
}

export function formatClockTime(timestamp: number | Date): string {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDayLabel(date: Date, now: Date = new Date()): string {
    const sameDay = date.toLocaleDateString() === now.toLocaleDateString();
    return sameDay ? 'Today' : date.toLocaleDateString();
}

export function formatReportDate(date: Date): string {
    return date.toLocaleDateString('en-IN', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}

export function isSameLocalDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}

export interface FriendlyQuantityOptions {
    secondaryUnit?: string | null;
    conversionFactor?: number | null;
}

function pluralizeUnit(unit: string): string {
    if (!unit) return unit;
    const lower = unit.trim().toLowerCase();
    // Indian kirana packaging terms that stay invariable in the plural
    if (lower === 'bori' || lower === 'pipa' || lower === 'dozen') return unit.trim();
    if (lower === 'peti') return 'petis';
    if (lower === 'box') return 'boxes';
    if (lower === 'tray') return 'trays';
    if (lower === 'carton') return 'cartons';
    if (lower === 'crate') return 'crates';
    if (lower === 'packet') return 'packets';
    if (lower === 'pkt') return 'pkts';
    if (lower === 'bag') return 'bags';
    if (lower === 'tin') return 'tins';
    return lower.endsWith('s') ? unit.trim() : `${unit.trim()}s`;
}

function formatFraction(
    value: number,
    wholeUnit: string,
    fractionUnit: string,
    fractionPerWhole: number
): string {
    const whole = Math.floor(value);
    const fraction = Math.round((value - whole) * fractionPerWhole);

    if (fraction === fractionPerWhole) {
        return `${whole + 1} ${wholeUnit}`;
    }
    if (whole > 0 && fraction > 0) {
        return `${whole} ${wholeUnit} ${fraction} ${fractionUnit}`;
    }
    if (whole > 0) {
        return `${whole} ${wholeUnit}`;
    }
    return `${fraction} ${fractionUnit}`;
}

/**
 * Counter-friendly compound quantity display.
 *   47.75 kg  -> "47 kg 750 g"
 *   1.25 l    -> "1 L 250 ml"
 *   52 pcs with secondary peti (24)   -> "2 petis & 4 pkts (52 pcs)"
 *   26 pcs with secondary dozen (12)  -> "2 dozen & 2 pcs"
 */
export function formatFriendlyQuantity(
    quantity: number,
    unit: string | null | undefined,
    options: FriendlyQuantityOptions = {}
): string {
    const value = Number(quantity);
    const rawUnit = (unit ?? '').trim();
    const baseUnit = rawUnit.toLowerCase();

    if (!Number.isFinite(value)) return `0 ${rawUnit}`.trim();
    if (value < 0) return `${value} ${rawUnit}`.trim();
    if (value === 0) return `0 ${rawUnit}`.trim();

    if (baseUnit === 'kg') return formatFraction(value, 'kg', 'g', 1000);
    if (baseUnit === 'l') return formatFraction(value, 'L', 'ml', 1000);
    if (baseUnit === 'm') return formatFraction(value, 'm', 'cm', 100);

    if (baseUnit === 'pcs') {
        const secondary = options.secondaryUnit?.trim();
        const factor = Number(options.conversionFactor);
        if (secondary && Number.isFinite(factor) && factor > 1) {
            const total = Math.round(value * 1000) / 1000;
            const whole = Math.floor(total / factor);
            const remainder = Math.round((total - whole * factor) * 1000) / 1000;

            if (whole > 0 && remainder > 0) {
                const isDozen = secondary.toLowerCase() === 'dozen';
                const remainderLabel = isDozen ? 'pcs' : 'pkts';
                const totalSuffix = isDozen ? '' : ` (${total} pcs)`;
                return `${whole} ${pluralizeUnit(secondary)} & ${remainder} ${remainderLabel}${totalSuffix}`;
            }
            if (whole > 0) {
                return `${whole} ${pluralizeUnit(secondary)} (${total} pcs)`;
            }
        }
        return `${Math.round(value * 1000) / 1000} pcs`;
    }

    return `${value} ${rawUnit}`.trim();
}
