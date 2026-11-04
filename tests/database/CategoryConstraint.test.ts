import fs from 'fs';
import path from 'path';

describe('Inventory Category Enum (Migration 020)', () => {
    const migrationPath = path.resolve(
        __dirname,
        '../../supabase/migrations/20261003000020_inventory_category_enum.sql'
    );

    it('exists and widens the inventory category constraint', () => {
        expect(fs.existsSync(migrationPath)).toBe(true);
        const sql = fs.readFileSync(migrationPath, 'utf8');

        expect(sql).toContain('drop constraint if exists inventory_category_check');
        expect(sql).toContain('add constraint inventory_category_check');
        expect(sql).toContain("'SPICES'");
        expect(sql).toContain("'STAPLES'");
        expect(sql).toContain("'DAIRY_BAKERY'");
    });
});
