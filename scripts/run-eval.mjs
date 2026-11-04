#!/usr/bin/env node
/**
 * Runs the live voice eval (`tests/eval`) against real providers.
 * Loads .env and .env.eval into the Jest child process so keys are available at
 * module load, then delegates to Jest. Any extra CLI args are forwarded.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(envPath) {
    if (!fs.existsSync(envPath)) return;

    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!match) continue;

        const [, key, rawValue] = match;
        if (process.env[key] !== undefined) continue;
        process.env[key] = rawValue.replace(/^(['"])(.*)\1$/, '$2');
    }
}

// Public app vars live in .env; eval/deploy-only secrets stay in .env.eval.
loadEnvFile(path.join(rootDir, '.env'));
loadEnvFile(path.join(rootDir, '.env.eval'));

const groqKey = process.env.GROQ_API_KEY;
if (!groqKey || groqKey.startsWith('test-')) {
    console.error('[eval] GROQ_API_KEY is missing from .env.eval — aborting live eval.');
    process.exit(1);
}

const mode = (process.argv[2] ?? 'all').toLowerCase();
if (!['intent', 'voice', 'all'].includes(mode)) {
    console.error(`[eval] unknown mode "${mode}" (expected: intent | voice | all)`);
    process.exit(1);
}

process.env.INTENT_EVAL = mode === 'intent' || mode === 'all' ? '1' : '0';
process.env.VOICE_EVAL = mode === 'voice' || mode === 'all' ? '1' : '0';

const jestBin = require.resolve('jest/bin/jest');
const args = [
    jestBin,
    'tests/eval',
    '--testPathIgnorePatterns=/node_modules/',
    '--runInBand',
    ...process.argv.slice(3),
];

const result = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: rootDir, env: process.env });
process.exit(result.status ?? 1);
