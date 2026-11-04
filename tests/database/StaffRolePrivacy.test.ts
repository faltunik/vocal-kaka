import fs from 'fs';
import path from 'path';

describe('Staff Role Privacy (Migration 022)', () => {
    const migrationPath = path.resolve(
        __dirname,
        '../../supabase/migrations/20261004000022_staff_role_privacy.sql'
    );

    const sql = () => fs.readFileSync(migrationPath, 'utf8');

    it('exists and defines the cost-masked staff inventory view', () => {
        expect(fs.existsSync(migrationPath)).toBe(true);
        const content = sql();

        expect(content).toContain('create or replace view public.staff_inventory');
        expect(content).toContain('when public.is_store_owner_admin(i.store_id) then i.last_purchase_price');
        expect(content).toContain('else null');
        expect(content).toContain('public.is_store_member(i.store_id)');
    });

    it('revokes wholesale cost reads from authenticated clients', () => {
        const content = sql();

        expect(content).toContain('revoke select on public.inventory from authenticated');
        expect(content).toContain('grant select (');
        // last_purchase_price must not be re-granted at the column level
        const grantBlock = content.slice(content.indexOf('grant select ('));
        expect(grantBlock.slice(0, grantBlock.indexOf(')')).includes('last_purchase_price')).toBe(false);
    });

    it('hides PURCHASED and EXPENSE ledger rows from staff', () => {
        const content = sql();

        expect(content).toContain('public.is_store_owner_admin(store_id)');
        expect(content).toContain("type not in ('PURCHASED', 'EXPENSE')");
        expect(content).toContain('drop policy if exists "events_store_members_select"');
    });
});
