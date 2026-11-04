#!/usr/bin/env node
/**
 * Converts doc/voice_test_scenarios.md into tests/eval/fixtures/intents.generated.json.
 *
 * The doc is the source of truth. Rows whose expected behaviour is a supported
 * intent become `runnable`; everything else is kept as `blocked` with a reason
 * so no scenario is silently dropped.
 *
 * Usage: npm run build:intents
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC_PATH = path.join(rootDir, 'doc', 'voice_test_scenarios.md');
const OUT_PATH = path.join(rootDir, 'tests', 'eval', 'fixtures', 'intents.generated.json');

const SUPPORTED_INTENTS = new Set([
    'ADD_STOCK', 'SALE', 'CHECK_STOCK', 'CHECK_PROFIT', 'UNKNOWN',
    'WRITE_OFF', 'CUSTOMER_RETURN', 'VENDOR_RETURN', 'LOG_EXPENSE',
    'CHECK_LOW_STOCK', 'CHECK_OUT_OF_STOCK',
]);

const UNIT_ALIASES = {
    kilograms: 'kg', kilogram: 'kg', kilo: 'kg',
    grams: 'g', gram: 'g',
    litres: 'l', liters: 'l', litre: 'l', liter: 'l',
    packets: 'packet', pieces: 'piece', crates: 'crate', boxes: 'box',
    dozens: 'dozen', bottles: 'bottle', pouches: 'pouch', sachets: 'sachet',
    tins: 'tin', sacks: 'sack', strips: 'strip',
};

function cleanUnit(raw) {
    if (!raw) return undefined;
    const value = String(raw).replace(/[`*]/g, '').trim().toLowerCase();
    if (!value || value === '-') return undefined;
    if (value.includes('/')) return undefined; // doc lists alternatives such as tin/pipa
    return UNIT_ALIASES[value] ?? value;
}

function cleanText(raw) {
    return String(raw)
        .replace(/[`*]/g, '')
        .replace(/\\\|/g, '|')
        .replace(/\s+/g, ' ')
        .trim();
}

function cleanUtterance(raw) {
    let value = cleanText(raw);
    value = value.replace(/\((?:garbled|noise|silence|beep)[^)]*\)/gi, '');
    value = value.replace(/\[[^\]]*\]/g, ' '); // bracketed noise/ASR artifacts
    value = value.replace(/\.{2,}/g, ' ');
    value = value.replace(/^["'`\s]+|["'`\s]+$/g, '');
    return value.replace(/\s+/g, ' ').trim();
}

function cleanItem(raw) {
    if (!raw) return undefined;
    let value = cleanText(raw);
    if (!value || /^null$/i.test(value) || value === '-') return undefined;
    value = value.replace(/\((?:or|generic)[^)]*\)/gi, '');
    value = value.replace(/\s+/g, ' ').trim();
    value = value.replace(/^["'`]+|["'`]+$/g, '');
    value = value.replace(/[.,;]+$/, '');
    return value || undefined;
}

function toNumber(raw) {
    const value = cleanText(raw).replace(/[^\d.]/g, '');
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function sanitizeAction(action) {
    const item = cleanItem(action.item);
    const quantity = action.quantity != null ? Number(action.quantity) : undefined;
    const unit = cleanUnit(action.unit);
    const amount = action.amount != null ? Number(action.amount) : undefined;

    const result = { intent: String(action.intent).toUpperCase() };
    if (item) result.item = item;
    if (quantity != null && Number.isFinite(quantity)) result.quantity = quantity;
    if (unit) result.unit = unit;
    if (amount != null && Number.isFinite(amount)) result.amount = amount;

    if (!SUPPORTED_INTENTS.has(result.intent)) {
        return { error: `intent ${result.intent} not implemented` };
    }
    return { action: result };
}

/** Parses one canonical action string such as "SALE: Sugar 2 kg" or "ADD_STOCK Atta 125 kg". */
const INTENT_PATTERN = 'ADD_STOCK|SALE|CHECK_STOCK|CHECK_PROFIT|WRITE_OFF|CUSTOMER_RETURN|VENDOR_RETURN|LOG_EXPENSE|CHECK_LOW_STOCK|CHECK_OUT_OF_STOCK';

