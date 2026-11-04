#!/usr/bin/env node
/**
 * Meta integration smoke test.
 *
 *   npm run meta:smoke                    # live call on the default transport
 *   npm run meta:smoke -- --replay        # keyless: replays fixtures/meta-parse.json
 *   npm run meta:smoke -- --asr audio.wav # Muse Voice Transcribe (direct only)
 *
 * Proves, in one command, that a Meta model is load-bearing: it prints the
 * provider label that the Edge Function stores in voice_command_logs.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const FIXTURE_DIR = path.join(ROOT, 'fixtures');
const FIXTURE = path.join(FIXTURE_DIR, 'meta-parse.json');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};

async function loadEnvFile(file) {
    const full = path.join(ROOT, file);
    if (!existsSync(full)) return;
    const text = await readFile(full, 'utf8');
    for (const line of text.split(/\r?\n/)) {
        const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
        if (!match) continue;
        const key = match[1];
        let val = match[2];
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
    }
}

function fail(message) {
    console.error(`\n✗ ${message}\n`);
    process.exit(1);
}

async function main() {
    await loadEnvFile('.env.eval');
    await loadEnvFile('.env');

    const { parseWithMeta, resolveMetaTransport, transcribeWithMeta, activeMetaTransport, metaStatus } =
        await import('../supabase/functions/_shared/meta.ts');

    const transportArg = value('transport');
    if (transportArg) process.env.META_TRANSPORT = transportArg;

    const keys = { openrouter: process.env.OPENROUTER_API_KEY, meta: process.env.MODEL_API_KEY };
    const cfg = resolveMetaTransport(keys);

    if (!cfg) {
        fail(
            'Meta tier is disabled. Set OPENROUTER_API_KEY (openrouter transport) or MODEL_API_KEY (direct).\n' +
            '  META_TRANSPORT=openrouter|direct|off',
        );
    }

    const transcript = value('text') ?? 'do kilo cheeni kharida, ek sau bees rupaye';
    const hints = ['Sugar', 'Rice', 'Atta', 'Toor Dal'];

    if (flag('replay')) {
        if (!existsSync(FIXTURE)) fail(`no fixture at ${FIXTURE} — run a live call once to record it`);
        const cached = JSON.parse(await readFile(FIXTURE, 'utf8'));
        printResult(cached, 'replay');
        return;
    }

    if (value('asr')) {
        if (cfg.transport !== 'direct') {
            fail('Muse Voice Transcribe is direct-only (set META_TRANSPORT=direct + MODEL_API_KEY)');
        }
        const audioPath = value('asr');
        const bytes = await readFile(audioPath);
        const result = await transcribeWithMeta(new Blob([bytes], { type: 'audio/wav' }), path.basename(audioPath), cfg, {
            sessionId: 'smoke-asr',
            keywords: hints,
        });
        console.log(`\n✓ ASR provider=${result.provider} latency=${result.latencyMs}ms`);
        console.log(`  transcript: ${result.text}\n`);
        return;
    }

    const startedAt = Date.now();
    const result = await parseWithMeta(transcript, hints, cfg);
    const total = Date.now() - startedAt;

    const payload = {
        transcript,
        provider: result.provider,
        meta_transport: activeMetaTransport(),
        latency_ms: result.latencyMs ?? total,
        actions: result.actions,
        recorded_at: new Date().toISOString(),
    };

    await mkdir(FIXTURE_DIR, { recursive: true });
    await writeFile(FIXTURE, JSON.stringify(payload, null, 2), 'utf8');

    printResult(payload, 'live');
    console.log(`  fixture written: ${path.relative(ROOT, FIXTURE)}`);
    console.log(`  breaker: ${JSON.stringify(metaStatus())}\n`);
}

function printResult(payload, mode) {
    const actions = Array.isArray(payload.actions?.actions) ? payload.actions.actions : [];
    console.log(`\n✓ Meta parse ok (${mode})`);
    console.log(`  provider  : ${payload.provider}`);
    console.log(`  transport : ${payload.meta_transport ?? 'replay'}`);
    console.log(`  latency   : ${payload.latency_ms}ms`);
    console.log(`  actions   : ${actions.length}`);
    for (const action of actions) {
        console.log(
            `    - ${action.intent} ${action.item ?? ''} ${action.quantity ?? ''}${action.unit ?? ''}` +
            `${action.amount != null ? ` ₹${action.amount}` : ''}`,
        );
    }
    if (actions.length === 0) fail('Meta returned no actions — contract violation');
}

main().catch((error) => fail(error?.message ?? String(error)));
