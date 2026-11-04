import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import InventoryScreen from '@/app/inventory';
import { useInventory } from '@/hooks/useInventory';
import { useRouter } from 'expo-router';
import { InventoryItem } from '@/core/interfaces/IInventoryRepository';

// Mock dependencies
jest.mock('@/hooks/useInventory');
jest.mock('@expo/vector-icons', () => ({
    Ionicons: () => null,
}));
jest.mock('@/components/ui/BottomTabBar', () => ({
    BottomTabBar: () => null,
}));

let mockStaffMode = false;

jest.mock('@/services/PrivacyContext', () => ({
    usePrivacy: () => ({
        isMasked: false,
        toggleMask: jest.fn(),
        isStaffMode: mockStaffMode,
        hasPin: false,
        hasPinSet: false,
        enableStaffMode: jest.fn(),
        disableStaffMode: jest.fn(),
        setPin: jest.fn(),
        setOwnerPin: jest.fn(),
        resetPinWithAuth: jest.fn(),
        failedAttempts: 0,
        lockedUntil: null,
    }),
}));

const mockItems: InventoryItem[] = [
    {
        id: 'item-1',
        user_id: 'user-1',
        name: 'Toor Dal',
        quantity: 50,
        unit: 'kg',
        base_unit: 'kg',
        category: 'Staples',
        aliases: ['अरहर दाल'],
        selling_price: 150,
        last_purchase_price: 125,
        low_stock_threshold: 10,
        secondary_unit: 'bori',
        conversion_factor: 50,
    },
    {
        id: 'item-2',
        user_id: 'user-1',
        name: 'Maggi Noodles',
        quantity: 4,
        unit: 'pcs',
        base_unit: 'pcs',
        category: 'FMCG',
        barcode: '8901058852493',
        selling_price: 14,
        last_purchase_price: 12,
        low_stock_threshold: 10,
    },
    {
        id: 'item-3',
        user_id: 'user-1',
        name: 'Amul Gold Milk',
        quantity: 20,
        unit: 'l',
        base_unit: 'l',
        category: 'Dairy',
        selling_price: 66,
        last_purchase_price: 60,
        low_stock_threshold: 5,
    },
    {
        id: 'item-4',
        user_id: 'user-1',
        name: 'Jeera Powder',
        quantity: 2,
        unit: 'kg',
        base_unit: 'kg',
        category: 'Spices',
        aliases: ['जीरा'],
        selling_price: 400,
        last_purchase_price: 320,
        low_stock_threshold: 5,
    },
];

