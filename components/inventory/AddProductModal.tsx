import { Ionicons } from '@expo/vector-icons';
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { AppModal } from '@/components/ui/AppModal';
import { AppTextField } from '@/components/ui/AppTextField';
import { AppButton } from '@/components/ui/AppButton';
import { toScope } from '@/core/interfaces/IInventoryRepository';
import { CREATABLE_CATEGORY_OPTIONS, InventoryCategory } from '@/utils/categories';
import { parseOptionalNumber } from '@/utils/numeric';
import { container } from '@/services/Container';
import { useAuth } from '@/services/AuthContext';
import { useStoreScope } from '@/hooks/useStoreScope';
import { GUEST_USER_ID } from '@/services/InventoryService';
import { getErrorMessage } from '@/utils/errors';
import { Spacing, Radius } from '@/constants/Layout';
import { Typography } from '@/constants/Typography';
import { Colors } from '@/constants/Colors';

export const BASE_UNITS = ['kg', 'l', 'pcs', 'm'] as const;
export type BaseUnitType = (typeof BASE_UNITS)[number];

interface AddProductModalProps {
    visible: boolean;
    onClose: () => void;
    onSuccess?: () => void;
    userId?: string;
}

export function AddProductModal({ visible, onClose, onSuccess, userId }: AddProductModalProps) {
    const { user } = useAuth();
    const { storeId } = useStoreScope();
    const effectiveUserId = userId || user?.id || GUEST_USER_ID;

    const [name, setName] = useState('');
    const [alias, setAlias] = useState('');
    const [category, setCategory] = useState<InventoryCategory>('STAPLES');
    const [baseUnit, setBaseUnit] = useState<BaseUnitType>('kg');
    const [secondaryUnit, setSecondaryUnit] = useState('');
    const [conversionFactor, setConversionFactor] = useState('');
    const [sellingPrice, setSellingPrice] = useState('');
    const [costPrice, setCostPrice] = useState('');
    const [initialStock, setInitialStock] = useState('0');
    const [lowStockThreshold, setLowStockThreshold] = useState('10');
    const [submitting, setSubmitting] = useState(false);
    const [nameError, setNameError] = useState<string | null>(null);
    const [showAdvanced, setShowAdvanced] = useState(false);

    // Reset fields when opening modal
    useEffect(() => {
        if (visible) {
            setName('');
            setAlias('');
            setCategory('STAPLES');
            setBaseUnit('kg');
            setSecondaryUnit('');
            setConversionFactor('');
            setSellingPrice('');
            setCostPrice('');
            setInitialStock('0');
            setLowStockThreshold('10');
            setNameError(null);
            setSubmitting(false);
            setShowAdvanced(false);
        }
    }, [visible]);

    const handleCategoryChange = (newCat: InventoryCategory) => {
        setCategory(newCat);
        if (newCat === 'STAPLES' || newCat === 'SPICES') {
            setBaseUnit('kg');
        } else if (newCat === 'DAIRY_BAKERY') {
            setBaseUnit('l');
        } else if (newCat === 'FMCG' || newCat === 'GENERAL') {
            setBaseUnit('pcs');
        }
    };

    const handleCreate = async () => {
        const trimmedName = name.trim();
        if (!trimmedName) {
            setNameError('Product name is required');
            Alert.alert('Required Field', 'Please enter a product name.');
            return;
        }

        if (effectiveUserId === GUEST_USER_ID) {
            Alert.alert('Guest mode', 'Products are not saved in guest mode. Create an account to build your catalog.');
            return;
        }

        const cost = parseOptionalNumber(costPrice);
        const sell = parseOptionalNumber(sellingPrice);
        const factor = parseOptionalNumber(conversionFactor);
        const threshold = parseOptionalNumber(lowStockThreshold);
        const stockQty = parseOptionalNumber(initialStock);

        const invalidField =
            (costPrice.trim() && cost == null) ? 'Cost price'
            : (sellingPrice.trim() && sell == null) ? 'Selling price'
            : (conversionFactor.trim() && (factor == null || factor <= 0)) ? 'Conversion factor (must be greater than 0)'
            : (lowStockThreshold.trim() && (threshold == null || threshold < 0)) ? 'Low-stock threshold (cannot be negative)'
            : (initialStock.trim() && (stockQty == null || stockQty < 0)) ? 'Initial stock (cannot be negative)'
            : (cost != null && cost < 0) ? 'Cost price (cannot be negative)'
            : (sell != null && sell < 0) ? 'Selling price (cannot be negative)'
            : null;

        if (invalidField) {
            Alert.alert('Invalid value', `Please check: ${invalidField}.`);
            return;
        }

        setSubmitting(true);
        try {
            const aliasArray = alias
                .split(',')
                .map((a) => a.trim())
                .filter(Boolean);

            const result = await container.inventoryService.createProduct(toScope(effectiveUserId, storeId), {
                name: trimmedName,
                category,
                aliases: aliasArray,
                unit: baseUnit,
                baseUnit,
                secondaryUnit: secondaryUnit.trim() || null,
                conversionFactor: factor,
                costPrice: cost,
                sellingPrice: sell,
                lowStockThreshold: threshold ?? 5,
                quantity: stockQty ?? 0,
            });

            if (result) {
                Alert.alert('Success', `"${trimmedName}" added to catalog.`);
                onSuccess?.();
                onClose();
            } else {
                Alert.alert('Failed', 'Could not create product. It may already exist.');
            }
        } catch (e: unknown) {
            Alert.alert('Creation Error', getErrorMessage(e, 'An error occurred.'));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AppModal
            visible={visible}
            onClose={onClose}
            title="Add Product"
            variant="sheet"
        >
            <View style={styles.container}>
                <AppTextField
                    label="Product Name (English / Canonical) *"
                    value={name}
                    onChangeText={(val) => {
                        setName(val);
                        if (nameError) setNameError(null);
                    }}
                    placeholder="e.g. Desi Khand, Tata Salt"
                    testID="add-product-name-input"
                />
                {nameError && (
                    <Text style={styles.errorText} testID="add-product-name-error">
                        {nameError}
                    </Text>
                )}

                <Text style={styles.fieldLabel}>Base Unit *</Text>
                <View style={styles.unitRow}>
                    {BASE_UNITS.map((u) => {
                        const active = u === baseUnit;
                        return (
                            <TouchableOpacity
                                key={u}
                                style={[styles.unitChip, active && styles.unitChipActive]}
                                onPress={() => setBaseUnit(u)}
                                accessibilityRole="button"
                                accessibilityState={{ selected: active }}
                                testID={`unit-chip-${u}`}
                            >
                                <Text style={[styles.unitText, active && styles.unitTextActive]}>
                                    {u.toUpperCase()}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>

                <AppTextField
                    label={`Selling Price (₹ / ${baseUnit})`}
                    value={sellingPrice}
                    onChangeText={setSellingPrice}
                    keyboardType="decimal-pad"
                    placeholder="48"
                    testID="add-product-selling-price-input"
                />

                <AppTextField
                    label={`Initial Stock (${baseUnit})`}
                    value={initialStock}
                    onChangeText={setInitialStock}
                    keyboardType="decimal-pad"
                    placeholder="100"
                    testID="add-product-initial-stock-input"
                />

                <TouchableOpacity
                    style={styles.advancedToggle}
                    onPress={() => setShowAdvanced(v => !v)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: showAdvanced }}
                    testID="add-product-advanced-toggle"
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
                    <View testID="add-product-advanced-section">
                        <AppTextField
                            label="Hindi / Vernacular Alias (Comma-separated)"
                            value={alias}
                            onChangeText={setAlias}
                            placeholder="कच्ची खांड, Desi Cheeni, Brown Sugar"
                            testID="add-product-alias-input"
                        />

                        <Text style={styles.fieldLabel}>Category</Text>
                        <View style={styles.chipRow}>
                            {CREATABLE_CATEGORY_OPTIONS.map((cat) => {
                                const active = cat.key === category;
                                return (
                                    <TouchableOpacity
                                        key={cat.key}
                                        style={[styles.chip, active && styles.chipActive]}
                                        onPress={() => handleCategoryChange(cat.key)}
                                        accessibilityRole="button"
                                        accessibilityState={{ selected: active }}
                                        testID={`category-chip-${cat.key}`}
                                    >
                                        <Text style={[styles.chipText, active && styles.chipTextActive]}>
                                            {cat.label}
                                        </Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>

                        <View style={styles.twoCol}>
                            <AppTextField
                                label={`Cost Price (₹ / ${baseUnit})`}
                                value={costPrice}
                                onChangeText={setCostPrice}
                                keyboardType="decimal-pad"
                                placeholder="42"
                                containerStyle={styles.halfCol}
                                testID="add-product-cost-price-input"
                            />
                            <AppTextField
                                label={`Min Alert (${baseUnit})`}
                                value={lowStockThreshold}
                                onChangeText={setLowStockThreshold}
                                keyboardType="numeric"
                                placeholder="10"
                                containerStyle={styles.halfCol}
                                testID="add-product-threshold-input"
                            />
                        </View>

                        <Text style={styles.sectionTitle}>Wholesale Packaging (Optional)</Text>
                        <View style={styles.twoCol}>
                            <AppTextField
                                label="Secondary Unit"
                                value={secondaryUnit}
                                onChangeText={setSecondaryUnit}
                                placeholder="e.g. bori, pipa, peti"
                                autoCapitalize="none"
                                containerStyle={styles.halfCol}
                                testID="add-product-secondary-unit-input"
                            />
                            <AppTextField
                                label={`Factor (1 unit = ? ${baseUnit})`}
                                value={conversionFactor}
                                onChangeText={setConversionFactor}
                                keyboardType="decimal-pad"
                                placeholder="50"
                                containerStyle={styles.halfCol}
                                testID="add-product-conversion-factor-input"
                            />
                        </View>
                    </View>
                )}

                <AppButton
                    title={submitting ? 'Adding...' : 'Add to Catalog 🚀'}
                    onPress={handleCreate}
                    disabled={submitting}
                    loading={submitting}
                    style={styles.submitBtn}
                    testID="add-product-submit-button"
                />
            </View>
        </AppModal>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingBottom: Spacing.xl,
    },
    errorText: {
        ...Typography.caption,
        color: Colors.light.danger,
        marginTop: -Spacing.md,
        marginBottom: Spacing.md,
    },
    fieldLabel: {
        ...Typography.captionStrong,
        color: Colors.light.textSecondary,
        marginBottom: Spacing.xs,
    },
    chipRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: Spacing.xs,
        marginBottom: Spacing.md,
    },
    chip: {
        paddingHorizontal: Spacing.lg,
        paddingVertical: 8,
        borderRadius: Radius.pill,
        backgroundColor: Colors.light.surfaceElevated,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: Colors.light.border,
    },
    chipActive: {
        backgroundColor: Colors.light.tint,
        borderColor: Colors.light.tint,
    },
    chipText: {
        ...Typography.caption,
        color: Colors.light.text,
    },
    chipTextActive: {
        color: Colors.light.onTint,
        fontWeight: '600',
    },
    unitRow: {
        flexDirection: 'row',
        gap: Spacing.sm,
        marginBottom: Spacing.md,
    },
    unitChip: {
        flex: 1,
        paddingVertical: 10,
        borderRadius: Radius.sm,
        backgroundColor: Colors.light.surfaceElevated,
        alignItems: 'center',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: Colors.light.border,
    },
    unitChipActive: {
        backgroundColor: Colors.light.tint,
        borderColor: Colors.light.tint,
    },
    unitText: {
        ...Typography.captionStrong,
        color: Colors.light.text,
    },
    unitTextActive: {
        color: Colors.light.onTint,
    },
    sectionTitle: {
        ...Typography.bodyStrong,
        color: Colors.light.text,
        marginTop: Spacing.sm,
        marginBottom: Spacing.xs,
    },
    twoCol: {
        flexDirection: 'row',
        gap: Spacing.md,
    },
    halfCol: {
        flex: 1,
    },
    submitBtn: {
        marginTop: Spacing.md,
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
});
