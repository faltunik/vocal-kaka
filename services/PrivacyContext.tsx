import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { useAuth } from './AuthContext';
import { useStore } from './StoreContext';

export const PRIVACY_STORAGE_KEYS = {
    MASKED: '@vocalstock_privacy_masked',
    STAFF_MODE: '@vocalstock_staff_mode',
    PIN_HASH: '@vocalstock_pin_hash',
    PIN_SALT: '@vocalstock_pin_salt',
    FAILURES: '@vocalstock_pin_failed_attempts',
    LOCKED_UNTIL: '@vocalstock_pin_locked_until',
};

const MAX_FAILURES = 5;
const COOLDOWN_MS = 5 * 60 * 1000; // 5-minute security lockout (FEAT-08)

export function generateSalt(): string {
    const arr = new Uint8Array(16);
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
        globalThis.crypto.getRandomValues(arr);
    } else {
        for (let i = 0; i < 16; i++) {
            arr[i] = Math.floor(Math.random() * 256);
        }
    }
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256(message: string): Promise<string> {
    try {
        if (Crypto && typeof Crypto.digestStringAsync === 'function') {
            const res = await Crypto.digestStringAsync(
                Crypto.CryptoDigestAlgorithm.SHA256,
                message
            );
            if (res && typeof res === 'string' && res.length > 0) {
                return res;
            }
        }
    } catch {
        // Fallback if native module is unavailable in current runtime
    }
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
        const msgUint8 = new TextEncoder().encode(message);
        const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', msgUint8);
        return Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const cryptoMod = require('crypto');
        if (cryptoMod?.createHash) {
            return cryptoMod.createHash('sha256').update(message).digest('hex');
        }
    } catch {
        // Fallback for environments where node crypto is not available
    }
    // Fail closed: a weak hash would silently weaken the PIN gate.
    throw new Error('SHA-256 is unavailable on this device');
}

export interface PrivacyContextType {
    /** False until AsyncStorage hydration finishes (gates sensitive queries). */
    isHydrated: boolean;

    // Feature A: Masking
    isMasked: boolean;
    toggleMask: () => Promise<void>;

    // Feature B: Staff Mode
    isStaffMode: boolean;
    hasPin: boolean;
    hasPinSet: boolean;
    enableStaffMode: (pin?: string) => Promise<boolean>;
    disableStaffMode: (pin: string) => Promise<boolean>;

    // PIN Management
    setPin: (newPin: string) => Promise<boolean>;
    setOwnerPin?: (newPin: string, currentPin?: string) => Promise<{ success: boolean; error?: string }>;
    resetPinWithAuth?: (password: string, newPin: string) => Promise<{ success: boolean; error?: string }>;

    // Security & Lockout
    failedAttempts: number;
    lockedUntil: number | null;
}

export const PrivacyContext = createContext<PrivacyContextType | null>(null);

