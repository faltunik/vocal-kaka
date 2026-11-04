import React from 'react';
import { render } from '@testing-library/react-native';
import { RecentActivityList } from '@/components/dashboard/RecentActivityList';
import { TransactionItem } from '@/services/RecentActivityContext';

jest.mock('@expo/vector-icons', () => ({
    Ionicons: () => null,
}));

let mockStaffMode = false;

jest.mock('@/services/PrivacyContext', () => ({
    usePrivacy: () => ({
        isMasked: mockStaffMode,
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

jest.mock('@/services/RecentActivityContext', () => ({
    useRecentActivity: () => ({
        activities: mockActivities,
        updateActivity: jest.fn(),
        deleteActivity: jest.fn(),
    }),
}));

let mockActivities: TransactionItem[] = [];

const row = (partial: Partial<TransactionItem>): TransactionItem => ({
    id: Math.random().toString(36).slice(2),
    intent: 'SALE',
    item: 'Sugar',
    quantity: 2,
    unit: 'kg',
    timestamp: Date.now(),
    amount: '₹88',
    title: 'Sold 2 kg Sugar',
    subtitle: 'Today',
    persisted: true,
    ...partial,
});

describe('RecentActivityList role privacy', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockStaffMode = false;
        mockActivities = [
            row({ id: 'sale-1' }),
            row({
                id: 'expense-1',
                intent: 'EXPENSE',
                item: 'Bijli ka bill',
                quantity: 1,
                unit: '',
                amount: '₹1,500',
                title: 'Spent ₹1,500 on Bijli ka bill',
            }),
        ];
    });

    it('hides EXPENSE rows and money from staff accounts', () => {
        mockStaffMode = true;
        const { queryByText, queryByLabelText } = render(<RecentActivityList />);

        expect(queryByText(/Bijli/)).toBeNull();
        expect(queryByText(/1,500/)).toBeNull();
        expect(queryByLabelText('- 2 kg Sugar')).toBeTruthy();
        expect(queryByLabelText(/₹88/)).toBeNull();
    });

    it('shows expense rows and amounts to owners', () => {
        const { getByText, getByLabelText } = render(<RecentActivityList />);

        expect(getByText(/Bijli/)).toBeTruthy();
        expect(getByLabelText(/₹88/)).toBeTruthy();
    });

    it('applies the limit after hiding staff expenses so staff get a full page', () => {
        mockStaffMode = true;
        mockActivities = [
            row({ id: 'sale-1' }),
            row({ id: 'expense-1', intent: 'EXPENSE', item: 'Bijli bill', unit: '', amount: '₹1,500' }),
            row({ id: 'sale-2' }),
            row({ id: 'sale-3' }),
            row({ id: 'sale-4' }),
            row({ id: 'sale-5' }),
        ];

        const { getAllByLabelText, queryByText } = render(<RecentActivityList limit={5} />);

        expect(getAllByLabelText('- 2 kg Sugar')).toHaveLength(5);
        expect(queryByText(/Bijli/)).toBeNull();
    });
});
