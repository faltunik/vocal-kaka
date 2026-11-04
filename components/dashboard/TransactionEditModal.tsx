import { AppButton } from '@/components/ui/AppButton';
import { AppModal } from '@/components/ui/AppModal';
import { AppTextField } from '@/components/ui/AppTextField';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Colors } from '@/constants/Colors';
import { Spacing, TouchTarget } from '@/constants/Layout';
import { FeedbackService } from '@/services/FeedbackService';
import { usePrivacy } from '@/services/PrivacyContext';
import { TransactionItem } from '@/services/RecentActivityContext';
import { getErrorMessage } from '@/utils/errors';
import { formatActivityTitle } from '@/utils/format';
import { parsePositiveQuantity } from '@/utils/quantity';
import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

interface TransactionEditModalProps {
    visible: boolean;
    transaction: TransactionItem | null;
    onClose: () => void;
    onSave: (id: string, updates: Partial<TransactionItem>) => void;
    onDelete: (id: string) => void;
    /** Resolves a Tier-4 value sale with a confirmed rate per unit. */
    onResolveRate?: (transaction: TransactionItem, ratePerUnit: number) => Promise<boolean>;
}

export function TransactionEditModal({
    visible,
    transaction,
    onClose,
    onSave,
    onDelete,
    onResolveRate,
}: TransactionEditModalProps) {
    const [intent, setIntent] = useState<TransactionItem['intent']>('SALE');
    const [item, setItem] = useState('');
    const [quantity, setQuantity] = useState('');
    const [unit, setUnit] = useState('');
    const [rate, setRate] = useState('');
    const [resolving, setResolving] = useState(false);
    const { isStaffMode } = usePrivacy();

    useEffect(() => {
        if (transaction) {
            setIntent(transaction.intent);
            setItem(transaction.item);
            setQuantity(String(transaction.quantity));
            setUnit(transaction.unit || '');
            setRate('');
            setResolving(false);
        }
    }, [transaction]);

    const isUnpriced = !!transaction
        && (transaction.payload?.pricing_unresolved === true || transaction.needsReview === true);
    const canResolveRate = isUnpriced && typeof onResolveRate === 'function';

    const amountValue = Number(String(transaction?.amount ?? '').replace(/[^\d.]/g, '')) || 0;
    const rateValue = parsePositiveQuantity(rate);
    const calculatedQty = rateValue != null && amountValue > 0
        ? Math.round((amountValue / rateValue) * 1000) / 1000
        : null;

    const isSimpleIntent = intent === 'SALE' || intent === 'PURCHASE';
    const simpleIntent: 'SALE' | 'PURCHASE' = intent === 'PURCHASE' ? 'PURCHASE' : 'SALE';

    const handleSave = () => {
        if (!transaction) return;

        const trimmedItem = item.trim();
        const trimmedUnit = unit.trim();
        const qtyNum = parsePositiveQuantity(quantity);
        if (!trimmedItem || qtyNum == null) {
            Alert.alert('Invalid entry', 'Enter an item name and a quantity greater than zero.');
            return;
        }

        const updates: Partial<TransactionItem> = {
            intent,
            item: trimmedItem,
            quantity: qtyNum,
            unit: trimmedUnit,
            // Re-derive display fields, but keep the stored amount
            title: intent === 'EXPENSE'
                ? `Spent ${transaction.amount}${trimmedItem && trimmedItem !== 'Expense' ? ` on ${trimmedItem}` : ''}`
                : formatActivityTitle(intent, qtyNum, trimmedUnit, trimmedItem),
            subtitle: 'Edited',
            amount: transaction.amount,
            needsReview: false // Saving counts as review
        };

        onSave(transaction.id, updates);
        onClose();
    };

    const handleDelete = () => {
        if (!transaction) return;
        Alert.alert('Delete transaction', 'This transaction will be permanently deleted.', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                    onDelete(transaction.id);
                    onClose();
                }
            }
        ]);
    };

    const handleConfirmRate = async () => {
        if (!transaction || !onResolveRate) return;

        const confirmedRate = parsePositiveQuantity(rate);
        if (confirmedRate == null) {
            Alert.alert('Invalid rate', 'Enter a rate greater than zero.');
            return;
        }

        setResolving(true);
        try {
            const resolved = await onResolveRate(transaction, confirmedRate);
            if (!resolved) {
                Alert.alert('Rate not saved', 'Could not resolve this rate. Please try again.');
                return;
            }
            void FeedbackService.triggerSuccess();
            onClose();
        } catch (error: unknown) {
            Alert.alert('Error', getErrorMessage(error));
        } finally {
            setResolving(false);
        }
    };

    if (isStaffMode) return null;
    if (!transaction) return null;

    if (canResolveRate) {
        const rateUnit = transaction.unit || 'unit';
        return (
            <AppModal
                visible={visible}
                onClose={onClose}
                title={`Confirm Rate for ${transaction.item}`}
                closeDisabled={resolving}
            >
                <Text style={styles.rateHint}>
                    Customer spent {transaction.amount}. Enter current rate to calculate weight.
                </Text>

                <AppTextField
                    label={`Rate per ${rateUnit}`}
                    value={rate}
                    onChangeText={setRate}
                    keyboardType="decimal-pad"
                    placeholder="e.g. 40"
                    testID="rate-resolution-input"
                />

                {calculatedQty != null && (
                    <Text style={styles.ratePreview} testID="rate-resolution-preview">
                        Calculated Quantity: {calculatedQty} {rateUnit}
                    </Text>
                )}

                <View style={styles.actions}>
                    <AppButton
                        title="Cancel"
                        onPress={onClose}
                        variant="outline"
                        disabled={resolving}
                        style={styles.deleteButton}
                        textStyle={styles.cancelText}
                        testID="rate-cancel-button"
                    />
                    <AppButton
                        title={resolving ? 'Resolving...' : 'Confirm Rate'}
                        onPress={handleConfirmRate}
                        disabled={resolving || calculatedQty == null}
                        loading={resolving}
                        style={styles.saveButton}
                        testID="rate-confirm-button"
                    />
                </View>
            </AppModal>
        );
    }

    return (
        <AppModal visible={visible} onClose={onClose} title="Edit Transaction">
            {isSimpleIntent && (
                <SegmentedControl
                    options={[
                        { value: 'SALE', label: 'Sale' },
                        { value: 'PURCHASE', label: 'Purchase' },
                    ]}
                    value={simpleIntent}
                    onChange={setIntent}
                    activeColor={simpleIntent === 'SALE' ? Colors.light.success : Colors.light.tint}
                    style={styles.switch}
                />
            )}

            <View style={styles.form}>
                <AppTextField
                    label="Item Name"
                    value={item}
                    onChangeText={setItem}
                    placeholder="e.g. Milk"
                />

                <View style={styles.row}>
                    <AppTextField
                        label="Quantity"
                        containerStyle={styles.rowCell}
                        value={quantity}
                        onChangeText={setQuantity}
                        keyboardType="numeric"
                    />
                    <AppTextField
                        label="Unit"
                        containerStyle={styles.rowCell}
                        value={unit}
                        onChangeText={setUnit}
                        placeholder="e.g. kg"
                    />
                </View>
            </View>

            <View style={styles.actions}>
                <AppButton
                    title="Delete"
                    onPress={handleDelete}
                    variant="danger"
                    style={styles.deleteButton}
                    textStyle={styles.deleteText}
                />
                <AppButton
                    title="Save Changes"
                    onPress={handleSave}
                    style={styles.saveButton}
                />
            </View>
        </AppModal>
    );
}

const styles = StyleSheet.create({
    switch: {
        marginBottom: Spacing.lg,
    },
    form: {
        marginBottom: Spacing.lg,
    },
    rateHint: {
        fontSize: 15,
        color: Colors.light.textSecondary,
        marginBottom: Spacing.lg,
    },
    ratePreview: {
        fontSize: 16,
        fontWeight: '600',
        color: Colors.light.tint,
        marginBottom: Spacing.lg,
    },
    row: {
        flexDirection: 'row',
        gap: Spacing.lg,
    },
    rowCell: {
        flex: 1,
    },
    actions: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: Spacing.md,
    },
    deleteButton: {
        flex: 1,
        minHeight: TouchTarget.min,
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: Colors.light.danger,
    },
    deleteText: {
        color: Colors.light.danger,
    },
    cancelText: {
        color: Colors.light.danger,
    },
    saveButton: {
        flex: 1,
    },
});
