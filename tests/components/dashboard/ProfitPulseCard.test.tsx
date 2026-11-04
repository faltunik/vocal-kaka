import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ProfitPulseCard } from '@/components/dashboard/ProfitPulseCard';
import { usePrivacy } from '@/services/PrivacyContext';

// Icons load fonts asynchronously, which triggers act() warnings in tests
jest.mock('@expo/vector-icons', () => ({
    Ionicons: () => null,
}));

jest.mock('@/services/PrivacyContext', () => ({
    usePrivacy: jest.fn(),
}));

describe('ProfitPulseCard', () => {
    const mockToggleMask = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        (usePrivacy as jest.Mock).mockReturnValue({
            isMasked: true,
            isStaffMode: false,
            toggleMask: mockToggleMask,
            hasPin: true,
            hasPinSet: true,
            failedAttempts: 0,
            lockedUntil: null,
            enableStaffMode: jest.fn(),
            disableStaffMode: jest.fn(),
            setPin: jest.fn(),
        });
    });

    describe('Loading State', () => {
        it('should show loading indicator and no amounts when loading is true', () => {
            const { getByTestId, queryByText } = render(
                <ProfitPulseCard
                    loading={true}
                    profit={0}
                    sales={0}
                    transactionCount={0}
                />
            );

            expect(getByTestId('profit-loading')).toBeTruthy();
            expect(queryByText(/₹/)).toBeNull();
        });
    });

    describe('Masking Behavior (Privacy Mode)', () => {
        it('should display masked values when isMasked is true', () => {
            (usePrivacy as jest.Mock).mockReturnValue({
                isMasked: true,
                isStaffMode: false,
                toggleMask: mockToggleMask,
                hasPin: true,
            });

            const { getByText, getByTestId, queryByText } = render(
                <ProfitPulseCard
                    loading={false}
                    profit={1500}
                    sales={5000}
                    transactionCount={20}
                />
            );

            // Obfuscated amounts
            expect(getByText('₹ •••••')).toBeTruthy();
            expect(getByText('Margin: ••••%')).toBeTruthy();
            expect(getByText('Sales: ₹ •••••')).toBeTruthy();

            // Transaction count remains visible
            expect(getByText('+20 Sales')).toBeTruthy();

            // Actual values are NOT visible
            expect(queryByText('₹ 1,500')).toBeNull();
            expect(queryByText(/5,000/)).toBeNull();
            expect(queryByText(/30\.0%/)).toBeNull();

            // Eye toggle button is present
            expect(getByTestId('privacy-eye-toggle')).toBeTruthy();
        });

        it('should call toggleMask when eye toggle button is tapped', () => {
            const { getByTestId } = render(
                <ProfitPulseCard
                    loading={false}
                    profit={1500}
                    sales={5000}
                    transactionCount={20}
                />
            );

            const toggleButton = getByTestId('privacy-eye-toggle');
            fireEvent.press(toggleButton);

            expect(mockToggleMask).toHaveBeenCalledTimes(1);
        });
    });

    describe('Unmasking Behavior (Owner Mode)', () => {
        it('should display actual profit, sales, and margin when isMasked is false', () => {
            (usePrivacy as jest.Mock).mockReturnValue({
                isMasked: false,
                isStaffMode: false,
                toggleMask: mockToggleMask,
                hasPin: true,
            });

            const { getByText, queryByText } = render(
                <ProfitPulseCard
                    loading={false}
                    profit={1500}
                    sales={5000}
                    transactionCount={20}
                />
            );

            expect(getByText('₹ 1,500')).toBeTruthy();
            expect(getByText('Margin: 30.0%')).toBeTruthy();
            expect(getByText('Sales: ₹5,000')).toBeTruthy();
            expect(getByText('+20 Sales')).toBeTruthy();

            // Masked bullets should not be rendered
            expect(queryByText('₹ •••••')).toBeNull();
            expect(queryByText('••••%')).toBeNull();
        });

        it('handles zero sales gracefully without division-by-zero error', () => {
            (usePrivacy as jest.Mock).mockReturnValue({
                isMasked: false,
                isStaffMode: false,
                toggleMask: mockToggleMask,
                hasPin: true,
            });

            const { getByText } = render(
                <ProfitPulseCard
                    loading={false}
                    profit={0}
                    sales={0}
                    transactionCount={0}
                />
            );

            expect(getByText('₹ 0')).toBeTruthy();
            expect(getByText('Margin: 0.0%')).toBeTruthy();
            expect(getByText('Sales: ₹0')).toBeTruthy();
            expect(getByText('+0 Sales')).toBeTruthy();
        });
    });

    describe('Staff / Chotu Mode Behavior', () => {
        it('renders simplified Today\'s Bills widget and hides all financial figures', () => {
            (usePrivacy as jest.Mock).mockReturnValue({
                isMasked: true,
                isStaffMode: true,
                toggleMask: mockToggleMask,
                hasPin: true,
            });

            const { getByText, queryByText, queryByTestId } = render(
                <ProfitPulseCard
                    loading={false}
                    profit={1500}
                    sales={5000}
                    transactionCount={42}
                />
            );

            // Shows simplified staff mode metrics
            expect(getByText('Counter Active (Staff Mode)')).toBeTruthy();
            expect(getByText("Today's Bills: 42")).toBeTruthy();
            expect(getByText('42')).toBeTruthy();
            expect(getByText('Voice & Barcode Scanner Active')).toBeTruthy();

            // Completely strips financial information
            expect(queryByText(/Today’s profit/)).toBeNull();
            expect(queryByText(/₹/)).toBeNull();
            expect(queryByText(/1,500/)).toBeNull();
            expect(queryByText(/5,000/)).toBeNull();
            expect(queryByText(/Margin/)).toBeNull();
            expect(queryByText(/Sales:/)).toBeNull();

            // Eye toggle button is hidden in Staff Mode
            expect(queryByTestId('privacy-eye-toggle')).toBeNull();
        });

        it('shows loading placeholder for transaction count in staff mode', () => {
            (usePrivacy as jest.Mock).mockReturnValue({
                isMasked: true,
                isStaffMode: true,
                toggleMask: mockToggleMask,
                hasPin: true,
            });

            const { getByText, queryByText } = render(
                <ProfitPulseCard
                    loading={true}
                    profit={0}
                    sales={0}
                    transactionCount={0}
                />
            );

            expect(getByText("Today's Bills: ...")).toBeTruthy();
            expect(queryByText(/₹/)).toBeNull();
        });
    });
});
