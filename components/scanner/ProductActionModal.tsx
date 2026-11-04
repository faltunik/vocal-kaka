import { AppButton } from '@/components/ui/AppButton';
import { AppModal } from '@/components/ui/AppModal';
import { AppTextField } from '@/components/ui/AppTextField';
import { Colors } from '@/constants/Colors';
import { Spacing } from '@/constants/Layout';
import { Typography } from '@/constants/Typography';
import { InventoryItem } from '@/core/interfaces/IInventoryRepository';
import { formatFriendlyQuantity } from '@/utils/format';
import { parsePositiveQuantity } from '@/utils/quantity';
import React, { useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

interface ProductActionModalProps {
    visible: boolean;
    product: InventoryItem | null;
    scannedBarcode?: string;
    prefilledData?: { name: string; unit: string } | null;
    onClose: () => void;
    onAddStock: (quantity: number, product: InventoryItem) => boolean | void | Promise<boolean | void>;
    onRecordSale: (quantity: number, product: InventoryItem) => boolean | void | Promise<boolean | void>;
    onCreateProduct?: (name: string, quantity: number, unit: string, barcode: string) => boolean | void | Promise<boolean | void>;
}

export function ProductActionModal({
    visible,
    product,
    scannedBarcode,
    prefilledData,
    onClose,
    onAddStock,
    onRecordSale,
    onCreateProduct
}: ProductActionModalProps) {
    const [quantity, setQuantity] = useState('1');
    const [submitting, setSubmitting] = useState(false);

    // Creation State
    const [newName, setNewName] = useState('');
    const [newUnit, setNewUnit] = useState('pcs');

    // Synchronous double-tap guard
    const busyRef = useRef(false);

    // Incremented on every open so stale actions cannot affect the next session
    const sessionRef = useRef(0);

    // Keep the latest callback without resetting the form when the parent re-renders
    const onCreateProductRef = useRef(onCreateProduct);
    onCreateProductRef.current = onCreateProduct;

    // Reset state when opening
    React.useEffect(() => {
        if (visible) {
            sessionRef.current += 1;
            setQuantity('1');
            setNewName(prefilledData?.name || '');
            setNewUnit(prefilledData?.unit || 'pcs');
            busyRef.current = false;
            setSubmitting(false);
        }
    }, [visible, product, prefilledData]);

    const runAction = async (action: () => boolean | void | Promise<boolean | void>) => {
        if (busyRef.current) return;
        busyRef.current = true;
        setSubmitting(true);
        const session = sessionRef.current;
        try {
            const result = await action();
            if (sessionRef.current !== session) return;
            if (result === false) return;
            onClose();
        } catch (error) {
            console.error('[ProductActionModal] Action failed', error);
            if (sessionRef.current === session) {
                Alert.alert('Something went wrong', 'Please try again.');
            }
        } finally {
            if (sessionRef.current === session) {
                busyRef.current = false;
                setSubmitting(false);
            }
        }
    };

    const validateQuantity = (): number | null => {
        const qty = parsePositiveQuantity(quantity);
        if (qty == null) {
            Alert.alert('Invalid quantity', 'Enter a quantity greater than zero.');
            return null;
        }
        return qty;
    };

    const handleAdd = () => {
        const qty = validateQuantity();
        if (qty == null) return;
        if (product) {
            void runAction(() => onAddStock(qty, product));
        } else {
            if (!newName.trim()) {
                Alert.alert('Invalid product', 'Enter a product name.');
                return;
            }
            const createProduct = onCreateProductRef.current;
            if (createProduct && scannedBarcode) {
                void runAction(() => createProduct(newName.trim(), qty, newUnit.trim() || 'pcs', scannedBarcode));
            } else {
                const syntheticProduct: InventoryItem = {
                    id: '',
                    user_id: '',
                    name: newName.trim(),
                    quantity: 0,
                    unit: newUnit.trim() || 'pcs',
                    barcode: scannedBarcode,
                };
                void runAction(() => onAddStock(qty, syntheticProduct));
            }
        }
    };

    const handleSale = () => {
        const qty = validateQuantity();
        if (qty == null) return;
        if (product) {
            void runAction(() => onRecordSale(qty, product));
        } else {
            if (!newName.trim()) {
                Alert.alert('Invalid product', 'Enter a product name.');
                return;
            }
            const syntheticProduct: InventoryItem = {
                id: '',
                user_id: '',
                name: newName.trim(),
                quantity: 0,
                unit: newUnit.trim() || 'pcs',
                barcode: scannedBarcode,
            };
            void runAction(() => onRecordSale(qty, syntheticProduct));
        }
    };

    if (!visible) return null;

    return (
        <AppModal
            visible={visible}
            onClose={onClose}
            title={product ? 'Product Found' : 'Unknown Product'}
            variant="sheet"
            closeDisabled={submitting}
        >
            {product ? (
                <>
                    <View style={styles.productInfo}>
                        <Text style={styles.productName}>{product.name}</Text>
                        <Text style={styles.productStock}>
                            Current Stock:{' '}
                            <Text style={styles.stockValue}>
                                {formatFriendlyQuantity(product.quantity, product.base_unit ?? product.unit, {
                                    secondaryUnit: product.secondary_unit,
                                    conversionFactor: product.conversion_factor,
                                })}
                            </Text>
                        </Text>
                    </View>

                    <AppTextField
                        label="Quantity"
                        containerStyle={styles.inputContainer}
                        value={quantity}
                        onChangeText={setQuantity}
                        keyboardType="numeric"
                        autoFocus
                    />

                    <View style={styles.actions}>
                        <AppButton
                            title="Add Stock"
                            onPress={handleAdd}
                            loading={submitting}
                            disabled={submitting}
                            style={styles.actionButton}
                        />
                        <AppButton
                            title="Record Sale"
                            variant="success"
                            onPress={handleSale}
                            loading={submitting}
                            disabled={submitting}
                            style={styles.actionButton}
                        />
                    </View>
                </>
            ) : (
                <>
                    <Text style={styles.subtitle}>
                        No product found for barcode: {scannedBarcode}
                    </Text>

                    <View style={styles.form}>
                        <AppTextField
                            label="Product Name"
                            value={newName}
                            onChangeText={setNewName}
                            placeholder="e.g. Maggi"
                            autoFocus
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
                                value={newUnit}
                                onChangeText={setNewUnit}
                                placeholder="e.g. pcs"
                            />
                        </View>
                    </View>

                    <View style={styles.actions}>
                        <AppButton
                            title="Add Stock"
                            onPress={handleAdd}
                            loading={submitting}
                            disabled={submitting}
                            style={styles.actionButton}
                        />
                        <AppButton
                            title="Record Sale"
                            variant="success"
                            onPress={handleSale}
                            loading={submitting}
                            disabled={submitting}
                            style={styles.actionButton}
                        />
                    </View>
                </>
            )}
        </AppModal>
    );
}

const styles = StyleSheet.create({
    subtitle: {
        ...Typography.body,
        color: Colors.light.textSecondary,
        marginBottom: Spacing.sm,
    },
    productInfo: {
        marginBottom: Spacing.xl,
    },
    productName: {
        ...Typography.title,
        color: Colors.light.text,
        marginBottom: Spacing.xs,
    },
    productStock: {
        ...Typography.body,
        color: Colors.light.textSecondary,
    },
    stockValue: {
        ...Typography.bodyStrong,
        color: Colors.light.tint,
    },
    inputContainer: {
        marginBottom: Spacing.sm,
    },
    actions: {
        flexDirection: 'row',
        gap: Spacing.lg,
    },
    actionButton: {
        flex: 1,
    },
    form: {
        marginBottom: Spacing.xs,
    },
    row: {
        flexDirection: 'row',
        gap: Spacing.md,
    },
    rowCell: {
        flex: 1,
    },
});
