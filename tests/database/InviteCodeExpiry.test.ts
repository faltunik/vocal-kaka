import fs from 'fs';
import path from 'path';

describe('Invite Code Expiry (Migration 023)', () => {
    const migrationPath = path.resolve(
        __dirname,
        '../../supabase/migrations/20261004000023_invite_code_expiry.sql'
    );

    const sql = () => fs.readFileSync(migrationPath, 'utf8');

    it('exists and adds the expiry column with a backfill', () => {
        expect(fs.existsSync(migrationPath)).toBe(true);
        const content = sql();

        expect(content).toContain('add column if not exists invite_expires_at timestamptz');
        expect(content).toContain("set invite_expires_at = now() + interval '24 hours'");
        expect(content).toContain('where invite_code is not null');
    });

    it('rotates codes with a fresh 24h TTL (owner-only preserved)', () => {
        const content = sql();

        expect(content).toContain('not authorized to rotate this store invite code');
        expect(content).toContain('invite_expires_at = now() + interval \'24 hours\'');
        // Behavior from 017 must survive the redefinition
        expect(content).toContain("v_code := 'KAKA' || substr(v_code, 1, 4)");
        expect(content).toContain('where invite_code = v_code and id <> p_store_id');
        expect(content).toContain('updated_at = now()');
        expect(content).toContain('create or replace function public.generate_store_invite_code(p_store_id uuid)');
    });

    it('rejects expired or TTL-less invite codes when joining', () => {
        const content = sql();

        expect(content).toContain('create or replace function public.join_store_by_invite_code(');
        expect(content).toContain('p_display_name text default null');
        expect(content).toContain('upper(trim(invite_code)) = upper(trim(p_invite_code))');
        expect(content).toContain('v_store.invite_expires_at is null or v_store.invite_expires_at < now()');
        expect(content).toContain("'Store invite code has expired'");
        // Existing members keep their access even with an expired code
        const memberCheckIndex = content.indexOf("'Already a member'");
        const expiryCheckIndex = content.indexOf("'Store invite code has expired'");
        expect(memberCheckIndex).toBeGreaterThan(-1);
        expect(expiryCheckIndex).toBeGreaterThan(memberCheckIndex);
    });
});
