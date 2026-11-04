import { AppHeader } from '@/components/ui/AppHeader';
import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { Colors } from '@/constants/Colors';
import { Radius, Spacing } from '@/constants/Layout';
import { Typography } from '@/constants/Typography';
import { useAnalytics } from '@/hooks/useAnalytics';
import { usePrivacy } from '@/services/PrivacyContext';
import { formatCurrency } from '@/utils/format';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function AnalyticsScreen() {
    const { isStaffMode } = usePrivacy();
    const {
        topSellers,
        deadStock,
        trend,
        categoryMix,
        peakHours,
        totalRevenue,
        totalTransactions,
        loading,
        error,
        refetch,
    } = useAnalytics({ enabled: !isStaffMode });

    if (isStaffMode) {
        return (
            <ScreenLayout>
                <AppHeader title="Analytics" />
                <View style={styles.lockedWrap}>
                    <Ionicons name="lock-closed-outline" size={56} color={Colors.light.icon} />
                    <Text style={styles.lockedText}>
                        Business analytics are locked in staff mode.
                    </Text>
                </View>
            </ScreenLayout>
        );
    }

    const maxTrendRevenue = Math.max(...trend.map(point => point.revenue), 1);

    return (
        <ScreenLayout>
            <AppHeader title="Analytics" />
            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                {error != null && (
                    <View style={styles.errorBanner}>
                        <Ionicons name="cloud-offline-outline" size={16} color={Colors.light.danger} />
                        <Text style={styles.errorBannerText}>
                            Could not load analytics. Check your connection.
                        </Text>
                        <TouchableOpacity
                            onPress={refetch}
                            accessibilityRole="button"
                            accessibilityLabel="Retry loading analytics"
                        >
                            <Text style={styles.errorRetry}>Retry</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {/* 30-day summary */}
                <View style={styles.summaryRow}>
                    <View style={styles.summaryCard}>
                        <Text style={styles.summaryLabel}>Revenue (30d)</Text>
                        <Text style={styles.summaryValue}>
                            {loading ? '…' : formatCurrency(totalRevenue)}
                        </Text>
                    </View>
                    <View style={styles.summaryCard}>
                        <Text style={styles.summaryLabel}>Sales (30d)</Text>
                        <Text style={styles.summaryValue}>{loading ? '…' : totalTransactions}</Text>
                    </View>
                </View>

                {/* 7-day revenue trend */}
                <View style={styles.card}>
                    <Text style={styles.cardTitle}>Last 7 days</Text>
                    <View style={styles.trendRow}>
                        {trend.map((point, index) => (
                            <View key={`${point.label}-${index}`} style={styles.trendColumn}>
                                <View style={styles.trendBarTrack}>
                                    <View
                                        style={[
                                            styles.trendBar,
                                            { height: `${Math.max(4, Math.round((point.revenue / maxTrendRevenue) * 100))}%` },
                                        ]}
                                    />
                                </View>
                                <Text style={styles.trendLabel}>{point.label}</Text>
                            </View>
                        ))}
                    </View>
                </View>

                {/* Top sellers */}
                <View style={styles.card}>
                    <Text style={styles.cardTitle}>Top sellers</Text>
                    {topSellers.length === 0 ? (
                        <Text style={styles.emptyText}>No sales in the last 30 days.</Text>
                    ) : (
                        topSellers.map((seller, index) => (
                            <View key={seller.name} style={styles.listRow}>
                                <Text style={styles.rank}>{index + 1}</Text>
                                <Text style={styles.listName} numberOfLines={1}>{seller.name}</Text>
                                <Text style={styles.listMeta}>{seller.quantity} sold</Text>
                                <Text style={styles.listValue}>{formatCurrency(seller.revenue)}</Text>
                            </View>
                        ))
                    )}
                </View>

                {/* Category mix */}
                <View style={styles.card}>
                    <Text style={styles.cardTitle}>Category mix</Text>
                    {categoryMix.length === 0 ? (
                        <Text style={styles.emptyText}>No revenue recorded yet.</Text>
                    ) : (
                        categoryMix.map(mix => (
                            <View key={mix.category} style={styles.listRow}>
                                <Text style={styles.listName}>{mix.category}</Text>
                                <Text style={styles.listMeta}>{Math.round(mix.share * 100)}%</Text>
                                <Text style={styles.listValue}>{formatCurrency(mix.revenue)}</Text>
                            </View>
                        ))
                    )}
                </View>

                {/* Peak hours */}
                <View style={styles.card}>
                    <Text style={styles.cardTitle}>Peak hours</Text>
                    {peakHours.length === 0 ? (
                        <Text style={styles.emptyText}>Not enough sales to detect peaks.</Text>
                    ) : (
                        <View style={styles.chipRow}>
                            {peakHours.map(hour => (
                                <View key={hour.label} style={styles.chip}>
                                    <Text style={styles.chipText}>{hour.label} · {hour.count}</Text>
                                </View>
                            ))}
                        </View>
                    )}
                </View>

                {/* Dead stock */}
                <View style={styles.card}>
                    <Text style={styles.cardTitle}>Dead stock (no sales in 30 days)</Text>
                    {deadStock.length === 0 ? (
                        <Text style={styles.emptyText}>Every stocked item moved recently.</Text>
                    ) : (
                        deadStock.map(item => (
                            <View key={item.name} style={styles.listRow}>
                                <Text style={styles.listName} numberOfLines={1}>{item.name}</Text>
                                <Text style={styles.listMeta}>
                                    {item.quantity} {item.unit} on hand
                                </Text>
                            </View>
                        ))
                    )}
                </View>
            </ScrollView>
        </ScreenLayout>
    );
}

const styles = StyleSheet.create({
    content: {
        paddingHorizontal: Spacing.xl,
        paddingBottom: Spacing.xxl,
        gap: Spacing.lg,
    },
    lockedWrap: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: Spacing.lg,
        paddingHorizontal: Spacing.xxl,
    },
    lockedText: {
        ...Typography.body,
        color: Colors.light.textSecondary,
        textAlign: 'center',
    },
    errorBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        backgroundColor: Colors.light.dangerSoft,
        borderRadius: Radius.md,
        padding: Spacing.md,
    },
    errorBannerText: {
        ...Typography.caption,
        color: Colors.light.danger,
        flex: 1,
    },
    errorRetry: {
        ...Typography.captionStrong,
        color: Colors.light.danger,
    },
    summaryRow: {
        flexDirection: 'row',
        gap: Spacing.md,
    },
    summaryCard: {
        flex: 1,
        backgroundColor: Colors.light.surface,
        borderRadius: Radius.md,
        borderWidth: 1,
        borderColor: Colors.light.border,
        padding: Spacing.lg,
        gap: Spacing.xs,
    },
    summaryLabel: {
        ...Typography.caption,
        color: Colors.light.textSecondary,
    },
    summaryValue: {
        ...Typography.heading,
        color: Colors.light.text,
    },
    card: {
        backgroundColor: Colors.light.surface,
        borderRadius: Radius.md,
        borderWidth: 1,
        borderColor: Colors.light.border,
        padding: Spacing.lg,
        gap: Spacing.sm,
    },
    cardTitle: {
        ...Typography.bodyStrong,
        color: Colors.light.text,
    },
    trendRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: Spacing.sm,
        height: 120,
        marginTop: Spacing.sm,
    },
    trendColumn: {
        flex: 1,
        alignItems: 'center',
        gap: Spacing.xs,
        height: '100%',
    },
    trendBarTrack: {
        flex: 1,
        width: '70%',
        justifyContent: 'flex-end',
        backgroundColor: Colors.light.surfaceElevated,
        borderRadius: Radius.sm,
        overflow: 'hidden',
    },
    trendBar: {
        width: '100%',
        backgroundColor: Colors.light.tint,
        borderRadius: Radius.sm,
    },
    trendLabel: {
        ...Typography.caption,
        fontSize: 10,
        color: Colors.light.textSecondary,
    },
    listRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        paddingVertical: Spacing.xs,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: Colors.light.border,
    },
    rank: {
        ...Typography.captionStrong,
        color: Colors.light.textSecondary,
        width: 18,
    },
    listName: {
        ...Typography.body,
        color: Colors.light.text,
        flex: 1,
    },
    listMeta: {
        ...Typography.caption,
        color: Colors.light.textSecondary,
    },
    listValue: {
        ...Typography.bodyStrong,
        color: Colors.light.tint,
        minWidth: 70,
        textAlign: 'right',
    },
    chipRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: Spacing.sm,
    },
    chip: {
        backgroundColor: Colors.light.surfaceElevated,
        borderRadius: Radius.pill,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.xs,
    },
    chipText: {
        ...Typography.captionStrong,
        color: Colors.light.text,
    },
    emptyText: {
        ...Typography.caption,
        color: Colors.light.textSecondary,
        paddingVertical: Spacing.sm,
    },
});
