import fs from 'fs';
import path from 'path';

describe('Store-Scoped Data Isolation (Migration 016)', () => {
    const migrationPath = path.resolve(
        __dirname,
        '../../supabase/migrations/20261003000016_store_scoped_data.sql'
    );

    it('exists and scopes product identity to the store', () => {
        expect(fs.existsSync(migrationPath)).toBe(true);
        const sql = fs.readFileSync(migrationPath, 'utf8');

        expect(sql).toContain('inventory (store_id, lower(trim(name)))');

        // Legacy per-user identity must not block the same product in a second store
        expect(sql).toContain('where store_id is null');
        expect(sql).toContain('on conflict (user_id, (lower(trim(name)))) where store_id is null');
    });

    it('makes the event materialization trigger store-aware', () => {
        const sql = fs.readFileSync(migrationPath, 'utf8');

        expect(sql).toContain('p_store uuid default null');
        expect(sql).toContain('on conflict (store_id, (lower(trim(name))))');
        expect(sql).toContain('sid uuid := new.store_id');
        expect(sql).toContain('coalesce(original.store_id, new.store_id)');
    });

    it('restricts invite-code rotation to the store owner', () => {
        const sql = fs.readFileSync(migrationPath, 'utf8');

        expect(sql).toContain('not authorized to rotate this store invite code');
        expect(sql).toContain('owner_id = auth.uid()');
    });

    it('grants store members RLS access to inventory and the ledger', () => {
        const sql = fs.readFileSync(migrationPath, 'utf8');

        expect(sql).toContain('create policy "inventory_store_members"');
        expect(sql).toContain('create policy "events_store_members_select"');
        expect(sql).toContain('create policy "events_store_members_insert"');
        expect(sql).toContain('public.is_store_member(store_id)');
    });

    it('contains the critical safety mechanisms', () => {
        const sql = fs.readFileSync(migrationPath, 'utf8');

        // VOID + replacement stays atomic and replay safe across members
        expect(sql).toContain('with inserted as (');
        expect(sql).toContain('on conflict do nothing');
        expect(sql).toContain('events_voided_event_global_unique');

        // Cross-member voided originals disappear from the live view, scoped to the same tenant
        expect(sql).toContain("v.payload->>'voided_event_id' = e.event_id::text");
        expect(sql).toContain('v.store_id = e.store_id');
        expect(sql).toContain('security_invoker = true');

        // Unpriced value sales resolve against the store catalog
        expect(sql).toContain('perform public.upsert_inventory_movement(');
        expect(sql).toContain('v_event.store_id');
    });
});
