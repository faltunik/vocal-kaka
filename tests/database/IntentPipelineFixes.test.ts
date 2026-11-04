import fs from 'fs';
import path from 'path';

describe('Intent Pipeline Fixes (Migration 019)', () => {
    const migrationPath = path.resolve(
        __dirname,
        '../../supabase/migrations/20261003000019_intent_pipeline_fixes.sql'
    );

    const sql = () => fs.readFileSync(migrationPath, 'utf8');

    it('exists and normalizes pack cost by the actual conversion ratio', () => {
        expect(fs.existsSync(migrationPath)).toBe(true);
        const content = sql();

        expect(content).toContain('v_normalized / p_signed_qty');
        expect(content).toContain('v_unit_cost := round(p_price / v_ratio, 2)');
        // The old unconditional factor division must be gone
        expect(content).not.toContain('round(p_price / v_factor, 2)');
    });

    it('refuses cross-dimension stock movements', () => {
        const content = sql();

        expect(content).toContain('lower(v_input_base) <> lower(v_base)');
    });

    it('makes benchmark lookup deterministic and de-duplicates the oll alias', () => {
        const content = sql();

        expect(content).toContain('order by');
        expect(content).toContain('(lower(commodity_key) = lower(item_name)) desc');
        expect(content).toContain("lower(a) not in ('sarson tel', 'sarson ka tel')");

        // The 0017 idempotency guards must survive the function rewrite
        expect(content).toContain('pg_advisory_xact_lock');
        expect(content).toContain("e.ledger_event_id = new.ledger_event_id");
    });
});
