import fs from 'fs';
import path from 'path';

describe('Database Trigger Hardening & Migration 014', () => {
    const migrationPath = path.resolve(
        __dirname,
        '../../supabase/migrations/20261003000014_trigger_concurrency_and_ledger_hardening.sql'
    );

    it('verifies migration 014 exists and contains critical safety mechanisms', () => {
        expect(fs.existsSync(migrationPath)).toBe(true);
        const sql = fs.readFileSync(migrationPath, 'utf8');

        // 1. Must use BEFORE INSERT trigger
        expect(sql).toContain('before insert on public.events');
        expect(sql).toContain('drop trigger if exists on_new_event');

        // 2. Must have safe_numeric helper
        expect(sql).toContain('create or replace function public.safe_numeric');

        // 3. Must normalize wholesale pack cost to unit cost
        expect(sql).toContain('v_factor is not null and v_factor > 0');
        expect(sql).toContain('round(p_price / v_factor, 2)');

        // 4. Must protect resolve_unpriced_sale with FOR UPDATE
        expect(sql).toContain('for update');
        expect(sql).toContain('coalesce((v_event.payload->>\'pricing_unresolved\')::boolean, false) is false');

        // 5. Must prevent duplicate VOID / replacement replay in apply_correction
        expect(sql).toContain('Event % has already been voided');

        // 6. Must cover Dairy / Spices in get_category_default_margin
        expect(sql).toContain("'DAIRY_BAKERY' then 0.08");
        expect(sql).toContain("'DAIRY' then 0.08");
        expect(sql).toContain("'SPICES' then 0.08");

        // 7. Must enforce trimmed lower name unique index
        expect(sql).toContain('inventory (user_id, lower(trim(name)))');

        // 8. Must enforce non-empty name and non-negative prices
        expect(sql).toContain('inventory_name_non_empty check (length(trim(name)) > 0)');
        expect(sql).toContain('selling_price is null or selling_price >= 0');
        expect(sql).toContain('last_purchase_price is null or last_purchase_price >= 0');

        // 9. Must have partial index for active_events
        expect(sql).toContain("where type <> 'VOID'");
    });

    describe('Wholesale pack price normalization simulation', () => {
        function calculateUnitCost(packPrice: number, conversionFactor: number | null): number {
            if (conversionFactor && conversionFactor > 0) {
                return Math.round((packPrice / conversionFactor) * 100) / 100;
            }
            return packPrice;
        }

        it('normalizes 50 kg sugar bori bought at ₹2100 to ₹42.00 / kg', () => {
            expect(calculateUnitCost(2100, 50)).toBe(42.00);
        });

        it('normalizes 15 L mustard oil pipa bought at ₹2175 to ₹145.00 / L', () => {
            expect(calculateUnitCost(2175, 15)).toBe(145.00);
        });

        it('normalizes 48 pcs Maggi carton bought at ₹576 to ₹12.00 / pcs', () => {
            expect(calculateUnitCost(576, 48)).toBe(12.00);
        });

        it('retains unit cost unchanged when conversion factor is missing', () => {
            expect(calculateUnitCost(44.00, null)).toBe(44.00);
        });
    });

    describe('Category Default Margin Parity', () => {
        function getCategoryDefaultMargin(category: string): number {
            const normalized = (category || 'GENERAL').trim().toUpperCase();
            switch (normalized) {
                case 'FMCG':
                    return 0.12;
                case 'STAPLES':
                case 'LOOSE_GRAINS':
                    return 0.06;
                case 'SPICES':
                case 'DAIRY':
                case 'DAIRY_BAKERY':
                    return 0.08;
                case 'EDIBLE_OIL':
                    return 0.05;
                default:
                    return 0.10;
            }
        }

        it('correctly maps all categories to their defined margins', () => {
            expect(getCategoryDefaultMargin('FMCG')).toBe(0.12);
            expect(getCategoryDefaultMargin('Staples')).toBe(0.06);
            expect(getCategoryDefaultMargin('loose_grains')).toBe(0.06);
            expect(getCategoryDefaultMargin('Dairy')).toBe(0.08);
            expect(getCategoryDefaultMargin('DAIRY_BAKERY')).toBe(0.08);
            expect(getCategoryDefaultMargin('Spices')).toBe(0.08);
            expect(getCategoryDefaultMargin('EDIBLE_OIL')).toBe(0.05);
            expect(getCategoryDefaultMargin('General')).toBe(0.10);
            expect(getCategoryDefaultMargin('Unknown Category')).toBe(0.10);
        });
    });

    describe('Safe numeric parsing simulation', () => {
        function safeNumeric(val: string | null | undefined): number | null {
            if (val == null) return null;
            const trimmed = val.trim();
            if (!trimmed) return null;
            if (/^[+-]?[0-9]+(\.[0-9]+)?$/.test(trimmed)) {
                return parseFloat(trimmed);
            }
            return null;
        }

        it('parses valid numeric inputs including decimals and leading signs', () => {
            expect(safeNumeric('50')).toBe(50);
            expect(safeNumeric('42.50')).toBe(42.5);
            expect(safeNumeric('+5')).toBe(5);
            expect(safeNumeric('-10.25')).toBe(-10.25);
            expect(safeNumeric('  100  ')).toBe(100);
        });

        it('returns null on invalid strings without throwing', () => {
            expect(safeNumeric(null)).toBeNull();
            expect(safeNumeric('')).toBeNull();
            expect(safeNumeric('null')).toBeNull();
            expect(safeNumeric('undefined')).toBeNull();
            expect(safeNumeric('N/A')).toBeNull();
            expect(safeNumeric('free')).toBeNull();
            expect(safeNumeric('10kg')).toBeNull();
        });
    });
});
