import {
    CATEGORY_OPTIONS,
    CREATABLE_CATEGORY_OPTIONS,
    INVENTORY_CATEGORIES,
    normalizeInventoryCategory,
} from '@/utils/categories';

describe('Inventory category helper', () => {
    it('exposes canonical enum values only', () => {
        expect(INVENTORY_CATEGORIES).toEqual([
            'GENERAL',
            'FMCG',
            'STAPLES',
            'DAIRY_BAKERY',
            'SPICES',
        ]);
        for (const option of CATEGORY_OPTIONS) {
            expect(INVENTORY_CATEGORIES).toContain(option.key);
        }
    });

    it('excludes GENERAL from the create-form options', () => {
        expect(CREATABLE_CATEGORY_OPTIONS.some(option => option.key === 'GENERAL')).toBe(false);
    });

    it('normalizes legacy labels to the DB enum', () => {
        expect(normalizeInventoryCategory('Staples')).toBe('STAPLES');
        expect(normalizeInventoryCategory('Dairy')).toBe('DAIRY_BAKERY');
        expect(normalizeInventoryCategory('Spices')).toBe('SPICES');
        expect(normalizeInventoryCategory('FMCG')).toBe('FMCG');
        expect(normalizeInventoryCategory('General')).toBe('GENERAL');
    });

    it('normalizes aliases and unknown values safely', () => {
        expect(normalizeInventoryCategory('loose_grains')).toBe('STAPLES');
        expect(normalizeInventoryCategory('bakery')).toBe('DAIRY_BAKERY');
        expect(normalizeInventoryCategory('masala')).toBe('SPICES');
        expect(normalizeInventoryCategory('')).toBe('GENERAL');
        expect(normalizeInventoryCategory(null)).toBe('GENERAL');
        expect(normalizeInventoryCategory('nonsense')).toBe('GENERAL');
    });
});
