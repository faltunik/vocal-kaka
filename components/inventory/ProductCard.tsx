import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { InventoryItem } from '@/core/interfaces/IInventoryRepository';
import { Colors } from '@/constants/Colors';
import { Spacing, Radius, TouchTarget } from '@/constants/Layout';
import { Typography } from '@/constants/Typography';
import { formatCurrency, formatFriendlyQuantity } from '@/utils/format';
import { Ionicons } from '@expo/vector-icons';
import { usePrivacy } from '@/services/PrivacyContext';

interface ProductCardProps {
    item: InventoryItem;
    onPress: () => void;
}

export const ProductCard = React.memo(function ProductCard({ item, onPress }: ProductCardProps) {
    const { isMasked, isStaffMode } = usePrivacy();
    const isSensitiveHidden = isMasked || isStaffMode;

    const qty = Number(item.quantity);
    const threshold = Number(item.low_stock_threshold ?? 5);
    const isNegative = qty < 0;
    const isOut = qty <= 0;
    const isLow = !isOut && qty <= threshold;

    const sp = Number(item.selling_price);
    const cp = Number(item.last_purchase_price);
    const hasMargin = Number.isFinite(sp) && Number.isFinite(cp) && cp > 0 && sp > 0;
    const marginPct = hasMargin ? Math.round(((sp - cp) / cp) * 100) : null;

    const baseUnit = item.base_unit || item.unit || 'pcs';

    const aliasDisplay =
        item.aliases && item.aliases.length > 0
            ? `(${item.aliases.slice(0, 2).join(', ')})`
            : null;

    const handleCardPress = () => {
        if (isStaffMode) return;
        onPress();
    };

    return (
        <TouchableOpacity
            style={styles.card}
            onPress={handleCardPress}
            disabled={isStaffMode}
            activeOpacity={isStaffMode ? 1 : 0.7}
            accessibilityRole="button"
            accessibilityState={{ disabled: isStaffMode }}
            accessibilityLabel={isStaffMode ? item.name : `Edit ${item.name}`}
            testID={`product-card-${item.id}`}
        >
            <View style={styles.topRow}>
                <View style={styles.nameBlock}>
                    <Text style={styles.name} numberOfLines={1}>
                        {item.name}
                    </Text>
                    {aliasDisplay && (
                        <Text style={styles.alias} numberOfLines={1}>
                            {aliasDisplay}
                        </Text>
                    )}
                </View>

                <View style={styles.topActions}>
                    {isNegative ? (
                        <View style={[styles.badge, styles.badgeNegative]}>
                            <Text style={styles.badgeTextNegative}>
                                ⚠️ Sold Before Inward: {Math.abs(qty)} {baseUnit}
                            </Text>
                        </View>
                    ) : isOut ? (
                        <View style={[styles.badge, styles.badgeOut]}>
                            <Text style={styles.badgeTextOut}>Out of Stock</Text>
                        </View>
                    ) : isLow ? (
                        <View style={[styles.badge, styles.badgeLow]}>
                            <Text style={styles.badgeTextLow}>Low Stock</Text>
                        </View>
                    ) : (
                        <View style={[styles.badge, styles.badgeHealthy]}>
                            <Text style={styles.badgeTextHealthy}>In Stock</Text>
                        </View>
                    )}

                    {!isStaffMode && (
                        <TouchableOpacity
                            style={styles.editButton}
                            onPress={onPress}
                            activeOpacity={0.7}
                            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                            accessibilityRole="button"
                            accessibilityLabel={`Edit ${item.name}`}
                            testID={`edit-button-${item.id}`}
                        >
                            <Ionicons name="pencil" size={12} color={Colors.light.tint} />
                            <Text style={styles.editButtonText}>Edit</Text>
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            {isNegative && !isStaffMode && (
                <TouchableOpacity
                    style={styles.deliveryButton}
                    onPress={onPress}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Record Delivery Bill for ${item.name}`}
                    testID={`record-delivery-${item.id}`}
                >
                    <Ionicons name="cloud-download-outline" size={14} color={Colors.light.warning} />
                    <Text style={styles.deliveryButtonText}>Record Delivery Bill</Text>
                </TouchableOpacity>
            )}

            <View style={styles.middleRow}>
                <View style={styles.stockBlock}>
                    <Text style={styles.fieldLabel}>Stock on Hand</Text>
                    <Text style={[styles.stockValue, isNegative ? styles.stockNegative : isOut && styles.stockOut, isLow && styles.stockLow]}>
                        {formatFriendlyQuantity(item.quantity, baseUnit, {
                            secondaryUnit: item.secondary_unit,
                            conversionFactor: item.conversion_factor,
                        })}
                    </Text>
                </View>

                <View style={styles.pricingBlock}>
                    <Text style={styles.fieldLabel}>Selling Price</Text>
                    <Text style={styles.sellingValue}>
                        {sp > 0 ? `${formatCurrency(sp)} / ${baseUnit}` : 'Unpriced'}
                    </Text>
                </View>
            </View>

            <View style={styles.bottomRow}>
                <Text style={styles.costInfo}>
                    {isSensitiveHidden
                        ? 'Cost: •••••'
                        : `Cost: ${cp > 0 ? `${formatCurrency(cp)} / ${baseUnit}` : 'N/A'}${marginPct !== null ? ` (${marginPct >= 0 ? '+' : ''}${marginPct}% margin)` : ''}`}
                </Text>
                {item.secondary_unit && item.conversion_factor && (
                    <Text style={styles.packagingInfo}>
                        1 {item.secondary_unit} = {item.conversion_factor} {baseUnit}
                    </Text>
                )}
            </View>
        </TouchableOpacity>
    );
});

const styles = StyleSheet.create({
    card: {
        backgroundColor: Colors.light.surface,
        borderRadius: Radius.md,
        padding: Spacing.md,
        marginBottom: Spacing.sm,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: Colors.light.border,
        gap: Spacing.xs,
    },
    topRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    nameBlock: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: Spacing.xs,
        marginRight: Spacing.sm,
    },
    name: {
        ...Typography.bodyStrong,
        color: Colors.light.text,
        fontSize: 16,
    },
    alias: {
        ...Typography.caption,
        color: Colors.light.textSecondary,
        fontSize: 13,
    },
    badge: {
        paddingHorizontal: Spacing.sm,
        paddingVertical: 2,
        borderRadius: Radius.pill,
    },
    badgeHealthy: {
        backgroundColor: Colors.light.successSoft,
    },
    badgeLow: {
        backgroundColor: Colors.light.warningSoft,
    },
    badgeOut: {
        backgroundColor: Colors.light.dangerSoft,
    },
    badgeNegative: {
        backgroundColor: Colors.light.warningSoft,
    },
    badgeTextHealthy: {
        ...Typography.captionStrong,
        fontSize: 11,
        color: Colors.light.success,
    },
    badgeTextLow: {
        ...Typography.captionStrong,
        fontSize: 11,
        color: Colors.light.warningText,
    },
    badgeTextOut: {
        ...Typography.captionStrong,
        fontSize: 11,
        color: Colors.light.danger,
    },
    badgeTextNegative: {
        ...Typography.captionStrong,
        fontSize: 11,
        color: Colors.light.warningText,
    },
    deliveryButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: Spacing.xs,
        minHeight: TouchTarget.min,
        paddingVertical: Spacing.xs,
        borderRadius: Radius.sm,
        backgroundColor: Colors.light.warningSoft,
    },
    deliveryButtonText: {
        ...Typography.captionStrong,
        fontSize: 12,
        color: Colors.light.warningText,
    },
    middleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 2,
    },
    stockBlock: {
        flex: 1.3,
    },
    fieldLabel: {
        ...Typography.caption,
        fontSize: 11,
        color: Colors.light.textSecondary,
    },
    stockValue: {
        ...Typography.bodyStrong,
        fontSize: 15,
        color: Colors.light.text,
    },
    stockLow: {
        color: Colors.light.warningText,
    },
    stockOut: {
        color: Colors.light.danger,
    },
    stockNegative: {
        color: Colors.light.warningText,
    },
    pricingBlock: {
        flex: 1.2,
    },
    sellingValue: {
        ...Typography.bodyStrong,
        fontSize: 15,
        color: Colors.light.tint,
    },
    topActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.xs,
    },
    editButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        minHeight: 32,
        paddingHorizontal: Spacing.sm,
        paddingVertical: 3,
        borderRadius: Radius.pill,
        backgroundColor: Colors.light.surfaceElevated,
        borderWidth: 1,
        borderColor: Colors.light.borderStrong,
    },
    editButtonText: {
        ...Typography.captionStrong,
        fontSize: 11,
        color: Colors.light.text,
    },
    bottomRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: Colors.light.border,
        paddingTop: 4,
        marginTop: 2,
    },
    costInfo: {
        ...Typography.caption,
        fontSize: 11,
        color: Colors.light.textSecondary,
    },
    packagingInfo: {
        ...Typography.caption,
        fontSize: 11,
        color: Colors.light.textSecondary,
        fontStyle: 'italic',
    },
});
