import { Colors } from '@/constants/Colors';
import { Radius, Spacing } from '@/constants/Layout';
import { Typography } from '@/constants/Typography';
import { toScope } from '@/core/interfaces/IInventoryRepository';
import { useStoreScope } from '@/hooks/useStoreScope';
import { useAuth } from '@/services/AuthContext';
import { container } from '@/services/Container';
import { usePrivacy } from '@/services/PrivacyContext';
import { TransactionItem, useRecentActivity } from '@/services/RecentActivityContext';
import { formatClockTime, formatCurrency } from '@/utils/format';
import { Ionicons } from '@expo/vector-icons';
import React, { ComponentProps, useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { TransactionEditModal } from './TransactionEditModal';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

interface RecentActivityListProps {
    /** Show only the first N rows (dashboard). Omit for the full feed. */
    limit?: number;
}

function rowVisual(item: TransactionItem): { icon: IoniconName; color: string; background: string } {
    switch (item.intent) {
        case 'PURCHASE':
            return { icon: 'arrow-up', color: Colors.light.success, background: Colors.light.successSoft };
        case 'SALE':
            return { icon: 'arrow-down', color: Colors.light.danger, background: Colors.light.dangerSoft };
        case 'CUSTOMER_RETURN':
            return { icon: 'arrow-undo', color: Colors.light.success, background: Colors.light.successSoft };
        case 'WRITE_OFF':
            return { icon: 'trash-outline', color: Colors.light.danger, background: Colors.light.dangerSoft };
        case 'VENDOR_RETURN':
            return { icon: 'arrow-redo', color: Colors.light.warning, background: Colors.light.warningSoft };
        case 'ADJUSTMENT':
            return { icon: 'options-outline', color: Colors.light.warning, background: Colors.light.warningSoft };
        case 'EXPENSE':
        default:
            return { icon: 'receipt-outline', color: Colors.light.textSecondary, background: Colors.light.surfaceElevated };
    }
}

function rowText(item: TransactionItem): string {
    if (item.intent === 'EXPENSE') {
        const note = item.item && item.item !== 'Expense' ? ` (${item.item})` : '';
        return `Expense: ${item.amount}${note}`;
    }
    if (item.intent === 'ADJUSTMENT') {
        const unit = item.unit ? ` ${item.unit}` : '';
        const sign = item.quantity > 0 ? '+' : '';
        return `${sign}${item.quantity}${unit} ${item.item}`.replace(/\s+/g, ' ').trim();
    }
    const isOutgoing = item.intent === 'SALE' || item.intent === 'WRITE_OFF' || item.intent === 'VENDOR_RETURN';
    const prefix = isOutgoing ? '-' : '+';
    const unit = item.unit ? ` ${item.unit}` : '';
    return `${prefix} ${item.quantity}${unit} ${item.item}`.replace(/\s+/g, ' ').trim();
}

/**
 * Money moved by this row: green when the shop received it, red when it left.
 * Staff see no totals at all — a purchase amount reveals wholesale cost.
 */
function rowMoney(item: TransactionItem, isStaffMode: boolean): { text: string; color: string } | null {
    if (isStaffMode) return null;
    const raw = Number(String(item.amount ?? '').replace(/[^\d.]/g, ''));
    if (!Number.isFinite(raw) || raw <= 0) return null;
    const incoming = item.intent === 'SALE' || item.intent === 'VENDOR_RETURN';
    return {
        text: `${incoming ? '+' : '-'}${formatCurrency(raw)}`,
        color: incoming ? Colors.light.success : Colors.light.danger,
    };
}

export function RecentActivityList({ limit }: RecentActivityListProps) {
    const { activities, loading, error, updateActivity, deleteActivity, refresh } = useRecentActivity();
    const { isStaffMode } = usePrivacy();
    const { user } = useAuth();
    const { storeId } = useStoreScope();
    const [editingItem, setEditingItem] = useState<TransactionItem | null>(null);

    const handleResolveRate = useCallback(async (
        transaction: TransactionItem,
        ratePerUnit: number
    ): Promise<boolean> => {
        if (!user || !transaction.eventId) return false;
        const scope = toScope(user.id, transaction.storeId ?? storeId);
        const resolved = await container.inventoryService.resolveUnpricedSale(
            scope,
            transaction.eventId,
            ratePerUnit
        );
        if (resolved) refresh();
        return resolved;
    }, [user, storeId, refresh]);

    // Staff accounts must not see expense notes or rupee totals (role privacy).
    // Filter before applying the limit so staff still get a full page.
    const privacyFiltered = isStaffMode
        ? activities.filter(item => item.intent !== 'EXPENSE')
        : activities;
    const visible = limit != null ? privacyFiltered.slice(0, limit) : privacyFiltered;

    if (visible.length === 0) {
        if (loading) {
            return (
                <View style={styles.empty}>
                    <Text style={styles.emptyText}>Loading transactions…</Text>
                </View>
            );
        }
        if (error) {
            return (
                <View style={styles.empty}>
                    <Text style={styles.emptyText}>
                        {error.message || 'Could not load transactions.'}
                    </Text>
                    <TouchableOpacity
                        onPress={refresh}
                        accessibilityRole="button"
                        accessibilityLabel="Retry loading transactions"
                    >
                        <Text style={styles.retryText}>Retry</Text>
                    </TouchableOpacity>
                </View>
            );
        }
        return (
            <View style={styles.empty}>
                <Text style={styles.emptyText}>No transactions yet. Tap the mic to start.</Text>
            </View>
        );
    }

    return (
        <View>
            {visible.map((item, index) => {
                const visual = rowVisual(item);
                const money = rowMoney(item, isStaffMode);
                return (
                    <TouchableOpacity
                        key={item.id}
                        style={[styles.row, index > 0 && styles.rowDivider]}
                        onPress={isStaffMode ? undefined : () => setEditingItem(item)}
                        activeOpacity={isStaffMode ? 1 : 0.7}
                        accessibilityRole="button"
                        accessibilityLabel={`${rowText(item)}${isStaffMode ? '' : `, ${item.amount}`}${item.needsReview ? ', needs review' : ''}`}
                    >
                        <View style={[styles.iconCircle, { backgroundColor: visual.background }]}>
                            <Ionicons name={visual.icon} size={18} color={visual.color} />
                        </View>
                        <Text style={styles.rowText} numberOfLines={1}>{rowText(item)}</Text>
                        {money ? (
                            <Text style={[styles.rowAmount, { color: money.color }]}>{money.text}</Text>
                        ) : (
                            <Text style={styles.rowTime}>{formatClockTime(item.timestamp)}</Text>
                        )}
                    </TouchableOpacity>
                );
            })}

            {!isStaffMode && (
                <TransactionEditModal
                    visible={!!editingItem}
                    transaction={editingItem}
                    onClose={() => setEditingItem(null)}
                    onSave={updateActivity}
                    onDelete={deleteActivity}
                    onResolveRate={handleResolveRate}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: Spacing.md,
    },
    rowDivider: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: Colors.light.border,
    },
    iconCircle: {
        width: 40,
        height: 40,
        borderRadius: Radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: Spacing.md,
    },
    rowText: {
        ...Typography.body,
        flex: 1,
        color: Colors.light.text,
        marginRight: Spacing.sm,
    },
    rowTime: {
        ...Typography.caption,
        color: Colors.light.textSecondary,
    },
    rowAmount: {
        ...Typography.captionStrong,
        fontSize: 13,
    },
    empty: {
        paddingVertical: Spacing.xl,
    },
    emptyText: {
        ...Typography.body,
        color: Colors.light.textSecondary,
        textAlign: 'center',
    },
    retryText: {
        ...Typography.bodyStrong,
        color: Colors.light.tint,
        textAlign: 'center',
        marginTop: Spacing.sm,
    },
});
