import { ExpectedAction } from '@/tests/helpers/voiceEvalMatcher';

export interface VoiceFixture {
    id: string;
    /** Audio file under tests/eval/fixtures/audio/ */
    audio: string;
    /** What the speaker actually says (paste the real transcript target for recordings). */
    spoken: string;
    inventoryHints?: string[];
    expectedActions: ExpectedAction[];
}

/**
 * Live eval fixtures: real Groq Whisper ASR + real LLM intent parsing.
 * Run with `npm run test:eval` (loads .env, excluded from `npm test`).
 *
 * The starter clips are Windows SAPI English smoke tests for the harness
 * itself. Replace/extend them with real Hinglish recordings matching
 * doc/voice_test_scenarios.md (S1-S30).
 */
export const VOICE_FIXTURES: VoiceFixture[] = [
    {
        id: 'en-add-milk',
        audio: 'add-five-milk.wav',
        spoken: 'Add five packets of milk',
        expectedActions: [{ intent: 'ADD_STOCK', item: 'Milk', quantity: 5, unit: 'packet' }],
    },
    {
        id: 'en-sell-sugar',
        audio: 'sell-two-kilo-sugar.wav',
        spoken: 'Sell two kilograms of sugar',
        expectedActions: [{ intent: 'SALE', item: 'Sugar', quantity: 2, unit: 'kg' }],
    },
    {
        id: 'en-check-sugar',
        audio: 'check-sugar-stock.wav',
        spoken: 'How much sugar is left',
        inventoryHints: ['Sugar'],
        expectedActions: [{ intent: 'CHECK_STOCK', item: 'Sugar' }],
    },
    {
        id: 'en-profit',
        audio: 'check-profit.wav',
        spoken: "What is today's profit",
        expectedActions: [{ intent: 'CHECK_PROFIT' }],
    },
];
