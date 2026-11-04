import { ParsedAction } from '@/tests/eval/support/IntentParser';

export interface ExpectedAction {
    intent: ParsedAction['intent'];
    item?: string;
    quantity?: number;
    unit?: string;
    amount?: number;
}

function normalize(value?: string | null): string {
    return (value ?? '').trim().toLowerCase();
}

export function actionMatches(actual: ParsedAction, expected: ExpectedAction): boolean {
    if (actual.intent !== expected.intent) return false;
    if (expected.item && normalize(actual.item) !== normalize(expected.item)) return false;
    if (expected.quantity != null && Number(actual.quantity) !== expected.quantity) return false;
    if (expected.unit && normalize(actual.unit) !== normalize(expected.unit)) return false;
    if (expected.amount != null && Number(actual.amount) !== expected.amount) return false;
    return true;
}

/**
 * Order-insensitive comparison of parsed actions against expected actions.
 * Returns a list of human-readable failures (empty when everything matched).
 */
export function matchFailures(actual: ParsedAction[], expected: ExpectedAction[]): string[] {
    const unmatched = [...actual];
    const failures: string[] = [];

    for (const expectation of expected) {
        const index = unmatched.findIndex(candidate => actionMatches(candidate, expectation));
        if (index === -1) {
            failures.push(`missing ${JSON.stringify(expectation)}`);
        } else {
            unmatched.splice(index, 1);
        }
    }

    if (unmatched.length > 0) {
        failures.push(`unexpected ${JSON.stringify(unmatched)}`);
    }

    return failures;
}
