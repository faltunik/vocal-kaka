import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { JoinStoreModal } from '@/components/store/JoinStoreModal';

const mockJoinStoreByCode = jest.fn().mockResolvedValue({ success: true });

jest.mock('@/services/StoreContext', () => ({
    useStore: () => ({ joinStoreByCode: mockJoinStoreByCode }),
}));

describe('JoinStoreModal validation', () => {
    let alertSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    });

    afterEach(() => alertSpy.mockRestore());

    it('requires an invite code before joining', async () => {
        const { getByText } = render(<JoinStoreModal visible onClose={jest.fn()} />);

        fireEvent.press(getByText('Join Store'));

        await waitFor(() => {
            expect(alertSpy).toHaveBeenCalledWith('Required', expect.any(String));
        });
        expect(mockJoinStoreByCode).not.toHaveBeenCalled();
    });

    it('normalizes the code and joins', async () => {
        const { getByPlaceholderText, getByText } = render(
            <JoinStoreModal visible onClose={jest.fn()} />
        );

        fireEvent.changeText(getByPlaceholderText('e.g. KAKA89'), 'kaka7788');
        fireEvent.press(getByText('Join Store'));

        await waitFor(() => {
            expect(mockJoinStoreByCode).toHaveBeenCalledWith('KAKA7788', undefined);
        });
    });
});