describe('InventoryScreen', () => {
    const mockRefetch = jest.fn();
    const mockRouter = {
        navigate: jest.fn(),
        push: jest.fn(),
        replace: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockStaffMode = false;
        (useRouter as jest.Mock).mockReturnValue(mockRouter);
        (useInventory as jest.Mock).mockReturnValue({
            items: mockItems,
            loading: false,
            error: null,
            refetch: mockRefetch,
        });
    });

    it('renders inventory header with count and add button', () => {
        const { getByText, getByTestId } = render(<InventoryScreen />);

        expect(getByText('Inventory')).toBeTruthy();
        expect(getByText('4 Products in catalog')).toBeTruthy();
        expect(getByTestId('add-product-header-button')).toBeTruthy();
        expect(getByTestId('scan-product-header-button')).toBeTruthy();
    });

    it('displays selling price, cost price, and base/secondary unit formatting on item cards', () => {
        const { getByText, getAllByText } = render(<InventoryScreen />);

        // Item 1: Toor Dal
        expect(getByText('Toor Dal')).toBeTruthy();
        expect(getByText('(अरहर दाल)')).toBeTruthy();
        expect(getByText('₹150 / kg')).toBeTruthy();
        expect(getByText(/Cost: ₹125 \/ kg/)).toBeTruthy();
        expect(getByText('1 bori = 50 kg')).toBeTruthy();
        expect(getByText('50 kg')).toBeTruthy();

        // Item 2: Maggi (Low stock: 4 <= 10)
        expect(getByText('Maggi Noodles')).toBeTruthy();
        expect(getByText('₹14 / pcs')).toBeTruthy();
        expect(getByText(/Cost: ₹12 \/ pcs/)).toBeTruthy();
        expect(getAllByText('Low Stock').length).toBeGreaterThanOrEqual(1);
    });

    it('filters inventory by category chips', async () => {
        const { getByTestId, queryByText, getByText } = render(<InventoryScreen />);

        // Initially 'All' shows all 4 products
        expect(getByText('Toor Dal')).toBeTruthy();
        expect(getByText('Maggi Noodles')).toBeTruthy();
        expect(getByText('Amul Gold Milk')).toBeTruthy();
        expect(getByText('Jeera Powder')).toBeTruthy();

        // Filter by 'Dairy'
        fireEvent.press(getByTestId('category-filter-Dairy'));
        expect(getByText('Amul Gold Milk')).toBeTruthy();
        expect(queryByText('Toor Dal')).toBeNull();
        expect(queryByText('Maggi Noodles')).toBeNull();
        expect(queryByText('Jeera Powder')).toBeNull();

        // Filter by 'Spices'
        fireEvent.press(getByTestId('category-filter-Spices'));
        expect(getByText('Jeera Powder')).toBeTruthy();
        expect(queryByText('Amul Gold Milk')).toBeNull();

        // Filter by 'Staples'
        fireEvent.press(getByTestId('category-filter-Staples'));
        expect(getByText('Toor Dal')).toBeTruthy();
        expect(queryByText('Jeera Powder')).toBeNull();

        // Switch back to 'All'
        fireEvent.press(getByTestId('category-filter-All'));
        expect(getByText('Toor Dal')).toBeTruthy();
        expect(getByText('Maggi Noodles')).toBeTruthy();
    });

    it('opens AddProductModal when tapping + button in header', async () => {
        const { getByTestId, getByText, queryByText } = render(<InventoryScreen />);

        // Initially modal is not visible (or doesn't show title)
        expect(queryByText('Add Product')).toBeNull();

        fireEvent.press(getByTestId('add-product-header-button'));

        await waitFor(() => {
            expect(getByText('Add Product')).toBeTruthy();
        });
    });

    it('opens EditProductModal when tapping an item card', async () => {
        const { getByTestId, getByText, queryByText } = render(<InventoryScreen />);

        expect(queryByText('Edit: Toor Dal')).toBeNull();

        // Tap Toor Dal card
        fireEvent.press(getByTestId('product-card-item-1'));

        await waitFor(() => {
            expect(getByText('Edit: Toor Dal')).toBeTruthy();
        });
    });

    it('opens EditProductModal when tapping the explicit Edit button on an item card', async () => {
        const { getByTestId, getByText, queryByText } = render(<InventoryScreen />);

        expect(queryByText('Edit: Maggi Noodles')).toBeNull();

        // Tap explicit Edit button on Maggi card
        fireEvent.press(getByTestId('edit-button-item-2'));

        await waitFor(() => {
            expect(getByText('Edit: Maggi Noodles')).toBeTruthy();
        });
    });

    it('hides catalog authoring affordances for staff accounts', () => {
        mockStaffMode = true;
        const { queryByTestId, queryByText } = render(<InventoryScreen />);

        expect(queryByTestId('add-product-header-button')).toBeNull();
        expect(queryByTestId('edit-button-item-2')).toBeNull();

        // Tapping a card must not open the cost/margin editor
        fireEvent.press(queryByTestId('product-card-item-1')!);
        expect(queryByText('Edit: Toor Dal')).toBeNull();
    });

    it('filters by search text including vernacular aliases', () => {
        const { getByTestId, getByText, queryByText } = render(<InventoryScreen />);

        // Search by Hindi alias "अरहर"
        fireEvent.changeText(getByTestId('inventory-search-input'), 'अरहर');

        expect(getByText('Toor Dal')).toBeTruthy();
        expect(queryByText('Maggi Noodles')).toBeNull();
        expect(queryByText('Amul Gold Milk')).toBeNull();
        expect(queryByText('Jeera Powder')).toBeNull();
    });
});
