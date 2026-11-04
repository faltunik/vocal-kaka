import fs from 'fs';
import path from 'path';

/**
 * Constitution Principle 1 (Strict Negative Scope): udhar/credit fields must
 * never exist in the intent schema, the ledger payloads, or the client types.
 */
describe('Credit & debtor fields are out of scope (TASK-02)', () => {
    const read = (relativePath: string) => fs.readFileSync(
        path.resolve(__dirname, '../..', relativePath),
        'utf8'
    );

    it('keeps the edge action pipeline free of credit/debtor payloads', () => {
        const source = read('supabase/functions/_shared/actions.ts');

        expect(source).not.toMatch(/is_credit/);
        expect(source).not.toMatch(/customer_name/);
    });

    it('keeps the client voice/parser interfaces free of credit/debtor fields', () => {
        for (const file of [
            'services/voice/VoiceCommandService.ts',
            'tests/eval/support/IntentParser.ts',
        ]) {
            const source = read(file);
            expect(source).not.toMatch(/is_credit/);
            expect(source).not.toMatch(/customer_name/);
        }
    });

    it('keeps the prompts free of credit/debtor schema fields', () => {
        const source = read('supabase/functions/_shared/prompt.ts');

        expect(source).not.toMatch(/"is_credit"/);
        expect(source).not.toMatch(/"customer_name"/);
    });
});
