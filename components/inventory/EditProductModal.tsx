import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppModal } from '@/components/ui/AppModal';
import { AppTextField } from '@/components/ui/AppTextField';
import { AppButton } from '@/components/ui/AppButton';
import { InventoryItem, toScope } from '@/core/interfaces/IInventoryRepository';
import { CATEGORY_OPTIONS, InventoryCategory, normalizeInventoryCategory } from '@/utils/categories';
import { parseOptionalNumber } from '@/utils/numeric';
import { confirmDestructive } from '@/utils/confirm';
import { container } from '@/services/Container';
import { useAuth } from '@/services/AuthContext';
import { usePrivacy } from '@/services/PrivacyContext';
import { useStoreScope } from '@/hooks/useStoreScope';
import { GUEST_USER_ID } from '@/services/InventoryService';
import { getErrorMessage } from '@/utils/errors';
import { Spacing, Radius } from '@/constants/Layout';
import { Typography } from '@/constants/Typography';
import { Colors } from '@/constants/Colors';
import { formatFriendlyQuantity } from '@/utils/format';



interface EditProductModalProps {
    visible: boolean;
    item: InventoryItem | null;
    onClose: () => void;
    onSuccess?: () => void;
    userId?: string;
}

export function EditProductModal({ visible, item, onClose, onSuccess, userId }: EditProductModalProps) {
    const { user } = useAuth();
    const { isStaffMode } = usePrivacy();
    const { storeId } = useStoreScope();
    const effectiveUserId = userId || user?.id || GUEST_USER_ID;
    const scope = toScope(effectiveUserId, storeId);

    const [submitting, setSubmitting] = useState(false);
    const [name, setName] = useState('');
    const [category, setCategory] = useState<InventoryCategory>('GENERAL');
    const [aliases, setAliases] = useState('');
    const [sellingPrice, setSellingPrice] = useState('');
    const [costPrice, setCostPrice] = useState('');
    const [threshold, setThreshold] = useState('5');
    const [secondaryUnit, setSecondaryUnit] = useState('');
    const [conversionFactor, setConversionFactor] = useState('');
    const [physicalStock, setPhysicalStock] = useState('');
    const [showAdvanced, setShowAdvanced] = useState(false);

    useEffect(() => {
        if (item) {
            setName(item.name || '');
            setCategory(normalizeInventoryCategory(item.category));
            setAliases(item.aliases && item.aliases.length > 0 ? item.aliases.join(', ') : '');
            setSellingPrice(item.selling_price != null ? String(item.selling_price) : '');
            setCostPrice(item.last_purchase_price != null ? String(item.last_purchase_price) : '');
            setThreshold(item.low_stock_threshold != null ? String(item.low_stock_threshold) : '5');
            setSecondaryUnit(item.secondary_unit || '');
            setConversionFactor(item.conversion_factor != null ? String(item.conversion_factor) : '');
            setPhysicalStock(item.quantity != null ? String(item.quantity) : '');
            setSubmitting(false);
            setShowAdvanced(false);
        }
    }, [item, visible]);

    if (isStaffMode) return null;
    if (!item) return null;

    const baseUnit = item.base_unit || item.unit || 'pcs';

    // Projected Margin Calculation
    const spNum = Number(sellingPrice);
    const cpNum = Number(costPrice);
    const validMargin = Number.isFinite(spNum) && Number.isFinite(cpNum) && cpNum > 0;
    const marginDelta = validMargin ? spNum - cpNum : 0;
    const marginPercent = validMargin ? Math.round((marginDelta / cpNum) * 100) : 0;
    const isNegativeMargin = validMargin && marginDelta < 0;

    // Physical Stock Delta Calculation
    const currentQty = Number(item.quantity || 0);
    const parsedPhysical = physicalStock.trim() ? Number(physicalStock) : NaN;
    const hasValidPhysical = physicalStock.trim() !== '' && Number.isFinite(parsedPhysical);
    const stockDelta = hasValidPhysical ? Math.round((parsedPhysical - currentQty) * 1000) / 1000 : 0;

    const handleSave = async () => {
        const selling = parseOptionalNumber(sellingPrice);
        const cost = parseOptionalNumber(costPrice);
        const thresholdValue = parseOptionalNumber(threshold);
        const factorValue = parseOptionalNumber(conversionFactor);

        const invalidField =
            (sellingPrice.trim() && (selling == null || selling < 0)) ? 'Selling rate'
            : (costPrice.trim() && (cost == null || cost < 0)) ? 'Wholesale cost'
            : (threshold.trim() && (thresholdValue == null || thresholdValue < 0)) ? 'Low-stock threshold'
            : (conversionFactor.trim() && (factorValue == null || factorValue <= 0)) ? 'Conversion factor'
            : (physicalStock.trim() && !Number.isFinite(Number(physicalStock))) ? 'Physical stock count'
            : null;

        if (invalidField) {
            Alert.alert('Invalid value', `Please check: ${invalidField}.`);
            return;
        }

        setSubmitting(true);
        try {
            const updates: Partial<InventoryItem> = {
                selling_price: selling,
                last_purchase_price: cost,
                low_stock_threshold: thresholdValue ?? 5,
                secondary_unit: secondaryUnit.trim() || null,
                conversion_factor: factorValue,
            };

            // Only include name if modified
            if (name.trim() && name.trim() !== item.name) {
                updates.name = name.trim();
            }

            // Only include category if modified (canonical enum comparison)
            if (category !== normalizeInventoryCategory(item.category)) {
                updates.category = category;
            }

            // Only include aliases if modified
            const parsedAliases = aliases
                .split(',')
                .map((a) => a.trim())
                .filter(Boolean);
            const origAliases = item.aliases || [];
            const aliasesChanged =
                parsedAliases.length !== origAliases.length ||
                parsedAliases.some((a, idx) => a !== origAliases[idx]);
            if (aliasesChanged) {
                updates.aliases = parsedAliases;
            }

            let success = false;
            if (container.inventoryService.updateProduct) {
                success = await container.inventoryService.updateProduct(scope, item.id, updates);
            }

            if (!success) {
                Alert.alert('Update Failed', 'Could not update product. Please check your connection.');
                return;
            }

            // The delta is recomputed inside InventoryService.auditStock against
            // the latest balance, so a concurrent sale can never be mis-adjusted.
            if (hasValidPhysical) {
                const adjusted = await container.inventoryService.auditStock(
                    scope,
                    item.id,
                    parsedPhysical
                );
                if (!adjusted) {
                    Alert.alert('Stock not adjusted', 'The product was updated but the stock adjustment could not be recorded.');
                }
            }

            Alert.alert('Updated', `Product "${updates.name || item.name}" updated successfully.`);
            onSuccess?.();
            onClose();
        } catch (e: unknown) {
            Alert.alert('Error', getErrorMessage(e));
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = () => {
        confirmDestructive(
            'Delete Product?',
            `Are you sure you want to delete "${item.name}"? This action cannot be undone.`,
            'Delete',
            async () => {
                setSubmitting(true);
                try {
                    let success = false;
                    if (container.inventoryService.deleteProduct) {
                        success = await container.inventoryService.deleteProduct(scope, item.id);
                    }

                    if (success) {
                        Alert.alert('Deleted', `"${item.name}" has been removed from catalog.`);
                        onSuccess?.();
                        onClose();
                    } else {
                        Alert.alert('Delete Failed', 'Could not delete product.');
                    }
                } catch (e: unknown) {
                    Alert.alert('Error', getErrorMessage(e, 'An error occurred while deleting.'));
                } finally {
                    setSubmitting(false);
                }
            }
        );
    };

    return (
        <AppModal
            visible={visible}
            onClose={onClose}
            title={`Edit: ${item.name}`}
            variant="sheet"
        >
            <View style={styles.container}>
                {/* Product Name */}
                <AppTextField
                    label="Product Name *"
                    value={name}
                    onChangeText={setName}
                    placeholder="e.g. Toor Dal"
                    testID="edit-product-name-input"
                />

                {/* Primary rate — the only number a shopkeeper changes daily */}
                <Text style={styles.sectionHeader}>Rate & Measurement</Text>
                <Text style={styles.unitNote}>Base Measurement Unit: {baseUnit}</Text>

                <View style={styles.row}>
                    <AppTextField
                        label={`Selling Rate (₹ / ${baseUnit})`}
                        value={sellingPrice}
                        onChangeText={setSellingPrice}
                        keyboardType="decimal-pad"
                        placeholder="e.g. 48"
                        containerStyle={styles.halfInput}
                        testID="edit-product-selling-price-input"
                    />
                    <AppTextField
                        label={`Purchase Price (₹ / ${baseUnit})`}
                        value={costPrice}
                        onChangeText={setCostPrice}
                        keyboardType="decimal-pad"
                        placeholder="e.g. 42"
                        containerStyle={styles.halfInput}
                        testID="edit-product-cost-price-input"
                    />
                </View>

                {validMargin && (
                    <View style={[styles.marginPreview, isNegativeMargin && styles.marginWarning]}>
                        <Text style={[styles.marginText, isNegativeMargin && styles.marginWarningText]}>
                            {isNegativeMargin
                                ? `Warning: Negative Margin ₹${marginDelta.toFixed(2)} (${marginPercent}%)`
                                : `Gross Margin: ₹${marginDelta.toFixed(2)} / ${baseUnit} (+${marginPercent}%)`}
                        </Text>
                    </View>
                )}

                <TouchableOpacity
                    style={styles.advancedToggle}
                    onPress={() => setShowAdvanced(v => !v)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: showAdvanced }}
                    testID="edit-product-advanced-toggle"
                >
                    <Text style={styles.advancedToggleText}>
                        {showAdvanced ? 'Hide advanced options' : 'Advanced options'}
                    </Text>
                    <Ionicons
                        name={showAdvanced ? 'chevron-up' : 'chevron-down'}
                        size={16}
                        color={Colors.light.tint}
                    />
                </TouchableOpacity>

                {showAdvanced && (
                    <View testID="edit-product-advanced-section">
                        <AppTextField
                            label="Vernacular / Hindi Aliases (Comma-separated)"
                            value={aliases}
                            onChangeText={setAliases}
                            placeholder="e.g. अरहर दाल, Arhar Dal"
                            testID="edit-product-aliases-input"
                        />

                        <Text style={styles.fieldLabel}>Category</Text>
                        <View style={styles.chipRow}>
                            {CATEGORY_OPTIONS.map((cat) => {
                                const active = cat.key === category;
                                return (
                                    <TouchableOpacity
                                        key={cat.key}
                                        style={[styles.chip, active && styles.chipActive]}
                                        onPress={() => setCategory(cat.key)}
                                        accessibilityRole="button"
                                        accessibilityState={{ selected: active }}
                                        testID={`edit-category-chip-${cat.key}`}
                                    >
                                        <Text style={[styles.chipText, active && styles.chipTextActive]}>
                                            {cat.label}
                                        </Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>

                        <AppTextField
                            label={`Low-Stock Alert Threshold (${baseUnit})`}
                            value={threshold}
                            onChangeText={setThreshold}
                            keyboardType="numeric"
                            placeholder="5"
                            testID="edit-product-threshold-input"
                        />

                        {/* Wholesale Packaging */}
                        <Text style={styles.sectionHeader}>Wholesale Packaging (Optional)</Text>
                        <View style={styles.row}>
                            <AppTextField
                                label="Secondary Unit (e.g. bori, peti)"
                                value={secondaryUnit}
                                onChangeText={setSecondaryUnit}
                                placeholder="bori"
                                autoCapitalize="none"
                                containerStyle={styles.halfInput}
                                testID="edit-product-secondary-unit-input"
                            />
                            <AppTextField
                                label={`Contains (${baseUnit}s)`}
                                value={conversionFactor}
                                onChangeText={setConversionFactor}
                                keyboardType="decimal-pad"
                                placeholder="50"
                                containerStyle={styles.halfInput}
                                testID="edit-product-conversion-factor-input"
                            />
                        </View>
                    </View>
                )}

                {/* Physical Stock Audit & Adjustment */}
                <Text style={styles.sectionHeader}>Physical Stock on Hand</Text>
                <Text style={styles.unitNote}>
                    Current recorded stock: {formatFriendlyQuantity(item.quantity, baseUnit, {
                        secondaryUnit: item.secondary_unit,
                        conversionFactor: item.conversion_factor,
                    })}
                </Text>
                <AppTextField
                    label={`Update Physical Stock Count (${baseUnit})`}
                    value={physicalStock}
                    onChangeText={setPhysicalStock}
                    keyboardType="decimal-pad"
                    placeholder={String(item.quantity ?? 0)}
                    testID="edit-product-stock-input"
                />
                {stockDelta !== 0 && (
                    <View
                        style={[
                            styles.stockDeltaBadge,
                            stockDelta < 0 ? styles.stockDeltaNegative : styles.stockDeltaPositive,
                        ]}
                    >
                        <Text
                            style={[
                                styles.stockDeltaText,
                                stockDelta < 0 ? styles.stockDeltaNegativeText : styles.stockDeltaPositiveText,
                            ]}
                        >
                            Stock Adjustment: {stockDelta > 0 ? `+${stockDelta}` : stockDelta} {baseUnit} ({stockDelta > 0 ? 'Surplus recorded' : 'Shrinkage / Waste recorded'})
                        </Text>
                    </View>
                )}

                {/* Action Buttons */}
                <View style={styles.buttonRow}>
                    <AppButton
                        title="Cancel"
                        variant="outline"
                        onPress={onClose}
                        style={styles.cancelBtn}
                        testID="edit-product-cancel-button"
                    />
                    <AppButton
                        title={submitting ? 'Saving...' : 'Save Changes 💾'}
                        onPress={handleSave}
                        disabled={submitting}
                        loading={submitting}
                        style={styles.saveBtn}
                        testID="edit-product-save-button"
                    />
                </View>

                {/* Delete Product */}
                <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={handleDelete}
                    disabled={submitting}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${item.name}`}
                    testID="edit-product-delete-button"
                >
                    <Ionicons name="trash-outline" size={16} color={Colors.light.danger} />
                    <Text style={styles.deleteButtonText}>Delete Product from Catalog</Text>
                </TouchableOpacity>
            </View>
        </AppModal>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingBottom: Spacing.xl,
    },
    fieldLabel: {
        ...Typography.captionStrong,
        color: Colors.light.text,        marginBottom: Spacing.xs,
        marginTop: Spacing.xs,
    },
    chipRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: Spacing.xs,
        marginBottom: Spacing.md,
    },
    chip: {
        paddingHorizontal: Spacing.md,
        paddingVertical: 6,
        borderRadius: Radius.pill,
        backgroundColor: Colors.light.surfaceElevated,
        borderWidth: 1,
        borderColor: Colors.light.border,
    },
    chipActive: {
        backgroundColor: Colors.light.tint,
        borderColor: Colors.light.tint,
    },
    chipText: {
        ...Typography.caption,
        color: Colors.light.text,
        fontWeight: '500',
    },
    chipTextActive: {
        color: Colors.light.onTint,
        fontWeight: '600',
    },
    unitNote: {
        ...Typography.captionStrong,
        color: Colors.light.textSecondary,
        marginBottom: Spacing.sm,
    },
    row: {
        flexDirection: 'row',
        gap: Spacing.md,
    },
    halfInput: {
        flex: 1,
    },
    marginPreview: {
        backgroundColor: Colors.light.successSoft,
        padding: Spacing.sm,
        borderRadius: Radius.sm,
        marginBottom: Spacing.md,
    },
    marginWarning: {
        backgroundColor: Colors.light.dangerSoft,
    },
    marginText: {
        ...Typography.captionStrong,
        color: Colors.light.success,
        textAlign: 'center',
    },
    marginWarningText: {
        color: Colors.light.danger,
    },
    sectionHeader: {
        ...Typography.bodyStrong,
        color: Colors.light.text,
        marginTop: Spacing.sm,
        marginBottom: Spacing.xs,
    },
    stockDeltaBadge: {
        padding: Spacing.sm,
        borderRadius: Radius.sm,
        marginTop: -Spacing.xs,
        marginBottom: Spacing.md,
    },
    stockDeltaPositive: {
        backgroundColor: Colors.light.successSoft,
    },
    stockDeltaNegative: {
        backgroundColor: Colors.light.warningSoft,
    },
    stockDeltaText: {
        ...Typography.captionStrong,
        fontSize: 12,
        textAlign: 'center',
    },
    stockDeltaPositiveText: {
        color: Colors.light.success,
    },
    stockDeltaNegativeText: {
        color: Colors.light.warningText,
    },
    advancedToggle: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: Spacing.sm,
        marginTop: Spacing.sm,
        marginBottom: Spacing.xs,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderColor: Colors.light.border,
    },
    advancedToggleText: {
        ...Typography.captionStrong,
        color: Colors.light.tint,
        fontSize: 13,
    },
    buttonRow: {
        flexDirection: 'row',
        gap: Spacing.md,
        marginTop: Spacing.lg,
    },
    cancelBtn: {
        flex: 1,
    },
    saveBtn: {
        flex: 2,
    },
    deleteButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: Spacing.xs,
        paddingVertical: Spacing.md,
        marginTop: Spacing.lg,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: Colors.light.border,
    },
    deleteButtonText: {
        ...Typography.captionStrong,
        color: Colors.light.danger,
        fontSize: 13,
    },
});