function parseActionText(raw) {
    let text = cleanText(raw).replace(/^`|`$/g, '');
    if (!text) return null;

    // "WRITE_OFF / SALE Promo Bowl 1 piece" -> the primary intent wins
    text = text.replace(new RegExp(`^(${INTENT_PATTERN})\\s*\\/\\s*[A-Z_]+\\s+`, 'i'), '$1 ');

    // "SALE Oil | value: 50 INR"
    let match = text.match(new RegExp(`^(${INTENT_PATTERN})\\s+(.+?)\\s*\\|\\s*value:\\s*(\\d+(?:\\.\\d+)?)\\s*INR`, 'i'));
    if (match) {
        return { intent: match[1], item: match[2], amount: Number(match[3]) };
    }

    // "ADD_STOCK Maggi Rs 5, Qty: 10 packet"
    match = text.match(new RegExp(`^(${INTENT_PATTERN})\\s+(.+?),\\s*Qty:\\s*(\\d+(?:\\.\\d+)?)\\s*([A-Za-z]+)?`, 'i'));
    if (match) {
        return { intent: match[1], item: match[2], quantity: Number(match[3]), unit: match[4] };
    }

    // "SALE Colgate Rs 10 (2), Frooti Rs 5 (4)"
    const priceBody = text.replace(new RegExp(`^\\s*(${INTENT_PATTERN})\\s*`, 'i'), '');
    const priceGroups = [...priceBody.matchAll(/([A-Za-z][A-Za-z\s'&.-]*?)\s+Rs\s*(\d+)\s*\((\d+)\)/g)];
    if (priceGroups.length > 0) {
        const intent = (text.match(/^\s*([A-Z_]+)/)?.[1] ?? 'SALE').toUpperCase();
        return priceGroups.map(group => ({
            intent,
            item: `${cleanItem(group[1])} Rs ${group[2]}`,
            quantity: Number(group[3]),
        }));
    }

    // "SALE: Sugar 2 kg" / "CHECK_STOCK: Sensodyne" / "ADD_STOCK Atta 125 kg"
    match = text.match(new RegExp(`^(${INTENT_PATTERN})\\s*:?\\s+(.+)$`, 'i'));
    if (match) {
        const intent = match[1].toUpperCase();
        const rest = match[2]
            .replace(/\(or[^)]*\)/gi, '')
            .replace(/\([^)]*\)/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        const quantityMatch = rest.match(/^(.*?)\s+(\d+(?:\.\d+)?)\s*([A-Za-z/]+)?$/);
        if (quantityMatch) {
            return {
                intent,
                item: quantityMatch[1],
                quantity: Number(quantityMatch[2]),
                unit: quantityMatch[3],
            };
        }
        return { intent, item: rest };
    }

    return null;
}

/** Parses "SALE: Sugar 2 kg + SALE: Salt 1 packet" style multi-action cells. */
function parseActionList(raw) {
    const text = cleanText(raw)
        .replace(/[`*]/g, '')
        .replace(/\([^)]*\)/g, ' '); // drop parenthetical alternatives such as "(or 10 purchased + 1 bonus)"
    if (!text) return null;

    const parts = text
        .split(/\s+\+\s+|\s*\|\s*(?=[A-Z_]+:)/)
        .map(part => part.trim())
        .filter(Boolean);

    const actions = [];
    for (const part of parts) {
        const parsed = parseActionText(part);
        if (!parsed) return null;
        if (Array.isArray(parsed)) actions.push(...parsed);
        else actions.push(parsed);
    }
    return actions.length > 0 ? actions : null;
}

function parseInventoryHints(raw) {
    if (!raw) return undefined;
    const text = cleanText(raw);
    if (text.startsWith('[')) {
        try {
            const parsed = JSON.parse(text.replace(/'/g, '"'));
            if (Array.isArray(parsed)) return parsed.map(String);
        } catch {
            // fall through to comma split
        }
    }
    return undefined;
}

function makeFixture({ section, row, spoken, hints, expected, status, reason, expectedRaw, notes }) {
    const fixture = {
        id: `${section}-${String(row).padStart(3, '0')}`,
        section,
        utterance: spoken,
        status,
    };
    if (hints && hints.length > 0) fixture.inventoryHints = hints;
    if (status === 'runnable') fixture.expectedActions = expected;
    if (reason) fixture.reason = reason;
    if (expectedRaw) fixture.expectedRaw = expectedRaw;
    if (notes) fixture.notes = notes;
    return fixture;
}

function buildFixture({ section, row, utteranceRaw, hintsRaw, expectedRaw, expectedOverride, notes }) {
    const spoken = cleanUtterance(utteranceRaw);
    const hints = parseInventoryHints(hintsRaw);

    if (!spoken) {
        return makeFixture({ section, row, spoken: '', status: 'blocked', reason: 'empty utterance' });
    }

    if (expectedOverride) {
        const actions = [];
        for (const candidate of expectedOverride) {
            const { action, error } = sanitizeAction(candidate);
            if (error) {
                return makeFixture({ section, row, spoken, hints, status: 'blocked', reason: error, expectedRaw, notes });
            }
            actions.push(action);
        }
        if (actions.length === 0) {
            return makeFixture({ section, row, spoken, hints, status: 'blocked', reason: 'no expected actions', expectedRaw, notes });
        }
        return makeFixture({ section, row, spoken, hints, expected: actions, status: 'runnable', expectedRaw, notes });
    }

    return makeFixture({ section, row, spoken, hints, status: 'blocked', reason: 'no expected actions parsed', expectedRaw, notes });
}

function isSeparator(cells) {
    return cells.every(cell => /^:?-{2,}:?$/.test(cell.replace(/\s/g, '')));
}

function readTables(lines) {
    const tables = [];
    let current = null;
    let row = 0;

    for (const line of lines) {
        if (!line.trim().startsWith('|')) {
            if (current) {
                tables.push(current);
                current = null;
            }
            continue;
        }
        const cells = line
            .replace(/\\\|/g, '\u0000')
            .split('|')
            .slice(1, -1)
            .map(cell => cell.trim().replace(/\u0000/g, '|'));
        if (isSeparator(cells)) continue;
        if (!current) {
            current = { rows: [] };
            continue; // header row
        }
        row++;
        current.rows.push({ row, cells });
    }
    if (current) tables.push(current);
    return tables;
}

function buildFromTable(section, cells, row) {
    const utterance = cells[0];

    switch (section) {
        case 'S1':
        case 'S2':
        case 'S3':
        case 'S4': {
            const expected = [{
                intent: cleanText(cells[1]),
                item: cleanItem(cells[2]),
                quantity: toNumber(cells[3]),
                unit: cleanUnit(cells[4]),
            }];
            return buildFixture({ section, row, utteranceRaw: utterance, expectedOverride: expected, expectedRaw: cells.slice(1, 5).join(' | '), notes: cells[5] });
        }
        case 'S5':
        case 'S6': {
            const actions = parseActionList(cells[section === 'S5' ? 1 : 2]);
            return buildFixture({ section, row, utteranceRaw: utterance, expectedOverride: actions ?? undefined, expectedRaw: cells[section === 'S5' ? 1 : 2], notes: cells[section === 'S5' ? 2 : 1] });
        }
        case 'S7': {
            const intentCell = cleanText(cells[1]);
            const itemCell = cells[2];
            if (/^2\s*x\s*CHECK_STOCK$/i.test(intentCell)) {
                const actions = String(itemCell).split(',').map(item => ({ intent: 'CHECK_STOCK', item: cleanItem(item) }));
                return buildFixture({ section, row, utteranceRaw: utterance, expectedOverride: actions, expectedRaw: cells[1] + ' | ' + itemCell, notes: cells[3] });
            }
            const expected = [{ intent: intentCell, item: cleanItem(itemCell) }];
            return buildFixture({ section, row, utteranceRaw: utterance, expectedOverride: expected, expectedRaw: cells[1] + ' | ' + itemCell, notes: cells[3] });
        }
        case 'S8': {
            const expected = [{ intent: cleanText(cells[1]) }];
            return buildFixture({ section, row, utteranceRaw: utterance, expectedOverride: expected, expectedRaw: cells[1], notes: cells[2] });
        }
        case 'S9': {
            const intentQty = cleanText(cells[3]);
            const item = cleanItem(cells[2]);
            const hints = parseInventoryHints(cells[1]);
            if (/clarification/i.test(intentQty)) {
                return buildFixture({
                    section, row, utteranceRaw: utterance, hintsRaw: cells[1],
                    expectedOverride: [{ intent: 'UNKNOWN' }],
                    expectedRaw: intentQty,
                    notes: 'ambiguous SKU: expected clarification, mapped to UNKNOWN',
                });
            }
            const match = intentQty.match(/^(ADD_STOCK|SALE|CHECK_STOCK|CHECK_PROFIT)(?:\s*\/\s*(ADD_STOCK|SALE))?\s*(\d+(?:\.\d+)?)?\s*([A-Za-z]+)?$/);
            if (!match || (match[2] && match[2] !== match[1])) {
                return makeFixture({ section, row, spoken: cleanUtterance(utterance), hints, status: 'blocked', reason: `ambiguous expected intent: ${intentQty}`, expectedRaw: intentQty });
            }
            const expected = [{ intent: match[1], item, quantity: match[3] ? Number(match[3]) : undefined, unit: cleanUnit(match[4]) }];
            return buildFixture({ section, row, utteranceRaw: utterance, hintsRaw: cells[1], expectedOverride: expected, expectedRaw: cells[2] + ' | ' + intentQty });
        }
        case 'S10': {
            const behavior = cleanText(cells[2]);
            if (/service/i.test(behavior)) {
                return makeFixture({ section, row, spoken: cleanUtterance(utterance), status: 'blocked', reason: `service-layer rejection: ${behavior}`, expectedRaw: behavior });
            }
            if (/UNKNOWN|Reject/i.test(behavior)) {
                return buildFixture({ section, row, utteranceRaw: utterance, expectedOverride: [{ intent: 'UNKNOWN' }], expectedRaw: behavior, notes: cells[1] });
            }
            return makeFixture({ section, row, spoken: cleanUtterance(utterance), status: 'blocked', reason: 'behaviour is app/service-level', expectedRaw: behavior });
        }
        case 'S11': {
            const behavior = cleanText(cells[2]);
            if (/UNKNOWN/i.test(behavior)) {
                return buildFixture({ section, row, utteranceRaw: utterance, expectedOverride: [{ intent: 'UNKNOWN' }], expectedRaw: behavior, notes: cells[1] });
            }
            const parsed = parseActionText(behavior);
            if (parsed) {
                const actions = Array.isArray(parsed) ? parsed : [parsed];
                return buildFixture({ section, row, utteranceRaw: utterance, expectedOverride: actions, expectedRaw: behavior, notes: cells[1] });
            }
            return makeFixture({ section, row, spoken: cleanUtterance(utterance), status: 'blocked', reason: `service-layer rejection: ${behavior}`, expectedRaw: behavior });
        }
        case 'S12': {
            return buildFixture({ section, row, utteranceRaw: utterance, expectedOverride: [{ intent: 'UNKNOWN' }], expectedRaw: cells[2], notes: cells[1] });
        }
        case 'S13':
        case 'S14': {
            const reasonCell = section === 'S13' ? cells[2] : cells[1];
            return makeFixture({
                section,
                row,
                spoken: cleanUtterance(utterance),
                status: 'blocked',
                reason: `intent not implemented (${cleanText(reasonCell)})`,
                expectedRaw: cells.slice(1).filter(Boolean).join(' | '),
            });
        }
        case 'S15': {
            const expected = [{
                intent: cleanText(cells[2]),
                item: cleanItem(cells[3]),
                quantity: toNumber(cells[4]),
                unit: cleanUnit(cells[5]),
            }];
            return buildFixture({ section, row, utteranceRaw: cells[1], expectedOverride: expected, expectedRaw: cells.slice(2, 6).join(' | '), notes: cells[0] });
        }
        case 'S16': {
            const behavior = cleanText(cells[2]);
            const parsed = parseActionText(behavior);
            if (parsed) {
                const actions = Array.isArray(parsed) ? parsed : [parsed];
                return buildFixture({ section, row, utteranceRaw: utterance, expectedOverride: actions, expectedRaw: behavior });
            }
            if (/UNKNOWN/i.test(behavior)) {
                return buildFixture({ section, row, utteranceRaw: utterance, expectedOverride: [{ intent: 'UNKNOWN' }], expectedRaw: behavior });
            }
            return makeFixture({ section, row, spoken: cleanUtterance(utterance), status: 'blocked', reason: 'adversarial handling not expressible as intent', expectedRaw: behavior });
        }
        case 'S17': {
            return makeFixture({ section, row, spoken: cleanUtterance(cells[1]), status: 'blocked', reason: `app-level handling: ${cleanText(cells[2]).slice(0, 80)}` });
        }
        case 'S18': {
            const parsed = parseActionText(cells[2]);
            if (parsed) {
                const actions = Array.isArray(parsed) ? parsed : [parsed];
                return buildFixture({ section, row, utteranceRaw: utterance, expectedOverride: actions, expectedRaw: cells[2], notes: cells[1] });
            }
            return makeFixture({ section, row, spoken: cleanUtterance(utterance), status: 'blocked', reason: 'no expected actions parsed', expectedRaw: cells[2] });
        }
        case 'S19': {
            const parsed = parseActionText(cells[2]);
            if (parsed) {
                const actions = Array.isArray(parsed) ? parsed : [parsed];
                return buildFixture({ section, row, utteranceRaw: utterance, hintsRaw: cells[1], expectedOverride: actions, expectedRaw: cells[2], notes: cells[3] });
            }
            return makeFixture({ section, row, spoken: cleanUtterance(utterance), hintsRaw: cells[1], status: 'blocked', reason: 'no expected actions parsed', expectedRaw: cells[2] });
        }
        case 'S20': {
            const parsed = parseActionText(cells[2]);
            if (parsed) {
                const actions = Array.isArray(parsed) ? parsed : [parsed];
                return buildFixture({ section, row, utteranceRaw: utterance, expectedOverride: actions, expectedRaw: cells[2], notes: cells[3] });
            }
            return makeFixture({ section, row, spoken: cleanUtterance(utterance), status: 'blocked', reason: 'no expected actions parsed', expectedRaw: cells[2] });
        }
        case 'S21': {
            const parsed = parseActionText(cells[3]);
            if (parsed) {
                const actions = Array.isArray(parsed) ? parsed : [parsed];
                return buildFixture({ section, row, utteranceRaw: utterance, expectedOverride: actions, expectedRaw: cells[3], notes: cells[2] });
            }
            return makeFixture({ section, row, spoken: cleanUtterance(utterance), status: 'blocked', reason: 'no expected actions parsed', expectedRaw: cells[3] });
        }
        case 'S22': {
            const parsed = parseActionList(cells[2]);
            if (parsed) {
                return buildFixture({ section, row, utteranceRaw: utterance, expectedOverride: parsed, expectedRaw: cells[2], notes: cells[1] });
            }
            return makeFixture({ section, row, spoken: cleanUtterance(utterance), status: 'blocked', reason: 'no expected actions parsed', expectedRaw: cells[2] });
        }
        case 'S28': {
            const businessIntent = cleanText(cells[1]).toUpperCase();
            const mapped = businessIntent === 'CHECK_REORDER_LIST' ? 'CHECK_LOW_STOCK' : businessIntent;
            if (mapped === 'CHECK_LOW_STOCK' || mapped === 'CHECK_OUT_OF_STOCK') {
                return buildFixture({ section, row, utteranceRaw: utterance, expectedOverride: [{ intent: mapped }], expectedRaw: cells[1], notes: cells[2] });
            }
            return makeFixture({
                section,
                row,
                spoken: cleanUtterance(utterance),
                status: 'blocked',
                reason: `${businessIntent} needs data not tracked (expiry dates / shelf locations)`,
                expectedRaw: cells[1],
            });
        }
        case 'S29': {
            const intent = cleanText(cells[2]).toUpperCase();
            const amount = toNumber(cells[3]);
            if (intent === 'LOG_EXPENSE' && amount != null) {
                return buildFixture({
                    section, row, utteranceRaw: utterance,
                    expectedOverride: [{ intent: 'LOG_EXPENSE', amount }],
                    expectedRaw: `${intent} ${amount}`,
                    notes: cells[1],
                });
            }
            return makeFixture({ section, row, spoken: cleanUtterance(utterance), status: 'blocked', reason: 'no expense amount parsed', expectedRaw: cells[3] });
        }
        case 'S23': {
            const parsed = parseActionText(cells[3]);
            if (parsed) {
                const actions = Array.isArray(parsed) ? parsed : [parsed];
                return buildFixture({ section, row, utteranceRaw: utterance, expectedOverride: actions, expectedRaw: cells[3], notes: cells[1] + ' -> ' + cells[2] });
            }
            return makeFixture({ section, row, spoken: cleanUtterance(utterance), status: 'blocked', reason: 'transfer handled outside intent schema', expectedRaw: cells[3] });
        }
        case 'S24': {
            const parsed = parseActionText(cells[1]);
            if (parsed) {
                // Udhar/khata phrasing is deliberately not part of the schema:
                // only the pure inventory movement is expected.
                const actions = Array.isArray(parsed) ? parsed : [parsed];
                return buildFixture({
                    section, row, utteranceRaw: utterance, expectedOverride: actions, expectedRaw: cells[1],
                    notes: 'customer/credit columns ignored (strict negative scope)',
                });
            }
            return makeFixture({ section, row, spoken: cleanUtterance(utterance), status: 'blocked', reason: 'khata settlement is not an inventory action', expectedRaw: cells[1] });
        }
        case 'S27': {
            const parsed = parseActionList(cells[2]);
            if (parsed) {
                return buildFixture({ section, row, utteranceRaw: utterance, expectedOverride: parsed, expectedRaw: cells[2], notes: cells[1] });
            }
            return makeFixture({ section, row, spoken: cleanUtterance(utterance), status: 'blocked', reason: 'no expected actions parsed', expectedRaw: cells[2] });
        }
        case 'S30': {
            const parsed = parseActionText(cells[3]);
            if (parsed) {
                const actions = Array.isArray(parsed) ? parsed : [parsed];
                return buildFixture({ section, row, utteranceRaw: utterance, expectedOverride: actions, expectedRaw: cells[3], notes: cells[1] });
            }
            return makeFixture({ section, row, spoken: cleanUtterance(utterance), status: 'blocked', reason: 'no expected actions parsed', expectedRaw: cells[3] });
        }
        default:
            return makeFixture({ section, row, spoken: cleanUtterance(utterance), status: 'blocked', reason: 'section has no mapping rule' });
    }
}

function parseS26Blocks(markdown) {
    const fixtures = [];
    const blockPattern = /Utterance \d+:\s*\n"([^"]+)"([\s\S]*?)Expected Structured Extraction:\s*([\s\S]*?)(?=\n```|$)/g;
    let match;
    let row = 0;

    while ((match = blockPattern.exec(markdown)) !== null) {
        row++;
        const spoken = cleanUtterance(match[1]);
        const extraction = match[3];
        const actionPattern = /^\s*\d+\.\s*(ADD_STOCK|SALE|CHECK_STOCK|CHECK_PROFIT)\s*\|\s*Item:\s*([^|]+?)\s*\|\s*Qty:\s*([\d.]+)\s*\|\s*Unit:\s*([A-Za-z/]+)/gim;
        const actions = [];
        let actionMatch;
        while ((actionMatch = actionPattern.exec(extraction)) !== null) {
            actions.push({
                intent: actionMatch[1],
                item: actionMatch[2],
                quantity: Number(actionMatch[3]),
                unit: actionMatch[4],
            });
        }
        if (actions.length > 0) {
            fixtures.push(buildFixture({ section: 'S26', row, utteranceRaw: spoken, expectedOverride: actions, expectedRaw: 'structured extraction block' }));
        } else {
            fixtures.push(makeFixture({ section: 'S26', row, spoken, status: 'blocked', reason: 'no expected actions parsed from prose block' }));
        }
    }

    return fixtures;
}

function main() {
    if (!fs.existsSync(DOC_PATH)) {
        console.error(`[build:intents] missing ${DOC_PATH}`);
        process.exit(1);
    }

    const markdown = fs.readFileSync(DOC_PATH, 'utf8');
    const lines = markdown.split(/\r?\n/);
    const fixtures = [];

    const sectionStarts = [];
    lines.forEach((line, index) => {
        const match = line.match(/^## (S\d+)\./);
        if (match) sectionStarts.push({ section: match[1], index });
    });

    sectionStarts.forEach((start, position) => {
        const end = position + 1 < sectionStarts.length ? sectionStarts[position + 1].index : lines.length;
        const sectionLines = lines.slice(start.index, end);

        if (start.section === 'S25') {
            fixtures.push(makeFixture({
                section: 'S25',
                row: 1,
                spoken: '(multi-turn dialogue)',
                status: 'blocked',
                reason: 'requires multi-turn conversational harness',
            }));
            return;
        }

        if (start.section === 'S26') {
            const proseFixtures = parseS26Blocks(sectionLines.join('\n'));
            if (proseFixtures.length === 0) {
                fixtures.push(makeFixture({ section: 'S26', row: 1, spoken: '(rapid-fire dictation)', status: 'blocked', reason: 'no utterances parsed from prose' }));
            } else {
                fixtures.push(...proseFixtures);
            }
            return;
        }

        const tables = readTables(sectionLines);
        if (tables.length === 0) {
            fixtures.push(makeFixture({ section: start.section, row: 1, spoken: '(no table)', status: 'blocked', reason: 'no parseable table' }));
            return;
        }

        for (const table of tables) {
            for (const row of table.rows) {
                fixtures.push(buildFromTable(start.section, row.cells, row.row));
            }
        }
    });

    const summary = {
        generatedAt: new Date().toISOString(),
        source: 'doc/voice_test_scenarios.md',
        total: fixtures.length,
        runnable: fixtures.filter(f => f.status === 'runnable').length,
        blocked: fixtures.filter(f => f.status === 'blocked').length,
        bySection: {},
    };

    for (const fixture of fixtures) {
        const bucket = summary.bySection[fixture.section] ?? { total: 0, runnable: 0, blocked: 0 };
        bucket.total++;
        bucket[fixture.status]++;
        summary.bySection[fixture.section] = bucket;
    }

    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, JSON.stringify({ summary, fixtures }, null, 2) + '\n');

    console.log(`[build:intents] wrote ${fixtures.length} fixtures (${summary.runnable} runnable, ${summary.blocked} blocked) to ${path.relative(rootDir, OUT_PATH)}`);
    for (const [section, bucket] of Object.entries(summary.bySection)) {
        console.log(`  ${section}: ${bucket.runnable}/${bucket.total} runnable`);
    }
}

main();
