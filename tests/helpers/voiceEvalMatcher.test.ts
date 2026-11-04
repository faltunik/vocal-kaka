import { matchFailures } from '@/tests/helpers/voiceEvalMatcher';
import { ParsedAction } from '@/tests/eval/support/IntentParser';

describe('voiceEvalMatcher', () => {
    it('matches actions regardless of order', () => {
        const actual: ParsedAction[] = [
            { intent: 'SALE', item: 'Salt', quantity: 1, unit: 'packet' },
            { intent: 'SALE', item: 'Sugar', quantity: 2, unit: 'kg' },
        ];
        const expected = [
            { intent: 'SALE' as const, item: 'Sugar', quantity: 2, unit: 'kg' },
            { intent: 'SALE' as const, item: 'Salt', quantity: 1, unit: 'packet' },
        ];

        expect(matchFailures(actual, expected)).toEqual([]);
    });

    it('is case and whitespace insensitive for item and unit', () => {
        const actual: ParsedAction[] = [{ intent: 'ADD_STOCK', item: '  Sugar ', quantity: 5, unit: 'KG' }];
        const expected = [{ intent: 'ADD_STOCK' as const, item: 'sugar', quantity: 5, unit: 'kg' }];

        expect(matchFailures(actual, expected)).toEqual([]);
    });

    it('reports a missing action', () => {
        const failures = matchFailures([], [{ intent: 'CHECK_PROFIT' }]);

        expect(failures).toHaveLength(1);
        expect(failures[0]).toContain('missing');
    });

    it('reports quantity, unit and amount mismatches', () => {
        const actual: ParsedAction[] = [{ intent: 'SALE', item: 'Sugar', quantity: 3, unit: 'kg', amount: 90 }];
        const expected = [{ intent: 'SALE' as const, item: 'Sugar', quantity: 2, unit: 'kg', amount: 120 }];

        const failures = matchFailures(actual, expected);

        expect(failures).toHaveLength(2);
        expect(failures[0]).toContain('missing');
        expect(failures[1]).toContain('unexpected');
    });

    it('reports unexpected extra actions', () => {
        const actual: ParsedAction[] = [
            { intent: 'SALE', item: 'Sugar', quantity: 2, unit: 'kg' },
            { intent: 'UNKNOWN', original_text: 'noise' },
        ];

        const failures = matchFailures(actual, [{ intent: 'SALE' as const, item: 'Sugar', quantity: 2, unit: 'kg' }]);

        expect(failures).toHaveLength(1);
        expect(failures[0]).toContain('unexpected');
    });

    it('ignores unspecified fields', () => {
        const actual: ParsedAction[] = [{ intent: 'CHECK_STOCK', item: 'Sugar' }];

        expect(matchFailures(actual, [{ intent: 'CHECK_STOCK' as const, item: 'Sugar' }])).toEqual([]);
    });

    it('treats udhar phrasing as a pure inventory SALE action', () => {
        const actual: ParsedAction[] = [{
            intent: 'SALE',
            item: 'Aashirvaad Atta',
            quantity: 2,
            unit: 'kg',
        }];

        expect(matchFailures(actual, [{
            intent: 'SALE' as const,
            item: 'Aashirvaad Atta',
            quantity: 2,
            unit: 'kg',
        }])).toEqual([]);
    });

    it('matches new intent types such as WRITE_OFF and LOG_EXPENSE', () => {
        const actual: ParsedAction[] = [
            { intent: 'WRITE_OFF', item: 'Egg', quantity: 3, unit: 'piece' },
            { intent: 'LOG_EXPENSE', amount: 1500 },
        ];

        expect(matchFailures(actual, [
            { intent: 'WRITE_OFF' as const, item: 'Egg', quantity: 3, unit: 'piece' },
            { intent: 'LOG_EXPENSE' as const, amount: 1500 },
        ])).toEqual([]);
    });
});
