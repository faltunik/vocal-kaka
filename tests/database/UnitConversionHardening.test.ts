import fs from 'fs';
import path from 'path';

describe('Unit conversion & write hardening (Migration 026)', () => {
    const migrationPath = path.resolve(
        __dirname,
        '../../supabase/migrations/20261004000026_unit_and_write_hardening.sql'
    );

    const sql = () => fs.readFileSync(migrationPath, 'utf8');

    it('exists and only applies the SKU pack factor to its own secondary unit', () => {
        expect(fs.existsSync(migrationPath)).toBe(true);
        const content = sql();

        // Alias-of-the-same-registry-row matching is retained...
        expect(content).toContain('lower(r.code) = v_secondary');
        expect(content).toContain('lower(r.code) = v_unit');
        // ...but same-dimension equivalence is gone.
        expect(content).not.toContain('public.resolve_unit_base(v_unit) = public.resolve_unit_base(v_secondary)');
    });

    it('lets account deletion null the actor without opening general mutation', () => {
        const content = sql();

        expect(content).toContain('if new.user_id is not null then');
        expect(content).toContain("to_jsonb(new) - 'user_id'");
        expect(content).toContain("raise exception 'Ledger is append-only'");
    });

    it('moves wholesale cost writes behind the owner-checked RPC', () => {
        const content = sql();

        expect(content).toContain('revoke update on public.inventory from authenticated');
        expect(content).toContain('create or replace function public.set_product_cost(');
        expect(content).toContain('public.is_store_owner_admin(v_item.store_id)');
        expect(content).toContain('grant execute on function public.set_product_cost(uuid, numeric) to authenticated');
        // last_purchase_price is deliberately absent from the column grant list.
        const grantBlock = content.slice(content.indexOf('grant update ('));
        expect(grantBlock.slice(0, grantBlock.indexOf(')')).includes('last_purchase_price')).toBe(false);
    });

    it('grants invite RPCs to authenticated only and drops redundant indexes', () => {
        const content = sql();

        expect(content).toContain('revoke all on function public.join_store_by_invite_code(text, text) from public, anon');
        expect(content).toContain('revoke all on function public.generate_store_invite_code(uuid) from public, anon');
        expect(content).toContain('drop index if exists public.idx_stores_invite_code');
        expect(content).toContain('drop index if exists public.idx_events_store_id');
    });

    it('matches "pav" as a whole word and keeps Pav Bhaji Masala out of dairy', () => {
        const content = sql();

        expect(content).toContain('\\mpav\\M');
        expect(content).toContain('pav\\s+bhaji');
    });

    it('repairs cross-dimension catalog rows (migration 027)', () => {
        const migrationPath = path.resolve(
            __dirname,
            '../../supabase/migrations/20261004000027_repair_cross_dimension_units.sql'
        );
        expect(fs.existsSync(migrationPath)).toBe(true);
        const content = fs.readFileSync(migrationPath, 'utf8');

        expect(content).toContain('set base_unit = public.resolve_unit_base(i.unit)');
        expect(content).toContain('public.resolve_unit_base(i.unit) <> i.base_unit');
    });
});
