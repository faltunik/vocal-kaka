import {
    calculateSuggestedReorder,
    formatBaseUnit,
    formatParchiDate,
    formatParchiItemLine,
    formatWholesaleUnit,
    generateParchiText,
    generateParchiHtml,
    resolveWholesalePackaging,
    shareParchiOnWhatsApp,
    copyParchiToClipboard,
    PARCHI_DIVIDER,
    ParchiItem,
} from '@/utils/parchi';
import { Linking, Platform, Share, Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';

// Mock expo-clipboard
jest.mock('expo-clipboard', () => ({
    setStringAsync: jest.fn().mockResolvedValue(true),
}));

// Mock expo-sharing
jest.mock('expo-sharing', () => ({
    isAvailableAsync: jest.fn().mockResolvedValue(false),
    shareAsync: jest.fn().mockResolvedValue(undefined),
}));

// Mock expo-file-system
jest.mock('expo-file-system', () => ({
    cacheDirectory: 'file:///cache/',
    writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
    EncodingType: { UTF8: 'utf8' },
}));

describe('WhatsApp Reorder Parchi Engine', () => {
    describe('1. Wholesale Packaging Resolution & Heuristics', () => {
        it('uses explicit secondary unit and conversion factor when provided', () => {
            const packaging = resolveWholesalePackaging({
                name: 'Sugar M-30',
                base_unit: 'kg',
                secondary_unit: 'bori',
                conversion_factor: 50,
            });

            expect(packaging).toEqual({
                secondaryUnit: 'bori',
                factor: 50,
                baseUnit: 'kg',
            });
        });

        it('infers bori (50 kg) for loose staples, grains, and pulses', () => {
            const items = ['Sugar Loose', 'Basmati Rice', 'Toor Daal', 'Chana Dal', 'Chakki Atta', 'Maida'];
            for (const name of items) {
                const packaging = resolveWholesalePackaging({ name, base_unit: 'kg' });
                expect(packaging.secondaryUnit).toBe('bori');
                expect(packaging.factor).toBe(50);
                expect(packaging.baseUnit).toBe('kg');
            }
        });

        it('infers gram-based bori (50000 g) and millilitre pipa (15000 ml) for small units', () => {
            expect(resolveWholesalePackaging({ name: 'Sugar Loose', base_unit: 'g' })).toEqual({
                secondaryUnit: 'bori',
                factor: 50000,
                baseUnit: 'g',
            });
            expect(resolveWholesalePackaging({ name: 'Mustard Oil', base_unit: 'ml' })).toEqual({
                secondaryUnit: 'pipa',
                factor: 15000,
                baseUnit: 'ml',
            });
        });

        it('infers pipa (15 L) for edible oils, ghee, and liquids', () => {
            const items = ['Fortune Mustard Oil', 'Refined Sunflower Tel', 'Desi Ghee', 'Sarson Tel'];
            for (const name of items) {
                const packaging = resolveWholesalePackaging({ name, base_unit: 'l' });
                expect(packaging.secondaryUnit).toBe('pipa');
                expect(packaging.factor).toBe(15);
                expect(packaging.baseUnit).toBe('L');
            }
        });

        it('infers tray (30 pcs) for eggs', () => {
            const packaging = resolveWholesalePackaging({ name: 'Fresh Farm Eggs', base_unit: 'pcs' });
            expect(packaging.secondaryUnit).toBe('tray');
            expect(packaging.factor).toBe(30);
            expect(packaging.baseUnit).toBe('pcs');
        });

        it('infers dozen (12 pcs) for bananas', () => {
            const packaging = resolveWholesalePackaging({ name: 'Robusta Banana (Kela)', base_unit: 'pcs' });
            expect(packaging.secondaryUnit).toBe('dozen');
            expect(packaging.factor).toBe(12);
            expect(packaging.baseUnit).toBe('pcs');
        });

        it('infers peti (24 pcs) for packaged FMCG items (Maggi, biscuits, soap)', () => {
            const items = ['Maggi 2-Minute Noodles', 'Parle-G Biscuit', 'Lifebuoy Soap', 'Colgate Paste'];
            for (const name of items) {
                const packaging = resolveWholesalePackaging({ name, base_unit: 'pcs' });
                expect(packaging.secondaryUnit).toBe('peti');
                expect(packaging.factor).toBe(24);
                expect(packaging.baseUnit).toBe('pcs');
            }
        });

        it('falls back to 1:1 base unit when item is unclassified', () => {
            const packaging = resolveWholesalePackaging({ name: 'Steel Scrub Pad', base_unit: 'pcs' });
            expect(packaging.secondaryUnit).toBe('peti'); // pcs defaults to peti
            expect(packaging.factor).toBe(24);

            const unknownUnit = resolveWholesalePackaging({ name: 'Special Item', base_unit: 'box' });
            expect(unknownUnit.secondaryUnit).toBe('box');
            expect(unknownUnit.factor).toBe(1);
            expect(unknownUnit.baseUnit).toBe('box');
        });
    });

    describe('2. Unit Pluralization & Formatting', () => {
        it('preserves invariable Indian Kirana wholesale units in plural', () => {
            expect(formatWholesaleUnit('bori', 1)).toBe('bori');
            expect(formatWholesaleUnit('bori', 2)).toBe('bori');
            expect(formatWholesaleUnit('bori', 10)).toBe('bori');

            expect(formatWholesaleUnit('pipa', 1)).toBe('pipa');
            expect(formatWholesaleUnit('pipa', 2)).toBe('pipa');

            expect(formatWholesaleUnit('dozen', 1)).toBe('dozen');
            expect(formatWholesaleUnit('dozen', 3)).toBe('dozen');
        });

        it('pluralizes English/hinglish packaging units correctly', () => {
            expect(formatWholesaleUnit('peti', 1)).toBe('peti');
            expect(formatWholesaleUnit('peti', 2)).toBe('petis');

            expect(formatWholesaleUnit('carton', 1)).toBe('carton');
            expect(formatWholesaleUnit('carton', 2)).toBe('cartons');

            expect(formatWholesaleUnit('tray', 1)).toBe('tray');
            expect(formatWholesaleUnit('tray', 2)).toBe('trays');

            expect(formatWholesaleUnit('box', 1)).toBe('box');
            expect(formatWholesaleUnit('box', 2)).toBe('boxes');

            expect(formatWholesaleUnit('pkt', 1)).toBe('pkt');
            expect(formatWholesaleUnit('pkt', 2)).toBe('pkts');
        });

        it('formats base units with standard capitalizations', () => {
            expect(formatBaseUnit('l')).toBe('L');
            expect(formatBaseUnit('ltr')).toBe('L');
            expect(formatBaseUnit('liter')).toBe('L');
            expect(formatBaseUnit('kg')).toBe('kg');
            expect(formatBaseUnit('pcs')).toBe('pcs');
            expect(formatBaseUnit('packet')).toBe('pkts');
            expect(formatBaseUnit(undefined)).toBe('pcs');
        });
    });

    describe('3. Suggested Wholesale Reorder Calculations', () => {
        it('calculates suggested order using threshold buffer when sales velocity is zero', () => {
            // Tata Salt: current = 5, threshold = 15, targetBuffer = 30, deficit = 25
            // Packaging: bori (50 pkts) -> ceil(25 / 50) = 1 bori (50 pkts)
            const result = calculateSuggestedReorder({
                name: 'Tata Salt 1kg Pack',
                quantity: 5,
                low_stock_threshold: 15,
                base_unit: 'pkt',
                secondary_unit: 'bori',
                conversion_factor: 50,
            }, 0);

            expect(result.suggestedSecondaryQty).toBe(1);
            expect(result.calculatedBaseQty).toBe(50);
            expect(result.displayUnit).toBe('bori');
        });

        it('factors in 7-day sales velocity to prevent stockout under high demand', () => {
            // Sugar: current = 4, threshold = 10, velocity = 14 kg/day (98 kg/wk)
            // targetBuffer = max(20, 98) = 98. deficit = 98 - 4 = 94.
            // bori (50 kg) -> ceil(94 / 50) = 2 bori (100 kg)
            const result = calculateSuggestedReorder({
                name: 'Sugar (Loose Khandsari)',
                quantity: 4,
                low_stock_threshold: 10,
                base_unit: 'kg',
                secondary_unit: 'bori',
                conversion_factor: 50,
            }, 14);

            expect(result.suggestedSecondaryQty).toBe(2);
            expect(result.calculatedBaseQty).toBe(100);
            expect(result.displayUnit).toBe('bori');
        });

        it('correctly handles negative stock debt (stock sold before entry)', () => {
            // Maggi: current = -3, threshold = 12, velocity = 5 pcs/day (35 pcs/wk)
            // targetBuffer = max(24, 35) = 35. deficit = 35 - (-3) = 38.
            // peti (24 pcs) -> ceil(38 / 24) = 2 petis (48 pcs)
            const result = calculateSuggestedReorder({
                name: 'Maggi 2-Minute Noodles',
                quantity: -3,
                low_stock_threshold: 12,
                base_unit: 'pcs',
                secondary_unit: 'peti',
                conversion_factor: 24,
            }, 5);

            expect(result.suggestedSecondaryQty).toBe(2);
            expect(result.calculatedBaseQty).toBe(48);
            expect(result.displayUnit).toBe('peti');
        });

        it('calculates 1 pipa (15 L) for low stock Fortune Mustard Oil', () => {
            // Oil: current = 1, threshold = 5, velocity = 2 L/day (14 L/wk)
            // targetBuffer = max(10, 14) = 14. deficit = 14 - 1 = 13.
            // pipa (15 L) -> ceil(13 / 15) = 1 pipa (15 L)
            const result = calculateSuggestedReorder({
                name: 'Fortune Mustard Oil',
                quantity: 1,
                low_stock_threshold: 5,
                base_unit: 'L',
                secondary_unit: 'pipa',
                conversion_factor: 15,
            }, 2);

            expect(result.suggestedSecondaryQty).toBe(1);
            expect(result.calculatedBaseQty).toBe(15);
            expect(result.displayUnit).toBe('pipa');
        });
    });

    describe('4. Parchi Item Line Formatting', () => {
        it('formats Sugar line as "1. Sugar - 2 bori (100 kg)"', () => {
            const line = formatParchiItemLine(1, {
                name: 'Sugar',
                reorderQuantity: 2,
                secondary_unit: 'bori',
                conversion_factor: 50,
                base_unit: 'kg',
            });
            expect(line).toBe('1. Sugar - 2 bori (100 kg)');
        });

        it('formats Fortune Oil line as "2. Fortune Oil - 1 pipa (15 L)"', () => {
            const line = formatParchiItemLine(2, {
                name: 'Fortune Oil',
                reorderQuantity: 1,
                secondary_unit: 'pipa',
                conversion_factor: 15,
                base_unit: 'L',
            });
            expect(line).toBe('2. Fortune Oil - 1 pipa (15 L)');
        });

        it('formats Maggi line with pluralized petis: "3. Maggi 2-Min - 2 petis (48 pcs)"', () => {
            const line = formatParchiItemLine(3, {
                name: 'Maggi 2-Min',
                reorderQuantity: 2,
                secondary_unit: 'peti',
                conversion_factor: 24,
                base_unit: 'pcs',
            });
            expect(line).toBe('3. Maggi 2-Min - 2 petis (48 pcs)');
        });

        it('formats single base unit item without duplicate parentheses', () => {
            const line = formatParchiItemLine(4, {
                name: 'Ball Pen',
                quantity: 10,
                base_unit: 'pcs',
                conversion_factor: 1,
                secondary_unit: 'pcs',
            });
            expect(line).toBe('4. Ball Pen - 10 pcs');
        });
    });

    describe('5. Full WhatsApp Parchi Generation', () => {
        it('generates the exact canonical WhatsApp Parchi format', () => {
            const items: ParchiItem[] = [
                {
                    name: 'Sugar',
                    reorderQuantity: 2,
                    secondary_unit: 'bori',
                    conversion_factor: 50,
                    base_unit: 'kg',
                },
                {
                    name: 'Fortune Oil',
                    reorderQuantity: 1,
                    secondary_unit: 'pipa',
                    conversion_factor: 15,
                    base_unit: 'L',
                },
            ];

            const parchi = generateParchiText('Laxmi Kirana Store', items, {
                date: '03 Oct',
                note: 'Bhejo jaldi kal subah.',
            });

            const expected = [
                '🛒 *Laxmi Kirana Store - Order Parchi* (03 Oct)',
                '─────────────────',
                '1. Sugar - 2 bori (100 kg)',
                '2. Fortune Oil - 1 pipa (15 L)',
                '─────────────────',
                'Total Items: 2',
                'Bhejo jaldi kal subah.',
            ].join('\n');

            expect(parchi).toBe(expected);
        });

        it('handles dynamic dates and defaults store name when empty', () => {
            const items: ParchiItem[] = [
                {
                    name: 'Tata Salt',
                    reorderQuantity: 1,
                    secondary_unit: 'bori',
                    conversion_factor: 50,
                    base_unit: 'kg',
                },
            ];

            const fixedDate = new Date(2026, 9, 3); // 03 Oct 2026
            const parchi = generateParchiText('', items, { date: fixedDate });

            expect(parchi).toContain('🛒 *Laxmi Kirana Store - Order Parchi* (03 Oct)');
            expect(parchi).toContain('1. Tata Salt - 1 bori (50 kg)');
            expect(parchi).toContain('Total Items: 1');
            expect(parchi).toContain('Bhejo jaldi kal subah.');
        });

        it('returns empty string when items array is empty', () => {
            expect(generateParchiText('Store', [])).toBe('');
        });

        it('allows custom delivery note or omitting delivery note', () => {
            const items: ParchiItem[] = [
                { name: 'Sugar', reorderQuantity: 1, secondary_unit: 'bori', conversion_factor: 50, base_unit: 'kg' },
            ];

            const withCustom = generateParchiText('Store', items, {
                date: '03 Oct',
                note: 'Subah 8 baje tak bhejo.',
            });
            expect(withCustom).toContain('Subah 8 baje tak bhejo.');

            const withoutNote = generateParchiText('Store', items, {
                date: '03 Oct',
                note: null,
            });
            expect(withoutNote.endsWith('Total Items: 1')).toBe(true);
        });

        it('contains the 17-character light horizontal rule divider', () => {
            expect(PARCHI_DIVIDER).toBe('─────────────────');
            expect(PARCHI_DIVIDER.length).toBe(17);
        });

        it('carries store locality, phone, and UPI identity when configured', () => {
            const items: ParchiItem[] = [
                { name: 'Sugar', reorderQuantity: 1, secondary_unit: 'bori', conversion_factor: 50, base_unit: 'kg' },
            ];

            const parchi = generateParchiText('Shree Krishna Kirana Store', items, {
                date: '03 Oct',
                note: null,
                address: 'Shop 5, APMC Mandi',
                phone: '9876543210',
                upiId: 'shreekrishna@okaxis',
            });

            expect(parchi).toContain(
                '📍 Shop 5, APMC Mandi | 📞 9876543210 | 💳 UPI: shreekrishna@okaxis'
            );
        });

        it('omits the identity line when no store contact details exist', () => {
            const items: ParchiItem[] = [
                { name: 'Sugar', reorderQuantity: 1, secondary_unit: 'bori', conversion_factor: 50, base_unit: 'kg' },
            ];

            const parchi = generateParchiText('Store', items, { date: '03 Oct', note: null });

            expect(parchi).not.toContain('📍');
            expect(parchi).not.toContain('📞');
        });
    });

    describe('6. WhatsApp Sharing & Clipboard Pipeline', () => {
        beforeEach(() => {
            jest.clearAllMocks();
        });

        it('launches native WhatsApp URL when supported', async () => {
            const canOpenSpy = jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
            const openSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as any);

            const result = await shareParchiOnWhatsApp('🛒 Test Parchi');

            expect(result.success).toBe(true);
            expect(result.method).toBe('whatsapp_deeplink');
            expect(openSpy).toHaveBeenCalledWith(expect.stringContaining('whatsapp://send?text='));

            canOpenSpy.mockRestore();
            openSpy.mockRestore();
        });

        it('falls back to Native Share sheet when WhatsApp app is not installed', async () => {
            const canOpenSpy = jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(false);
            const openSpy = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('WhatsApp not installed'));
            const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as any);

            const result = await shareParchiOnWhatsApp('🛒 Test Parchi');

            expect(result.success).toBe(true);
            expect(result.method).toBe('native_share');
            expect(shareSpy).toHaveBeenCalledWith(
                expect.objectContaining({ message: '🛒 Test Parchi' })
            );

            canOpenSpy.mockRestore();
            openSpy.mockRestore();
            shareSpy.mockRestore();
        });

        it('copies to clipboard via copyParchiToClipboard', async () => {
            const result = await copyParchiToClipboard('🛒 Parchi for clipboard');
            expect(result).toBe(true);
            expect(Clipboard.setStringAsync).toHaveBeenCalledWith('🛒 Parchi for clipboard');
        });

        it('reports clipboard failure instead of claiming success', async () => {
            const canOpenSpy = jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(false);
            const openSpy = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no whatsapp'));
            const shareSpy = jest.spyOn(Share, 'share').mockRejectedValue(new Error('no share'));
            const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
            (Clipboard.setStringAsync as jest.Mock).mockRejectedValueOnce(new Error('blocked'));

            const result = await shareParchiOnWhatsApp('Parchi text');

            expect(result.success).toBe(false);
            expect(result.method).toBe('clipboard');

            canOpenSpy.mockRestore();
            openSpy.mockRestore();
            shareSpy.mockRestore();
            alertSpy.mockRestore();
        });
    });

    describe('Printable PDF Parchi (FEAT-05)', () => {
        it('renders an A4 HTML document with store branding, items and note', () => {
            const html = generateParchiHtml(
                'Kaka Kirana Store',
                [
                    {
                        name: 'Sugar M-30',
                        reorderQuantity: 2,
                        secondary_unit: 'bori',
                        conversion_factor: 50,
                        base_unit: 'kg',
                    },
                ],
                { note: 'Bhejo jaldi kal subah.', phone: '9876543210' }
            );

            expect(html).toContain('Kaka Kirana Store');
            expect(html).toContain('Order Parchi');
            expect(html).toContain('Sugar M-30');
            expect(html).toContain('2 bori');
            expect(html).toContain('100 kg');
            expect(html).toContain('Bhejo jaldi kal subah.');
            expect(html).toContain('Ph: 9876543210');
        });
    });

    describe('Math hardening (audit wave 3)', () => {
        it('never returns NaN for a malformed threshold', () => {
            const result = calculateSuggestedReorder({
                name: 'Sugar',
                quantity: 1,
                low_stock_threshold: 'abc',
                base_unit: 'kg',
            });

            expect(Number.isFinite(result.suggestedSecondaryQty)).toBe(true);
            expect(Number.isFinite(result.calculatedBaseQty)).toBe(true);
        });

        it('never pairs count-based SKUs with mass/volume packaging', () => {
            expect(resolveWholesalePackaging({ name: 'Milk Biscuits', base_unit: 'pcs' }).secondaryUnit).toBe('peti');
            expect(resolveWholesalePackaging({ name: 'Egg Noodles', base_unit: 'pcs' }).secondaryUnit).toBe('peti');
        });

        it('renders PDF and WhatsApp lines with the same pluralized unit', () => {
            const item = {
                name: 'Sugar',
                reorderQuantity: 2,
                secondary_unit: 'peti',
                conversion_factor: 24,
                base_unit: 'pcs',
            };

            const html = generateParchiHtml('Kaka Store', [item]);

            expect(html).toContain('2 petis');
            expect(formatParchiItemLine(1, item)).toContain('2 petis');
        });

        it('returns an empty PDF for an empty selection', () => {
            expect(generateParchiHtml('Kaka Store', [])).toBe('');
        });

        it('does not append ASCII plurals to Devanagari units', () => {
            expect(formatWholesaleUnit('बोरी', 2)).toBe('बोरी');
        });
    });
});
