import { classifyCategory } from '@/supabase/functions/_shared/categories';
import { classifyCategoryClient } from '@/utils/categories';

/**
 * The edge snapshot and the client dashboard must classify identically, or
 * spoken and displayed profit diverge. This corpus catches drift.
 */
const CORPUS: Array<[string, string | null]> = [
    ['Sugar', 'kg'],
    ['Madhur Pure Sugar', 'kg'],
    ['Toor Dal', 'kg'],
    ['Fortune Mustard Oil 1L', 'l'],
    ['Amul Taaza Milk 500ml', 'l'],
    ['Britannia Bread', 'packet'],
    ['Pav', 'packet'],
    ['Pav Bhaji Masala', 'packet'],
    ['Egg Noodles', 'packet'],
    ['Maggi 2-Minute Masala Noodles', 'packet'],
    ['Butter Cookies', 'packet'],
    ['Colgate Total', 'piece'],
    ['Cello Ball Pen', 'piece'],
    ['Aashirvaad Atta', 'kg'],
    ['Tata Salt 1kg Pack', 'packet'],
    ['Dahi', 'packet'],
    ['Paneer', 'kg'],
    ['Banana', 'dozen'],
    ['Kurkure', 'packet'],
    ['Unknown Widget', 'pcs'],
];

describe('classifyCategory parity (edge vs client vs DB semantics)', () => {
    it.each(CORPUS)('agrees on %s (%s)', (name, unit) => {
        expect(classifyCategory(name, unit)).toBe(classifyCategoryClient(name, unit));
    });

    it('classifies pav bhaji masala as a staple, not dairy', () => {
        expect(classifyCategory('Pav Bhaji Masala', 'packet')).toBe('STAPLES');
        expect(classifyCategoryClient('Pav Bhaji Masala', 'packet')).toBe('STAPLES');
    });

    it('keeps dairy pav out of staples', () => {
        expect(classifyCategory('Pav', 'packet')).toBe('DAIRY_BAKERY');
        expect(classifyCategoryClient('Pav', 'packet')).toBe('DAIRY_BAKERY');
    });
});
