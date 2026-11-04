import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import QuickCounterScreen from '@/app/quick-counter';
import { container } from '@/services/Container';
import { Alert } from 'react-native';

let mockItems = [
    {
        id: 'item-1',
        name: 'Toor Dal',
        quantity: 10,
        unit: 'kg',
        base_unit: 'kg',
        selling_price: 150,
        aliases: ['अरहर दाल'],
    },
    {
        id: 'item-2',
        name: 'Sugar',
        quantity: 50,
        unit: 'kg',
        base_unit: 'kg',
        selling_price: 44,
    },
    {
        id: 'item-3',
        name: 'Unpriced Item',
        quantity: 5,
        unit: 'pcs',
        base_unit: 'pcs',
        selling_price: null,
    },
];

jest.mock('@/hooks/useInventory', () => ({
    useInventory: () => ({ items: mockItems, loading: false, error: null, refetch: jest.fn() }),
}));

jest.mock('@/services/AuthContext', () => ({
    useAuth: () => ({ user: { id: 'u1' }, isGuest: false }),
}));

jest.mock('@/services/StoreContext', () => ({
    useStore: () => ({ currentStore: null }),
}));

const mockRefreshFeed = jest.fn();

jest.mock('@/services/RecentActivityContext', () => ({
    useRecentActivity: () => ({ refresh: mockRefreshFeed }),
}));

describe('QuickCounterScreen', () => {
    let alertSpy: jest.SpyInstance;
    let saleSpy: jest.SpyInstance;
    let stockSpy: jest.SpyInstance;
    let wasteSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
        saleSpy = jest.spyOn(container.inventoryService, 'saleEvent').mockResolvedValue(true);
        stockSpy = jest.spyOn(container.inventoryService, 'addStockEvent').mockResolvedValue(true);
        wasteSpy = jest.spyOn(container.inventoryService, 'writeOffEvent').mockResolvedValue(true);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('records a sale with the numpad quantity for the selected item', async () => {
        const { getByTestId } = render(<QuickCounterScreen />);

        fireEvent.press(getByTestId('quick-counter-item-item-1'));
        fireEvent.press(getByTestId('numpad-2'));
        fireEvent.press(getByTestId('numpad-5'));

        expect(getByTestId('quick-counter-quantity').props.children).toBe('25');

        fireEvent.press(getByTestId('quick-counter-sale'));

        await waitFor(() => {
            expect(saleSpy).toHaveBeenCalledWith('u1', {
                item: 'Toor Dal',
                quantity: 25,
                unit: 'kg',
                price: 150,
            });
        });
        expect(mockRefreshFeed).toHaveBeenCalledTimes(1);
    });

    it('records wastage against the catalog unit', async () => {
        const { getByTestId } = render(<QuickCounterScreen />);

        fireEvent.press(getByTestId('quick-counter-item-item-2'));
        fireEvent.press(getByTestId('numpad-3'));
        fireEvent.press(getByTestId('quick-counter-waste'));

        await waitFor(() => {
            expect(wasteSpy).toHaveBeenCalledWith('u1', {
                item: 'Sugar',
                quantity: 3,
                unit: 'kg',
            });
        });
    });

    it('records stock-in with the full payload', async () => {
        const { getByTestId } = render(<QuickCounterScreen />);

        fireEvent.press(getByTestId('quick-counter-item-item-2'));
        fireEvent.press(getByTestId('numpad-1'));
        fireEvent.press(getByTestId('numpad-0'));
        fireEvent.press(getByTestId('quick-counter-stock'));

        await waitFor(() => {
            expect(stockSpy).toHaveBeenCalledWith('u1', {
                item: 'Sugar',
                quantity: 10,
                unit: 'kg',
            });
        });
    });

    it('resets the quantity when a different item is selected', () => {
        const { getByTestId } = render(<QuickCounterScreen />);

        fireEvent.press(getByTestId('quick-counter-item-item-1'));
        fireEvent.press(getByTestId('numpad-9'));
        fireEvent.press(getByTestId('quick-counter-clear-item'));
        fireEvent.press(getByTestId('quick-counter-item-item-2'));

        expect(getByTestId('quick-counter-quantity').props.children).toBe('0');
    });

    it('blocks a leading decimal point', () => {
        const { getByTestId } = render(<QuickCounterScreen />);

        fireEvent.press(getByTestId('quick-counter-item-item-1'));
        fireEvent.press(getByTestId('numpad-.'));

        expect(getByTestId('quick-counter-quantity').props.children).toBe('0');
    });

    it('supports backspace and decimal keys', () => {
        const { getByTestId } = render(<QuickCounterScreen />);

        fireEvent.press(getByTestId('quick-counter-item-item-1'));
        fireEvent.press(getByTestId('numpad-1'));
        fireEvent.press(getByTestId('numpad-DEL'));
        fireEvent.press(getByTestId('numpad-2'));
        fireEvent.press(getByTestId('numpad-.'));
        fireEvent.press(getByTestId('numpad-5'));
        fireEvent.press(getByTestId('numpad-.')); // second decimal is ignored

        expect(getByTestId('quick-counter-quantity').props.children).toBe('2.5');
    });

    it('rejects empty quantities without writing', () => {
        const { getByTestId } = render(<QuickCounterScreen />);

        fireEvent.press(getByTestId('quick-counter-item-item-2'));
        fireEvent.press(getByTestId('quick-counter-stock'));

        expect(alertSpy).toHaveBeenCalledWith('Invalid quantity', expect.any(String));
        expect(stockSpy).not.toHaveBeenCalled();
    });

    it('refreshes the selected item stock after the catalog updates', () => {
        const { getByTestId, getByText } = render(<QuickCounterScreen />);

        fireEvent.press(getByTestId('quick-counter-item-item-2'));
        expect(getByText('Stock: 50 kg')).toBeTruthy();

        mockItems = mockItems.map((item, index) => index === 1 ? { ...item, quantity: 45 } : item);
        fireEvent.press(getByTestId('numpad-7'));

        expect(getByText('Stock: 45 kg')).toBeTruthy();
    });

    it('blocks sales of items without a selling price', () => {
        const { getByTestId } = render(<QuickCounterScreen />);

        fireEvent.press(getByTestId('quick-counter-item-item-3'));
        fireEvent.press(getByTestId('numpad-2'));
        fireEvent.press(getByTestId('quick-counter-sale'));

        expect(alertSpy).toHaveBeenCalledWith('Price missing', expect.any(String));
        expect(saleSpy).not.toHaveBeenCalled();
    });

    it('requires an item selection first', () => {
        const { getByTestId } = render(<QuickCounterScreen />);

        fireEvent.press(getByTestId('quick-counter-sale'));

        expect(alertSpy).toHaveBeenCalledWith('Select an item', expect.any(String));
        expect(saleSpy).not.toHaveBeenCalled();
    });
});
