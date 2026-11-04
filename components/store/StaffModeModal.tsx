import { AppButton } from '@/components/ui/AppButton';
import { AppModal } from '@/components/ui/AppModal';
import { AppTextField } from '@/components/ui/AppTextField';
import { Colors } from '@/constants/Colors';
import { Spacing } from '@/constants/Layout';
import { Typography } from '@/constants/Typography';
import { usePrivacy } from '@/services/PrivacyContext';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface StaffModeModalProps {
    visible: boolean;
    onClose: () => void;
}

/**
 * PIN-gated entry/exit for counter Staff Mode (FEAT-08). Enabling without an
 * existing PIN sets one; disabling always verifies the PIN with lockout.
 */
export function StaffModeModal({ visible, onClose }: StaffModeModalProps) {
    const { isStaffMode, hasPin, enableStaffMode, disableStaffMode, lockedUntil } = usePrivacy();
    const [pin, setPin] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (visible) {
            setPin('');
            setError(null);
            setBusy(false);
        }
    }, [visible]);

    const locked = lockedUntil != null && Date.now() < lockedUntil;

    const handleConfirm = async () => {
        if (!/^\d{4}$/.test(pin)) {
            setError('Enter a 4-digit PIN.');
            return;
        }
        if (locked) {
            setError('Too many attempts. Try again in a few minutes.');
            return;
        }

        setBusy(true);
        setError(null);
        try {
            const ok = isStaffMode
                ? await disableStaffMode(pin)
                : await enableStaffMode(pin);

            if (!ok) {
                setError(isStaffMode
                    ? 'Incorrect PIN. Try again.'
                    : 'Could not enable Staff Mode. Check the PIN and try again.');
                return;
            }
            onClose();
        } catch {
            setError('Could not update Staff Mode. Please try again.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <AppModal
            visible={visible}
            onClose={onClose}
            title={isStaffMode ? 'Disable Staff Mode' : 'Enable Staff Mode'}
            closeDisabled={busy}
        >
            <Text style={styles.hint}>
                {isStaffMode
                    ? 'Enter the owner PIN to restore full access.'
                    : hasPin
                        ? 'Enter the owner PIN to hand the counter over to staff.'
                        : 'Set a 4-digit owner PIN. Staff will only see counter operations.'}
            </Text>

            <AppTextField
                label="4-digit PIN"
                value={pin}
                onChangeText={setPin}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={4}
                placeholder="••••"
                testID="staff-mode-pin-input"
            />

            {error && <Text style={styles.error}>{error}</Text>}

            <View style={styles.actions}>
                <AppButton
                    title="Cancel"
                    variant="outline"
                    onPress={onClose}
                    disabled={busy}
                    style={styles.cancel}
                    testID="staff-mode-cancel"
                />
                <AppButton
                    title={isStaffMode ? 'Disable' : 'Enable'}
                    onPress={handleConfirm}
                    loading={busy}
                    disabled={busy}
                    style={styles.confirm}
                    testID="staff-mode-confirm"
                />
            </View>
        </AppModal>
    );
}

const styles = StyleSheet.create({
    hint: {
        ...Typography.body,
        color: Colors.light.textSecondary,
        marginBottom: Spacing.lg,
    },
    error: {
        ...Typography.captionStrong,
        color: Colors.light.danger,
        marginTop: -Spacing.md,
        marginBottom: Spacing.md,
    },
    actions: {
        flexDirection: 'row',
        gap: Spacing.md,
    },
    cancel: {
        flex: 1,
    },
    confirm: {
        flex: 1,
    },
});
