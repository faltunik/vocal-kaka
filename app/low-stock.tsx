import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    TouchableOpacity,
    RefreshControl,
    TextInput,
    Modal,
    Pressable,
    ScrollView,
    Alert,
    Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { AppHeader } from '@/components/ui/AppHeader';
import { AppButton } from '@/components/ui/AppButton';
import { Colors } from '@/constants/Colors';
import { Spacing, Radius, TouchTarget } from '@/constants/Layout';
import { Typography } from '@/constants/Typography';
import { useAuth } from '@/services/AuthContext';
import { useStore } from '@/services/StoreContext';
import { useLowStock } from '@/hooks/useLowStock';
import {
    generateParchiText,
    generateParchiHtml,
    shareParchiOnWhatsApp,
    copyParchiToClipboard,
    formatBaseUnit,
    resolveWholesalePackaging,
    ParchiItem,
    DEFAULT_PARCHI_NOTE,
} from '@/utils/parchi';
import { formatFriendlyQuantity } from '@/utils/format';
import { getStoreDisplayName } from '@/utils/storeName';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

export default function LowStockScreen() {
    const { user } = useAuth();
    const {
        items,
        outOfStockCount,
        lowStockCount,
        loading,
        refetch,
        error,
        selectedIds,
        toggleSelect,
        selectAll,
        deselectAll,
        reorderQuantities,
        updateQuantity,
    } = useLowStock();

    const [filterTab, setFilterTab] = useState<'ALL' | 'OUT' | 'LOW'>('ALL');
    const [previewModalVisible, setPreviewModalVisible] = useState(false);
    const [copiedToast, setCopiedToast] = useState(false);
    const [note, setNote] = useState<string>(DEFAULT_PARCHI_NOTE);
    const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const showCopiedToast = () => {
        setCopiedToast(true);
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => setCopiedToast(false), 2500);
    };

    useEffect(() => () => {
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    }, []);

    const { currentStore } = useStore();
    const storeName = useMemo(() => getStoreDisplayName({
        storeName: currentStore?.name,
        metadataName: user?.user_metadata?.store_name,
        email: user?.email,
    }), [currentStore, user]);

    // Resolve wholesale packaging once per item and reuse it in both the list
    // and the generated parchi (avoids divergent factors between the two).
    const packagingById = useMemo(() => {
        const map = new Map<string, ReturnType<typeof resolveWholesalePackaging>>();
        for (const item of items) {
            map.set(item.id, resolveWholesalePackaging(item));
        }
        return map;
    }, [items]);

    const filteredItems = useMemo(() => {
        if (filterTab === 'OUT') return items.filter(i => i.isOutOfStock);
        if (filterTab === 'LOW') return items.filter(i => !i.isOutOfStock);
        return items;
    }, [items, filterTab]);

    // The OUT tab disappears when the count reaches zero; never leave the user
    // on an empty filtered view that claims everything is healthy.
    useEffect(() => {
        if (filterTab === 'OUT' && outOfStockCount === 0) {
            setFilterTab('ALL');
        }
    }, [filterTab, outOfStockCount]);

    const selectedCount = selectedIds.size;
    const isAllSelected = items.length > 0 && selectedCount === items.length;

    const handleMasterToggle = () => {
        if (isAllSelected) {
            deselectAll();
        } else {
            selectAll();
        }
    };

    const parchiItems: ParchiItem[] = useMemo(() => {
        return items
            .filter(item => selectedIds.has(item.id))
            .map(item => {
                const secQty = reorderQuantities[item.id] ?? item.suggestedSecondaryQty ?? 1;
                const packaging = packagingById.get(item.id) ?? resolveWholesalePackaging(item);
                return {
                    ...item,
                    reorderQuantity: secQty,
                    calculatedBaseQty: secQty * packaging.factor,
                };
            });
    }, [items, selectedIds, reorderQuantities, packagingById]);

    const parchiText = useMemo(() => {
        return generateParchiText(storeName, parchiItems, {
            note,
            address: currentStore?.address,
            phone: currentStore?.phone,
            upiId: currentStore?.upi_id,
        });
    }, [storeName, parchiItems, note, currentStore]);

    const handleShare = async () => {
        if (selectedCount === 0) {
            Alert.alert('Selection Required', 'Please select at least one item to order.');
            return;
        }
        const result = await shareParchiOnWhatsApp(parchiText);
        if (result.success && result.method === 'clipboard') {
            showCopiedToast();
        } else if (!result.success) {
            Alert.alert('Sharing unavailable', 'Could not share or copy the Parchi. Please try again.');
        }
    };

    const handleCopy = async () => {
        if (selectedCount === 0) {
            Alert.alert('Selection Required', 'Please select at least one item to copy.');
            return;
        }
        const ok = await copyParchiToClipboard(parchiText);
        if (ok) {
            showCopiedToast();
        }
    };

    const handleSharePdf = async () => {
        if (selectedCount === 0) {
            Alert.alert('Selection Required', 'Please select at least one item to export.');
            return;
        }
        try {
            const html = generateParchiHtml(storeName, parchiItems, {
                note,
                address: currentStore?.address,
                phone: currentStore?.phone,
                upiId: currentStore?.upi_id,
            });
            const { uri } = await Print.printToFileAsync({ html });
            await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
        } catch (error) {
            console.error('Failed to generate Parchi PDF:', error);
            Alert.alert('Export failed', 'Could not generate the Parchi PDF. Please try again.');
        }
    };

    return (
        <ScreenLayout edges={['top', 'left', 'right', 'bottom']}>
            <AppHeader
                title="Low Stock & Parchi"
                rightElement={
                    items.length > 0 ? (
                        <TouchableOpacity
                            onPress={handleMasterToggle}
                            style={styles.headerToggle}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                            <Text style={styles.headerToggleText}>
                                {isAllSelected ? 'Deselect All' : 'Select All'}
                            </Text>
                        </TouchableOpacity>
                    ) : null
                }
            />

            {/* Quick Status Bar */}
            {items.length > 0 && (
                <View style={styles.statusBar}>
                    <TouchableOpacity
                        style={[styles.statusTab, filterTab === 'ALL' && styles.statusTabActive]}
                        onPress={() => setFilterTab('ALL')}
                    >
                        <Text
                            style={[
                                styles.statusTabText,
                                filterTab === 'ALL' && styles.statusTabTextActive,
                            ]}
                        >
                            All ({items.length})
                        </Text>
                    </TouchableOpacity>
                    {outOfStockCount > 0 && (
                        <TouchableOpacity
                            style={[styles.statusTab, filterTab === 'OUT' && styles.statusTabActive]}
                            onPress={() => setFilterTab('OUT')}
                        >
                            <Text
                                style={[
                                    styles.statusTabText,
                                    filterTab === 'OUT' ? styles.statusTabTextActive : styles.statusTabDanger,
                                ]}
                            >
                                Out ({outOfStockCount})
                            </Text>
                        </TouchableOpacity>
                    )}
                    <TouchableOpacity
                        style={[styles.statusTab, filterTab === 'LOW' && styles.statusTabActive]}
                        onPress={() => setFilterTab('LOW')}
                    >
                        <Text
                            style={[
                                styles.statusTabText,
                                filterTab === 'LOW' ? styles.statusTabTextActive : styles.statusTabWarning,
                            ]}
                        >
                            Low ({lowStockCount})
                        </Text>
                    </TouchableOpacity>
                </View>
            )}

            <FlatList
                data={filteredItems}
                keyExtractor={item => item.id}
                refreshControl={
                    <RefreshControl refreshing={loading} onRefresh={refetch} tintColor={Colors.light.tint} />
                }
                contentContainerStyle={styles.listContent}
                ItemSeparatorComponent={() => <View style={styles.separator} />}
                ListEmptyComponent={
                    !loading ? (
                        error ? (
                            <View style={styles.emptyContainer}>
                                <Ionicons name="cloud-offline-outline" size={64} color={Colors.light.danger} />
                                <Text style={styles.errorText}>
                                    {error.message || 'Could not load inventory.'}
                                </Text>
                                <AppButton title="Retry" onPress={refetch} style={styles.retryButton} />
                            </View>
                        ) : (
                            <View style={styles.emptyContainer}>
                                <Ionicons name="checkmark-circle" size={72} color={Colors.light.success} />
                                <Text style={styles.emptyTitle}>All Stocks Healthy!</Text>
                                <Text style={styles.emptySubtext}>
                                    No items need restocking right now. Wholesale Parchi is clear.
                                </Text>
                            </View>
                        )
                    ) : null
                }
                renderItem={({ item }) => {
                    const isSelected = selectedIds.has(item.id);
                    const qty = reorderQuantities[item.id] ?? item.suggestedSecondaryQty ?? 1;
                    const packaging = packagingById.get(item.id) ?? resolveWholesalePackaging(item);
                    const totalBaseEquivalent = qty * packaging.factor;
                    const baseUnit = formatBaseUnit(packaging.baseUnit);

                    return (
                        <View style={[styles.card, isSelected && styles.cardSelected]}>
                            <View style={styles.cardHeaderRow}>
                                <TouchableOpacity
                                    style={styles.checkboxContainer}
                                    onPress={() => toggleSelect(item.id)}
                                    accessibilityRole="checkbox"
                                    accessibilityState={{ checked: isSelected }}
                                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                >
                                    <Ionicons
                                        name={isSelected ? 'checkbox' : 'square-outline'}
                                        size={26}
                                        color={isSelected ? Colors.light.success : Colors.light.textSecondary}
                                    />
                                    <Text style={styles.itemName} numberOfLines={1}>
                                        {item.name}
                                    </Text>
                                </TouchableOpacity>

                                <View
                                    style={[
                                        styles.badge,
                                        item.isNegativeStock || !item.isOutOfStock
                                            ? styles.badgeWarning
                                            : styles.badgeDanger,
                                    ]}
                                >
                                    <Text
                                        style={[
                                            styles.badgeText,
                                            item.isNegativeStock || !item.isOutOfStock
                                                ? styles.badgeTextWarning
                                                : styles.badgeTextDanger,
                                        ]}
                                    >
                                        {item.isNegativeStock
                                            ? 'SOLD BEFORE INWARD'
                                            : item.isOutOfStock
                                                ? 'OUT OF STOCK'
                                                : 'LOW STOCK'}
                                    </Text>
                                </View>
                            </View>

                            <View style={styles.cardMetaRow}>
                                <Text style={styles.currentStockText}>
                                    Current:{' '}
                                    <Text style={styles.boldText}>
                                        {formatFriendlyQuantity(item.quantity, item.base_unit ?? item.unit)}
                                    </Text>
                                    {'  '}• Min: {item.low_stock_threshold ?? 5} {item.base_unit ?? item.unit}
                                </Text>
                            </View>

                            {/* Wholesale Stepper Bar */}
                            <View style={styles.stepperContainer}>
                                <View style={styles.stepperInfo}>
                                    <Text style={styles.stepperLabel}>Order Wholesale:</Text>
                                    <Text style={styles.stepperEquivalent}>
                                        = {totalBaseEquivalent} {baseUnit}
                                    </Text>
                                </View>

                                <View style={styles.stepperControls}>
                                    <TouchableOpacity
                                        style={[styles.stepperButton, qty <= 1 && styles.stepperButtonDisabled]}
                                        onPress={() => updateQuantity(item.id, -1)}
                                        disabled={qty <= 1}
                                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                        accessibilityLabel="Decrease quantity"
                                    >
                                        <Ionicons
                                            name="remove"
                                            size={20}
                                            color={qty <= 1 ? Colors.light.borderStrong : Colors.light.text}
                                        />
                                    </TouchableOpacity>

                                    <View style={styles.stepperValueContainer}>
                                        <Text style={styles.stepperValueText}>
                                            {qty} {item.displayUnit}
                                        </Text>
                                    </View>

                                    <TouchableOpacity
                                        style={styles.stepperButton}
                                        onPress={() => updateQuantity(item.id, 1)}
                                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                        accessibilityLabel="Increase quantity"
                                    >
                                        <Ionicons name="add" size={20} color={Colors.light.text} />
                                    </TouchableOpacity>
                                </View>
                            </View>
                        </View>
                    );
                }}
            />

            {/* Sticky Bottom Actions */}
            {items.length > 0 && (
                <View style={styles.bottomBar}>
                    {copiedToast && (
                        <View style={styles.toast}>
                            <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
                            <Text style={styles.toastText}>Parchi Copied to Clipboard!</Text>
                        </View>
                    )}

                    <View style={styles.bottomSummaryRow}>
                        <Text style={styles.bottomSummaryText}>
                            <Text style={styles.boldText}>{selectedCount}</Text> of {items.length} items in Parchi
                        </Text>
                        <TouchableOpacity
                            onPress={() => setPreviewModalVisible(true)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                            <Text style={styles.previewLinkText}>👁️ Preview Chit</Text>
                        </TouchableOpacity>
                    </View>

                    <AppButton
                        title={`📲 Share Parchi on WhatsApp (${selectedCount})`}
                        onPress={handleShare}
                        disabled={selectedCount === 0}
                        style={styles.shareBtn}
                        textStyle={styles.shareBtnText}
                    />

                    <AppButton
                        title="📋 Copy Parchi Text"
                        onPress={handleCopy}
                        variant="outline"
                        disabled={selectedCount === 0}
                        style={styles.copyBtn}
                    />

                    <AppButton
                        title="🧾 Share PDF Parchi"
                        onPress={handleSharePdf}
                        variant="outline"
                        disabled={selectedCount === 0}
                        style={styles.pdfBtn}
                    />
                </View>
            )}

            {/* Preview & Delivery Note Modal */}
            <Modal
                visible={previewModalVisible}
                animationType="slide"
                transparent
                onRequestClose={() => setPreviewModalVisible(false)}
            >
                <Pressable style={styles.modalOverlay} onPress={() => setPreviewModalVisible(false)}>
                    <Pressable style={styles.modalContent} onPress={e => e.stopPropagation()}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>WhatsApp Parchi Preview</Text>
                            <TouchableOpacity
                                onPress={() => setPreviewModalVisible(false)}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                                <Ionicons name="close" size={24} color={Colors.light.text} />
                            </TouchableOpacity>
                        </View>

                        <ScrollView style={styles.chitScroll} contentContainerStyle={styles.chitBox}>
                            <Text style={styles.chitText} selectable>
                                {parchiText || 'No items selected.'}
                            </Text>
                        </ScrollView>

                        <Text style={styles.modalNoteLabel}>Closing Delivery Note / Instructions:</Text>
                        <TextInput
                            style={styles.noteInput}
                            value={note}
                            onChangeText={setNote}
                            placeholder="e.g. Bhejo jaldi kal subah."
                            placeholderTextColor={Colors.light.textSecondary}
                        />

                        <View style={styles.quickChipsRow}>
                            {[
                                'Bhejo jaldi kal subah.',
                                'Subah 8 baje tak bhejo.',
                                'Rates wahi lagana jo baat hui thi.',
                                'Kal shaam tak bhejo.',
                            ].map(chip => (
                                <TouchableOpacity
                                    key={chip}
                                    style={[styles.quickChip, note === chip && styles.quickChipActive]}
                                    onPress={() => setNote(chip)}
                                >
                                    <Text
                                        style={[
                                            styles.quickChipText,
                                            note === chip && styles.quickChipTextActive,
                                        ]}
                                    >
                                        {chip}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        <AppButton
                            title="Done"
                            onPress={() => setPreviewModalVisible(false)}
                            style={{ marginTop: Spacing.lg }}
                        />
                    </Pressable>
                </Pressable>
            </Modal>
        </ScreenLayout>
    );
}

const styles = StyleSheet.create({
    headerToggle: {
        paddingVertical: Spacing.xs,
        paddingHorizontal: Spacing.sm,
    },
    headerToggleText: {
        ...Typography.captionStrong,
        color: Colors.light.tint,
    },
    statusBar: {
        flexDirection: 'row',
        paddingHorizontal: Spacing.xl,
        paddingBottom: Spacing.sm,
        gap: Spacing.sm,
    },
    statusTab: {
        paddingVertical: Spacing.xs,
        paddingHorizontal: Spacing.md,
        borderRadius: Radius.pill,
        backgroundColor: Colors.light.surfaceElevated,
    },
    statusTabActive: {
        backgroundColor: Colors.light.tint,
    },
    statusTabText: {
        ...Typography.captionStrong,
        color: Colors.light.textSecondary,
    },
    statusTabTextActive: {
        color: Colors.light.onTint,
    },
    statusTabDanger: {
        color: Colors.light.danger,
    },
    statusTabWarning: {
        color: Colors.light.warningText,
    },
    listContent: {
        padding: Spacing.xl,
        paddingBottom: 160, // Space for sticky bottom bar
    },
    separator: {
        height: Spacing.md,
    },
    card: {
        backgroundColor: Colors.light.surface,
        borderRadius: Radius.md,
        padding: Spacing.lg,
        borderWidth: 1,
        borderColor: Colors.light.border,
    },
    cardSelected: {
        borderColor: Colors.light.success,
        backgroundColor: '#FCFFFD',
    },
    cardHeaderRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    checkboxContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        gap: Spacing.sm,
    },
    itemName: {
        ...Typography.heading,
        color: Colors.light.text,
        flex: 1,
    },
    badge: {
        paddingHorizontal: Spacing.sm,
        paddingVertical: 2,
        borderRadius: Radius.sm,
    },
    badgeDanger: {
        backgroundColor: Colors.light.dangerSoft,
    },
    badgeWarning: {
        backgroundColor: Colors.light.warningSoft,
    },
    badgeText: {
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.5,
    },
    badgeTextDanger: {
        color: Colors.light.danger,
    },
    badgeTextWarning: {
        color: Colors.light.warningText,
    },
    cardMetaRow: {
        marginTop: Spacing.xs,
        marginLeft: 34,
    },
    currentStockText: {
        ...Typography.caption,
        color: Colors.light.textSecondary,
    },
    boldText: {
        fontWeight: '700',
        color: Colors.light.text,
    },
    stepperContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: Spacing.md,
        paddingTop: Spacing.md,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: Colors.light.border,
        marginLeft: 34,
    },
    stepperInfo: {
        flex: 1,
    },
    stepperLabel: {
        ...Typography.captionStrong,
        color: Colors.light.text,
    },
    stepperEquivalent: {
        ...Typography.caption,
        color: Colors.light.textSecondary,
        marginTop: 2,
    },
    stepperControls: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: Colors.light.surfaceElevated,
        borderRadius: Radius.pill,
        padding: 2,
    },
    stepperButton: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: Colors.light.surface,
    },
    stepperButtonDisabled: {
        opacity: 0.4,
    },
    stepperValueContainer: {
        paddingHorizontal: Spacing.md,
        alignItems: 'center',
    },
    stepperValueText: {
        ...Typography.bodyStrong,
        color: Colors.light.text,
    },
    bottomBar: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: Colors.light.surface,
        borderTopWidth: 1,
        borderTopColor: Colors.light.border,
        paddingHorizontal: Spacing.xl,
        paddingTop: Spacing.md,
        paddingBottom: Spacing.xl,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -3 },
        shadowOpacity: 0.06,
        shadowRadius: 6,
        elevation: 8,
    },
    bottomSummaryRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: Spacing.sm,
    },
    bottomSummaryText: {
        ...Typography.caption,
        color: Colors.light.textSecondary,
    },
    previewLinkText: {
        ...Typography.captionStrong,
        color: Colors.light.tint,
    },
    shareBtn: {
        minHeight: TouchTarget.min,
        backgroundColor: '#25D366', // WhatsApp Brand Green
        marginBottom: Spacing.sm,
    },
    shareBtnText: {
        color: '#FFFFFF',
    },
    copyBtn: {
        minHeight: TouchTarget.min,
    },
    pdfBtn: {
        minHeight: TouchTarget.min,
        marginTop: Spacing.sm,
    },
    toast: {
        position: 'absolute',
        top: -42,
        alignSelf: 'center',
        backgroundColor: Colors.light.tint,
        paddingVertical: Spacing.xs,
        paddingHorizontal: Spacing.lg,
        borderRadius: Radius.pill,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.xs,
        zIndex: 10,
    },
    toastText: {
        ...Typography.captionStrong,
        color: Colors.light.onTint,
    },
    emptyContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: Spacing.xxxl * 2,
        paddingHorizontal: Spacing.xxl,
    },
    emptyTitle: {
        ...Typography.heading,
        color: Colors.light.text,
        marginTop: Spacing.lg,
    },
    emptySubtext: {
        ...Typography.body,
        color: Colors.light.textSecondary,
        textAlign: 'center',
        marginTop: Spacing.xs,
    },
    errorText: {
        ...Typography.body,
        color: Colors.light.danger,
        marginTop: Spacing.md,
        textAlign: 'center',
    },
    retryButton: {
        marginTop: Spacing.lg,
        minWidth: 120,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: Colors.light.overlay,
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: Colors.light.surface,
        borderTopLeftRadius: Radius.lg,
        borderTopRightRadius: Radius.lg,
        padding: Spacing.xl,
        maxHeight: '85%',
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: Spacing.md,
    },
    modalTitle: {
        ...Typography.heading,
        color: Colors.light.text,
    },
    chitScroll: {
        maxHeight: 220,
        marginVertical: Spacing.sm,
    },
    chitBox: {
        backgroundColor: Colors.light.surfaceElevated,
        padding: Spacing.md,
        borderRadius: Radius.md,
        borderWidth: 1,
        borderColor: Colors.light.border,
    },
    chitText: {
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
        fontSize: 14,
        lineHeight: 20,
        color: Colors.light.text,
    },
    modalNoteLabel: {
        ...Typography.captionStrong,
        color: Colors.light.textSecondary,
        marginTop: Spacing.md,
        marginBottom: Spacing.xs,
    },
    noteInput: {
        backgroundColor: Colors.light.surfaceElevated,
        borderRadius: Radius.md,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
        fontSize: 15,
        color: Colors.light.text,
        borderWidth: 1,
        borderColor: Colors.light.border,
    },
    quickChipsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: Spacing.xs,
        marginTop: Spacing.sm,
    },
    quickChip: {
        backgroundColor: Colors.light.surfaceElevated,
        paddingVertical: 4,
        paddingHorizontal: Spacing.sm,
        borderRadius: Radius.pill,
        borderWidth: 1,
        borderColor: Colors.light.border,
    },
    quickChipActive: {
        backgroundColor: Colors.light.tint,
        borderColor: Colors.light.tint,
    },
    quickChipText: {
        fontSize: 12,
        color: Colors.light.textSecondary,
    },
    quickChipTextActive: {
        color: Colors.light.onTint,
    },
});
