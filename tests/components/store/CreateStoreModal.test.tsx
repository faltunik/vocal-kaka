import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { CreateStoreModal } from '@/components/store/CreateStoreModal';

const mockCreateStore = jest.fn().mockResolvedValue({ id: 'new-store' });

jest.mock('@/services/StoreContext', () => ({
    useStore: () => ({ createStore: mockCreateStore }),
}));

describe('CreateStoreModal validation', () => {
    let alertSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    });

    afterEach(() => alertSpy.mockRestore());

    it('requires a store name before creating', async () => {
        const { getByText } = render(<CreateStoreModal visible onClose={jest.fn()} />);

        fireEvent.press(getByText('Create Store'));

        await waitFor(() => {
            expect(alertSpy).toHaveBeenCalledWith('Required', expect.any(String));
        });
        expect(mockCreateStore).not.toHaveBeenCalled();
    });
});
