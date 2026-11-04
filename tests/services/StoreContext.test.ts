import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StoreProvider, useStore, STORE_STORAGE_KEYS } from '@/services/StoreContext';
import { PrivacyProvider, usePrivacy } from '@/services/PrivacyContext';
import { supabase } from '@/lib/supabase';

let mockUser: { id: string; email?: string } | null = { id: 'user-mukesh-kirana', email: 'mukesh@kirana.in' };
let mockIsGuest = false;

jest.mock('@/services/AuthContext', () => ({
    useAuth: () => ({ user: mockUser, isGuest: mockIsGuest }),
}));

describe('StoreContext (Multi-Store & Staff Sharing)', () => {
    beforeEach(async () => {
        jest.clearAllMocks();
        await AsyncStorage.clear();
        mockUser = { id: 'demo-user', email: 'demo@kirana.in' };
        mockIsGuest = true;
    });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(StoreProvider, null, children);

    describe('1. Default Initialization & Hydration', () => {
        it('initializes with default store in demo mode', async () => {
            const { result } = renderHook(() => useStore(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            expect(result.current.currentStore).not.toBeNull();
            expect(result.current.currentStore?.name).toBe('Laxmi Kirana Store');
            expect(result.current.currentRole).toBe('owner');
            expect(result.current.isOwner).toBe(true);
            expect(result.current.userStores.length).toBeGreaterThanOrEqual(1);
        });

        it('hydrates active store from AsyncStorage if previously stored', async () => {
            const customStore = {
                id: 'store-godown-99',
                name: 'Mandi Godown Warehouse',
                owner_id: 'demo-user',
                category: 'STAPLES',
                invite_code: 'KAKA99',
            };
            await AsyncStorage.setItem(
                STORE_STORAGE_KEYS.DEMO_STORES,
                JSON.stringify([customStore])
            );
            await AsyncStorage.setItem(
                STORE_STORAGE_KEYS.ACTIVE_STORE_ID,
                'store-godown-99'
            );

            const { result } = renderHook(() => useStore(), { wrapper });

            await waitFor(() => {
                expect(result.current.currentStore?.id).toBe('store-godown-99');
            });

            expect(result.current.currentStore?.name).toBe('Mandi Godown Warehouse');
            expect(result.current.currentStore?.category).toBe('STAPLES');
        });
    });

    describe('2. Store Creation & Switching (Dukaan vs Godown)', () => {
        it('allows owner to create a new branch or godown store', async () => {
            const { result } = renderHook(() => useStore(), { wrapper });

            await waitFor(() => expect(result.current.isLoading).toBe(false));

            let newStore: any = null;
            await act(async () => {
                newStore = await result.current.createStore({
                    name: 'Railway Station Branch',
                    category: 'FMCG',
                    address: 'Shop 2, Platform Road',
                });
            });

            expect(newStore).toBeTruthy();
            expect(newStore.name).toBe('Railway Station Branch');
            expect(newStore.category).toBe('FMCG');
            expect(newStore.invite_code).toMatch(/^KAKA/);

            // Automatically activates new store
            expect(result.current.currentStore?.id).toBe(newStore.id);
            expect(result.current.userStores.some(s => s.id === newStore.id)).toBe(true);
        });

        it('allows switching between stores seamlessly', async () => {
            const { result } = renderHook(() => useStore(), { wrapper });

            await waitFor(() => expect(result.current.isLoading).toBe(false));

            let store2: any = null;
            await act(async () => {
                store2 = await result.current.createStore({
                    name: 'Godown 2',
                    category: 'STAPLES',
                });
            });

            expect(result.current.currentStore?.id).toBe(store2.id);

            // Switch back to default store
            const firstStoreId = result.current.userStores[0].id;
            await act(async () => {
                await result.current.switchStore(firstStoreId);
            });

            expect(result.current.currentStore?.id).toBe(firstStoreId);
            expect(await AsyncStorage.getItem(STORE_STORAGE_KEYS.ACTIVE_STORE_ID)).toBe(firstStoreId);
        });
    });

    describe('3. Store Profile Updates', () => {
        it('updates store name, whatsapp phone, address, and UPI ID', async () => {
            const { result } = renderHook(() => useStore(), { wrapper });

            await waitFor(() => expect(result.current.isLoading).toBe(false));
            const storeId = result.current.currentStore!.id;

            await act(async () => {
                await result.current.updateStore(storeId, {
                    name: 'Shree Krishna Provision Store',
                    phone: '9820011223',
                    address: 'Near Old Bus Stand',
                    upi_id: 'shreekrishna@upi',
                });
            });

            expect(result.current.currentStore?.name).toBe('Shree Krishna Provision Store');
            expect(result.current.currentStore?.phone).toBe('9820011223');
            expect(result.current.currentStore?.address).toBe('Near Old Bus Stand');
            expect(result.current.currentStore?.upi_id).toBe('shreekrishna@upi');
        });
    });

    describe('4. Staff & Family Sharing via Invite Code', () => {
        it('generates a 6-8 character uppercase invite code', async () => {
            const { result } = renderHook(() => useStore(), { wrapper });

            await waitFor(() => expect(result.current.isLoading).toBe(false));
            const storeId = result.current.currentStore!.id;

            let code = '';
            await act(async () => {
                code = await result.current.generateInviteCode(storeId);
            });

            expect(code).toMatch(/^KAKA[0-9]{4}/);
            expect(result.current.currentStore?.invite_code).toBe(code);
        });

        it('allows a child or employee to join a store using an invite code as staff', async () => {
            const { result } = renderHook(() => useStore(), { wrapper });

            await waitFor(() => expect(result.current.isLoading).toBe(false));

            let joinRes: any = null;
            await act(async () => {
                joinRes = await result.current.joinStoreByCode('KAKA7788', 'Aman (Son)');
            });

            expect(joinRes.success).toBe(true);
            expect(result.current.currentStore?.invite_code).toBe('KAKA7788');
            // Role should be staff
            expect(result.current.currentRole).toBe('staff');
            expect(result.current.isOwner).toBe(false);
        });

        it('rejects empty or whitespace invite codes', async () => {
            const { result } = renderHook(() => useStore(), { wrapper });

            await waitFor(() => expect(result.current.isLoading).toBe(false));

            let joinRes: any = null;
            await act(async () => {
                joinRes = await result.current.joinStoreByCode('   ');
            });

            expect(joinRes.success).toBe(false);
            expect(joinRes.error).toContain('valid invite code');
        });

        it('allows managing staff members', async () => {
            const { result } = renderHook(() => useStore(), { wrapper });

            await waitFor(() => expect(result.current.isLoading).toBe(false));

            await act(async () => {
                await result.current.refreshMembers();
            });

            expect(result.current.members.length).toBeGreaterThan(0);
            const staffMember = result.current.members.find(m => m.role === 'staff');
            expect(staffMember).toBeTruthy();

            // Remove staff member
            await act(async () => {
                await result.current.removeMember(staffMember!.id);
            });

            expect(result.current.members.some(m => m.id === staffMember!.id)).toBe(false);
        });

        it('persists an invited staff role across provider remounts', async () => {
            const { result, unmount } = renderHook(() => useStore(), { wrapper });

            await waitFor(() => expect(result.current.isLoading).toBe(false));

            await act(async () => {
                await result.current.joinStoreByCode('KAKA7788', 'Aman (Son)');
            });
            expect(result.current.currentRole).toBe('staff');

            unmount();

            const remounted = renderHook(() => useStore(), { wrapper });
            await waitFor(() => expect(remounted.result.current.isLoading).toBe(false));

            expect(remounted.result.current.currentStore?.invite_code).toBe('KAKA7788');
            expect(remounted.result.current.currentRole).toBe('staff');
            expect(remounted.result.current.isOwner).toBe(false);
        });
    });

    describe('5. Staff Role Financial Masking', () => {
        it('locks privacy masking while the active store role is staff', async () => {
            const combinedWrapper = ({ children }: { children: React.ReactNode }) =>
                React.createElement(
                    StoreProvider,
                    null,
                    React.createElement(PrivacyProvider, null, children)
                );

            const { result } = renderHook(
                () => ({ store: useStore(), privacy: usePrivacy() }),
                { wrapper: combinedWrapper }
            );

            await waitFor(() => expect(result.current.store.isLoading).toBe(false));
            expect(result.current.privacy.isStaffMode).toBe(false);

            await act(async () => {
                await result.current.store.joinStoreByCode('KAKA9012', 'Raju (Chotu)');
            });

            expect(result.current.store.currentRole).toBe('staff');
            expect(result.current.privacy.isStaffMode).toBe(true);

            // Unmasking must be impossible for account-level staff
            await act(async () => {
                await result.current.privacy.toggleMask();
            });
            expect(result.current.privacy.isMasked).toBe(true);
        });
    });

    describe('6. Real-User Store Loading', () => {
        it('never falls back to the demo store for a signed-in user when loading fails', async () => {
            mockUser = { id: 'real-user-9', email: 'owner@store.in' };
            mockIsGuest = false;

            const { result } = renderHook(() => useStore(), { wrapper });

            await waitFor(() => expect(result.current.isLoading).toBe(false));

            expect(result.current.currentStore).toBeNull();
            expect(result.current.userStores).toEqual([]);
        });

        it('creates a real store through the atomic create_store RPC', async () => {
            mockUser = { id: 'real-user-9', email: 'owner@store.in' };
            mockIsGuest = false;

            (supabase.rpc as jest.Mock).mockResolvedValue({
                data: {
                    id: 'store-new',
                    name: 'Station Branch',
                    owner_id: 'real-user-9',
                    category: 'GENERAL',
                    invite_code: 'KAKA1234',
                },
                error: null,
            });

            const { result } = renderHook(() => useStore(), { wrapper });
            await waitFor(() => expect(result.current.isLoading).toBe(false));

            let created: any = null;
            await act(async () => {
                created = await result.current.createStore({ name: 'Station Branch' });
            });

            expect(created.id).toBe('store-new');
            expect(result.current.currentStore?.id).toBe('store-new');
            expect(supabase.rpc).toHaveBeenCalledWith(
                'create_store',
                expect.objectContaining({ p_name: 'Station Branch' })
            );
        });

        it('joins a store through the invite RPC and activates it', async () => {
            mockUser = { id: 'staff-aman', email: 'aman@kirana.in' };
            mockIsGuest = false;

            (supabase.rpc as jest.Mock).mockImplementation((name: string) => {
                if (name === 'join_store_by_invite_code') {
                    return Promise.resolve({
                        data: { success: true, store_id: 'store-joined', store_name: 'Partner Store', role: 'staff' },
                        error: null,
                    });
                }
                if (name === 'create_store') {
                    return Promise.resolve({
                        data: { id: 'store-joined', name: 'Partner Store', owner_id: 'other', category: 'GENERAL', invite_code: 'KAKA1' },
                        error: null,
                    });
                }
                return Promise.resolve({ data: null, error: null });
            });

            const { result } = renderHook(() => useStore(), { wrapper });
            await waitFor(() => expect(result.current.isLoading).toBe(false));

            let joined: any = null;
            await act(async () => {
                joined = await result.current.joinStoreByCode('kaka1234', 'Aman');
            });

            expect(joined.success).toBe(true);
            expect(result.current.currentStore?.id).toBe('store-joined');
            expect(supabase.rpc).toHaveBeenCalledWith('join_store_by_invite_code', {
                p_invite_code: 'KAKA1234',
                p_display_name: 'Aman',
            });
        });
    });
});
