import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import LowStockScreen from '@/app/low-stock';
import { Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

// Mock dependencies
const mockRefetch = jest.fn();
const mockToggleSelect = jest.fn();
const mockSelectAll = jest.fn();
const mockDeselectAll = jest.fn();
const mockUpdateQuantity = jest.fn();

let mockSelectedIds = new Set(['item-1', 'item-2']);
let mockReorderQuantities: Record<string, number> = { 'item-1': 2, 'item-2': 1 };

const mockItems = [
    {
        id: 'item-1',
        name: 'Sugar (Loose Khandsari)',
        quantity: 0,
        low_stock_threshold: 10,
        base_unit: 'kg',
        secondary_unit: 'bori',
        conversion_factor: 50,
        isOutOfStock: true,
        dailyVelocity: 14,
        suggestedSecondaryQty: 2,
        calculatedBaseQty: 100,
        displayUnit: 'bori',
    },
    {
        id: 'item-2',
        name: 'Fortune Mustard Oil',
        quantity: 2,
        low_stock_threshold: 5,
        base_unit: 'L',
        secondary_unit: 'pipa',
        conversion_factor: 15,
        isOutOfStock: false,
        dailyVelocity: 2,
        suggestedSecondaryQty: 1,
        calculatedBaseQty: 15,
        displayUnit: 'pipa',
    },
];

jest.mock('@/hooks/useLowStock', () => ({
    useLowStock: () => ({
        items: mockItems,
        count: mockItems.length,
        outOfStockCount: 1,
        lowStockCount: 1,
        loading: false,
        error: null,
        refetch: mockRefetch,
        selectedIds: mockSelectedIds,
        toggleSelect: mockToggleSelect,
        selectAll: mockSelectAll,
        deselectAll: mockDeselectAll,
        reorderQuantities: mockReorderQuantities,
        updateQuantity: mockUpdateQuantity,
        setQuantity: jest.fn(),
    }),
}));

jest.mock('@/services/AuthContext', () => ({
    useAuth: () => ({
        user: {
            id: 'kirana-user-1',
            email: 'mukesh@kirana.in',
            user_metadata: { store_name: 'Mukesh Kirana Store' },
        },
    }),
}));

jest.mock('@/services/StoreContext', () => ({
    useStore: () => ({ currentStore: null }),
}));

jest.mock('expo-router', () => ({
    useRouter: () => ({
        back: jest.fn(),
        push: jest.fn(),
    }),
}));

jest.mock('expo-clipboard', () => ({
    setStringAsync: jest.fn().mockResolvedValue(true),
}));

describe('LowStockScreen - Interactive Reorder Parchi', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSelectedIds = new Set(['item-1', 'item-2']);
        mockReorderQuantities = { 'item-1': 2, 'item-2': 1 };
    });

    it('renders low stock items with wholesale suggestions and badges', () => {
        const { getByText } = render(<LowStockScreen />);

        expect(getByText('Sugar (Loose Khandsari)')).toBeTruthy();
        expect(getByText('OUT OF STOCK')).toBeTruthy();
        expect(getByText('2 bori')).toBeTruthy();
        expect(getByText('= 100 kg')).toBeTruthy();

        expect(getByText('Fortune Mustard Oil')).toBeTruthy();
        expect(getByText('LOW STOCK')).toBeTruthy();
        expect(getByText('1 pipa')).toBeTruthy();
        expect(getByText('= 15 L')).toBeTruthy();
    });

    it('displays summary count and action buttons in bottom bar', () => {
        const { getByText } = render(<LowStockScreen />);

        expect(getByText('2 of 2 items in Parchi')).toBeTruthy();
        expect(getByText('📲 Share Parchi on WhatsApp (2)')).toBeTruthy();
        expect(getByText('📋 Copy Parchi Text')).toBeTruthy();
    });

    it('toggles selection when tapping checkbox', () => {
        const { getByText } = render(<LowStockScreen />);

        fireEvent.press(getByText('Sugar (Loose Khandsari)'));
        expect(mockToggleSelect).toHaveBeenCalledWith('item-1');
    });

    it('triggers stepper increment and decrement', () => {
        const { getAllByLabelText } = render(<LowStockScreen />);

        const increaseButtons = getAllByLabelText('Increase quantity');
        fireEvent.press(increaseButtons[0]);
        expect(mockUpdateQuantity).toHaveBeenCalledWith('item-1', 1);

        const decreaseButtons = getAllByLabelText('Decrease quantity');
        fireEvent.press(decreaseButtons[0]);
        expect(mockUpdateQuantity).toHaveBeenCalledWith('item-1', -1);
    });

    it('shares parchi on WhatsApp when share button is tapped', async () => {
        const canOpenSpy = jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
        const openSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as any);

        const { getByText } = render(<LowStockScreen />);

        fireEvent.press(getByText('📲 Share Parchi on WhatsApp (2)'));

        await waitFor(() => {
            expect(openSpy).toHaveBeenCalledWith(
                expect.stringContaining('whatsapp://send?text=')
            );
        });

        canOpenSpy.mockRestore();
        openSpy.mockRestore();
    });

    it('copies parchi to clipboard when copy button is tapped', async () => {
        const { getByText } = render(<LowStockScreen />);

        fireEvent.press(getByText('📋 Copy Parchi Text'));

        await waitFor(() => {
            expect(Clipboard.setStringAsync).toHaveBeenCalledWith(
                expect.stringContaining('🛒 *Mukesh Kirana Store - Order Parchi*')
            );
        });
    });

    it('opens preview modal when tapping "Preview Chit"', async () => {
        const { getByText } = render(<LowStockScreen />);

        fireEvent.press(getByText('👁️ Preview Chit'));

        await waitFor(() => {
            expect(getByText('WhatsApp Parchi Preview')).toBeTruthy();
            expect(getByText('Closing Delivery Note / Instructions:')).toBeTruthy();
        });
    });

    it('exports the Parchi as a PDF through expo-print and sharing', async () => {
        const { getByText } = render(<LowStockScreen />);

        fireEvent.press(getByText('🧾 Share PDF Parchi'));

        await waitFor(() => {
            expect(Print.printToFileAsync).toHaveBeenCalledWith({
                html: expect.stringContaining('Mukesh Kirana Store'),
            });
        });
        expect(Sharing.shareAsync).toHaveBeenCalledWith(
            'file:///mock/print.pdf',
            expect.objectContaining({ mimeType: 'application/pdf' })
        );
    });
});
