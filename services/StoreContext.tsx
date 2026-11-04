import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from './AuthContext';

export interface Store {
    id: string;
    name: string;
    owner_id: string;
    category: 'GENERAL' | 'FMCG' | 'STAPLES' | 'DAIRY_BAKERY' | 'SPICES' | string;
    phone?: string | null;
    address?: string | null;
    upi_id?: string | null;
    invite_code?: string | null;
    created_at?: string;
    updated_at?: string;
}

export interface StoreMember {
    id: string;
    store_id: string;
    user_id: string;
    role: 'owner' | 'admin' | 'staff';
    display_name?: string | null;
    joined_at?: string;
}

export interface StoreContextType {
    currentStore: Store | null;
    userStores: Store[];
    currentRole: 'owner' | 'admin' | 'staff';
    isOwner: boolean;
    isLoading: boolean;
    switchStore: (storeId: string) => Promise<void>;
    createStore: (data: { name: string; category?: string; address?: string; phone?: string; upi_id?: string }) => Promise<Store>;
    updateStore: (storeId: string, data: Partial<Store>) => Promise<void>;
    joinStoreByCode: (code: string, displayName?: string) => Promise<{ success: boolean; store?: Store; error?: string }>;
    generateInviteCode: (storeId: string) => Promise<string>;
    members: StoreMember[];
    refreshMembers: () => Promise<void>;
    removeMember: (memberId: string) => Promise<void>;
    refreshStores: () => Promise<void>;
}

export const STORE_STORAGE_KEYS = {
    ACTIVE_STORE_ID: '@vocalstock_active_store_id',
    DEMO_STORES: '@vocalstock_demo_stores',
    DEMO_MEMBERS: '@vocalstock_demo_members',
    DEMO_ROLES: '@vocalstock_demo_roles',
};

const DEFAULT_DEMO_STORE: Store = {
    id: 'demo-store-default',
    name: 'Laxmi Kirana Store',
    owner_id: 'demo-user',
    category: 'GENERAL',
    phone: '9876543210',
    address: 'Shop 12, APMC Grain Market',
    upi_id: 'laxmikirana@okaxis',
    invite_code: 'KAKA88',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
};

const DEFAULT_DEMO_MEMBERS: StoreMember[] = [
    {
        id: 'member-demo-owner',
        store_id: 'demo-store-default',
        user_id: 'demo-user',
        role: 'owner',
        display_name: 'Mukesh Bhai (Owner)',
        joined_at: new Date().toISOString(),
    },
    {
        id: 'member-demo-son',
        store_id: 'demo-store-default',
        user_id: 'demo-staff-1',
        role: 'staff',
        display_name: 'Aman (Son)',
        joined_at: new Date().toISOString(),
    },
    {
        id: 'member-demo-helper',
        store_id: 'demo-store-default',
        user_id: 'demo-staff-2',
        role: 'staff',
        display_name: 'Raju (Chotu)',
        joined_at: new Date().toISOString(),
    },
];

/** Storage can be corrupted by partial writes; never let JSON.parse crash boot. */
function safeJsonParse<T>(raw: string | null, fallback: T): T {
    if (!raw) return fallback;
    try {
        const parsed = JSON.parse(raw) as T;
        return parsed ?? fallback;
    } catch {
        console.warn('[StoreContext] Ignoring corrupted stored value');
        return fallback;
    }
}

const StoreContext = createContext<StoreContextType | undefined>(undefined);

