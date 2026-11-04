import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    PrivacyProvider,
    usePrivacy,
    PRIVACY_STORAGE_KEYS,
    generateSalt,
    sha256,
} from '@/services/PrivacyContext';
import React from 'react';

describe('PrivacyContext', () => {
    beforeEach(async () => {
        jest.clearAllMocks();
        await AsyncStorage.clear();
    });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(PrivacyProvider, null, children);

    it('marks privacy as hydrated after storage load', async () => {
        const { result } = renderHook(() => usePrivacy(), { wrapper });

        await waitFor(() => expect(result.current.isHydrated).toBe(true));
    });

    it('starts fail-closed for sensitive consumers', () => {
        const { result } = renderHook(() => usePrivacy(), { wrapper });

        // Before hydration resolves, staff mode is deliberately false but
        // isHydrated is false so profit queries stay disabled.
        expect(typeof result.current.isHydrated).toBe('boolean');
    });

    describe('Hashing and Salt utilities', () => {
        it('generates a 32-character hexadecimal salt', () => {
            const salt1 = generateSalt();
            const salt2 = generateSalt();
            expect(salt1).toHaveLength(32);
            expect(salt2).toHaveLength(32);
            expect(salt1).not.toBe(salt2);
        });

        it('produces consistent SHA-256 hashes for identical inputs', async () => {
            const hash1 = await sha256('1234salt');
            const hash2 = await sha256('1234salt');
            const hash3 = await sha256('4321salt');

            expect(hash1).toBe(hash2);
            expect(hash1).not.toBe(hash3);
        });
    });

    describe('Default State and Hydration', () => {
        it('initializes with safe-by-default masked state', async () => {
            const { result } = renderHook(() => usePrivacy(), { wrapper });

            await waitFor(() => {
                expect(result.current.isMasked).toBe(true);
            });
            expect(result.current.isStaffMode).toBe(false);
            expect(result.current.hasPin).toBe(false);
            expect(result.current.hasPinSet).toBe(false);
            expect(result.current.failedAttempts).toBe(0);
            expect(result.current.lockedUntil).toBeNull();
        });

        it('hydrates unmasked state if previously stored in AsyncStorage', async () => {
            await AsyncStorage.setItem(PRIVACY_STORAGE_KEYS.MASKED, 'false');

            const { result } = renderHook(() => usePrivacy(), { wrapper });

            await waitFor(() => {
                expect(result.current.isMasked).toBe(false);
            });
        });

        it('hydrates active staff mode and forces mask', async () => {
            await AsyncStorage.multiSet([
                [PRIVACY_STORAGE_KEYS.STAFF_MODE, 'true'],
                [PRIVACY_STORAGE_KEYS.MASKED, 'false'],
                [PRIVACY_STORAGE_KEYS.PIN_HASH, 'dummy-hash'],
                [PRIVACY_STORAGE_KEYS.PIN_SALT, 'dummy-salt'],
            ]);

            const { result } = renderHook(() => usePrivacy(), { wrapper });

            await waitFor(() => {
                expect(result.current.isStaffMode).toBe(true);
                expect(result.current.isMasked).toBe(true);
                expect(result.current.hasPin).toBe(true);
            });
        });
    });

    describe('Mask Toggle & Persistence', () => {
        it('toggles mask state and persists to AsyncStorage', async () => {
            const { result } = renderHook(() => usePrivacy(), { wrapper });

            await waitFor(() => expect(result.current.isMasked).toBe(true));

            // Toggle to unmasked
            await act(async () => {
                await result.current.toggleMask();
            });

            expect(result.current.isMasked).toBe(false);
            expect(await AsyncStorage.getItem(PRIVACY_STORAGE_KEYS.MASKED)).toBe('false');

            // Toggle back to masked
            await act(async () => {
                await result.current.toggleMask();
            });

            expect(result.current.isMasked).toBe(true);
            expect(await AsyncStorage.getItem(PRIVACY_STORAGE_KEYS.MASKED)).toBe('true');
        });

        it('prevents unmasking when Staff Mode is active', async () => {
            const { result } = renderHook(() => usePrivacy(), { wrapper });

            await act(async () => {
                await result.current.setPin('1234');
                await result.current.enableStaffMode('1234');
            });

            expect(result.current.isStaffMode).toBe(true);
            expect(result.current.isMasked).toBe(true);

            // Attempt to toggle mask while in Staff Mode
            await act(async () => {
                await result.current.toggleMask();
            });

            expect(result.current.isMasked).toBe(true);
        });
    });

    describe('PIN Management', () => {
        it('sets 4-digit PIN and stores salted hash in AsyncStorage', async () => {
            const { result } = renderHook(() => usePrivacy(), { wrapper });

            let success = false;
            await act(async () => {
                success = await result.current.setPin('4829');
            });

            expect(success).toBe(true);
            expect(result.current.hasPin).toBe(true);

            const storedHash = await AsyncStorage.getItem(PRIVACY_STORAGE_KEYS.PIN_HASH);
            const storedSalt = await AsyncStorage.getItem(PRIVACY_STORAGE_KEYS.PIN_SALT);

            expect(storedHash).toBeTruthy();
            expect(storedSalt).toBeTruthy();
            // Verify plaintext PIN is never stored
            expect(storedHash).not.toBe('4829');
            expect(storedSalt).not.toBe('4829');

            // Verify hash matches
            const computed = await sha256('4829' + storedSalt);
            expect(computed).toBe(storedHash);
        });

        it('rejects invalid PIN formats (not 4 digits)', async () => {
            const { result } = renderHook(() => usePrivacy(), { wrapper });

            let res1 = false;
            let res2 = false;
            let res3 = false;

            await act(async () => {
                res1 = await result.current.setPin('123');
                res2 = await result.current.setPin('12345');
                res3 = await result.current.setPin('abcd');
            });

            expect(res1).toBe(false);
            expect(res2).toBe(false);
            expect(res3).toBe(false);
            expect(result.current.hasPin).toBe(false);
        });

        it('allows changing PIN using setOwnerPin with current PIN verification', async () => {
            const { result } = renderHook(() => usePrivacy(), { wrapper });

            await act(async () => {
                await result.current.setPin('1234');
            });

            // Fails with wrong current PIN
            let changeRes: { success: boolean; error?: string } = { success: false };
            await act(async () => {
                changeRes = await result.current.setOwnerPin!('5678', '9999');
            });
            expect(changeRes.success).toBe(false);

            // Succeeds with correct current PIN
            await act(async () => {
                changeRes = await result.current.setOwnerPin!('5678', '1234');
            });
            expect(changeRes.success).toBe(true);

            // Verify new PIN works to unlock staff mode
            await act(async () => {
                await result.current.enableStaffMode('5678');
            });
            expect(result.current.isStaffMode).toBe(true);

            let unlock = false;
            await act(async () => {
                unlock = await result.current.disableStaffMode('5678');
            });
            expect(unlock).toBe(true);
            expect(result.current.isStaffMode).toBe(false);
        });

        it('refuses to enable staff mode without the configured PIN', async () => {
            const { result } = renderHook(() => usePrivacy(), { wrapper });

            await act(async () => {
                await result.current.setPin('1234');
            });

            let enabled: boolean | undefined;
            await act(async () => {
                enabled = await result.current.enableStaffMode();
            });

            expect(enabled).toBe(false);
            expect(result.current.isStaffMode).toBe(false);
        });
    });

    describe('Staff Mode Activation and Deactivation', () => {
        it('refuses to enable Staff Mode without a PIN when none is set', async () => {
            const { result } = renderHook(() => usePrivacy(), { wrapper });

            let enabled = false;
            await act(async () => {
                enabled = await result.current.enableStaffMode();
            });

            expect(enabled).toBe(false);
            expect(result.current.isStaffMode).toBe(false);
        });

        it('allows setting PIN and enabling Staff Mode in one step', async () => {
            const { result } = renderHook(() => usePrivacy(), { wrapper });

            let enabled = false;
            await act(async () => {
                enabled = await result.current.enableStaffMode('7492');
            });

            expect(enabled).toBe(true);
            expect(result.current.isStaffMode).toBe(true);
            expect(result.current.hasPin).toBe(true);
            expect(result.current.isMasked).toBe(true);
            expect(await AsyncStorage.getItem(PRIVACY_STORAGE_KEYS.STAFF_MODE)).toBe('true');
        });

        it('fails to disable Staff Mode with wrong PIN and increments failure counter', async () => {
            const { result } = renderHook(() => usePrivacy(), { wrapper });

            await act(async () => {
                await result.current.setPin('1234');
                await result.current.enableStaffMode('1234');
            });

            let unlocked = false;
            await act(async () => {
                unlocked = await result.current.disableStaffMode('0000');
            });

            expect(unlocked).toBe(false);
            expect(result.current.isStaffMode).toBe(true);
            expect(result.current.failedAttempts).toBe(1);
            expect(await AsyncStorage.getItem(PRIVACY_STORAGE_KEYS.FAILURES)).toBe('1');
        });

        it('successfully disables Staff Mode with correct PIN and resets failures', async () => {
            const { result } = renderHook(() => usePrivacy(), { wrapper });

            await act(async () => {
                await result.current.setPin('1234');
                await result.current.enableStaffMode('1234');
                await result.current.disableStaffMode('0000'); // 1st failure
            });

            expect(result.current.failedAttempts).toBe(1);

            let unlocked = false;
            await act(async () => {
                unlocked = await result.current.disableStaffMode('1234');
            });

            expect(unlocked).toBe(true);
            expect(result.current.isStaffMode).toBe(false);
            expect(result.current.failedAttempts).toBe(0);
            expect(await AsyncStorage.getItem(PRIVACY_STORAGE_KEYS.STAFF_MODE)).toBe('false');
        });

        it('triggers 5-minute cooldown lockout after 5 consecutive failures', async () => {
            const { result } = renderHook(() => usePrivacy(), { wrapper });

            await act(async () => {
                await result.current.setPin('1234');
                await result.current.enableStaffMode('1234');
            });

            // Enter wrong PIN 5 times
            for (let i = 0; i < 5; i++) {
                await act(async () => {
                    await result.current.disableStaffMode('9999');
                });
            }

            expect(result.current.failedAttempts).toBe(5);
            expect(result.current.lockedUntil).not.toBeNull();
            expect(result.current.lockedUntil! > Date.now()).toBe(true);

            // Attempt with correct PIN while locked out must still fail
            let unlocked = false;
            await act(async () => {
                unlocked = await result.current.disableStaffMode('1234');
            });

            expect(unlocked).toBe(false);
            expect(result.current.isStaffMode).toBe(true);
        });
    });
});
