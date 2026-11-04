import { QuantityNumpad } from '@/components/counter/QuantityNumpad';
import { AppButton } from '@/components/ui/AppButton';
import { AppHeader } from '@/components/ui/AppHeader';
import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { Colors } from '@/constants/Colors';
import { Radius, Spacing } from '@/constants/Layout';
import { Typography } from '@/constants/Typography';
import { InventoryItem } from '@/core/interfaces/IInventoryRepository';
import { useInventory } from '@/hooks/useInventory';
import { useStoreScope } from '@/hooks/useStoreScope';
import { useAuth } from '@/services/AuthContext';
import { container } from '@/services/Container';
import { FeedbackService } from '@/services/FeedbackService';
import { useRecentActivity } from '@/services/RecentActivityContext';
import { getErrorMessage } from '@/utils/errors';
import { formatFriendlyQuantity } from '@/utils/format';
import { parsePositiveQuantity } from '@/utils/quantity';
import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useRef, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

type CounterAction = 'SALE' | 'PURCHASE' | 'WRITE_OFF';

const MAX_RESULTS = 50;

export default function QuickCounterScreen() {
    const { user, isGuest } = useAuth();
    const { currentScope } = useStoreScope();
    const { items, loading, error, refetch } = useInventory();
    const { refresh } = useRecentActivity();

    const [query, setQuery] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [quantity, setQuantity] = useState('');
    const [submitting, setSubmitting] = useState<CounterAction | null>(null);
    const submittingRef = useRef(false);

    // Derive the selection from the live catalog so a refetch refreshes stock
    // (and a deleted item clears the selection) without a stale snapshot.
    const selected = useMemo(
        () => (selectedId ? items.find(item => item.id === selectedId) ?? null : null),
        [items, selectedId]
    );

    const results = useMemo(() => {
        const needle = query.trim().toLowerCase();
        const matched = needle
            ? items.filter(item =>
                item.name.toLowerCase().includes(needle)
                || (item.aliases || []).some(alias => alias.toLowerCase().includes(needle)))
            : items;
        return matched.slice(0, MAX_RESULTS);
    }, [items, query]);

    const baseUnit = selected ? (selected.base_unit || selected.unit || 'pcs') : 'pcs';

    const handleKeyPress = (key: string) => {
        setQuantity(prev => {
            if (key === 'DEL') return prev.slice(0, -1);
            if (key === '.' && (prev === '' || prev.includes('.'))) return prev;
            if (prev === '0' && key !== '.') return key;
            return `${prev}${key}`;
        });
    };

    const handleSelect = (item: InventoryItem) => {
        setSelectedId(item.id);
        setQuery('');
        setQuantity('');
    };

    const dispatch = async (action: CounterAction) => {
        // Synchronous guard: rapid double-taps must not mint two ledger events.
        if (submittingRef.current) return;

        if (!selected) {
            Alert.alert('Select an item', 'Search and tap a product first.');
            return;
        }
        const parsedQuantity = parsePositiveQuantity(quantity);
        if (parsedQuantity == null) {
            Alert.alert('Invalid quantity', 'Enter a quantity greater than zero.');
            return;
        }
        if (!user?.id) {
            Alert.alert('Not signed in', isGuest
                ? 'Guest mode: transactions are not saved.'
                : 'Sign in to record transactions.');
            return;
        }

        // A sale without a selling price would silently record ₹0 revenue.
        if (action === 'SALE') {
            const price = Number(selected.selling_price);
            if (!Number.isFinite(price) || price <= 0) {
                Alert.alert('Price missing', 'Add a selling price for this item in Inventory before recording a sale.');
                return;
            }
        }

        submittingRef.current = true;
        setSubmitting(action);
        try {
            const scope = currentScope();
            const input = {
                item: selected.name,
                quantity: parsedQuantity,
                unit: baseUnit,
                ...(action === 'SALE' && selected.selling_price != null
                    ? { price: selected.selling_price }
                    : {}),
            };

            let applied = false;
            if (action === 'SALE') {
                applied = await container.inventoryService.saleEvent(scope, input);
            } else if (action === 'PURCHASE') {
                applied = await container.inventoryService.addStockEvent(scope, input);
            } else {
                applied = await container.inventoryService.writeOffEvent(scope, input);
            }

            if (!applied) {
                Alert.alert('Not saved', 'The entry could not be recorded. Please try again.');
                return;
            }

            void FeedbackService.triggerSuccess();
            setQuantity('');
            refetch();
            refresh();
        } catch (error: unknown) {
            Alert.alert('Error', getErrorMessage(error));
        } finally {
            submittingRef.current = false;
            setSubmitting(null);
        }
    };

    return (
        <ScreenLayout>
            <AppHeader title="Quick Counter" />

            <View style={styles.content}>
                {isGuest && !user && (
                    <View style={styles.guestNotice}>
                        <Ionicons name="information-circle-outline" size={16} color={Colors.light.textSecondary} />
                        <Text style={styles.guestNoticeText}>
                            Guest mode: entries are not saved. Sign in to use the counter.
                        </Text>
                    </View>
                )}

                {/* Stale catalog warning: refetch failed but cached items remain */}
                {error != null && results.length > 0 && (
                    <View style={styles.catalogError}>
                        <Ionicons name="cloud-offline-outline" size={16} color={Colors.light.danger} />
                        <Text style={styles.catalogErrorText}>Catalog may be out of date.</Text>
                        <TouchableOpacity
                            onPress={refetch}
                            accessibilityRole="button"
                            accessibilityLabel="Retry loading catalog"
                        >
                            <Text style={styles.retryText}>Retry</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {selected ? (
                    <View style={styles.selectedCard}>
                        <View style={styles.selectedInfo}>
                            <Text style={styles.selectedName} numberOfLines={1}>{selected.name}</Text>
                            <Text style={styles.selectedStock}>
                                Stock: {formatFriendlyQuantity(selected.quantity, baseUnit)}
                            </Text>
                        </View>
                        <TouchableOpacity
                            onPress={() => setSelectedId(null)}
                            accessibilityRole="button"
                            accessibilityLabel="Change item"
                            testID="quick-counter-clear-item"
                        >
                            <Ionicons name="close-circle" size={24} color={Colors.light.textSecondary} />
                        </TouchableOpacity>
                    </View>
                ) : (
                    <>
                        <View style={styles.searchRow}>
                            <Ionicons name="search" size={18} color={Colors.light.textSecondary} />
                            <TextInput
                                style={styles.searchInput}
                                value={query}
                                onChangeText={setQuery}
                                placeholder="Search item (e.g. Jeera, दाल)"
                                placeholderTextColor={Colors.light.textSecondary}
                                testID="quick-counter-search"
                            />
                        </View>

                        <FlatList
                            data={results}
                            keyExtractor={item => item.id}
                            keyboardShouldPersistTaps="handled"
                            style={styles.results}
                            renderItem={({ item }) => (
                                <TouchableOpacity
                                    style={styles.resultRow}
                                    onPress={() => handleSelect(item)}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Select ${item.name}`}
                                    testID={`quick-counter-item-${item.id}`}
                                >
                                    <Text style={styles.resultName} numberOfLines={1}>{item.name}</Text>
                                    <Text style={styles.resultStock}>
                                        {formatFriendlyQuantity(item.quantity, item.base_unit || item.unit)}
                                    </Text>
                                </TouchableOpacity>
                            )}
                            ListEmptyComponent={
                                loading ? (
                                    <Text style={styles.emptyText}>Loading catalog…</Text>
                                ) : error ? (
                                    <View style={styles.emptyBlock}>
                                        <Text style={styles.emptyText}>
                                            {error.message || 'Could not load the catalog.'}
                                        </Text>
                                        <TouchableOpacity
                                            onPress={refetch}
                                            accessibilityRole="button"
                                            accessibilityLabel="Retry loading catalog"
                                        >
                                            <Text style={styles.retryText}>Retry</Text>
                                        </TouchableOpacity>
                                    </View>
                                ) : (
                                    <Text style={styles.emptyText}>No matching items in the catalog.</Text>
                                )
                            }
                        />
                    </>
                )}

                <View style={styles.quantityBlock}>
                    <Text style={styles.quantityLabel}>Quantity ({baseUnit})</Text>
                    <Text style={styles.quantityValue} testID="quick-counter-quantity">
                        {quantity || '0'}
                    </Text>
                </View>

                <QuantityNumpad onKeyPress={handleKeyPress} />

                <View style={styles.actions}>
                    <AppButton
                        title="Sale"
                        onPress={() => dispatch('SALE')}
                        loading={submitting === 'SALE'}
                        disabled={submitting != null}
                        style={styles.saleButton}
                        testID="quick-counter-sale"
                    />
                    <AppButton
                        title="Stock In"
                        onPress={() => dispatch('PURCHASE')}
                        loading={submitting === 'PURCHASE'}
                        disabled={submitting != null}
                        style={styles.stockButton}
                        testID="quick-counter-stock"
                    />
                    <AppButton
                        title="Waste"
                        onPress={() => dispatch('WRITE_OFF')}
                        variant="danger"
                        loading={submitting === 'WRITE_OFF'}
                        disabled={submitting != null}
                        style={styles.wasteButton}
                        testID="quick-counter-waste"
                    />
                </View>

                <Text style={styles.hint}>
                    Works offline — entries sync automatically when the network returns.
                </Text>
            </View>
        </ScreenLayout>
    );
}

const styles = StyleSheet.create({
    content: {
        flex: 1,
        paddingHorizontal: Spacing.xl,
        paddingBottom: Spacing.xl,
        gap: Spacing.md,
    },
    guestNotice: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        backgroundColor: Colors.light.surfaceElevated,
        borderRadius: Radius.md,
        padding: Spacing.md,
    },
    guestNoticeText: {
        ...Typography.caption,
        color: Colors.light.textSecondary,
        flex: 1,
    },
    catalogError: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        backgroundColor: Colors.light.dangerSoft,
        borderRadius: Radius.md,
        padding: Spacing.md,
    },
    catalogErrorText: {
        ...Typography.caption,
        color: Colors.light.danger,
        flex: 1,
    },
    searchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        backgroundColor: Colors.light.surfaceElevated,
        borderRadius: Radius.md,
        borderWidth: 1,
        borderColor: Colors.light.border,
        paddingHorizontal: Spacing.md,
    },
    searchInput: {
        flex: 1,
        minHeight: 44,
        color: Colors.light.text,
        fontSize: 16,
    },
    results: {
        maxHeight: 190,
    },
    resultRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: Spacing.md,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: Colors.light.border,
    },
    resultName: {
        ...Typography.body,
        color: Colors.light.text,
        flex: 1,
        marginRight: Spacing.sm,
    },
    resultStock: {
        ...Typography.captionStrong,
        color: Colors.light.textSecondary,
    },
    emptyText: {
        ...Typography.caption,
        color: Colors.light.textSecondary,
        textAlign: 'center',
        paddingVertical: Spacing.lg,
    },
    emptyBlock: {
        alignItems: 'center',
        gap: Spacing.sm,
        paddingVertical: Spacing.lg,
    },
    retryText: {
        ...Typography.captionStrong,
        color: Colors.light.tint,
    },
    selectedCard: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: Colors.light.successSoft,
        borderRadius: Radius.md,
        padding: Spacing.md,
    },
    selectedInfo: {
        flex: 1,
        marginRight: Spacing.sm,
    },
    selectedName: {
        ...Typography.bodyStrong,
        color: Colors.light.text,
    },
    selectedStock: {
        ...Typography.caption,
        color: Colors.light.textSecondary,
    },
    quantityBlock: {
        alignItems: 'center',
    },
    quantityLabel: {
        ...Typography.caption,
        color: Colors.light.textSecondary,
    },
    quantityValue: {
        ...Typography.largeTitle,
        color: Colors.light.text,
    },
    actions: {
        flexDirection: 'row',
        gap: Spacing.sm,
    },
    saleButton: {
        flex: 1,
    },
    stockButton: {
        flex: 1,
    },
    wasteButton: {
        flex: 1,
    },
    hint: {
        ...Typography.caption,
        color: Colors.light.textSecondary,
        textAlign: 'center',
    },
});
