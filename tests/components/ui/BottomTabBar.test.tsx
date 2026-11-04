import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { BottomTabBar } from '@/components/ui/BottomTabBar';

const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
    useRouter: () => ({ replace: mockReplace, navigate: jest.fn(), push: jest.fn() }),
    usePathname: () => '/',
    useSegments: () => [],
}));

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

let mockStaffMode = false;

jest.mock('@/services/PrivacyContext', () => ({
    usePrivacy: () => ({
        isMasked: true,
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

describe('BottomTabBar staff lock', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockStaffMode = false;
    });

    it('blocks history navigation in staff mode', () => {
        mockStaffMode = true;
        const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
        const { getByLabelText } = render(<BottomTabBar />);

        fireEvent.press(getByLabelText('History'));

        expect(alertSpy).toHaveBeenCalledWith('Staff Mode Active', expect.any(String));
        expect(mockReplace).not.toHaveBeenCalled();

        alertSpy.mockRestore();
    });

    it('allows history navigation for owners', () => {
        const { getByLabelText } = render(<BottomTabBar />);

        fireEvent.press(getByLabelText('History'));

        expect(mockReplace).toHaveBeenCalledWith('/history');
    });
});
