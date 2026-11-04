import fs from 'fs';
import path from 'path';

describe('Voice log hardening (Migration 024)', () => {
    const migrationPath = path.resolve(
        __dirname,
        '../../supabase/migrations/20261004000024_voice_log_hardening.sql'
    );

    it('revokes client access to the internal voice_command_logs table', () => {
        expect(fs.existsSync(migrationPath)).toBe(true);
        const sql = fs.readFileSync(migrationPath, 'utf8');

        expect(sql).toContain('drop policy if exists "voice_logs_owner_all" on public.voice_command_logs');
        // No replacement policy: clients get zero access; service role bypasses RLS.
        expect(sql).not.toContain('create policy');
    });

    it('refreshes created_at in the edge rate-limit upsert', () => {
        const source = fs.readFileSync(
            path.resolve(__dirname, '../../supabase/functions/process-recording/index.ts'),
            'utf8'
        );

        expect(source).toContain('created_at: new Date().toISOString()');
    });
});

describe('Dead schema prune (Migration 025)', () => {
    const migrationPath = path.resolve(
        __dirname,
        '../../supabase/migrations/20261004000025_prune_dead_schema.sql'
    );

    it('drops the legacy product_definitions table and estimate_cost_price', () => {
        expect(fs.existsSync(migrationPath)).toBe(true);
        const sql = fs.readFileSync(migrationPath, 'utf8');

        expect(sql).toContain('drop table if exists public.product_definitions cascade');
        expect(sql).toContain('drop function if exists public.estimate_cost_price(numeric, text)');
    });
});
