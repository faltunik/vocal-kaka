import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { ParsedAction } from './actions.ts';
import { computeProfitSnapshot } from './categories.ts';
import { STAFF_PROFIT_BLOCKED_MESSAGE, isProfitRestrictedForRole } from './profitPrivacy.ts';

export interface Answer {
    intent: string;
    text: string;
}

export interface AnswerScope {
    userId: string;
    storeId?: string | null;
    /** Store role of the caller; staff are denied profit answers. */
    role?: string | null;
}

const inr = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
});

interface InventoryRow {
    name: string;
    quantity: number;
    unit: string | null;
    low_stock_threshold: number | null;
    last_purchase_price: number | null;
    selling_price: number | null;
    category?: string | null;
}

function escapeLikePattern(value: string): string {
    return value.replace(/[\\%_*]/g, (match) => `\\${match}`);
}

async function loadInventory(admin: SupabaseClient, scope: AnswerScope): Promise<InventoryRow[]> {
    let query = admin
        .from('inventory')
        .select('name, quantity, unit, low_stock_threshold, last_purchase_price, selling_price, category');

    // Personal scope must never include store rows: a staff token without a
    // store context would otherwise read masked store data through service role.
    query = scope.storeId
        ? query.eq('store_id', scope.storeId)
        : query.eq('user_id', scope.userId).is('store_id', null);

    const { data } = await query.limit(1000);
    return (data ?? []) as InventoryRow[];
}

function formatStock(name: string, quantity: number, unit: string | null): string {
    return `${name}: ${quantity}${unit ? ` ${unit}` : ''}`;
}

function formatList(label: string, rows: InventoryRow[]): string {
    if (rows.length === 0) return `${label}: none`;
    const shown = rows
        .slice(0, 5)
        .map(row => `${row.name} (${row.quantity}${row.unit ? ` ${row.unit}` : ''})`)
        .join(', ');
    const extra = rows.length > 5 ? ` +${rows.length - 5} more` : '';
    return `${label}: ${shown}${extra}`;
}

/**
 * Answers read-only query intents from current state. The profit answer
 * mirrors the dashboard exactly (net of returns/expenses, amount-based value
 * sales, and category-margin cost estimation for cold-start items).
 */
export async function buildAnswers(
    admin: SupabaseClient,
    scope: AnswerScope,
    queries: ParsedAction[]
): Promise<Answer[]> {
    const answers: Answer[] = [];

    for (const query of queries) {
        if (query.intent === 'CHECK_STOCK') {
            const item = typeof query.item === 'string' ? query.item.trim() : '';
            if (!item) continue;

            let stockQuery = admin
                .from('inventory')
                .select('name, quantity, unit');

            stockQuery = scope.storeId
                ? stockQuery.eq('store_id', scope.storeId)
                : stockQuery.eq('user_id', scope.userId).is('store_id', null);

            const { data } = await stockQuery
                .ilike('name', escapeLikePattern(item))
                .limit(1);
            const row = (data ?? [])[0] as InventoryRow | undefined;

            answers.push({
                intent: 'CHECK_STOCK',
                text: row ? formatStock(row.name, Number(row.quantity), row.unit) : `${item}: not found in inventory`,
            });
            continue;
        }

        if (query.intent === 'CHECK_LOW_STOCK' || query.intent === 'CHECK_OUT_OF_STOCK') {
            const rows = await loadInventory(admin, scope);
            const outOfStock = query.intent === 'CHECK_OUT_OF_STOCK';
            const filtered = rows.filter(row =>
                outOfStock
                    ? Number(row.quantity) <= 0
                    : Number(row.quantity) <= Number(row.low_stock_threshold ?? 5)
            );

            answers.push({
                intent: query.intent,
                text: formatList(outOfStock ? 'Out of stock' : 'Low stock', filtered),
            });
            continue;
        }

        if (query.intent === 'CHECK_PROFIT') {
            // Strict Role Privacy: staff counter accounts never receive margins.
            if (isProfitRestrictedForRole(scope.role)) {
                answers.push({
                    intent: 'CHECK_PROFIT',
                    text: STAFF_PROFIT_BLOCKED_MESSAGE,
                });
                continue;
            }

            // Start of today in IST (UTC+5:30) to match the dashboard exactly
            const istOffsetMs = 5.5 * 60 * 60 * 1000;
            const istNow = new Date(Date.now() + istOffsetMs);
            const startOfDay = new Date(
                Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()) - istOffsetMs
            );

            let profitQuery = admin
                .from('active_events')
                .select('type, payload')
                .in('type', ['SOLD', 'CUSTOMER_RETURN', 'EXPENSE'])
                .gte('created_at', startOfDay.toISOString());

            profitQuery = scope.storeId
                ? profitQuery.eq('store_id', scope.storeId)
                : profitQuery.eq('user_id', scope.userId).is('store_id', null);

            const { data: events } = await profitQuery.limit(1000);

            const inventory = await loadInventory(admin, scope);
            const snapshot = computeProfitSnapshot(
                (events ?? []) as Array<{ type?: string | null; payload?: Record<string, unknown> | null }>,
                inventory
            );

            answers.push({
                intent: 'CHECK_PROFIT',
                text: `Today: ${inr.format(snapshot.sales)} sales, ${inr.format(snapshot.profit)} profit (${snapshot.transactionCount} ${snapshot.transactionCount === 1 ? 'sale' : 'sales'})`,
            });
        }
    }

    return answers;
}
