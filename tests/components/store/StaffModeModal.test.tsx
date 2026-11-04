import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { StaffModeModal } from '@/components/store/StaffModeModal';

jest.mock('@/components/ui/AppModal', () => {
    const ReactLib = require('react');
    const { View } = require('react-native');
    return { AppModal: ({ children }: { children: React.ReactNode }) => ReactLib.createElement(View, null, children) };
});

const mockEnableStaffMode = jest.fn().mockResolvedValue(true);
const mockDisableStaffMode = jest.fn().mockResolvedValue(true);

let mockStaffMode = false;

jest.mock('@/services/PrivacyContext', () => ({
    usePrivacy: () => ({
        isStaffMode: mockStaffMode,
        hasPin: false,
        enableStaffMode: mockEnableStaffMode,
        disableStaffMode: mockDisableStaffMode,
        lockedUntil: null,
    }),
}));

describe('StaffModeModal', () => {
    const onClose = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        mockStaffMode = false;
    });

    it('sets a PIN and enables staff mode for the owner', async () => {
        const { getByTestId } = render(<StaffModeModal visible onClose={onClose} />);

        fireEvent.changeText(getByTestId('staff-mode-pin-input'), '1234');
        fireEvent.press(getByTestId('staff-mode-confirm'));

        await waitFor(() => {
            expect(mockEnableStaffMode).toHaveBeenCalledWith('1234');
            expect(onClose).toHaveBeenCalledTimes(1);
        }, { timeout: 5000 });
    });

    it('rejects a short PIN without calling the context', () => {
        const { getByTestId, getByText } = render(<StaffModeModal visible onClose={onClose} />);

        fireEvent.changeText(getByTestId('staff-mode-pin-input'), '12');
        fireEvent.press(getByTestId('staff-mode-confirm'));

        expect(getByText('Enter a 4-digit PIN.')).toBeTruthy();
        expect(mockEnableStaffMode).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('disables staff mode with the PIN and reports a wrong PIN', async () => {
        mockStaffMode = true;
        mockDisableStaffMode.mockResolvedValueOnce(false);
        const { getByTestId, getByText } = render(<StaffModeModal visible onClose={onClose} />);

        fireEvent.changeText(getByTestId('staff-mode-pin-input'), '9999');
        fireEvent.press(getByTestId('staff-mode-confirm'));

        await waitFor(() => {
            expect(mockDisableStaffMode).toHaveBeenCalledWith('9999');
            expect(getByText('Incorrect PIN. Try again.')).toBeTruthy();
        }, { timeout: 5000 });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('reports a context failure without getting stuck busy', async () => {
        mockEnableStaffMode.mockRejectedValueOnce(new Error('storage unavailable'));
        const { getByTestId, getByText } = render(<StaffModeModal visible onClose={onClose} />);

        fireEvent.changeText(getByTestId('staff-mode-pin-input'), '1234');
        fireEvent.press(getByTestId('staff-mode-confirm'));

        await waitFor(() => {
            expect(getByText('Could not update Staff Mode. Please try again.')).toBeTruthy();
        });
        expect(onClose).not.toHaveBeenCalled();

        // Not stuck: a corrected attempt can still be made.
        mockEnableStaffMode.mockResolvedValueOnce(true);
        fireEvent.press(getByTestId('staff-mode-confirm'));
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1), { timeout: 5000 });
    });
});
