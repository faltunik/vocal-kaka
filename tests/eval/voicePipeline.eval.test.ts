import fs from 'fs';
import path from 'path';
import { parseIntent } from '@/tests/eval/support/IntentParser';
import { resolveMimeType, transcribeRecording } from '@/tests/eval/support/transcription';
import { matchFailures } from '@/tests/helpers/voiceEvalMatcher';
import { VOICE_FIXTURES, VoiceFixture } from './fixtures/manifest';

jest.setTimeout(180_000);

// Only runs through `npm run test:voice`/`test:eval`, which loads .env and sets VOICE_EVAL=1.
const evalEnabled = process.env.VOICE_EVAL === '1' && !!process.env.GROQ_API_KEY;
const describeLive = evalEnabled ? describe : describe.skip;
const AUDIO_DIR = path.join(__dirname, 'fixtures', 'audio');
const GENERATED_PATH = path.join(__dirname, 'fixtures', 'voice.generated.json');

function loadGeneratedFixtures(): VoiceFixture[] {
    if (!fs.existsSync(GENERATED_PATH)) return [];
    const parsed = JSON.parse(fs.readFileSync(GENERATED_PATH, 'utf8')) as { fixtures: VoiceFixture[] };
    return parsed.fixtures ?? [];
}

const FIXTURES: VoiceFixture[] = [...VOICE_FIXTURES, ...loadGeneratedFixtures()];

describeLive('live voice pipeline (Groq ASR + LLM intent)', () => {
    it.each(FIXTURES.map((fixture): [string, VoiceFixture] => [fixture.id, fixture]))(
        '%s',
        async (id, fixture) => {
            const filePath = path.join(AUDIO_DIR, fixture.audio);
            expect(fs.existsSync(filePath)).toBe(true);

            const { text, provider } = await transcribeRecording({
                blob: new Blob([fs.readFileSync(filePath)], { type: resolveMimeType(fixture.audio) }),
                filename: fixture.audio,
            });
            const { actions } = await parseIntent(text, fixture.inventoryHints ?? []);
            const failures = matchFailures(actions, fixture.expectedActions);

            const report = [
                `fixture: ${id}`,
                `spoken:  "${fixture.spoken}"`,
                `asr:     ${provider} -> "${text}"`,
                `parsed:  ${JSON.stringify(actions)}`,
            ].join('\n');

            if (failures.length > 0) {
                throw new Error(`${report}\nfailed:  ${failures.join('; ')}`);
            }

            console.log(report);
        }
    );
});
