import { renderHook } from '@testing-library/react-native';
import { useStoreScope } from '@/hooks/useStoreScope';

let mockUser: { id: string } | null = { id: 'user-1' };
let mockStore: { id: string } | null = { id: 'store-1' };

jest.mock('@/services/AuthContext', () => ({
    useAuth: () => ({ user: mockUser }),
}));

jest.mock('@/services/StoreContext', () => ({
    useStore: () => ({ currentStore: mockStore }),
}));

describe('useStoreScope', () => {
    beforeEach(() => {
        mockUser = { id: 'user-1' };
        mockStore = { id: 'store-1' };
    });

    it('scopes to the active store when one is loaded', () => {
        const { result } = renderHook(() => useStoreScope());

        expect(result.current.scope).toEqual({ userId: 'user-1', storeId: 'store-1' });
        expect(result.current.scopeKey).toBe('store-1');
        expect(result.current.storeId).toBe('store-1');
        expect(result.current.currentStoreId()).toBe('store-1');
    });

    it('falls back to the user scope when no store is active', () => {
        mockStore = null;
        const { result } = renderHook(() => useStoreScope());

        expect(result.current.scope).toBe('user-1');
        expect(result.current.scopeKey).toBe('user-1');
        expect(result.current.currentScope()).toBe('user-1');
    });

    it('uses the guest scope when signed out', () => {
        mockUser = null;
        mockStore = null;
        const { result } = renderHook(() => useStoreScope());

        expect(result.current.scope).toBe('guest');
        expect(result.current.scopeKey).toBe('anonymous');
    });

    it('reads the latest store at call time after a switch', () => {
        const { result, rerender } = renderHook(() => useStoreScope());
        expect(result.current.currentStoreId()).toBe('store-1');

        mockStore = { id: 'store-2' };
        rerender({});

        expect(result.current.currentStoreId()).toBe('store-2');
        expect(result.current.currentScope()).toEqual({ userId: 'user-1', storeId: 'store-2' });
    });
});
