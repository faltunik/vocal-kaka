import { parseNonNegativeNumber, parseOptionalNumber, parsePositiveNumber } from '@/utils/numeric';

describe('numeric form helpers', () => {
    it('parses finite numbers and blanks', () => {
        expect(parseOptionalNumber('12')).toBe(12);
        expect(parseOptionalNumber(' 4.5 ')).toBe(4.5);
        expect(parseOptionalNumber('')).toBeNull();
        expect(parseOptionalNumber('   ')).toBeNull();
    });

    it('rejects partial or non-numeric junk', () => {
        expect(parseOptionalNumber('12abc')).toBeNull();
        expect(parseOptionalNumber('NaN')).toBeNull();
        expect(parseOptionalNumber('Infinity')).toBeNull();
        expect(parseOptionalNumber('0x10')).toBeNull();
        expect(parseOptionalNumber('1e3')).toBeNull();
    });

    it('enforces non-negative and positive bounds', () => {
        expect(parseNonNegativeNumber('0')).toBe(0);
        expect(parseNonNegativeNumber('-1')).toBeNull();
        expect(parsePositiveNumber('0')).toBeNull();
        expect(parsePositiveNumber('3')).toBe(3);
    });
});
