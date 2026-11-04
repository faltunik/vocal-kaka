import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { StoreSettingsModal } from '@/components/store/StoreSettingsModal';

const mockRemoveMember = jest.fn().mockResolvedValue(undefined);
const mockRefreshMembers = jest.fn().mockResolvedValue(undefined);

jest.mock('@/services/StoreContext', () => ({
    useStore: () => ({
        currentStore: { id: 's1', name: 'Laxmi Kirana Store', invite_code: 'KAKA1234' },
        isOwner: true,
        updateStore: jest.fn(),
        generateInviteCode: jest.fn(),
        members: [
            { id: 'm1', store_id: 's1', user_id: 'owner-1', role: 'owner', display_name: 'Mukesh (Owner)' },
            { id: 'm2', store_id: 's1', user_id: 'staff-1', role: 'staff', display_name: 'Aman (Son)' },
        ],
        refreshMembers: mockRefreshMembers,
        removeMember: mockRemoveMember,
    }),
}));

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));

describe('StoreSettingsModal member management', () => {
    let alertSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    });

    afterEach(() => alertSpy.mockRestore());

    it('removes a staff member after confirmation', async () => {
        const { getByText, getByLabelText } = render(
            <StoreSettingsModal visible onClose={jest.fn()} />
        );

        fireEvent.press(getByText(/Staff & Sharing/));
        fireEvent.press(getByLabelText('Remove Aman (Son)'));

        expect(alertSpy).toHaveBeenCalledWith('Remove Member', expect.any(String), expect.any(Array));
        const buttons = alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
        const remove = buttons.find(button => button.text === 'Remove');
        await remove?.onPress?.();

        expect(mockRemoveMember).toHaveBeenCalledWith('m2');
    });

    it('never offers removal for the owner row', () => {
        const { getByText, queryByLabelText } = render(
            <StoreSettingsModal visible onClose={jest.fn()} />
        );

        fireEvent.press(getByText(/Staff & Sharing/));

        expect(queryByLabelText('Remove Mukesh (Owner)')).toBeNull();
    });
});
