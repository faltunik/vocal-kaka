import React, { useMemo, useState, useCallback } from 'react';
import {
    FlatList,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BottomTabBar } from '@/components/ui/BottomTabBar';
import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { Colors } from '@/constants/Colors';
import { Radius, Spacing, TouchTarget } from '@/constants/Layout';
import { Typography } from '@/constants/Typography';
import { useInventory } from '@/hooks/useInventory';
import { InventoryItem } from '@/core/interfaces/IInventoryRepository';
import { ProductCard } from '@/components/inventory/ProductCard';
import { AddProductModal } from '@/components/inventory/AddProductModal';
import { EditProductModal } from '@/components/inventory/EditProductModal';
import { usePrivacy } from '@/services/PrivacyContext';

export const CATEGORIES = ['All', 'Staples', 'FMCG', 'Dairy', 'Spices'] as const;
export type CategoryFilterType = (typeof CATEGORIES)[number];

export default function InventoryScreen() {
    const router = useRouter();
    const { items, loading, error, refetch } = useInventory();
    const { isStaffMode } = usePrivacy();
    const [query, setQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<CategoryFilterType>('All');

    // Modals
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);

    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();

        return items.filter((item) => {
            // Category check
            if (selectedCategory !== 'All') {
                const itemCat = (item.category || '').toLowerCase();
                const sel = selectedCategory.toLowerCase();

                let matches = false;
                if (sel === 'staples') {
                    matches = itemCat === 'staples' || itemCat === 'loose_grains';
                } else if (sel === 'fmcg') {
                    matches = itemCat === 'fmcg' || (!itemCat && !!item.barcode);
                } else if (sel === 'dairy') {
                    matches = itemCat === 'dairy' || itemCat === 'dairy_bakery';
                } else if (sel === 'spices') {
                    matches = itemCat === 'spices';
                } else {
                    matches = itemCat === sel;
                }

                if (!matches) return false;
            }

            // Search query check
            if (needle) {
                const nameMatch = item.name.toLowerCase().includes(needle);
                const aliasMatch = (item.aliases || []).some((a) =>
                    a.toLowerCase().includes(needle)
                );
                if (!nameMatch && !aliasMatch) return false;
            }

            return true;
        });
    }, [items, query, selectedCategory]);

    const renderItem = useCallback(
        ({ item }: { item: InventoryItem }) => (
            <ProductCard
                item={item}
                onPress={() => setEditingItem(item)}
            />
        ),
        []
    );

    return (
        <ScreenLayout>
            <View style={styles.header}>
                <View>
                    <Text style={styles.title}>Inventory</Text>
                    <Text style={styles.subtitle}>
                        {items.length} {items.length === 1 ? 'Product' : 'Products'} in catalog
                    </Text>
                </View>
                <View style={styles.headerActions}>
                    {!isStaffMode && (
                        <TouchableOpacity
                            style={styles.actionButton}
                            onPress={() => setIsAddModalOpen(true)}
                            accessibilityRole="button"
                            accessibilityLabel="Add product"
                            testID="add-product-header-button"
                        >
                            <Ionicons name="add" size={24} color={Colors.light.text} />
                        </TouchableOpacity>
                    )}
                    <TouchableOpacity
                        style={styles.actionButton}
                        onPress={() => router.navigate('/scanner')}
                        accessibilityRole="button"
                        accessibilityLabel="Scan a product"
                        testID="scan-product-header-button"
                    >
                        <Ionicons name="scan-outline" size={20} color={Colors.light.text} />
                    </TouchableOpacity>
                </View>
            </View>

            {/* Search Input */}
            <View style={styles.searchWrap}>
                <Ionicons name="search" size={18} color={Colors.light.textSecondary} />
                <TextInput
                    style={styles.searchInput}
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search items or vernacular (e.g. Jeera, दाल)..."
                    placeholderTextColor={Colors.light.textSecondary}
                    autoCapitalize="none"
                    returnKeyType="search"
                    testID="inventory-search-input"
                />
                {query.length > 0 && (
                    <TouchableOpacity
                        onPress={() => setQuery('')}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                        <Ionicons name="close-circle" size={18} color={Colors.light.textSecondary} />
                    </TouchableOpacity>
                )}
            </View>

            {/* Category Filter Chips */}
            <View style={styles.categoryContainer}>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.categoryScroll}
                >
                    {CATEGORIES.map((cat) => {
                        const active = selectedCategory === cat;
                        return (
                            <TouchableOpacity
                                key={cat}
                                style={[styles.categoryChip, active && styles.categoryChipActive]}
                                onPress={() => setSelectedCategory(cat)}
                                accessibilityRole="button"
                                accessibilityState={{ selected: active }}
                                testID={`category-filter-${cat}`}
                            >
                                <Text
                                    style={[
                                        styles.categoryChipText,
                                        active && styles.categoryChipTextActive,
                                    ]}
                                >
                                    {cat}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </ScrollView>
            </View>

            {/* Product List */}
            <FlatList
                data={filtered}
                keyExtractor={(item) => item.id}
                renderItem={renderItem}
                keyboardShouldPersistTaps="handled"
                refreshControl={
                    <RefreshControl
                        refreshing={loading}
                        onRefresh={refetch}
                        tintColor={Colors.light.textSecondary}
                    />
                }
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={
                    !loading ? (
                        error ? (
                            <View style={styles.empty}>
                                <Ionicons name="cloud-offline-outline" size={56} color={Colors.light.danger} />
                                <Text style={styles.emptyText}>
                                    {error.message || 'Could not load inventory.'}
                                </Text>
                                <TouchableOpacity
                                    onPress={refetch}
                                    style={styles.retryButton}
                                    accessibilityRole="button"
                                    accessibilityLabel="Retry loading inventory"
                                >
                                    <Text style={styles.retryText}>Retry</Text>
                                </TouchableOpacity>
                            </View>
                        ) : (
                            <View style={styles.empty}>
                                <Ionicons name="cube-outline" size={56} color={Colors.light.icon} />
                                <Text style={styles.emptyText}>
                                    {query
                                        ? 'No items match your search.'
                                        : selectedCategory !== 'All'
                                        ? `No products in ${selectedCategory} category.`
                                        : 'No products yet. Tap + to add stock or scan a barcode.'}
                                </Text>
                            </View>
                        )
                    ) : null
                }
            />

            {/* Modals */}
            <AddProductModal
                visible={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                onSuccess={() => {
                    setIsAddModalOpen(false);
                    refetch();
                }}
            />

            <EditProductModal
                visible={!!editingItem}
                item={editingItem}
                onClose={() => setEditingItem(null)}
                onSuccess={() => {
                    setEditingItem(null);
                    refetch();
                }}
            />

            <BottomTabBar />
        </ScreenLayout>
    );
}

const styles = StyleSheet.create({
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.xl,
        paddingTop: Spacing.lg,
        paddingBottom: Spacing.xs,
    },
    title: {
        ...Typography.largeTitle,
        color: Colors.light.text,
    },
    subtitle: {
        ...Typography.caption,
        color: Colors.light.textSecondary,
        marginTop: 2,
    },
    headerActions: {
        flexDirection: 'row',
        gap: Spacing.sm,
    },
    actionButton: {
        width: TouchTarget.min,
        height: TouchTarget.min,
        borderRadius: Radius.md,
        backgroundColor: Colors.light.surface,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: Colors.light.border,
    },
    searchWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        marginHorizontal: Spacing.xl,
        marginTop: Spacing.sm,
        marginBottom: Spacing.sm,
        paddingHorizontal: Spacing.lg,
        height: 44,
        borderRadius: Radius.md,
        backgroundColor: Colors.light.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: Colors.light.border,
    },
    searchInput: {
        flex: 1,
        ...Typography.body,
        color: Colors.light.text,
        paddingVertical: 0,
    },
    categoryContainer: {
        marginBottom: Spacing.sm,
    },
    categoryScroll: {
        paddingHorizontal: Spacing.xl,
        gap: Spacing.xs,
    },
    categoryChip: {
        paddingHorizontal: Spacing.lg,
        paddingVertical: 6,
        borderRadius: Radius.pill,
        backgroundColor: Colors.light.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: Colors.light.border,
    },
    categoryChipActive: {
        backgroundColor: Colors.light.tint,
        borderColor: Colors.light.tint,
    },
    categoryChipText: {
        ...Typography.caption,
        color: Colors.light.text,
        fontWeight: '500',
    },
    categoryChipTextActive: {
        color: Colors.light.onTint,
        fontWeight: '600',
    },
    listContent: {
        paddingHorizontal: Spacing.xl,
        paddingBottom: Spacing.xxl,
    },
    empty: {
        alignItems: 'center',
        marginTop: Spacing.xxxl * 2,
        gap: Spacing.lg,
    },
    emptyText: {
        ...Typography.body,
        color: Colors.light.textSecondary,
        textAlign: 'center',
    },
    retryButton: {
        marginTop: Spacing.lg,
        minHeight: 48,
        paddingHorizontal: Spacing.xl,
        borderRadius: Radius.md,
        backgroundColor: Colors.light.surfaceElevated,
        borderWidth: 1,
        borderColor: Colors.light.borderStrong,
        alignItems: 'center',
        justifyContent: 'center',
    },
    retryText: {
        ...Typography.bodyStrong,
        color: Colors.light.text,
    },
});
