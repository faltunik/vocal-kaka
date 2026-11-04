import fs from 'fs';
import path from 'path';

const read = (relativePath: string) => fs.readFileSync(
    path.resolve(__dirname, '../..', relativePath),
    'utf8'
);

describe('Edge function hardening', () => {
    it('resolve-unit rejects non-service callers before spending provider quota', () => {
        const source = read('supabase/functions/resolve-unit/index.ts');

        expect(source).toContain("return json({ error: 'forbidden' }, 403)");
        expect(source).not.toContain('userClient.auth.getUser');
        // Aliases owned by other units are never re-pointed on insert either.
        expect(source).toContain('filterTakenAliases');
        expect(source).toContain('aliases: await filterTakenAliases(admin, code, aliases)');
    });

    it('process-recording validates recording ids and cleans up private audio', () => {
        const source = read('supabase/functions/process-recording/index.ts');

        expect(source).toContain('/^rec-[A-Za-z0-9-]{4,80}$/.test(recordingId)');
        expect(source).toContain('cleanupAudio');
        expect(source).toContain(".from('recordings').remove([audioPath])");
        // Log status reflects real work, not just reaching the end.
        expect(source).toContain("applied > 0 || answers.length > 0 ? 'applied' : 'parsed'");
    });

    it('process-recording short-circuits replayed recordings before ASR/LLM', () => {
        const source = read('supabase/functions/process-recording/index.ts');

        expect(source).toContain("existingLog.status === 'applied' || existingLog.status === 'parsed'");
        expect(source).toContain('existingLog.processed_at');
        expect(source).toContain('replay: true');
    });

    it('personal-scope voice answers never include store rows', () => {
        const source = read('supabase/functions/_shared/answers.ts');

        expect(source).toContain("query.eq('user_id', scope.userId).is('store_id', null)");
        expect(source).toContain("stockQuery.eq('user_id', scope.userId).is('store_id', null)");
        expect(source).toContain("profitQuery.eq('user_id', scope.userId).is('store_id', null)");
    });

    it('Tier 2 value sales use category margins, not a flat 12%', () => {
        const source = read('supabase/functions/_shared/actions.ts');

        expect(source).toContain('CATEGORY_MARGIN_BENCHMARKS[category]');
        expect(source).not.toContain('costPrice * 1.12');
    });
});
