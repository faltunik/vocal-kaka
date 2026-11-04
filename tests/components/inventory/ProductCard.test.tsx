import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ProductCard } from '@/components/inventory/ProductCard';
import { InventoryItem } from '@/core/interfaces/IInventoryRepository';

// Mock vector icons
jest.mock('@expo/vector-icons', () => ({
    Ionicons: () => null,
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

describe('ProductCard', () => {
    const mockOnPress = jest.fn();

    const mockItem: InventoryItem = {
        id: 'sugar-1',
        user_id: 'user-1',
        name: 'Madhur Sugar',
        quantity: 50,
        unit: 'kg',
        base_unit: 'kg',
        selling_price: 44,
        last_purchase_price: 38,
        low_stock_threshold: 10,
        secondary_unit: 'bori',
        conversion_factor: 50,
        aliases: ['चीनी', 'Cheeni'],
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockStaffMode = false;
    });

    it('hides catalog editing affordances for staff accounts', () => {
        mockStaffMode = true;
        const { queryByTestId, queryByText } = render(
            <ProductCard item={mockItem} onPress={mockOnPress} />
        );

        expect(queryByTestId('edit-button-sugar-1')).toBeNull();
        expect(queryByText('Edit')).toBeNull();

        fireEvent.press(queryByTestId('product-card-sugar-1')!);
        expect(mockOnPress).not.toHaveBeenCalled();
    });

    it('renders item details, pricing, packaging and explicit Edit button', () => {
        const { getByText, getByTestId } = render(
            <ProductCard item={mockItem} onPress={mockOnPress} />
        );

        expect(getByText('Madhur Sugar')).toBeTruthy();
        expect(getByText('(चीनी, Cheeni)')).toBeTruthy();
        expect(getByText('₹44 / kg')).toBeTruthy();
        expect(getByText(/Cost: ₹38 \/ kg/)).toBeTruthy();
        expect(getByText('1 bori = 50 kg')).toBeTruthy();
        expect(getByText('In Stock')).toBeTruthy();

        // Check explicit Edit button
        const editButton = getByTestId('edit-button-sugar-1');
        expect(editButton).toBeTruthy();
        expect(getByText('Edit')).toBeTruthy();
    });

    it('triggers onPress when tapping the explicit Edit button', () => {
        const { getByTestId } = render(
            <ProductCard item={mockItem} onPress={mockOnPress} />
        );

        fireEvent.press(getByTestId('edit-button-sugar-1'));
        expect(mockOnPress).toHaveBeenCalledTimes(1);
    });

    it('triggers onPress when tapping anywhere on the card', () => {
        const { getByTestId } = render(
            <ProductCard item={mockItem} onPress={mockOnPress} />
        );

        fireEvent.press(getByTestId('product-card-sugar-1'));
        expect(mockOnPress).toHaveBeenCalledTimes(1);
    });

    it('displays Low Stock badge when stock is below threshold', () => {
        const lowStockItem: InventoryItem = {
            ...mockItem,
            quantity: 5,
            low_stock_threshold: 10,
        };

        const { getByText } = render(
            <ProductCard item={lowStockItem} onPress={mockOnPress} />
        );

        expect(getByText('Low Stock')).toBeTruthy();
    });

    it('displays Out of Stock badge when stock is zero or negative', () => {
        const outOfStockItem: InventoryItem = {
            ...mockItem,
            quantity: 0,
        };

        const { getByText } = render(
            <ProductCard item={outOfStockItem} onPress={mockOnPress} />
        );

        expect(getByText('Out of Stock')).toBeTruthy();
    });

    it('shows a Sold Before Inward warning and delivery action for negative stock', () => {
        const negativeItem: InventoryItem = {
            ...mockItem,
            quantity: -5,
        };

        const { getByText, getByTestId } = render(
            <ProductCard item={negativeItem} onPress={mockOnPress} />
        );

        expect(getByText('⚠️ Sold Before Inward: 5 kg')).toBeTruthy();
        expect(getByText('Record Delivery Bill')).toBeTruthy();

        fireEvent.press(getByTestId('record-delivery-sugar-1'));
        expect(mockOnPress).toHaveBeenCalledTimes(1);
    });
});
