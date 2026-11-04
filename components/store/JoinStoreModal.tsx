import React, { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Modal,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Colors } from '@/constants/Colors';
import { Radius, Spacing, TouchTarget } from '@/constants/Layout';
import { Typography } from '@/constants/Typography';
import { useStore } from '@/services/StoreContext';
import { getErrorMessage } from '@/utils/errors';
import { Ionicons } from '@expo/vector-icons';

interface JoinStoreModalProps {
    visible: boolean;
    onClose: () => void;
}

export function JoinStoreModal({ visible, onClose }: JoinStoreModalProps) {
    const { joinStoreByCode } = useStore();
    const [code, setCode] = useState('');
    const [name, setName] = useState('');
    const [isJoining, setIsJoining] = useState(false);

    const handleJoin = async () => {
        const cleanCode = code.trim().toUpperCase();
        if (!cleanCode) {
            Alert.alert('Required', 'Please enter the 6-character store invite code.');
            return;
        }

        setIsJoining(true);
        try {
            const res = await joinStoreByCode(cleanCode, name.trim() || undefined);
            if (res.success) {
                setCode('');
                setName('');
                onClose();
                Alert.alert(
                    'Connected!',
                    `You are now connected to ${res.store?.name || 'the store'}. You can start recording sales immediately!`
                );
            } else {
                Alert.alert('Join Failed', res.error || 'Invalid invite code.');
            }
        } catch (err: unknown) {
            Alert.alert('Error', getErrorMessage(err, 'Could not join store.'));
        } finally {
            setIsJoining(false);
        }
    };

    return (
        <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
            <View style={styles.backdrop}>
                <View style={styles.sheet}>
                    <View style={styles.header}>
                        <Text style={styles.title}>Join a Store</Text>
                        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                            <Ionicons name="close" size={24} color={Colors.light.textSecondary} />
                        </TouchableOpacity>
                    </View>

                    <Text style={styles.subtitle}>
                        Enter the Store Invite Code provided by the store owner (Papa / Employer) to share their live counter inventory.
                    </Text>

                    <Text style={styles.label}>Store Invite Code *</Text>
                    <TextInput
                        style={[styles.input, styles.codeInput]}
                        placeholder="e.g. KAKA89"
                        placeholderTextColor={Colors.light.textSecondary}
                        value={code}
                        onChangeText={t => setCode(t.toUpperCase())}
                        autoCapitalize="characters"
                        maxLength={12}
                    />

                    <Text style={styles.label}>Your Name / Role (Optional)</Text>
                    <TextInput
                        style={styles.input}
                        placeholder="e.g. Aman (Son) or Raju (Cashier)"
                        placeholderTextColor={Colors.light.textSecondary}
                        value={name}
                        onChangeText={setName}
                    />

                    <View style={styles.actions}>
                        <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
                            <Text style={styles.cancelBtnText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.joinBtn, isJoining && styles.joinBtnDisabled]}
                            onPress={handleJoin}
                            disabled={isJoining}
                        >
                            {isJoining ? (
                                <ActivityIndicator color="#fff" size="small" />
                            ) : (
                                <Text style={styles.joinBtnText}>Join Store</Text>
                            )}
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    sheet: {
        backgroundColor: Colors.light.background,
        borderTopLeftRadius: Radius.lg,
        borderTopRightRadius: Radius.lg,
        padding: Spacing.xl,
        gap: Spacing.sm,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    title: {
        ...Typography.heading,
        color: Colors.light.text,
    },
    closeBtn: {
        padding: Spacing.xs,
    },
    subtitle: {
        ...Typography.caption,
        color: Colors.light.textSecondary,
        marginBottom: Spacing.xs,
    },
    label: {
        ...Typography.captionStrong,
        color: Colors.light.textSecondary,
        marginTop: Spacing.xs,
    },
    input: {
        backgroundColor: Colors.light.surface,
        borderWidth: 1,
        borderColor: Colors.light.border,
        borderRadius: Radius.md,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
        fontSize: 15,
        color: Colors.light.text,
    },
    codeInput: {
        fontSize: 20,
        fontWeight: 'bold',
        letterSpacing: 2,
        textAlign: 'center',
    },
    actions: {
        flexDirection: 'row',
        gap: Spacing.md,
        marginTop: Spacing.md,
    },
    cancelBtn: {
        flex: 1,
        height: TouchTarget.min,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: Radius.md,
        borderWidth: 1,
        borderColor: Colors.light.border,
    },
    cancelBtnText: {
        ...Typography.bodyStrong,
        color: Colors.light.textSecondary,
    },
    joinBtn: {
        flex: 1,
        height: TouchTarget.min,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: Radius.md,
        backgroundColor: Colors.light.tint,
    },
    joinBtnDisabled: {
        opacity: 0.6,
    },
    joinBtnText: {
        ...Typography.bodyStrong,
        color: '#fff',
    },
});
