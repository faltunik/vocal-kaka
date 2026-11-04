import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { AddProductModal } from '@/components/inventory/AddProductModal';
import { container } from '@/services/Container';
import { Alert } from 'react-native';

// Mock vector icons to avoid font loading issues in tests
jest.mock('@expo/vector-icons', () => ({
    Ionicons: () => null,
}));

describe('AddProductModal', () => {
    const mockOnClose = jest.fn();
    const mockOnSuccess = jest.fn();
    let alertSpy: jest.SpyInstance;
    let createProductSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
        createProductSpy = jest.spyOn(container.inventoryService, 'createProduct').mockResolvedValue({
            id: 'prod-123',
            user_id: 'test-user',
            name: 'Desi Khand',
            quantity: 100,
            unit: 'kg',
            base_unit: 'kg',
        });
    });

    afterEach(() => {
        alertSpy.mockRestore();
        createProductSpy.mockRestore();
    });

    it('renders all form fields when visible', () => {
        const { getByTestId, getByText } = render(
            <AddProductModal
                visible={true}
                onClose={mockOnClose}
                onSuccess={mockOnSuccess}
                userId="test-user"
            />
        );

        expect(getByText('Add Product / Commodity')).toBeTruthy();
        expect(getByTestId('add-product-name-input')).toBeTruthy();
        expect(getByTestId('add-product-alias-input')).toBeTruthy();
        expect(getByTestId('category-chip-STAPLES')).toBeTruthy();
        expect(getByTestId('category-chip-FMCG')).toBeTruthy();
        expect(getByTestId('category-chip-DAIRY_BAKERY')).toBeTruthy();
        expect(getByTestId('category-chip-SPICES')).toBeTruthy();
        expect(getByTestId('unit-chip-kg')).toBeTruthy();
        expect(getByTestId('unit-chip-l')).toBeTruthy();
        expect(getByTestId('unit-chip-pcs')).toBeTruthy();
        expect(getByTestId('unit-chip-m')).toBeTruthy();
        expect(getByTestId('add-product-secondary-unit-input')).toBeTruthy();
        expect(getByTestId('add-product-conversion-factor-input')).toBeTruthy();
        expect(getByTestId('add-product-cost-price-input')).toBeTruthy();
        expect(getByTestId('add-product-selling-price-input')).toBeTruthy();
        expect(getByTestId('add-product-initial-stock-input')).toBeTruthy();
        expect(getByTestId('add-product-threshold-input')).toBeTruthy();
        expect(getByTestId('add-product-submit-button')).toBeTruthy();
    });

    it('validates that product name is required before saving', async () => {
        const { getByTestId, getByText } = render(
            <AddProductModal
                visible={true}
                onClose={mockOnClose}
                onSuccess={mockOnSuccess}
                userId="test-user"
            />
        );

        // Name is left empty
        const submitBtn = getByTestId('add-product-submit-button');
        fireEvent.press(submitBtn);

        await waitFor(() => {
            expect(getByText('Product name is required')).toBeTruthy();
        });

        expect(createProductSpy).not.toHaveBeenCalled();
        expect(mockOnSuccess).not.toHaveBeenCalled();
        expect(mockOnClose).not.toHaveBeenCalled();
    });

    it('successfully creates product with all attributes and triggers onSuccess and onClose', async () => {
        const { getByTestId } = render(
            <AddProductModal
                visible={true}
                onClose={mockOnClose}
                onSuccess={mockOnSuccess}
                userId="test-user-123"
            />
        );

        // Fill in required name
        fireEvent.changeText(getByTestId('add-product-name-input'), 'Desi Khand');

        // Fill in Hindi / Vernacular alias
        fireEvent.changeText(getByTestId('add-product-alias-input'), 'कच्ची खांड, Brown Sugar');

        // Select Category: Staples
        fireEvent.press(getByTestId('category-chip-STAPLES'));

        // Select Base Unit: kg
        fireEvent.press(getByTestId('unit-chip-kg'));

        // Wholesale secondary packaging
        fireEvent.changeText(getByTestId('add-product-secondary-unit-input'), 'bori');
        fireEvent.changeText(getByTestId('add-product-conversion-factor-input'), '50');

        // Rates
        fireEvent.changeText(getByTestId('add-product-cost-price-input'), '42');
        fireEvent.changeText(getByTestId('add-product-selling-price-input'), '48');

        // Stock & Threshold
        fireEvent.changeText(getByTestId('add-product-threshold-input'), '20');
        fireEvent.changeText(getByTestId('add-product-initial-stock-input'), '100');

        // Submit form
        fireEvent.press(getByTestId('add-product-submit-button'));

        await waitFor(() => {
            expect(createProductSpy).toHaveBeenCalledTimes(1);
        });

        expect(createProductSpy).toHaveBeenCalledWith('test-user-123', {
            name: 'Desi Khand',
            category: 'STAPLES',
            aliases: ['कच्ची खांड', 'Brown Sugar'],
            unit: 'kg',
            baseUnit: 'kg',
            secondaryUnit: 'bori',
            conversionFactor: 50,
            costPrice: 42,
            sellingPrice: 48,
            lowStockThreshold: 20,
            quantity: 100,
        });

        expect(mockOnSuccess).toHaveBeenCalledTimes(1);
        expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('handles failure when product already exists or service returns null', async () => {
        createProductSpy.mockResolvedValueOnce(null);

        const { getByTestId } = render(
            <AddProductModal
                visible={true}
                onClose={mockOnClose}
                onSuccess={mockOnSuccess}
                userId="test-user-123"
            />
        );

        fireEvent.changeText(getByTestId('add-product-name-input'), 'Existing Item');
        fireEvent.press(getByTestId('add-product-submit-button'));

        await waitFor(() => {
            expect(createProductSpy).toHaveBeenCalledTimes(1);
        });

        expect(alertSpy).toHaveBeenCalledWith('Failed', 'Could not create product. It may already exist.');
        expect(mockOnSuccess).not.toHaveBeenCalled();
    });
});
