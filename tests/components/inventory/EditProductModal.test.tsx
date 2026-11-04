import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import fs from 'fs';
import path from 'path';
import { EditProductModal } from '@/components/inventory/EditProductModal';
import { container } from '@/services/Container';
import { InventoryItem } from '@/core/interfaces/IInventoryRepository';
import { Alert } from 'react-native';

// Mock vector icons to avoid font loading issues
jest.mock('@expo/vector-icons', () => ({
    Ionicons: () => null,
}));

describe('EditProductModal', () => {
    const mockOnClose = jest.fn();
    const mockOnSuccess = jest.fn();
    let alertSpy: jest.SpyInstance;
    let updateProductSpy: jest.SpyInstance;

    const testItem: InventoryItem = {
        id: 'item-toor-dal',
        user_id: 'user-123',
        name: 'Toor Dal',
        quantity: 50,
        unit: 'kg',
        base_unit: 'kg',
        selling_price: 150,
        last_purchase_price: 125,
        low_stock_threshold: 10,
        secondary_unit: 'bori',
        conversion_factor: 50,
    };

    beforeEach(() => {
        jest.clearAllMocks();
        alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
        updateProductSpy = jest.spyOn(container.inventoryService, 'updateProduct').mockResolvedValue(true);
    });

    afterEach(() => {
        alertSpy.mockRestore();
        updateProductSpy.mockRestore();
    });

    it('renders with existing product values and calculates gross margin', () => {
        const { getByTestId, getByText } = render(
            <EditProductModal
                visible={true}
                item={testItem}
                onClose={mockOnClose}
                onSuccess={mockOnSuccess}
                userId="user-123"
            />
        );

        expect(getByText('Edit: Toor Dal')).toBeTruthy();
        expect(getByTestId('edit-product-selling-price-input').props.value).toBe('150');

        fireEvent.press(getByTestId('edit-product-advanced-toggle'));
        expect(getByTestId('edit-product-cost-price-input').props.value).toBe('125');
        expect(getByTestId('edit-product-threshold-input').props.value).toBe('10');
        expect(getByTestId('edit-product-secondary-unit-input').props.value).toBe('bori');
        expect(getByTestId('edit-product-conversion-factor-input').props.value).toBe('50');

        // Margin: 150 - 125 = 25 / 125 = 20%
        expect(getByText(/Gross Margin: ₹25\.00 \/ kg \(\+20%\)/)).toBeTruthy();
    });

    it('updates product rates successfully and triggers onSuccess and onClose', async () => {
        const { getByTestId } = render(
            <EditProductModal
                visible={true}
                item={testItem}
                onClose={mockOnClose}
                onSuccess={mockOnSuccess}
                userId="user-123"
            />
        );

        // Update selling price and cost price
        fireEvent.press(getByTestId('edit-product-advanced-toggle'));
        fireEvent.changeText(getByTestId('edit-product-selling-price-input'), '160');
        fireEvent.changeText(getByTestId('edit-product-cost-price-input'), '130');
        fireEvent.changeText(getByTestId('edit-product-threshold-input'), '15');

        fireEvent.press(getByTestId('edit-product-save-button'));

        await waitFor(() => {
            expect(updateProductSpy).toHaveBeenCalledTimes(1);
        });

        expect(updateProductSpy).toHaveBeenCalledWith('user-123', 'item-toor-dal', {
            selling_price: 160,
            last_purchase_price: 130,
            low_stock_threshold: 15,
            secondary_unit: 'bori',
            conversion_factor: 50,
        });

        expect(mockOnSuccess).toHaveBeenCalledTimes(1);
        expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('displays negative margin warning when selling price is lower than cost price', () => {
        const { getByTestId, getByText } = render(
            <EditProductModal
                visible={true}
                item={testItem}
                onClose={mockOnClose}
                onSuccess={mockOnSuccess}
                userId="user-123"
            />
        );

        // Sell for 100, cost 125
        fireEvent.press(getByTestId('edit-product-advanced-toggle'));
        fireEvent.changeText(getByTestId('edit-product-selling-price-input'), '100');

        expect(getByText(/Warning: Negative Margin/)).toBeTruthy();
    });

    it('updates product name, category, and aliases when changed', async () => {
        const { getByTestId } = render(
            <EditProductModal
                visible={true}
                item={testItem}
                onClose={mockOnClose}
                onSuccess={mockOnSuccess}
                userId="user-123"
            />
        );

        fireEvent.changeText(getByTestId('edit-product-name-input'), 'Premium Toor Dal');
        fireEvent.press(getByTestId('edit-product-advanced-toggle'));
        fireEvent.changeText(getByTestId('edit-product-aliases-input'), 'अरहर दाल, Yellow Dal');
        fireEvent.press(getByTestId('edit-category-chip-STAPLES'));

        fireEvent.press(getByTestId('edit-product-save-button'));

        await waitFor(() => {
            expect(updateProductSpy).toHaveBeenCalledTimes(1);
        });

        expect(updateProductSpy).toHaveBeenCalledWith(
            'user-123',
            'item-toor-dal',
            expect.objectContaining({
                name: 'Premium Toor Dal',
                category: 'STAPLES',
                aliases: ['अरहर दाल', 'Yellow Dal'],
            })
        );
    });

    it('calculates physical stock delta and delegates reconciliation to InventoryService', async () => {
        const auditStockSpy = jest.spyOn(container.inventoryService, 'auditStock').mockResolvedValue(true);

        const { getByTestId, getByText } = render(
            <EditProductModal
                visible={true}
                item={testItem} // quantity is 50
                onClose={mockOnClose}
                onSuccess={mockOnSuccess}
                userId="user-123"
            />
        );

        // Adjust physical stock from 50 to 45 (-5 kg shrinkage)
        fireEvent.changeText(getByTestId('edit-product-stock-input'), '45');

        expect(getByText(/Stock Adjustment: -5 kg/)).toBeTruthy();

        fireEvent.press(getByTestId('edit-product-save-button'));

        await waitFor(() => {
            expect(auditStockSpy).toHaveBeenCalledWith('user-123', 'item-toor-dal', 45);
        });

        auditStockSpy.mockRestore();
    });

    it('does not record a stock adjustment when the catalog update fails', async () => {
        updateProductSpy.mockResolvedValue(false);
        const auditStockSpy = jest.spyOn(container.inventoryService, 'auditStock').mockResolvedValue(true);

        const { getByTestId } = render(
            <EditProductModal
                visible={true}
                item={testItem}
                onClose={mockOnClose}
                onSuccess={mockOnSuccess}
                userId="user-123"
            />
        );

        fireEvent.changeText(getByTestId('edit-product-stock-input'), '45');
        fireEvent.press(getByTestId('edit-product-save-button'));

        await waitFor(() => {
            expect(alertSpy).toHaveBeenCalledWith('Update Failed', expect.any(String));
        });
        expect(auditStockSpy).not.toHaveBeenCalled();

        auditStockSpy.mockRestore();
    });

    it('rejects invalid numeric input without writing anything', async () => {
        const auditStockSpy = jest.spyOn(container.inventoryService, 'auditStock').mockResolvedValue(true);

        const { getByTestId } = render(
            <EditProductModal
                visible={true}
                item={testItem}
                onClose={mockOnClose}
                onSuccess={mockOnSuccess}
                userId="user-123"
            />
        );

        fireEvent.changeText(getByTestId('edit-product-selling-price-input'), '12abc');
        fireEvent.press(getByTestId('edit-product-save-button'));

        await waitFor(() => {
            expect(alertSpy).toHaveBeenCalledWith('Invalid value', expect.any(String));
        });
        expect(updateProductSpy).not.toHaveBeenCalled();
        expect(auditStockSpy).not.toHaveBeenCalled();

        auditStockSpy.mockRestore();
    });

    it('deletes product from catalog when delete button is pressed and confirmed', async () => {
        const deleteProductSpy = jest.spyOn(container.inventoryService, 'deleteProduct').mockResolvedValue(true);

        const { getByTestId } = render(
            <EditProductModal
                visible={true}
                item={testItem}
                onClose={mockOnClose}
                onSuccess={mockOnSuccess}
                userId="user-123"
            />
        );

        fireEvent.press(getByTestId('edit-product-delete-button'));

        expect(alertSpy).toHaveBeenCalledWith(
            'Delete Product?',
            expect.stringContaining('Are you sure you want to delete "Toor Dal"?'),
            expect.any(Array)
        );

        // Simulate confirming delete in the alert
        const alertButtons = alertSpy.mock.calls[0][2];
        const deleteButton = alertButtons.find((b: any) => b.text === 'Delete');
        await waitFor(async () => {
            await deleteButton.onPress();
        });

        await waitFor(() => {
            expect(deleteProductSpy).toHaveBeenCalledWith('user-123', 'item-toor-dal');
            expect(mockOnSuccess).toHaveBeenCalledTimes(1);
            expect(mockOnClose).toHaveBeenCalledTimes(1);
        });

        deleteProductSpy.mockRestore();
    });

    it('contains no direct Supabase inventory mutations', () => {
        const source = fs.readFileSync(
            path.resolve(__dirname, '../../../components/inventory/EditProductModal.tsx'),
            'utf8'
        );

        expect(source).not.toContain("from('inventory')");
        expect(source).not.toMatch(/supabase/i);
    });
});
