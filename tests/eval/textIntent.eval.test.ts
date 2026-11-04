import fs from 'fs';
import path from 'path';
import { parseIntent } from '@/tests/eval/support/IntentParser';
import { ExpectedAction, matchFailures } from '@/tests/helpers/voiceEvalMatcher';

interface GeneratedFixture {
    id: string;
    section: string;
    utterance: string;
    status: 'runnable' | 'blocked';
    inventoryHints?: string[];
    expectedActions?: ExpectedAction[];
    reason?: string;
    expectedRaw?: string;
    notes?: string;
}

interface GeneratedManifest {
    summary: { total: number; runnable: number; blocked: number };
    fixtures: GeneratedFixture[];
}

jest.setTimeout(120_000);

// Only runs through `npm run test:intent`, which loads .env and sets INTENT_EVAL=1.
const evalEnabled = process.env.INTENT_EVAL === '1' && !!process.env.GROQ_API_KEY;
const describeLive = evalEnabled ? describe : describe.skip;

const MANIFEST_PATH = path.join(__dirname, 'fixtures', 'intents.generated.json');
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as GeneratedManifest;

const sectionFilter = String(process.env.EVAL_SECTIONS ?? '')
    .split(',')
    .map(section => section.trim().toUpperCase())
    .filter(Boolean);
const limit = Number(process.env.EVAL_LIMIT ?? '0');
const delayMs = Number(process.env.EVAL_DELAY_MS ?? '300');

let fixtures = manifest.fixtures.filter(fixture => fixture.status === 'runnable');
if (sectionFilter.length > 0) {
    fixtures = fixtures.filter(fixture => sectionFilter.includes(fixture.section));
}
if (limit > 0) {
    fixtures = fixtures.slice(0, limit);
}

const blocked = manifest.fixtures.filter(fixture => fixture.status === 'blocked');

describeLive('live intent eval (LLM structured output)', () => {
    interface ResultRow {
        id: string;
        section: string;
        passed: boolean;
        utterance: string;
        inventoryHints?: string[];
        expected: ExpectedAction[];
        parsed: unknown;
        failures: string[];
    }

    const results: ResultRow[] = [];

    beforeAll(() => {
        console.log(
            `[intent-eval] ${fixtures.length} runnable fixtures` +
            (sectionFilter.length > 0 ? ` (sections: ${sectionFilter.join(', ')})` : '') +
            `; ${blocked.length} blocked (see tests/eval/fixtures/intents.generated.json)`
        );
    });

    afterEach(async () => {
        if (delayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    });

    afterAll(() => {
        const failed = results.filter(result => !result.passed);
        console.log(`[intent-eval] passed ${results.length - failed.length}/${results.length}`);
        if (failed.length > 0) {
            console.log(`[intent-eval] failed: ${failed.map(result => result.id).join(', ')}`);
        }

        const bySection = new Map<string, { passed: number; total: number }>();
        for (const result of results) {
            const bucket = bySection.get(result.section) ?? { passed: 0, total: 0 };
            bucket.total++;
            if (result.passed) bucket.passed++;
            bySection.set(result.section, bucket);
        }
        for (const [section, bucket] of [...bySection.entries()].sort()) {
            console.log(`[intent-eval] ${section}: ${bucket.passed}/${bucket.total}`);
        }

        const reportPath = path.join(__dirname, 'reports', 'intent-eval.latest.json');
        fs.mkdirSync(path.dirname(reportPath), { recursive: true });
        fs.writeFileSync(reportPath, JSON.stringify({
            generatedAt: new Date().toISOString(),
            mode: 'intent',
            sections: sectionFilter,
            summary: {
                passed: results.length - failed.length,
                failed: failed.length,
                total: results.length,
                blocked: blocked.length,
            },
            bySection: Object.fromEntries(bySection),
            results,
        }, null, 2) + '\n');
        console.log(`[intent-eval] report: ${path.relative(process.cwd(), reportPath)}`);
    });

    if (fixtures.length === 0) {
        it('has no runnable fixtures for the current filter', () => {
            console.log('[intent-eval] nothing to run; adjust EVAL_SECTIONS/EVAL_LIMIT');
        });
    }

    it.each(fixtures.map((fixture): [string, GeneratedFixture] => [fixture.id, fixture]))(
        '%s',
        async (id, fixture) => {
            const { actions } = await parseIntent(fixture.utterance, fixture.inventoryHints ?? []);
            const failures = matchFailures(actions, fixture.expectedActions ?? []);
            results.push({
                id,
                section: fixture.section,
                passed: failures.length === 0,
                utterance: fixture.utterance,
                inventoryHints: fixture.inventoryHints,
                expected: fixture.expectedActions ?? [],
                parsed: actions,
                failures,
            });

            const report = [
                `fixture: ${id} (${fixture.section})`,
                `said:    "${fixture.utterance}"`,
                `expected:${JSON.stringify(fixture.expectedActions)}`,
                `parsed:  ${JSON.stringify(actions)}`,
            ].join('\n');

            if (failures.length > 0) {
                throw new Error(`${report}\nfailed:  ${failures.join('; ')}`);
            }
        }
    );
});