export const PrivacyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    let authContext: ReturnType<typeof useAuth> | undefined;
    try {
        authContext = useAuth();
    } catch {
        // Graceful handling if mounted outside AuthProvider in test environments
    }

    let storeContext: ReturnType<typeof useStore> | undefined;
    try {
        storeContext = useStore();
    } catch {
        // Graceful handling if mounted outside StoreProvider in test environments
    }

    const [isMasked, setIsMasked] = useState<boolean>(true);
    const [isStaffMode, setIsStaffMode] = useState<boolean>(false);
    const [isHydrated, setIsHydrated] = useState<boolean>(false);

    // Account-level staff role (store membership) is always restricted, and can
    // never be unlocked by the device PIN used for temporary counter handover.
    // Only an actually-active store with the staff role counts; a missing
    // provider/loading state must not lock the owner out.
    const isStoreStaffRole = !!storeContext?.currentStore && storeContext.currentRole === 'staff';
    const effectiveStaffMode = isStaffMode || isStoreStaffRole;
    const [hasPin, setHasPin] = useState<boolean>(false);
    const [failedAttempts, setFailedAttempts] = useState<number>(0);
    const [lockedUntil, setLockedUntil] = useState<number | null>(null);

    // Hydrate state from AsyncStorage on mount
    useEffect(() => {
        let isMounted = true;
        (async () => {
            try {
                const [storedMask, storedStaff, storedHash, storedSalt, storedFailures, storedLock] = await Promise.all([
                    AsyncStorage.getItem(PRIVACY_STORAGE_KEYS.MASKED),
                    AsyncStorage.getItem(PRIVACY_STORAGE_KEYS.STAFF_MODE),
                    AsyncStorage.getItem(PRIVACY_STORAGE_KEYS.PIN_HASH),
                    AsyncStorage.getItem(PRIVACY_STORAGE_KEYS.PIN_SALT),
                    AsyncStorage.getItem(PRIVACY_STORAGE_KEYS.FAILURES),
                    AsyncStorage.getItem(PRIVACY_STORAGE_KEYS.LOCKED_UNTIL),
                ]);

                if (!isMounted) return;

                if (storedMask !== null) {
                    setIsMasked(storedMask === 'true');
                } else {
                    setIsMasked(true); // Safe default for Kirana counters
                }

                if (storedStaff !== null) {
                    const staffActive = storedStaff === 'true';
                    setIsStaffMode(staffActive);
                    if (staffActive) {
                        setIsMasked(true);
                    }
                }

                setHasPin(Boolean(storedHash && storedSalt));

                if (storedFailures) {
                    setFailedAttempts(parseInt(storedFailures, 10) || 0);
                }

                if (storedLock) {
                    const lockTime = parseInt(storedLock, 10);
                    if (Date.now() < lockTime) {
                        setLockedUntil(lockTime);
                    } else {
                        await AsyncStorage.multiRemove([
                            PRIVACY_STORAGE_KEYS.FAILURES,
                            PRIVACY_STORAGE_KEYS.LOCKED_UNTIL,
                        ]);
                        setFailedAttempts(0);
                        setLockedUntil(null);
                    }
                }
            } catch (err) {
                console.error('[PrivacyContext] Hydration error:', err);
            } finally {
                if (isMounted) setIsHydrated(true);
            }
        })();

        return () => {
            isMounted = false;
        };
    }, []);

    const toggleMask = useCallback(async () => {
        // In Staff Mode, mask cannot be toggled to unmasked
        if (effectiveStaffMode) return;

        const nextState = !isMasked;
        setIsMasked(nextState);
        await AsyncStorage.setItem(PRIVACY_STORAGE_KEYS.MASKED, String(nextState));
    }, [isMasked, effectiveStaffMode]);

    const setPin = async (newPin: string): Promise<boolean> => {
        if (!/^\d{4}$/.test(newPin)) {
            return false;
        }

        try {
            const salt = generateSalt();
            const hash = await sha256(newPin + salt);

            await AsyncStorage.multiSet([
                [PRIVACY_STORAGE_KEYS.PIN_HASH, hash],
                [PRIVACY_STORAGE_KEYS.PIN_SALT, salt],
            ]);
            setHasPin(true);
            return true;
        } catch (err) {
            console.error('[PrivacyContext] setPin error:', err);
            return false;
        }
    };

    const setOwnerPin = async (newPin: string, currentPin?: string): Promise<{ success: boolean; error?: string }> => {
        if (!/^\d{4}$/.test(newPin)) {
            return { success: false, error: 'PIN must be exactly 4 digits.' };
        }

        const storedHash = await AsyncStorage.getItem(PRIVACY_STORAGE_KEYS.PIN_HASH);
        const storedSalt = await AsyncStorage.getItem(PRIVACY_STORAGE_KEYS.PIN_SALT);

        if (storedHash && storedSalt) {
            if (!currentPin) {
                return { success: false, error: 'Current PIN required to change PIN.' };
            }
            let currentComputed: string;
            try {
                currentComputed = await sha256(currentPin + storedSalt);
            } catch {
                return { success: false, error: 'PIN verification is unavailable on this device.' };
            }
            if (currentComputed !== storedHash) {
                return { success: false, error: 'Current PIN is incorrect.' };
            }
        }

        const ok = await setPin(newPin);
        return ok ? { success: true } : { success: false, error: 'Failed to set PIN.' };
    };

    const enableStaffMode = async (pin?: string): Promise<boolean> => {
        const storedHash = await AsyncStorage.getItem(PRIVACY_STORAGE_KEYS.PIN_HASH);
        const storedSalt = await AsyncStorage.getItem(PRIVACY_STORAGE_KEYS.PIN_SALT);
        const pinConfigured = Boolean(storedHash && storedSalt);

        if (!pinConfigured) {
            if (!pin || !/^\d{4}$/.test(pin)) {
                return false;
            }
            const setupOk = await setPin(pin);
            if (!setupOk) return false;
        } else if (pin) {
            let computed: string;
            try {
                computed = await sha256(pin + storedSalt);
            } catch {
                return false;
            }
            if (computed !== storedHash) {
                return false;
            }
        } else {
            // Fail closed: an existing PIN must always be verified.
            return false;
        }

        setIsStaffMode(true);
        setIsMasked(true); // Force mask in Staff Mode
        await AsyncStorage.multiSet([
            [PRIVACY_STORAGE_KEYS.STAFF_MODE, 'true'],
            [PRIVACY_STORAGE_KEYS.MASKED, 'true'],
        ]);
        return true;
    };

    const disableStaffMode = async (pin: string): Promise<boolean> => {
        if (lockedUntil && Date.now() < lockedUntil) {
            return false;
        }

        const storedHash = await AsyncStorage.getItem(PRIVACY_STORAGE_KEYS.PIN_HASH);
        const storedSalt = await AsyncStorage.getItem(PRIVACY_STORAGE_KEYS.PIN_SALT);

        if (!storedHash || !storedSalt) {
            setIsStaffMode(false);
            await AsyncStorage.setItem(PRIVACY_STORAGE_KEYS.STAFF_MODE, 'false');
            return true;
        }

        let computed: string;
        try {
            computed = await sha256(pin + storedSalt);
        } catch {
            return false;
        }
        if (computed === storedHash) {
            setFailedAttempts(0);
            setLockedUntil(null);
            setIsStaffMode(false);
            await AsyncStorage.multiRemove([
                PRIVACY_STORAGE_KEYS.FAILURES,
                PRIVACY_STORAGE_KEYS.LOCKED_UNTIL,
            ]);
            await AsyncStorage.setItem(PRIVACY_STORAGE_KEYS.STAFF_MODE, 'false');
            return true;
        }

        const nextFailures = failedAttempts + 1;
        setFailedAttempts(nextFailures);
        await AsyncStorage.setItem(PRIVACY_STORAGE_KEYS.FAILURES, String(nextFailures));

        if (nextFailures >= MAX_FAILURES) {
            const lockTime = Date.now() + COOLDOWN_MS;
            setLockedUntil(lockTime);
            await AsyncStorage.setItem(PRIVACY_STORAGE_KEYS.LOCKED_UNTIL, String(lockTime));
        }

        return false;
    };

    const resetPinWithAuth = async (password: string, newPin: string): Promise<{ success: boolean; error?: string }> => {
        if (!authContext?.user?.email) {
            return { success: false, error: 'User email not found.' };
        }
        const { error } = await authContext.signIn(authContext.user.email, password);
        if (error) {
            return { success: false, error: 'Incorrect store account password.' };
        }
        return setOwnerPin(newPin);
    };

    return (
        <PrivacyContext.Provider
            value={{
                isHydrated,
                isMasked,
                toggleMask,
                isStaffMode: effectiveStaffMode,
                hasPin,
                hasPinSet: hasPin,
                enableStaffMode,
                disableStaffMode,
                setPin,
                setOwnerPin,
                resetPinWithAuth,
                failedAttempts,
                lockedUntil,
            }}
        >
            {children}
        </PrivacyContext.Provider>
    );
};

export function usePrivacy(): PrivacyContextType {
    const context = useContext(PrivacyContext);
    if (!context) {
        return {
            isHydrated: true,
            isMasked: false,
            toggleMask: async () => {},
            isStaffMode: false,
            hasPin: false,
            hasPinSet: false,
            enableStaffMode: async () => false,
            disableStaffMode: async () => false,
            setPin: async () => false,
            setOwnerPin: async () => ({ success: false }),
            resetPinWithAuth: async () => ({ success: false }),
            failedAttempts: 0,
            lockedUntil: null,
        };
    }
    return context;
}
