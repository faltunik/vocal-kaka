import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Linking,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Colors } from '@/constants/Colors';
import { Radius, Spacing, TouchTarget } from '@/constants/Layout';
import { Typography } from '@/constants/Typography';
import { StoreMember, useStore } from '@/services/StoreContext';
import { confirmDestructive } from '@/utils/confirm';
import { getErrorMessage } from '@/utils/errors';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';

interface StoreSettingsModalProps {
    visible: boolean;
    onClose: () => void;
}

const CATEGORIES = [
    { key: 'GENERAL', label: 'General Kirana' },
    { key: 'STAPLES', label: 'Wholesale / Grains' },
    { key: 'FMCG', label: 'FMCG / Superette' },
    { key: 'DAIRY_BAKERY', label: 'Dairy & Bakery' },
    { key: 'SPICES', label: 'Spices & Mandi' },
];

export function StoreSettingsModal({ visible, onClose }: StoreSettingsModalProps) {
    const {
        currentStore,
        isOwner,
        updateStore,
        generateInviteCode,
        members,
        refreshMembers,
        removeMember,
    } = useStore();

    const [activeTab, setActiveTab] = useState<'PROFILE' | 'STAFF'>('PROFILE');
    const [name, setName] = useState('');
    const [category, setCategory] = useState('GENERAL');
    const [phone, setPhone] = useState('');
    const [address, setAddress] = useState('');
    const [upiId, setUpiId] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [isRegenerating, setIsRegenerating] = useState(false);

    useEffect(() => {
        if (currentStore) {
            setName(currentStore.name || '');
            setCategory(currentStore.category || 'GENERAL');
            setPhone(currentStore.phone || '');
            setAddress(currentStore.address || '');
            setUpiId(currentStore.upi_id || '');
        }
    }, [currentStore]);

    useEffect(() => {
        if (visible && activeTab === 'STAFF') {
            void refreshMembers();
        }
    }, [visible, activeTab, refreshMembers]);

    const handleSaveProfile = async () => {
        if (!currentStore) return;
        const trimmed = name.trim();
        if (!trimmed) {
            Alert.alert('Required', 'Store name cannot be empty.');
            return;
        }

        setIsSaving(true);
        try {
            await updateStore(currentStore.id, {
                name: trimmed,
                category,
                phone: phone.trim() || null,
                address: address.trim() || null,
                upi_id: upiId.trim() || null,
            });
            Alert.alert('Saved', 'Store profile updated successfully.');
        } catch (err: unknown) {
            Alert.alert('Error', getErrorMessage(err, 'Could not update store profile.'));
        } finally {
            setIsSaving(false);
        }
    };

    const handleCopyCode = async () => {
        if (!currentStore?.invite_code) return;
        await Clipboard.setStringAsync(currentStore.invite_code);
        Alert.alert('Copied!', `Store invite code ${currentStore.invite_code} copied to clipboard.`);
    };

    const handleShareWhatsApp = async () => {
        if (!currentStore?.invite_code) return;
        const text = `🛒 *Join ${currentStore.name} on VocalStock*\n` +
            `Use Store Code: *${currentStore.invite_code}*\n\n` +
            `Download the app, tap "Join Store", and enter this code to connect to our counter inventory!`;
        const url = `whatsapp://send?text=${encodeURIComponent(text)}`;
        try {
            const canOpen = await Linking.canOpenURL(url);
            if (canOpen) {
                await Linking.openURL(url);
            } else {
                await handleCopyCode();
            }
        } catch {
            await handleCopyCode();
        }
    };

    const handleRegenerateCode = async () => {
        if (!currentStore) return;
        Alert.alert(
            'New Invite Code',
            'Regenerating the code will invalidate the previous code for new joins. Continue?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Regenerate',
                    onPress: async () => {
                        setIsRegenerating(true);
                        try {
                            const newCode = await generateInviteCode(currentStore.id);
                            Alert.alert('Success', `New invite code: ${newCode}`);
                        } catch (err: unknown) {
                            Alert.alert('Error', getErrorMessage(err, 'Could not regenerate code.'));
                        } finally {
                            setIsRegenerating(false);
                        }
                    },
                },
            ]
        );
    };

    const handleRemoveMember = (member: StoreMember) => {
        if (!isOwner) {
            Alert.alert('Not allowed', 'Only the store owner can manage team members.');
            return;
        }
        if (member.role === 'owner') {
            Alert.alert('Error', 'The store owner cannot be removed.');
            return;
        }

        confirmDestructive(
            'Remove Member',
            `Remove ${member.display_name || 'this staff member'} from the store? They will lose access to counter inventory.`,
            'Remove',
            async () => {
                try {
                    await removeMember(member.id);
                } catch (err: unknown) {
                    Alert.alert('Error', getErrorMessage(err, 'Failed to remove member.'));
                }
            }
        );
    };

    return (
        <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
            <View style={styles.backdrop}>
                <View style={styles.sheet}>
                    {/* Header */}
                    <View style={styles.header}>
                        <View>
                            <Text style={styles.title}>Store Settings</Text>
                            <Text style={styles.storeSubtitle}>{currentStore?.name || 'Store Profile'}</Text>
                        </View>
                        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                            <Ionicons name="close" size={24} color={Colors.light.textSecondary} />
                        </TouchableOpacity>
                    </View>

                    {/* Navigation Tabs */}
                    <View style={styles.tabBar}>
                        <TouchableOpacity
                            style={[styles.tabItem, activeTab === 'PROFILE' && styles.tabItemActive]}
                            onPress={() => setActiveTab('PROFILE')}
                        >
                            <Ionicons
                                name="storefront-outline"
                                size={18}
                                color={activeTab === 'PROFILE' ? Colors.light.tint : Colors.light.textSecondary}
                            />
                            <Text style={[styles.tabLabel, activeTab === 'PROFILE' && styles.tabLabelActive]}>
                                Profile
                            </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.tabItem, activeTab === 'STAFF' && styles.tabItemActive]}
                            onPress={() => setActiveTab('STAFF')}
                        >
                            <Ionicons
                                name="people-outline"
                                size={18}
                                color={activeTab === 'STAFF' ? Colors.light.tint : Colors.light.textSecondary}
                            />
                            <Text style={[styles.tabLabel, activeTab === 'STAFF' && styles.tabLabelActive]}>
                                Staff & Sharing ({members.length})
                            </Text>
                        </TouchableOpacity>
                    </View>

                    {/* Tab 1: Profile */}
                    {activeTab === 'PROFILE' && (
                        <ScrollView style={styles.tabScroll} contentContainerStyle={styles.tabContent} showsVerticalScrollIndicator={false}>
                            <Text style={styles.label}>Store Name *</Text>
                            <TextInput
                                style={styles.input}
                                value={name}
                                onChangeText={setName}
                                placeholder="Store Name"
                                placeholderTextColor={Colors.light.textSecondary}
                                editable={isOwner}
                            />

                            <Text style={styles.label}>Store Category</Text>
                            <View style={styles.chipsRow}>
                                {CATEGORIES.map(cat => (
                                    <TouchableOpacity
                                        key={cat.key}
                                        style={[styles.chip, category === cat.key && styles.chipActive]}
                                        onPress={() => isOwner && setCategory(cat.key)}
                                        disabled={!isOwner}
                                    >
                                        <Text style={[styles.chipText, category === cat.key && styles.chipTextActive]}>
                                            {cat.label}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>

                            <Text style={styles.label}>WhatsApp Phone (for Reorder Parchis)</Text>
                            <TextInput
                                style={styles.input}
                                value={phone}
                                onChangeText={setPhone}
                                placeholder="e.g. 9876543210"
                                placeholderTextColor={Colors.light.textSecondary}
                                keyboardType="phone-pad"
                                editable={isOwner}
                            />

                            <Text style={styles.label}>Market Address / Locality</Text>
                            <TextInput
                                style={styles.input}
                                value={address}
                                onChangeText={setAddress}
                                placeholder="e.g. Shop 4, APMC Grain Market"
                                placeholderTextColor={Colors.light.textSecondary}
                                editable={isOwner}
                            />

                            <Text style={styles.label}>UPI ID (for Payment QR)</Text>
                            <TextInput
                                style={styles.input}
                                value={upiId}
                                onChangeText={setUpiId}
                                placeholder="e.g. yourstore@okaxis"
                                placeholderTextColor={Colors.light.textSecondary}
                                autoCapitalize="none"
                                editable={isOwner}
                            />

                            {isOwner && (
                                <TouchableOpacity
                                    style={[styles.saveBtn, isSaving && styles.saveBtnDisabled]}
                                    onPress={handleSaveProfile}
                                    disabled={isSaving}
                                >
                                    {isSaving ? (
                                        <ActivityIndicator color="#fff" size="small" />
                                    ) : (
                                        <Text style={styles.saveBtnText}>Save Profile Changes</Text>
                                    )}
                                </TouchableOpacity>
                            )}
                        </ScrollView>
                    )}

                    {/* Tab 2: Staff & Sharing */}
                    {activeTab === 'STAFF' && (
                        <View style={styles.staffContainer}>
                            {/* Invite Code Box */}
                            <View style={styles.inviteCard}>
                                <Text style={styles.inviteTitle}>Store Invite Code</Text>
                                <Text style={styles.inviteDescription}>
                                    Share this code with your son, daughter, or counter helper to link their phone to this store.
                                </Text>
                                <Text style={styles.inviteExpiryNote}>
                                    Codes expire 24 hours after generation.
                                </Text>

                                <View style={styles.codeRow}>
                                    <Text style={styles.codeText}>{currentStore?.invite_code || '------'}</Text>
                                    {isOwner && (
                                        <TouchableOpacity
                                            style={styles.refreshCodeBtn}
                                            onPress={handleRegenerateCode}
                                            disabled={isRegenerating}
                                        >
                                            <Ionicons name="refresh" size={18} color={Colors.light.tint} />
                                        </TouchableOpacity>
                                    )}
                                </View>

                                <View style={styles.shareButtonsRow}>
                                    <TouchableOpacity style={styles.copyBtn} onPress={handleCopyCode}>
                                        <Ionicons name="copy-outline" size={16} color={Colors.light.text} />
                                        <Text style={styles.copyBtnText}>Copy Code</Text>
                                    </TouchableOpacity>

                                    <TouchableOpacity style={styles.whatsappBtn} onPress={handleShareWhatsApp}>
                                        <Ionicons name="logo-whatsapp" size={16} color="#fff" />
                                        <Text style={styles.whatsappBtnText}>WhatsApp</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>

                            {/* Active Members List */}
                            <Text style={styles.membersHeader}>Active Team Members ({members.length})</Text>
                            <View style={styles.membersList}>
                                {members.map(item => (
                                    <View key={item.id} style={styles.memberCard}>
                                        <View style={styles.memberAvatar}>
                                            <Text style={styles.memberAvatarText}>
                                                {(item.display_name || 'S').charAt(0).toUpperCase()}
                                            </Text>
                                        </View>
                                        <View style={styles.memberInfo}>
                                            <Text style={styles.memberName}>{item.display_name || 'Staff'}</Text>
                                            <View style={styles.roleBadgeRow}>
                                                <View
                                                    style={[
                                                        styles.roleBadge,
                                                        item.role === 'owner' ? styles.roleOwner : styles.roleStaff,
                                                    ]}
                                                >
                                                    <Text
                                                        style={[
                                                            styles.roleBadgeText,
                                                            item.role === 'owner' ? styles.roleOwnerText : styles.roleStaffText,
                                                        ]}
                                                    >
                                                        {item.role.toUpperCase()}
                                                    </Text>
                                                </View>
                                            </View>
                                        </View>

                                        {isOwner && item.role !== 'owner' && (
                                            <TouchableOpacity
                                                style={styles.removeBtn}
                                                onPress={() => handleRemoveMember(item)}
                                                accessibilityRole="button"
                                                accessibilityLabel={`Remove ${item.display_name || 'staff member'}`}
                                            >
                                                <Ionicons name="trash-outline" size={18} color={Colors.light.danger} />
                                            </TouchableOpacity>
                                        )}
                                    </View>
                                ))}
                            </View>
                        </View>
                    )}
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
        // A maxHeight alone let the sheet collapse to its header when the
        // scroll child reported no height. A real height keeps the tab body
        // visible and lets the inner ScrollView do the scrolling.
        height: '85%',
        gap: Spacing.md,
    },
    tabScroll: {
        flexShrink: 1,
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
    storeSubtitle: {
        ...Typography.caption,
        color: Colors.light.textSecondary,
    },
    closeBtn: {
        padding: Spacing.xs,
    },
    tabBar: {
        flexDirection: 'row',
        borderBottomWidth: 1,
        borderColor: Colors.light.border,
        gap: Spacing.lg,
    },
    tabItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.xs,
        paddingBottom: Spacing.sm,
        borderBottomWidth: 2,
        borderColor: 'transparent',
    },
    tabItemActive: {
        borderColor: Colors.light.tint,
    },
    tabLabel: {
        ...Typography.caption,
        color: Colors.light.textSecondary,
    },
    tabLabelActive: {
        color: Colors.light.tint,
        fontWeight: 'bold',
    },
    tabContent: {
        gap: Spacing.sm,
        paddingBottom: Spacing.xxl,
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
    saveBtn: {
        height: TouchTarget.min,
        backgroundColor: Colors.light.tint,
        borderRadius: Radius.md,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: Spacing.md,
    },
    saveBtnDisabled: {
        opacity: 0.6,
    },
    saveBtnText: {
        ...Typography.bodyStrong,
        color: '#fff',
    },
    staffContainer: {
        flex: 1,
        gap: Spacing.md,
    },
    inviteCard: {
        backgroundColor: Colors.light.surface,
        borderRadius: Radius.lg,
        padding: Spacing.md,
        borderWidth: 1,
        borderColor: Colors.light.border,
        gap: Spacing.xs,
    },
    inviteTitle: {
        ...Typography.heading,
        color: Colors.light.text,
    },
    inviteDescription: {
        ...Typography.caption,
        color: Colors.light.textSecondary,
    },
    inviteExpiryNote: {
        ...Typography.caption,
        color: Colors.light.warningText,
    },
    codeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: Spacing.sm,
        backgroundColor: Colors.light.background,
        paddingVertical: Spacing.sm,
        borderRadius: Radius.md,
        marginVertical: Spacing.xs,
    },
    codeText: {
        fontSize: 24,
        fontWeight: 'bold',
        letterSpacing: 3,
        color: Colors.light.tint,
    },
    refreshCodeBtn: {
        padding: Spacing.xs,
    },
    shareButtonsRow: {
        flexDirection: 'row',
        gap: Spacing.sm,
        marginTop: Spacing.xs,
    },
    copyBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: Spacing.xs,
        height: 38,
        borderRadius: Radius.md,
        borderWidth: 1,
        borderColor: Colors.light.border,
        backgroundColor: Colors.light.background,
    },
    copyBtnText: {
        ...Typography.bodyStrong,
        fontSize: 13,
        color: Colors.light.text,
    },
    whatsappBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: Spacing.xs,
        height: 38,
        borderRadius: Radius.md,
        backgroundColor: '#25D366',
    },
    whatsappBtnText: {
        ...Typography.bodyStrong,
        fontSize: 13,
        color: '#fff',
    },
    membersHeader: {
        ...Typography.heading,
        color: Colors.light.text,
        marginTop: Spacing.xs,
    },
    membersList: {
        gap: Spacing.xs,
        paddingBottom: Spacing.lg,
    },
    memberCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: Colors.light.surface,
        borderRadius: Radius.md,
        padding: Spacing.sm,
        borderWidth: 1,
        borderColor: Colors.light.border,
        gap: Spacing.sm,
    },
    memberAvatar: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: Colors.light.surfaceElevated,
        justifyContent: 'center',
        alignItems: 'center',
    },
    memberAvatarText: {
        ...Typography.bodyStrong,
        color: Colors.light.tint,
    },
    memberInfo: {
        flex: 1,
        gap: 2,
    },
    memberName: {
        ...Typography.body,
        fontWeight: '500',
        color: Colors.light.text,
    },
    roleBadgeRow: {
        flexDirection: 'row',
    },
    roleBadge: {
        paddingHorizontal: Spacing.xs,
        paddingVertical: 1,
        borderRadius: Radius.sm,
    },
    roleOwner: {
        backgroundColor: Colors.light.successSoft,
    },
    roleStaff: {
        backgroundColor: Colors.light.surfaceElevated,
    },
    roleBadgeText: {
        fontSize: 10,
        fontWeight: 'bold',
    },
    roleOwnerText: {
        color: Colors.light.success,
    },
    roleStaffText: {
        color: Colors.light.tint,
    },
    removeBtn: {
        padding: Spacing.sm,
    },
});
