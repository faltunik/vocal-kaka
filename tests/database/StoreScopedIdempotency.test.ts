import fs from 'fs';
import path from 'path';

describe('Store-Scoped Idempotency (Migration 021)', () => {
    const migrationPath = path.resolve(
        __dirname,
        '../../supabase/migrations/20261004000021_store_scoped_idempotency.sql'
    );

    const sql = () => fs.readFileSync(migrationPath, 'utf8');

    it('exists and never builds a NULL advisory lock key', () => {
        expect(fs.existsSync(migrationPath)).toBe(true);
        const content = sql();

        expect(content).toContain("coalesce(new.store_id::text, new.user_id::text, 'global')");
        expect(content).toContain("|| ':' || new.ledger_event_id");
        expect(content).toContain('perform pg_advisory_xact_lock(hashtextextended(v_lock_key, 0))');

        // The old NULL-prone user-only key must be gone
        expect(content).not.toContain("v_lock_key := new.user_id::text");
    });

    it('enforces one ledger id per store', () => {
        const content = sql();

        expect(content).toContain('create unique index if not exists events_store_ledger_event_unique');
        expect(content).toContain('on public.events (store_id, ledger_event_id)');
    });

    it('scopes duplicate detection to the store, falling back to the acting user', () => {
        const content = sql();

        expect(content).toContain('e.ledger_event_id = new.ledger_event_id');
        expect(content).toContain('(new.store_id is not null and e.store_id = new.store_id)');
        expect(content).toContain('(new.store_id is null and e.user_id = new.user_id)');
    });
});

describe('UUID ledger ids', () => {
    it('InventoryService generates UUIDv4 ledger ids for unsupplied events', () => {
        const serviceSource = fs.readFileSync(
            path.resolve(__dirname, '../../services/InventoryService.ts'),
            'utf8'
        );

        expect(serviceSource).toContain('createUuidV4()');
        expect(serviceSource).not.toContain('Date.now()');
    });

    it('the uuid helper emits version-4 identifiers', () => {
        const helper = fs.readFileSync(
            path.resolve(__dirname, '../../utils/uuid.ts'),
            'utf8'
        );

        expect(helper).toContain('randomUUID');
        expect(helper).toContain('4');
    });
});
