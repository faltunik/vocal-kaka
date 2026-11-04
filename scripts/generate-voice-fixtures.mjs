#!/usr/bin/env node
/**
 * Generates Hinglish audio fixtures with edge-tts (Microsoft neural voices)
 * for a curated subset of the scenario matrix, then writes
 * tests/eval/fixtures/voice.generated.json for the live voice eval.
 *
 * Usage: npm run build:voice
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INTENTS_PATH = path.join(rootDir, 'tests', 'eval', 'fixtures', 'intents.generated.json');
const AUDIO_DIR = path.join(rootDir, 'tests', 'eval', 'fixtures', 'audio', 'hinglish');
const OUT_PATH = path.join(rootDir, 'tests', 'eval', 'fixtures', 'voice.generated.json');

const HINDI_VOICE = 'hi-IN-MadhurNeural';
const ENGLISH_VOICE = 'en-IN-PrabhatNeural';
const ENGLISH_FIXTURE_IDS = new Set(['S12-001']);

// Curated cross-section subset; extend as needed.
const FIXTURE_IDS = [
    'S1-001',  // 5 kilo cheeni aaya hai
    'S2-003',  // aadha kilo dhaniya aaya
    'S3-001',  // 2 kilo cheeni bech diya
    'S4-002',  // paav kilo mirchi bechi
    'S5-001',  // multi-action sale
    'S7-001',  // cheeni kitni hai
    'S8-001',  // aaj ka profit kya hai
    'S10-001', // bech do (reject)
    'S12-001', // mic check (noise)
    'S18-001', // timing noise
    'S19-001', // price-point SKU with hints
    'S20-001', // amount-first sale
    'S21-001', // self-correction
    'S24-001', // khata sale
    'S26-001', // rapid-fire receipt dump
    'S30-002', // Do doodh do
];

function pickVoice(id) {
    return ENGLISH_FIXTURE_IDS.has(id) ? ENGLISH_VOICE : HINDI_VOICE;
}

function main() {
    if (!fs.existsSync(INTENTS_PATH)) {
        console.error('[build:voice] missing intents.generated.json — run `npm run build:intents` first.');
        process.exit(1);
    }

    const probe = spawnSync('python', ['-m', 'edge_tts', '--help'], { encoding: 'utf8' });
    if (probe.status !== 0) {
        console.error('[build:voice] edge-tts is not available (pip install edge-tts).');
        process.exit(1);
    }

    const { fixtures } = JSON.parse(fs.readFileSync(INTENTS_PATH, 'utf8'));
    const byId = new Map(fixtures.map(fixture => [fixture.id, fixture]));
    fs.mkdirSync(AUDIO_DIR, { recursive: true });

    const generated = [];
    for (const id of FIXTURE_IDS) {
        const fixture = byId.get(id);
        if (!fixture) {
            console.warn(`[build:voice] unknown fixture id ${id}, skipping`);
            continue;
        }
        if (fixture.status !== 'runnable') {
            console.warn(`[build:voice] ${id} is blocked (${fixture.reason}), skipping`);
            continue;
        }

        const voice = pickVoice(id);
        const filename = `${id}.mp3`;
        const outputPath = path.join(AUDIO_DIR, filename);

        const result = spawnSync('python', [
            '-m', 'edge_tts',
            '--voice', voice,
            '--text', fixture.utterance,
            '--write-media', outputPath,
        ], { encoding: 'utf8' });

        if (result.status !== 0 || !fs.existsSync(outputPath)) {
            console.error(`[build:voice] failed for ${id}: ${result.stderr || result.stdout}`);
            process.exit(1);
        }

        generated.push({
            id,
            audio: path.posix.join('hinglish', filename),
            spoken: fixture.utterance,
            inventoryHints: fixture.inventoryHints,
            expectedActions: fixture.expectedActions,
        });
        console.log(`[build:voice] ${id} (${voice}) -> ${filename}`);
    }

    fs.writeFileSync(OUT_PATH, JSON.stringify({
        generatedAt: new Date().toISOString(),
        voices: { hindi: HINDI_VOICE, english: ENGLISH_VOICE },
        fixtures: generated,
    }, null, 2) + '\n');

    console.log(`[build:voice] wrote ${generated.length} audio fixtures to ${path.relative(rootDir, OUT_PATH)}`);
}

main();
