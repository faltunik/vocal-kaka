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

interface CreateStoreModalProps {
    visible: boolean;
    onClose: () => void;
}

const CATEGORIES = [
    { key: 'GENERAL', label: 'General Kirana' },
    { key: 'STAPLES', label: 'Wholesale / Grains' },
    { key: 'FMCG', label: 'FMCG / Superette' },
    { key: 'DAIRY_BAKERY', label: 'Dairy & Bakery' },
];

export function CreateStoreModal({ visible, onClose }: CreateStoreModalProps) {
    const { createStore } = useStore();
    const [name, setName] = useState('');
    const [category, setCategory] = useState('GENERAL');
    const [address, setAddress] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    const handleCreate = async () => {
        const trimmed = name.trim();
        if (!trimmed) {
            Alert.alert('Required', 'Please enter a store or godown name.');
            return;
        }

        setIsSaving(true);
        try {
            await createStore({
                name: trimmed,
                category,
                address: address.trim() || undefined,
            });
            setName('');
            setAddress('');
            onClose();
            Alert.alert('Success', `Store "${trimmed}" created and activated!`);
        } catch (err: unknown) {
            Alert.alert('Error', getErrorMessage(err, 'Could not create store.'));
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
            <View style={styles.backdrop}>
                <View style={styles.sheet}>
                    <View style={styles.header}>
                        <Text style={styles.title}>Add New Store / Godown</Text>
                        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                            <Ionicons name="close" size={24} color={Colors.light.textSecondary} />
                        </TouchableOpacity>
                    </View>

                    <Text style={styles.subtitle}>
                        Create a separate catalog for your godown warehouse or a second branch.
                    </Text>

                    <Text style={styles.label}>Store / Godown Name *</Text>
                    <TextInput
                        style={styles.input}
                        placeholder="e.g. Mandi Godown or Station Road Branch"
                        placeholderTextColor={Colors.light.textSecondary}
                        value={name}
                        onChangeText={setName}
                    />

                    <Text style={styles.label}>Store Type</Text>
                    <View style={styles.chipsRow}>
                        {CATEGORIES.map(cat => (
                            <TouchableOpacity
                                key={cat.key}
                                style={[styles.chip, category === cat.key && styles.chipActive]}
                                onPress={() => setCategory(cat.key)}
                            >
                                <Text style={[styles.chipText, category === cat.key && styles.chipTextActive]}>
                                    {cat.label}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    <Text style={styles.label}>Market Locality / Address (Optional)</Text>
                    <TextInput
                        style={styles.input}
                        placeholder="e.g. Warehouse Shed 4, APMC Yard"
                        placeholderTextColor={Colors.light.textSecondary}
                        value={address}
                        onChangeText={setAddress}
                    />

                    <View style={styles.actions}>
                        <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
                            <Text style={styles.cancelBtnText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.saveBtn, isSaving && styles.saveBtnDisabled]}
                            onPress={handleCreate}
                            disabled={isSaving}
                        >
                            {isSaving ? (
                                <ActivityIndicator color="#fff" size="small" />
                            ) : (
                                <Text style={styles.saveBtnText}>Create Store</Text>
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
    chipsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: Spacing.xs,
    },
    chip: {
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.xs,
        borderRadius: Radius.pill,
        backgroundColor: Colors.light.surface,
        borderWidth: 1,
        borderColor: Colors.light.border,
    },
    chipActive: {
        backgroundColor: Colors.light.tint,
        borderColor: Colors.light.tint,
    },
    chipText: {
        ...Typography.caption,
        color: Colors.light.textSecondary,
    },
    chipTextActive: {
        color: '#fff',
        fontWeight: 'bold',
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
    saveBtn: {
        flex: 1,
        height: TouchTarget.min,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: Radius.md,
        backgroundColor: Colors.light.tint,
    },
    saveBtnDisabled: {
        opacity: 0.6,
    },
    saveBtnText: {
        ...Typography.bodyStrong,
        color: '#fff',
    },
});