export function StoreProvider({ children }: { children: React.ReactNode }) {
    const { user, isGuest, isLoading: authLoading } = useAuth();
    const [currentStore, setCurrentStore] = useState<Store | null>(null);
    const [userStores, setUserStores] = useState<Store[]>([]);
    const [members, setMembers] = useState<StoreMember[]>([]);
    const [storeRoles, setStoreRoles] = useState<Record<string, 'owner' | 'admin' | 'staff'>>({});
    const [isLoading, setIsLoading] = useState(true);

    const isDemo = !authLoading && (!user || isGuest || user.id === 'demo-user' || user.id === 'guest');

    // 1. Fetch stores for active user
    const loadStoresInternal = useCallback(async (): Promise<Store[] | null> => {
        // Do not fall into the demo store while auth is still resolving;
        // starting a real session must never query with a fake store id.
        if (authLoading) {
            setIsLoading(true);
            return null;
        }

        setIsLoading(true);
        try {
            if (isDemo) {
                // Demo mode store handling
                const storedStores = await AsyncStorage.getItem(STORE_STORAGE_KEYS.DEMO_STORES);
                let demoList = safeJsonParse<Store[]>(storedStores, [DEFAULT_DEMO_STORE]);
                if (!Array.isArray(demoList) || demoList.length === 0) demoList = [DEFAULT_DEMO_STORE];

                const storedRoles = await AsyncStorage.getItem(STORE_STORAGE_KEYS.DEMO_ROLES);
                const persistedRoles = safeJsonParse<Record<string, 'owner' | 'admin' | 'staff'>>(storedRoles, {});
                const roles: Record<string, 'owner' | 'admin' | 'staff'> = {};
                demoList.forEach(s => { roles[s.id] = persistedRoles[s.id] || 'owner'; });

                setUserStores(demoList);
                setStoreRoles(roles);

                const activeId = await AsyncStorage.getItem(STORE_STORAGE_KEYS.ACTIVE_STORE_ID);
                const active = demoList.find(s => s.id === activeId) || demoList[0];
                setCurrentStore(active);
                return demoList;
            }

            // Real users only past this point (demo handled above)
            if (!user) {
                setCurrentStore(null);
                return null;
            }

            // Real user: Query store memberships
            const { data: memberRows, error: memberError } = await supabase
                .from('store_members')
                .select('store_id, role, store:stores(*)')
                .eq('user_id', user.id);

            if (memberError) {
                console.error('[StoreContext] Failed to load store members:', memberError.message);
                // Never leave a demo/previous-store fallback in place for a
                // real account; a stale store id would poison every query.
                setUserStores([]);
                setStoreRoles({});
                setCurrentStore(null);
                return null;
            }

            const storesList: Store[] = [];
            const roles: Record<string, 'owner' | 'admin' | 'staff'> = {};

            (memberRows || []).forEach(row => {
                if (row.store) {
                    const st = row.store as unknown as Store;
                    storesList.push(st);
                    roles[st.id] = (row.role as 'owner' | 'admin' | 'staff') || 'staff';
                }
            });

            // If user has zero stores, auto-provision default store.
            // create_store is atomic: store + owner membership + invite code.
            if (storesList.length === 0) {
                const defaultName = (user.user_metadata?.store_name as string)
                    || (user.email ? user.email.split('@')[0] : 'My Kirana Store');

                const { data: newStore, error: createError } = await supabase.rpc('create_store', {
                    p_name: defaultName,
                });

                if (createError) {
                    console.error('[StoreContext] Failed to provision default store:', createError.message);
                } else if (newStore) {
                    const created = newStore as unknown as Store;
                    storesList.push(created);
                    roles[created.id] = 'owner';
                }
            }

            // Resolve the active store BEFORE publishing roles/store state so
            // the previous account's store can never pair with the new roles
            // map (which would transiently report the owner as staff).
            const activeId = await AsyncStorage.getItem(STORE_STORAGE_KEYS.ACTIVE_STORE_ID);
            const active = storesList.find(s => s.id === activeId) || storesList[0] || null;

            setUserStores(storesList);
            setStoreRoles(roles);
            setCurrentStore(active);

            if (active) {
                await AsyncStorage.setItem(STORE_STORAGE_KEYS.ACTIVE_STORE_ID, active.id);
            }

            return storesList;
        } catch (err) {
            console.error('[StoreContext] Error loading stores:', err);
            setUserStores([]);
            setStoreRoles({});
            setCurrentStore(null);
            return null;
        } finally {
            setIsLoading(false);
        }
    }, [authLoading, isDemo, user]);

    // Single-flight: concurrent loads (mount + join + refresh) must never
    // double-provision a default store.
    const loadInFlightRef = useRef<Promise<Store[] | null> | null>(null);
    const loadStores = useCallback(async (): Promise<Store[] | null> => {
        if (loadInFlightRef.current) return loadInFlightRef.current;
        const run = loadStoresInternal();
        loadInFlightRef.current = run;
        try {
            return await run;
        } finally {
            if (loadInFlightRef.current === run) {
                loadInFlightRef.current = null;
            }
        }
    }, [loadStoresInternal]);

    // 2. Fetch members for current store
    const refreshMembers = useCallback(async () => {
        if (!currentStore) {
            setMembers([]);
            return;
        }

        if (isDemo) {
            const storedMembers = await AsyncStorage.getItem(STORE_STORAGE_KEYS.DEMO_MEMBERS);
            const memList = safeJsonParse<StoreMember[]>(storedMembers, DEFAULT_DEMO_MEMBERS);
            setMembers(memList.filter(m => m.store_id === currentStore.id));
            return;
        }

        try {
            const { data, error } = await supabase
                .from('store_members')
                .select('*')
                .eq('store_id', currentStore.id)
                .order('joined_at', { ascending: true });

            if (!error && data) {
                setMembers(data as StoreMember[]);
            }
        } catch (err) {
            console.error('[StoreContext] Error loading members:', err);
        }
    }, [currentStore, isDemo]);

    // 3a. Activate a known store object (works even before state updates flush)
    const activateStore = useCallback(async (store: Store) => {
        setCurrentStore(store);
        await AsyncStorage.setItem(STORE_STORAGE_KEYS.ACTIVE_STORE_ID, store.id);
    }, []);

    // 3b. Switch active store by id
    const switchStore = useCallback(async (storeId: string) => {
        const target = userStores.find(s => s.id === storeId);
        if (!target) return;

        await activateStore(target);
    }, [userStores, activateStore]);

    // 4. Create new store (e.g. Godown or 2nd Branch)
    const createStore = useCallback(async (data: {
        name: string;
        category?: string;
        address?: string;
        phone?: string;
        upi_id?: string;
    }): Promise<Store> => {
        const storeName = data.name.trim();
        if (!storeName) throw new Error('Store name cannot be empty');

        if (isDemo) {
            const newStore: Store = {
                id: `demo-store-${Date.now()}`,
                name: storeName,
                owner_id: 'demo-user',
                category: data.category || 'GENERAL',
                phone: data.phone || null,
                address: data.address || null,
                upi_id: data.upi_id || null,
                invite_code: `KAKA${Math.floor(1000 + Math.random() * 9000)}`,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };

            const updated = [...userStores, newStore];
            setUserStores(updated);

            const storedRoles = await AsyncStorage.getItem(STORE_STORAGE_KEYS.DEMO_ROLES);
            const roleMap = safeJsonParse<Record<string, 'owner' | 'admin' | 'staff'>>(storedRoles, {});
            roleMap[newStore.id] = 'owner';
            setStoreRoles(roleMap);
            await AsyncStorage.multiSet([
                [STORE_STORAGE_KEYS.DEMO_STORES, JSON.stringify(updated)],
                [STORE_STORAGE_KEYS.DEMO_ROLES, JSON.stringify(roleMap)],
            ]);
            await activateStore(newStore);
            return newStore;
        }

        // Real user creation via the atomic create_store RPC
        const { data: createdRow, error: createError } = await supabase.rpc('create_store', {
            p_name: storeName,
            p_category: data.category || 'GENERAL',
            p_address: data.address || null,
            p_phone: data.phone || null,
            p_upi_id: data.upi_id || null,
        });

        if (createError || !createdRow) {
            throw new Error(createError?.message || 'Failed to create store');
        }

        const newStore = createdRow as unknown as Store;

        const updated = [...userStores, newStore];
        setUserStores(updated);
        setStoreRoles(prev => ({ ...prev, [newStore.id]: 'owner' }));
        await activateStore(newStore);
        return newStore;
    }, [isDemo, user, userStores, activateStore]);

    // 5. Update store details
    const updateStore = useCallback(async (storeId: string, data: Partial<Store>) => {
        if (isDemo) {
            const updated = userStores.map(s => {
                if (s.id === storeId) {
                    return { ...s, ...data, updated_at: new Date().toISOString() };
                }
                return s;
            });
            setUserStores(updated);
            await AsyncStorage.setItem(STORE_STORAGE_KEYS.DEMO_STORES, JSON.stringify(updated));
            if (currentStore?.id === storeId) {
                setCurrentStore(prev => (prev ? { ...prev, ...data } : null));
            }
            return;
        }

        const { error } = await supabase
            .from('stores')
            .update({
                name: data.name,
                category: data.category,
                phone: data.phone,
                address: data.address,
                upi_id: data.upi_id,
                updated_at: new Date().toISOString(),
            })
            .eq('id', storeId);

        if (error) throw new Error(error.message);

        // Update local state
        setUserStores(prev =>
            prev.map(s => (s.id === storeId ? { ...s, ...data } : s))
        );
        if (currentStore?.id === storeId) {
            setCurrentStore(prev => (prev ? { ...prev, ...data } : null));
        }
    }, [isDemo, userStores, currentStore]);

    // 6. Join store via Invite Code (Child / Staff)
    const joinStoreByCode = useCallback(async (
        code: string,
        displayName?: string
    ): Promise<{ success: boolean; store?: Store; error?: string }> => {
        const cleanCode = code.trim().toUpperCase();
        if (!cleanCode) return { success: false, error: 'Please enter a valid invite code' };

        if (isDemo) {
            // Demo join simulation
            const demoStore: Store = {
                id: `joined-store-${Date.now()}`,
                name: `Partner Store (${cleanCode})`,
                owner_id: 'other-user',
                category: 'GENERAL',
                phone: '9811223344',
                address: 'Main Market Road',
                invite_code: cleanCode,
                created_at: new Date().toISOString(),
            };

            const updatedStores = [...userStores, demoStore];
            setUserStores(updatedStores);

            const storedRoles = await AsyncStorage.getItem(STORE_STORAGE_KEYS.DEMO_ROLES);
            const roleMap = safeJsonParse<Record<string, 'owner' | 'admin' | 'staff'>>(storedRoles, {});
            roleMap[demoStore.id] = 'staff';
            setStoreRoles(roleMap);
            await AsyncStorage.multiSet([
                [STORE_STORAGE_KEYS.DEMO_STORES, JSON.stringify(updatedStores)],
                [STORE_STORAGE_KEYS.DEMO_ROLES, JSON.stringify(roleMap)],
            ]);

            const newMember: StoreMember = {
                id: `mem-${Date.now()}`,
                store_id: demoStore.id,
                user_id: 'demo-user',
                role: 'staff',
                display_name: displayName || 'Staff',
                joined_at: new Date().toISOString(),
            };
            const storedMembers = await AsyncStorage.getItem(STORE_STORAGE_KEYS.DEMO_MEMBERS);
            const currentMemList = safeJsonParse<StoreMember[]>(storedMembers, DEFAULT_DEMO_MEMBERS);
            await AsyncStorage.setItem(STORE_STORAGE_KEYS.DEMO_MEMBERS, JSON.stringify([...currentMemList, newMember]));

            await activateStore(demoStore);
            return { success: true, store: demoStore };
        }

        // Real user join via database RPC
        const { data, error } = await supabase.rpc('join_store_by_invite_code', {
            p_invite_code: cleanCode,
            p_display_name: displayName || 'Staff',
        });

        if (error) {
            return { success: false, error: error.message };
        }

        const res = data as {
            success: boolean;
            error?: string;
            store_id?: string;
            store_name?: string;
            role?: 'owner' | 'admin' | 'staff';
        };

        if (!res.success) {
            return { success: false, error: res.error || 'Failed to join store' };
        }

        // Wait for any in-flight load, then force a fresh read that includes
        // the new membership (the in-flight one may predate the join).
        await loadStores();
        const reloaded = await loadStores();
        const joined = res.store_id ? reloaded?.find(s => s.id === res.store_id) : undefined;
        if (joined) {
            await activateStore(joined);
        }

        return { success: true, store: joined };
    }, [isDemo, userStores, loadStores, activateStore]);

    // 7. Generate or refresh invite code
    const generateInviteCode = useCallback(async (storeId: string): Promise<string> => {
        if (isDemo) {
            const newCode = `KAKA${Math.floor(1000 + Math.random() * 9000)}`;
            await updateStore(storeId, { invite_code: newCode });
            return newCode;
        }

        const { data, error } = await supabase.rpc('generate_store_invite_code', { p_store_id: storeId });
        if (error || !data) {
            throw new Error(error?.message || 'Could not generate invite code');
        }

        const code = String(data);
        setUserStores(prev =>
            prev.map(s => (s.id === storeId ? { ...s, invite_code: code } : s))
        );
        if (currentStore?.id === storeId) {
            setCurrentStore(prev => (prev ? { ...prev, invite_code: code } : null));
        }
        return code;
    }, [isDemo, updateStore, currentStore]);

    // 8. Remove member (Owner only)
    const removeMember = useCallback(async (memberId: string) => {
        if (isDemo) {
            const storedMembers = await AsyncStorage.getItem(STORE_STORAGE_KEYS.DEMO_MEMBERS);
            const list = safeJsonParse<StoreMember[]>(storedMembers, DEFAULT_DEMO_MEMBERS);
            const filtered = list.filter(m => m.id !== memberId);
            await AsyncStorage.setItem(STORE_STORAGE_KEYS.DEMO_MEMBERS, JSON.stringify(filtered));
            setMembers(filtered.filter(m => m.store_id === currentStore?.id));
            return;
        }

        const { error } = await supabase.from('store_members').delete().eq('id', memberId);
        if (error) throw new Error(error.message);
        setMembers(prev => prev.filter(m => m.id !== memberId));
    }, [isDemo, currentStore]);

    useEffect(() => {
        void loadStores();
    }, [loadStores]);

    useEffect(() => {
        void refreshMembers();
    }, [refreshMembers]);

    // Unknown roles must fail safe (restricted), never fall back to owner.
    const activeRole = currentStore ? (storeRoles[currentStore.id] ?? 'staff') : 'owner';
    const isOwner = activeRole === 'owner' || activeRole === 'admin';

    const value: StoreContextType = {
        currentStore,
        userStores,
        currentRole: activeRole,
        isOwner,
        isLoading,
        switchStore,
        createStore,
        updateStore,
        joinStoreByCode,
        generateInviteCode,
        members,
        refreshMembers,
        removeMember,
        refreshStores: async () => {
            await loadStores();
        },
    };

    return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

const DEFAULT_STORE_CONTEXT: StoreContextType = {
    currentStore: null,
    userStores: [],
    currentRole: 'staff',
    isOwner: false,
    isLoading: false,
    switchStore: async () => {},
    createStore: async () => {
        throw new Error('useStore must be used within a StoreProvider to create stores');
    },
    updateStore: async () => {},
    joinStoreByCode: async () => ({ success: false, error: 'StoreProvider is not mounted' }),
    generateInviteCode: async () => '',
    members: [],
    refreshMembers: async () => {},
    removeMember: async () => {},
    refreshStores: async () => {},
};

export function useStore(): StoreContextType {
    return useContext(StoreContext) ?? DEFAULT_STORE_CONTEXT;
}
