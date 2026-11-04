import fs from 'fs';
import path from 'path';

describe('Pipeline Hardening (Migration 017)', () => {
    const migrationPath = path.resolve(
        __dirname,
        '../../supabase/migrations/20261003000017_pipeline_hardening.sql'
    );

    const sql = () => fs.readFileSync(migrationPath, 'utf8');

    it('exists and makes event materialization idempotent', () => {
        expect(fs.existsSync(migrationPath)).toBe(true);
        const content = sql();

        // Serialize duplicate ledger rows, then skip side effects for replays
        expect(content).toContain('pg_advisory_xact_lock');
        expect(content).toContain('hashtextextended');
        expect(content).toContain('e.ledger_event_id = new.ledger_event_id');
    });

    it('scopes void uniqueness and void matching to the tenant', () => {
        const content = sql();

        expect(content).toContain('events_voided_event_tenant_unique');
        expect(content).toContain('coalesce(store_id, user_id)');
        expect(content).toContain("(new.store_id is null and store_id is null and user_id = uid)");
    });

    it('keeps legacy (store_id NULL) scope isolated from store rows', () => {
        const content = sql();

        expect(content).toContain('store_id is null and lower(trim(name))');
        expect(content).toContain('where user_id = uid and store_id is null');
    });

    it('protects apply_correction against replay and lost replacements', () => {
        const content = sql();

        expect(content).toContain('for update');
        expect(content).toContain("v.payload->>'voided_event_id' = p_voided_event_id::text");
        expect(content).toContain('on conflict do nothing');
    });

    it('makes invite rotation strictly owner-only with no anon bypass', () => {
        const content = sql();

        expect(content).toContain('not authorized to rotate this store invite code');
        expect(content).not.toContain('if auth.uid() is not null');
        expect(content).toContain('revoke all on function public.generate_store_invite_code');
    });

    it('blocks attribution spoofing and restricts catalog deletes', () => {
        const content = sql();

        expect(content).toContain('is_store_member(store_id) and user_id = auth.uid()');
        expect(content).toContain('inventory_store_members_delete');
        expect(content).toContain('public.is_store_owner_admin(store_id)');
        expect(content).toContain('inventory_pin_attribution');
    });

    it('creates stores atomically through an RPC', () => {
        const content = sql();

        expect(content).toContain('function public.create_store(');
        expect(content).toContain('on conflict (store_id, user_id) do nothing');
        expect(content).toContain('grant execute on function public.create_store');
    });

    it('excludes legacy voids from the live view only for the same user', () => {
        const content = sql();

        expect(content).toContain('(e.store_id is null and v.store_id is null and v.user_id = e.user_id)');
    });
});
