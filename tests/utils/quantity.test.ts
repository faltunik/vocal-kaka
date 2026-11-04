import { parseNonNegativeAmount, parsePositiveQuantity } from '@/utils/quantity';

describe('parsePositiveQuantity', () => {
    const accepted: Array<[unknown, number]> = [
        [5, 5],
        [1.5, 1.5],
        [0.25, 0.25],
        ['5', 5],
        ['1.5', 1.5],
        ['  42  ', 42],
        ['0.5', 0.5],
    ];

    it.each(accepted)('accepts %p and returns %p', (input, expected) => {
        expect(parsePositiveQuantity(input)).toBe(expected);
    });

    const rejected: unknown[] = [
        null,
        undefined,
        '',
        '   ',
        0,
        -1,
        '0',
        '0.0',
        '-3',
        'abc',
        '5 kg',
        '1e3',
        '0x10',
        'Infinity',
        'NaN',
        '5.',
        '.5',
        '5,5',
        true,
        false,
        [],
        [5],
        {},
        Infinity,
        -Infinity,
        NaN,
    ];

    it.each(rejected)('rejects %p', (input) => {
        expect(parsePositiveQuantity(input)).toBeNull();
    });
});

describe('parseNonNegativeAmount', () => {
    const accepted: Array<[unknown, number]> = [
        [0, 0],
        [5, 5],
        [1.5, 1.5],
        ['0', 0],
        ['300', 300],
        ['  250  ', 250],
        ['0.5', 0.5],
    ];

    it.each(accepted)('accepts %p and returns %p', (input, expected) => {
        expect(parseNonNegativeAmount(input)).toBe(expected);
    });

    const rejected: unknown[] = [
        null,
        undefined,
        '',
        '   ',
        -1,
        '-3',
        'abc',
        '5 rupaye',
        '1e3',
        '0x10',
        'Infinity',
        'NaN',
        true,
        false,
        [],
        [5],
        {},
        Infinity,
        -Infinity,
        NaN,
    ];

    it.each(rejected)('rejects %p', (input) => {
        expect(parseNonNegativeAmount(input)).toBeNull();
    });
});
