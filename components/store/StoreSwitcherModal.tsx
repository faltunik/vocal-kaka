import React, { useState } from 'react';
import {
    FlatList,
    Modal,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Colors } from '@/constants/Colors';
import { Radius, Spacing } from '@/constants/Layout';
import { Typography } from '@/constants/Typography';
import { Store, useStore } from '@/services/StoreContext';
import { Ionicons } from '@expo/vector-icons';
import { CreateStoreModal } from './CreateStoreModal';
import { JoinStoreModal } from './JoinStoreModal';
import { StoreSettingsModal } from './StoreSettingsModal';

interface StoreSwitcherModalProps {
    visible: boolean;
    onClose: () => void;
}

export function StoreSwitcherModal({ visible, onClose }: StoreSwitcherModalProps) {
    const { currentStore, userStores, isOwner, switchStore } = useStore();

    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showJoinModal, setShowJoinModal] = useState(false);
    const [showSettingsModal, setShowSettingsModal] = useState(false);

    const handleSelectStore = async (store: Store) => {
        if (store.id !== currentStore?.id) {
            await switchStore(store.id);
        }
        onClose();
    };

    return (
        <>
            <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
                <View style={styles.backdrop}>
                    <View style={styles.sheet}>
                        {/* Header */}
                        <View style={styles.header}>
                            <View>
                                <Text style={styles.title}>Switch Store</Text>
                                <Text style={styles.subtitle}>Select counter shop or godown</Text>
                            </View>
                            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                                <Ionicons name="close" size={24} color={Colors.light.textSecondary} />
                            </TouchableOpacity>
                        </View>

                        {/* Store List */}
                        <FlatList
                            data={userStores}
                            keyExtractor={item => item.id}
                            contentContainerStyle={styles.storeList}
                            renderItem={({ item }) => {
                                const isActive = item.id === currentStore?.id;
                                return (
                                    <TouchableOpacity
                                        style={[styles.storeCard, isActive && styles.storeCardActive]}
                                        onPress={() => void handleSelectStore(item)}
                                        activeOpacity={0.7}
                                    >
                                        <View style={[styles.storeIcon, isActive && styles.storeIconActive]}>
                                            <Ionicons
                                                name="storefront"
                                                size={20}
                                                color={isActive ? '#fff' : Colors.light.textSecondary}
                                            />
                                        </View>

                                        <View style={styles.storeDetails}>
                                            <Text style={[styles.storeName, isActive && styles.storeNameActive]}>
                                                {item.name}
                                            </Text>
                                            <Text style={styles.storeLocality} numberOfLines={1}>
                                                {item.address || `${item.category} Store`}
                                            </Text>
                                        </View>

                                        {isActive ? (
                                            <Ionicons name="checkmark-circle" size={22} color={Colors.light.tint} />
                                        ) : (
                                            <Ionicons name="chevron-forward" size={18} color={Colors.light.border} />
                                        )}
                                    </TouchableOpacity>
                                );
                            }}
                        />

                        {/* Action buttons */}
                        <View style={styles.actions}>
                            {isOwner && (
                                <TouchableOpacity
                                    style={styles.actionRow}
                                    onPress={() => {
                                        onClose();
                                        setShowSettingsModal(true);
                                    }}
                                >
                                    <Ionicons name="settings-outline" size={20} color={Colors.light.tint} />
                                    <Text style={styles.actionText}>Store Settings & Staff Sharing</Text>
                                </TouchableOpacity>
                            )}

                            <TouchableOpacity
                                style={styles.actionRow}
                                onPress={() => {
                                    onClose();
                                    setShowCreateModal(true);
                                }}
                            >
                                <Ionicons name="add-circle-outline" size={20} color={Colors.light.tint} />
                                <Text style={styles.actionText}>Add New Store / Godown</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={styles.actionRow}
                                onPress={() => {
                                    onClose();
                                    setShowJoinModal(true);
                                }}
                            >
                                <Ionicons name="key-outline" size={20} color={Colors.light.tint} />
                                <Text style={styles.actionText}>Join Store with Invite Code</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* Sub-modals */}
            <CreateStoreModal
                visible={showCreateModal}
                onClose={() => setShowCreateModal(false)}
            />
            <JoinStoreModal
                visible={showJoinModal}
                onClose={() => setShowJoinModal(false)}
            />
            <StoreSettingsModal
                visible={showSettingsModal}
                onClose={() => setShowSettingsModal(false)}
            />
        </>
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
        maxHeight: '80%',
        gap: Spacing.md,
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
    subtitle: {
        ...Typography.caption,
        color: Colors.light.textSecondary,
    },
    closeBtn: {
        padding: Spacing.xs,
    },
    storeList: {
        gap: Spacing.xs,
    },
    storeCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: Colors.light.surface,
        borderRadius: Radius.lg,
        padding: Spacing.md,
        borderWidth: 1,
        borderColor: Colors.light.border,
        gap: Spacing.sm,
    },
    storeCardActive: {
        borderColor: Colors.light.tint,
        backgroundColor: Colors.light.surface,
    },
    storeIcon: {
        width: 40,
        height: 40,
        borderRadius: Radius.md,
        backgroundColor: Colors.light.background,
        justifyContent: 'center',
        alignItems: 'center',
    },
    storeIconActive: {
        backgroundColor: Colors.light.tint,
    },
    storeDetails: {
        flex: 1,
        gap: 2,
    },
    storeName: {
        ...Typography.body,
        fontWeight: 'bold',
        color: Colors.light.text,
    },
    storeNameActive: {
        color: Colors.light.tint,
    },
    storeLocality: {
        ...Typography.caption,
        color: Colors.light.textSecondary,
    },
    actions: {
        borderTopWidth: 1,
        borderColor: Colors.light.border,
        paddingTop: Spacing.md,
        gap: Spacing.sm,
    },
    actionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        paddingVertical: Spacing.xs,
    },
    actionText: {
        ...Typography.bodyStrong,
        color: Colors.light.tint,
    },
});
