import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { TransactionEditModal } from '@/components/dashboard/TransactionEditModal';
import { TransactionItem } from '@/services/RecentActivityContext';

jest.mock('@/components/ui/AppModal', () => {
    const ReactLib = require('react');
    const { View } = require('react-native');
    return { AppModal: ({ children }: { children: React.ReactNode }) => ReactLib.createElement(View, null, children) };
});

describe('TransactionEditModal expense titles', () => {
    const onSave = jest.fn();

    const expense: TransactionItem = {
        id: 'e1',
        intent: 'EXPENSE',
        item: 'Packaging bags',
        quantity: 1,
        unit: '',
        timestamp: Date.now(),
        amount: '₹15',
        title: 'Spent ₹15 on Packaging bags',
        subtitle: 'Today',
        persisted: true,
    };

    beforeEach(() => jest.clearAllMocks());

    it('keeps the amount-based title when saving an expense', () => {
        const { getByText } = render(
            <TransactionEditModal
                visible
                transaction={expense}
                onClose={jest.fn()}
                onSave={onSave}
                onDelete={jest.fn()}
            />
        );

        fireEvent.press(getByText('Save Changes'));

        expect(onSave).toHaveBeenCalledWith('e1', expect.objectContaining({
            title: 'Spent ₹15 on Packaging bags',
        }));
    });

    it('renders the Confirm Rate flow for unresolved value sales', async () => {
        const onResolveRate = jest.fn().mockResolvedValue(true);
        const unresolved: TransactionItem = {
            id: 's1',
            intent: 'SALE',
            item: 'Sugar',
            quantity: 0,
            unit: 'kg',
            timestamp: Date.now(),
            amount: '₹20',
            title: 'Sold Sugar',
            subtitle: 'Today',
            persisted: true,
            needsReview: true,
            eventId: 'event-1',
            payload: { pricing_unresolved: true },
        };

        const { getByText, getByTestId, queryByText } = render(
            <TransactionEditModal
                visible
                transaction={unresolved}
                onClose={jest.fn()}
                onSave={onSave}
                onDelete={jest.fn()}
                onResolveRate={onResolveRate}
            />
        );

        expect(getByText(/Customer spent ₹20/)).toBeTruthy();
        expect(queryByText('Save Changes')).toBeNull();

        fireEvent.changeText(getByTestId('rate-resolution-input'), '40');
        expect(getByText('Calculated Quantity: 0.5 kg')).toBeTruthy();

        fireEvent.press(getByTestId('rate-confirm-button'));

        await waitFor(() => {
            expect(onResolveRate).toHaveBeenCalledWith(unresolved, 40);
        });
    });
});
