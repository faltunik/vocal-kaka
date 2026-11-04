import fs from 'fs';
import path from 'path';

describe('Immutable Unpriced Sale Resolution (Migration 020)', () => {
    const migrationPath = path.resolve(
        __dirname,
        '../../supabase/migrations/20261004000020_immutable_unpriced_resolution.sql'
    );

    const sql = () => fs.readFileSync(migrationPath, 'utf8');

    it('exists and installs an append-only guard on the ledger', () => {
        expect(fs.existsSync(migrationPath)).toBe(true);
        const content = sql();

        expect(content).toContain('create or replace function public.prevent_events_mutation()');
        expect(content).toContain('before update or delete on public.events');
        expect(content).toContain("raise exception 'Ledger is append-only'");
    });

    it('resolves unpriced sales through apply_correction instead of UPDATE', () => {
        const content = sql();

        // The correction path voids the original and appends the resolved sale
        expect(content).toContain('public.apply_correction(p_event_id, \'SOLD\', v_replacement)');
        expect(content).toContain("'price_source', 'manual_resolution'");
        expect(content).toContain("'pricing_unresolved', false");
        expect(content).toContain("'is_value_based', true");

        // No direct mutation of the ledger remains in the function body
        expect(content).not.toContain('update public.events');
    });

    it('keeps the resolution authorization and idempotency guards', () => {
        const content = sql();

        expect(content).toContain('from public.store_members');
        expect(content).toContain("v_event.user_id is distinct from auth.uid()");
        expect(content).toContain("coalesce((v_event.payload->>'pricing_unresolved')::boolean, false) is false");
        expect(content).toContain('Rate per unit must be greater than zero');
    });
});
