import fs from 'fs';
import path from 'path';

describe('Ownership Preservation (Migration 018)', () => {
    const migrationPath = path.resolve(
        __dirname,
        '../../supabase/migrations/20261003000018_ownership_preservation.sql'
    );

    const sql = () => fs.readFileSync(migrationPath, 'utf8');

    it('exists and preserves shared inventory/ledger rows when an actor is deleted', () => {
        expect(fs.existsSync(migrationPath)).toBe(true);
        const content = sql();

        // Actor columns become nullable with SET NULL FKs
        expect(content).toContain('alter table public.inventory alter column user_id drop not null');
        expect(content).toContain('alter table public.events alter column user_id drop not null');
        expect(content).toContain(
            'foreign key (user_id) references auth.users(id) on delete set null'
        );
    });

    it('blocks cascade-wiping a shared store when its owner account is deleted', () => {
        const content = sql();

        expect(content).toContain('foreign key (owner_id) references auth.users(id) on delete restrict');
    });

    it('uses NULL-safe authorization in correction RPCs', () => {
        const content = sql();

        // A null user_id must NOT slip through a `<>` comparison
        expect(content).toContain('v_event.user_id is distinct from uid');
        expect(content).toContain('v_event.user_id is distinct from auth.uid()');
        expect(content).toContain('v.user_id is not distinct from v_event.user_id');
    });

    it('keeps legacy void correlation NULL-safe in active_events', () => {
        const content = sql();

        expect(content).toContain('v.user_id is not distinct from e.user_id');
    });
});
