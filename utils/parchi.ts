import { Linking, Platform, Share, Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';

import { DEFAULT_STORE_NAME } from './storeName';
import { getErrorMessage } from './errors';

export { DEFAULT_STORE_NAME } from './storeName';

export const PARCHI_DIVIDER = '─────────────────';
export const DEFAULT_PARCHI_NOTE = 'Bhejo jaldi kal subah.';

export interface ParchiItem {
    id?: string;
    name: string;
    quantity?: number;
    reorderQuantity?: number;
    base_unit?: string | null;
    unit?: string | null;
    secondary_unit?: string | null;
    conversion_factor?: number | string | null;
    base_quantity?: number;
    calculatedBaseQty?: number;
    displayUnit?: string;
    suggestedSecondaryQty?: number;
    low_stock_threshold?: number | string | null;
    isOutOfStock?: boolean;
    dailyVelocity?: number;
}

export interface WholesalePackaging {
    secondaryUnit: string;
    factor: number;
    baseUnit: string;
}

export interface SuggestedReorderResult {
    suggestedSecondaryQty: number;
    calculatedBaseQty: number;
    displayUnit: string;
    factor: number;
    baseUnit: string;
}

export interface GenerateParchiOptions {
    date?: Date | string;
    note?: string | null;
    address?: string | null;
    phone?: string | null;
    upiId?: string | null;
}

export interface ParchiShareResult {
    success: boolean;
    method: 'whatsapp_deeplink' | 'whatsapp_web' | 'expo_sharing' | 'native_share' | 'clipboard' | 'none';
    error?: string;
}

/**
 * Standardize base units for clean chit display (e.g. 'L' for litres, 'kg', 'pcs').
 */
export function formatBaseUnit(unit?: string | null): string {
    if (!unit) return 'pcs';
    const lower = unit.trim().toLowerCase();
    if (lower === 'l' || lower === 'ltr' || lower === 'liter' || lower === 'litre') return 'L';
    if (lower === 'kg') return 'kg';
    if (lower === 'g' || lower === 'gm' || lower === 'gram') return 'g';
    if (lower === 'ml') return 'ml';
    if (lower === 'pcs' || lower === 'pc' || lower === 'piece' || lower === 'pieces') return 'pcs';
    if (lower === 'pkt' || lower === 'packet' || lower === 'pkts' || lower === 'packets') return 'pkts';
    return unit.trim();
}

/**
 * Pluralize wholesale packaging units following Indian Kirana conventions.
 * Terms like 'bori', 'pipa', 'dozen' do not take an 's' in Hindi/English kirana chits.
 */
export function formatWholesaleUnit(unit: string, qty: number): string {
    if (!unit) return '';
    const trimmed = unit.trim();
    if (qty <= 1) return trimmed;

    // Never append an ASCII 's' to Hindi/Devanagari or other non-ASCII units.
    if (/[^\x00-\x7F]/.test(trimmed)) return trimmed;

    const lower = trimmed.toLowerCase();
    // Indian Kirana terms that remain invariable in plural count
    if (lower === 'bori') return 'bori';
    if (lower === 'pipa') return 'pipa';
    if (lower === 'dozen') return 'dozen';

    // Specific plurals
    if (lower === 'peti') return 'petis';
    if (lower === 'box') return 'boxes';
    if (lower === 'carton') return 'cartons';
    if (lower === 'tray') return 'trays';
    if (lower === 'crate') return 'crates';
    if (lower === 'packet') return 'packets';
    if (lower === 'pkt') return 'pkts';
    if (lower === 'bag') return 'bags';
    if (lower === 'tin') return 'tins';

    if (lower.endsWith('s')) return trimmed;
    return `${trimmed}s`;
}

/**
 * Resolves or infers wholesale secondary unit and conversion factor.
 */
export function resolveWholesalePackaging(item: Partial<ParchiItem>): WholesalePackaging {
    const rawSec = item.secondary_unit?.trim();
    const factorNum = Number(item.conversion_factor);

    if (rawSec && factorNum > 0) {
        return {
            secondaryUnit: rawSec,
            factor: factorNum,
            baseUnit: formatBaseUnit(item.base_unit ?? item.unit),
        };
    }

    const nameLower = (item.name ?? '').toLowerCase();
    const rawBase = (item.base_unit ?? item.unit ?? 'pcs').trim().toLowerCase();
    const isMassBase = rawBase === 'kg' || rawBase === 'g' || rawBase === 'gm' || rawBase === 'gram';
    const isVolumeBase = rawBase === 'l' || rawBase === 'ltr' || rawBase === 'liter' || rawBase === 'litre' || rawBase === 'ml';
    const isCountBase = rawBase === 'pcs' || rawBase === 'pc' || rawBase === 'pkt' || rawBase === 'pkts'
        || rawBase === 'packet' || rawBase === 'packets' || rawBase === 'm';

    // Weight staples (sugar, rice, atta, daal, flour, etc.). A mass base alone
    // is not enough: vegetables and spices are sold loose by the kg and must
    // not be turned into "4 bori (200 kg)" on a purchase order.
    const isStapleName = /(sugar|rice|daal|dal|chana|wheat|atta|maida|anaj|besan|cheeni|chini|suji|sooji|namak|salt)/i.test(nameLower);
    if (isStapleName && !isCountBase && !isVolumeBase) {
        const factor = (rawBase === 'g' || rawBase === 'gm' || rawBase === 'gram') ? 50000 : 50;
        const baseUnit = (rawBase === 'g' || rawBase === 'gm' || rawBase === 'gram') ? 'g' : 'kg';
        return {
            secondaryUnit: 'bori',
            factor,
            baseUnit,
        };
    }

    // Edible oils & liquid staples
    if (
        isVolumeBase ||
        (!isCountBase && !isMassBase && /(oil|tel|ghee|sarson|refined|mustard|sunflower|doodh|milk)/i.test(nameLower))
    ) {
        const factor = rawBase === 'ml' ? 15000 : 15;
        const baseUnit = rawBase === 'ml' ? 'ml' : 'L';
        return {
            secondaryUnit: 'pipa',
            factor,
            baseUnit,
        };
    }

    // Eggs (never compound FMCG names like "Egg Noodles")
    if (
        !isMassBase &&
        !isVolumeBase &&
        /(egg|anda|ande)/i.test(nameLower) &&
        !/(noodle|noodles|maggi|biscuit|cookie|chips|kurkure)/i.test(nameLower)
    ) {
        return {
            secondaryUnit: 'tray',
            factor: 30,
            baseUnit: 'pcs',
        };
    }

    // Bananas
    if (!isMassBase && !isVolumeBase && /(banana|kela)/i.test(nameLower)) {
        return {
            secondaryUnit: 'dozen',
            factor: 12,
            baseUnit: 'pcs',
        };
    }

    // Packaged FMCG (Maggi, biscuits, soap, shampoo, etc.)
    if (
        rawBase === 'pcs' ||
        rawBase === 'pc' ||
        rawBase === 'pkt' ||
        rawBase === 'pkts' ||
        rawBase === 'packet' ||
        rawBase === 'packets' ||
        /(biscuit|maggi|noodle|noodles|soap|shampoo|paste|colgate|chips|kurkure|parle|oreo|kitkat)/i.test(nameLower)
    ) {
        return {
            secondaryUnit: 'peti',
            factor: 24,
            baseUnit: formatBaseUnit(item.base_unit ?? item.unit),
        };
    }

    // Direct fallback
    const fallbackUnit = formatBaseUnit(item.base_unit ?? item.unit);
    return {
        secondaryUnit: fallbackUnit,
        factor: 1,
        baseUnit: fallbackUnit,
    };
}

/**
 * Calculates suggested wholesale reorder quantities based on buffer, velocity, and deficit.
 */
export function calculateSuggestedReorder(
    item: Partial<ParchiItem>,
    dailyVelocity: number = 0,
    targetDaysCover: number = 7
): SuggestedReorderResult {
    const rawThreshold = Number(item.low_stock_threshold);
    const threshold = Number.isFinite(rawThreshold) && rawThreshold >= 0 ? rawThreshold : 5;
    const currentQty = Number(item.quantity) || 0;
    const velocity = Math.max(0, Number(dailyVelocity) || 0);

    const targetBuffer = Math.max(threshold * 2, velocity * targetDaysCover);
    const deficit = Math.max(1, targetBuffer - currentQty);

    const packaging = resolveWholesalePackaging(item);
    const suggestedSecondaryQty = Math.max(1, Math.ceil(deficit / packaging.factor));
    const calculatedBaseQty = suggestedSecondaryQty * packaging.factor;

    return {
        suggestedSecondaryQty,
        calculatedBaseQty,
        displayUnit: packaging.secondaryUnit,
        factor: packaging.factor,
        baseUnit: packaging.baseUnit,
    };
}

/**
 * Formats date as 'DD MMM' (e.g. '03 Oct').
 */
export function formatParchiDate(date: Date | string = new Date()): string {
    if (typeof date === 'string') return date.trim();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = String(date.getDate()).padStart(2, '0');
    const month = months[date.getMonth()];
    return `${day} ${month}`;
}

/**
 * Formats a single item row in the Parchi chit:
 * e.g. "1. Sugar - 2 bori (100 kg)"
 */
export function formatParchiItemLine(index: number, item: ParchiItem): string {
    const packaging = resolveWholesalePackaging(item);

    const rawQty = item.reorderQuantity ?? item.quantity ?? item.suggestedSecondaryQty ?? 1;
    const secQty = Math.max(1, Number(rawQty) || 1);

    const secUnit = item.displayUnit ?? packaging.secondaryUnit;
    const factor = Number(item.conversion_factor) > 0 ? Number(item.conversion_factor) : packaging.factor;
    const baseUnit = formatBaseUnit(item.base_unit ?? item.unit ?? packaging.baseUnit);

    const baseQty = Number(item.calculatedBaseQty ?? item.base_quantity ?? (secQty * factor));
    const unitLabel = formatWholesaleUnit(secUnit, secQty);

    // If 1:1 base unit and unit names match, display without redundant parentheses
    if (factor === 1 && secUnit.toLowerCase() === baseUnit.toLowerCase()) {
        return `${index}. ${item.name} - ${secQty} ${baseUnit}`;
    }

    return `${index}. ${item.name} - ${secQty} ${unitLabel} (${baseQty} ${baseUnit})`;
}

/**
 * Generates the full WhatsApp Parchi text chit.
 */
export function generateParchiText(
    storeName: string,
    items: ParchiItem[],
    options?: GenerateParchiOptions
): string {
    if (!items || items.length === 0) {
        return '';
    }

    const cleanStoreName = (storeName || '').trim() || DEFAULT_STORE_NAME;
    const dateStr = formatParchiDate(options?.date);

    const lines: string[] = [];
    lines.push(`🛒 *${cleanStoreName} - Order Parchi* (${dateStr})`);

    const contactParts: string[] = [];
    if (options?.address?.trim()) contactParts.push(`📍 ${options.address.trim()}`);
    if (options?.phone?.trim()) contactParts.push(`📞 ${options.phone.trim()}`);
    if (options?.upiId?.trim()) contactParts.push(`💳 UPI: ${options.upiId.trim()}`);
    if (contactParts.length > 0) {
        lines.push(contactParts.join(' | '));
    }

    lines.push(PARCHI_DIVIDER);

    items.forEach((item, index) => {
        lines.push(formatParchiItemLine(index + 1, item));
    });

    lines.push(PARCHI_DIVIDER);
    lines.push(`Total Items: ${items.length}`);

    const note = options?.note !== undefined ? options.note : DEFAULT_PARCHI_NOTE;
    if (note && note.trim()) {
        lines.push(note.trim());
    }

    return lines.join('\n');
}

/**
 * Generates the printable A4 Parchi document (expo-print HTML).
 */
export function generateParchiHtml(
    storeName: string,
    items: ParchiItem[],
    options?: GenerateParchiOptions
): string {
    if (!items || items.length === 0) {
        return '';
    }

    const cleanStoreName = (storeName || '').trim() || DEFAULT_STORE_NAME;
    const dateStr = formatParchiDate(options?.date);
    const note = options?.note !== undefined ? options.note : DEFAULT_PARCHI_NOTE;

    const escapeHtml = (value: unknown) => String(value ?? '').replace(
        /[&<>"']/g,
        (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string)
    );

    const contactParts: string[] = [];
    if (options?.address?.trim()) contactParts.push(escapeHtml(options.address.trim()));
    if (options?.phone?.trim()) contactParts.push(`Ph: ${escapeHtml(options.phone.trim())}`);
    if (options?.upiId?.trim()) contactParts.push(`UPI: ${escapeHtml(options.upiId.trim())}`);

    const rows = items.map((item, index) => {
        const packaging = resolveWholesalePackaging(item);
        const rawQty = item.reorderQuantity ?? item.quantity ?? item.suggestedSecondaryQty ?? 1;
        const secQty = Math.max(1, Number(rawQty) || 1);
        const secUnit = item.displayUnit ?? packaging.secondaryUnit;
        const factor = Number(item.conversion_factor) > 0 ? Number(item.conversion_factor) : packaging.factor;
        const baseQty = Number(item.calculatedBaseQty ?? item.base_quantity ?? (secQty * factor));
        const baseUnit = formatBaseUnit(item.base_unit ?? item.unit ?? packaging.baseUnit);

        return `
            <tr>
                <td>${index + 1}</td>
                <td>${escapeHtml(item.name)}</td>
                <td style="text-align: right;">${secQty} ${escapeHtml(formatWholesaleUnit(secUnit, secQty))}</td>
                <td style="text-align: right;">${baseQty} ${escapeHtml(baseUnit)}</td>
            </tr>
        `;
    }).join('');

    return `
        <html>
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <style>
                    body { font-family: 'Helvetica', sans-serif; padding: 24px; color: #333; }
                    .header { border-bottom: 2px solid #eee; padding-bottom: 16px; margin-bottom: 20px; }
                    .store-name { font-size: 24px; font-weight: bold; }
                    .meta { color: #666; font-size: 13px; margin-top: 4px; }
                    table { width: 100%; border-collapse: collapse; font-size: 14px; }
                    th { text-align: left; padding: 10px; background: #f8f9fa; border-bottom: 2px solid #ddd; color: #666; }
                    td { padding: 10px; border-bottom: 1px solid #eee; }
                    tr:nth-child(even) { background-color: #fafafa; }
                    .note { margin-top: 24px; padding: 12px; background: #fff8e1; border-radius: 6px; font-size: 14px; }
                    .footer { margin-top: 28px; color: #999; font-size: 11px; text-align: center; }
                </style>
            </head>
            <body>
                <div class="header">
                    <div class="store-name">${escapeHtml(cleanStoreName)} — Order Parchi</div>
                    <div class="meta">${escapeHtml(dateStr)}${contactParts.length > 0 ? ` • ${contactParts.join(' • ')}` : ''}</div>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Item</th>
                            <th style="text-align: right;">Order</th>
                            <th style="text-align: right;">Base Qty</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>
                ${note && note.trim() ? `<div class="note">${escapeHtml(note.trim())}</div>` : ''}
                <div class="footer">Total Items: ${items.length} • Generated by Vocal Kaka</div>
            </body>
        </html>
    `;
}

/**
 * Multi-tier WhatsApp sharing pipeline:
 * Tier 1: WhatsApp Native App Deep Link (`whatsapp://send?text=...`)
 * Tier 2: WhatsApp Web Universal Link (`https://wa.me/?text=...`) on Web platform
 * Tier 3: Expo File Sharing (exports as temporary text file)
 * Tier 4: Native Share Sheet (`Share.share(...)`)
 * Tier 5: Clipboard Copy Fallback
 */
export async function shareParchiOnWhatsApp(parchiText: string): Promise<ParchiShareResult> {
    if (!parchiText || !parchiText.trim()) {
        Alert.alert('No Items Selected', 'Please select at least one item to generate a Parchi.');
        return { success: false, method: 'none', error: 'Empty text' };
    }

    const encoded = encodeURIComponent(parchiText);
    const nativeWhatsAppUrl = `whatsapp://send?text=${encoded}`;
    const webWhatsAppUrl = `https://wa.me/?text=${encoded}`;

    // 1. Try WhatsApp native app
    try {
        const canOpen = await Linking.canOpenURL(nativeWhatsAppUrl);
        if (canOpen) {
            await Linking.openURL(nativeWhatsAppUrl);
            return { success: true, method: 'whatsapp_deeplink' };
        }
    } catch {
        // Can open check failed or rejected
    }

    // Direct open attempt (helps on Android 11+ with package visibility restrictions)
    try {
        await Linking.openURL(nativeWhatsAppUrl);
        return { success: true, method: 'whatsapp_deeplink' };
    } catch {
        // WhatsApp not installed
    }

    // 2. On Web, open WhatsApp Web
    if (Platform.OS === 'web') {
        try {
            await Linking.openURL(webWhatsAppUrl);
            return { success: true, method: 'whatsapp_web' };
        } catch {
            // Web open failed
        }
    }

    // 3. Fallback to expo-sharing if available
    try {
        const isSharingAvailable = await Sharing.isAvailableAsync();
        if (isSharingAvailable) {
            const file = new File(Paths.cache, 'Order_Parchi.txt');
            file.write(parchiText);
            await Sharing.shareAsync(file.uri, {
                mimeType: 'text/plain',
                dialogTitle: 'Share Order Parchi',
            });
            return { success: true, method: 'expo_sharing' };
        }
    } catch {
        // expo-sharing failed
    }

    // 4. Fallback to system Share sheet
    try {
        await Share.share({
            message: parchiText,
            title: 'Order Parchi',
        });
        return { success: true, method: 'native_share' };
    } catch {
        // Native share failed
    }

    // 5. Ultimate fallback: Clipboard (only report success when it copied)
    try {
        const copied = await copyParchiToClipboard(parchiText);
        if (!copied) {
            return { success: false, method: 'clipboard', error: 'Clipboard unavailable' };
        }
        Alert.alert(
            'Copied to Clipboard',
            'WhatsApp could not be launched directly. The Parchi has been copied to your clipboard—paste it in your supplier chat!'
        );
        return { success: true, method: 'clipboard' };
    } catch (err: unknown) {
        return { success: false, method: 'clipboard', error: getErrorMessage(err) };
    }
}

/**
 * Copies Parchi text to clipboard with cross-platform fallback.
 */
export async function copyParchiToClipboard(text: string): Promise<boolean> {
    try {
        await Clipboard.setStringAsync(text);
        return true;
    } catch {
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch {
                return false;
            }
        }
        return false;
    }
}
