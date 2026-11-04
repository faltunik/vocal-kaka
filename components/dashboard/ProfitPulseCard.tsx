import { AppCard } from '@/components/ui/AppCard';
import { Colors } from '@/constants/Colors';
import { Radius, Spacing, TouchTarget } from '@/constants/Layout';
import { Typography } from '@/constants/Typography';
import { usePrivacy } from '@/services/PrivacyContext';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
    ActivityIndicator,
    LayoutAnimation,
    Platform,
    StyleSheet,
    Text,
    TouchableOpacity,
    UIManager,
    View,
} from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface ProfitPulseCardProps {
    loading: boolean;
    profit: number;
    sales: number;
    transactionCount: number;
}

export function ProfitPulseCard({ loading, profit, sales, transactionCount }: ProfitPulseCardProps) {
    const { isMasked, toggleMask, isStaffMode } = usePrivacy();

    const handleToggle = () => {
        try {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        } catch {
            // LayoutAnimation may not be available in all test or web runners
        }
        void toggleMask();
    };

    // Calculate approximate margin %
    const marginPercent = sales > 0 ? ((profit / sales) * 100).toFixed(1) : '0.0';

    // -------------------------------------------------------------
    // RENDER: STAFF / CHOTU MODE (Simplified Bills Widget)
    // -------------------------------------------------------------
    if (isStaffMode) {
        return (
            <AppCard style={[styles.profitCard, styles.staffCard]} testID="staff-pulse-card">
                <View style={styles.headerRow}>
                    <View style={styles.badgeRow}>
                        <Ionicons name="shield-checkmark" size={16} color={Colors.light.tint} />
                        <Text style={styles.staffBadgeText}>Counter Active (Staff Mode)</Text>
                    </View>
                </View>

                <Text style={styles.staffMainNumber}>
                    {loading ? '...' : transactionCount}
                </Text>
                <Text style={styles.staffSubLabel}>
                    Today&apos;s Bills: {loading ? '...' : transactionCount}
                </Text>

                <View style={styles.staffFooter}>
                    <View style={styles.statusIndicator}>
                        <View style={styles.activeDot} />
                        <Text style={styles.statusText}>Voice & Barcode Scanner Active</Text>
                    </View>
                </View>
            </AppCard>
        );
    }

    // -------------------------------------------------------------
    // RENDER: OWNER MODE (With Eye Toggle & Masking)
    // -------------------------------------------------------------
    const displayProfit = isMasked ? '₹ •••••' : `₹ ${profit.toLocaleString()}`;
    const displaySales = isMasked ? '₹ •••••' : `₹${sales.toLocaleString()}`;
    const displayMargin = isMasked ? '••••%' : `${marginPercent}%`;

    return (
        <AppCard style={styles.profitCard}>
            <View style={styles.headerRow}>
                <Text style={styles.profitLabel}>Today’s profit (approx.)</Text>
                <TouchableOpacity
                    testID="privacy-eye-toggle"
                    onPress={handleToggle}
                    style={styles.eyeButton}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    accessibilityRole="button"
                    accessibilityLabel={isMasked ? 'Reveal profit numbers' : 'Hide profit numbers'}
                >
                    <Ionicons
                        name={isMasked ? 'eye-off-outline' : 'eye-outline'}
                        size={22}
                        color={isMasked ? Colors.light.tint : Colors.light.textSecondary}
                    />
                </TouchableOpacity>
            </View>

            {loading ? (
                <ActivityIndicator
                    testID="profit-loading"
                    size="large"
                    color={Colors.light.success}
                    style={{ marginVertical: Spacing.sm }}
                />
            ) : (
                <View style={styles.profitValueContainer}>
                    <Text style={styles.profitValue}>{displayProfit}</Text>
                    <Text style={styles.marginText}>Margin: {displayMargin}</Text>
                </View>
            )}

            <View style={styles.profitRow}>
                <Text style={styles.saleText}>Sales: {loading ? '...' : displaySales}</Text>
                <View style={styles.trendBadge}>
                    <Ionicons name="trending-up" size={14} color={Colors.light.onSuccess} />
                    <Text style={styles.trendText}>
                        {loading ? '...' : `+${transactionCount} Sales`}
                    </Text>
                </View>
            </View>
        </AppCard>
    );
}

const styles = StyleSheet.create({
    profitCard: {
        padding: Spacing.xxl,
        borderRadius: Radius.lg,
        borderWidth: 0,
    },
    staffCard: {
        backgroundColor: Colors.light.surfaceElevated,
        borderLeftWidth: 4,
        borderLeftColor: Colors.light.tint,
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    profitLabel: {
        ...Typography.captionStrong,
        color: Colors.light.textSecondary,
    },
    eyeButton: {
        width: TouchTarget.min,
        height: TouchTarget.min,
        alignItems: 'center',
        justifyContent: 'center',
    },
    profitValueContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginVertical: Spacing.sm,
    },
    profitValue: {
        ...Typography.display,
        color: Colors.light.success,
    },
    marginText: {
        ...Typography.bodyStrong,
        color: Colors.light.textSecondary,
    },
    profitRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    saleText: {
        ...Typography.body,
        color: Colors.light.text,
    },
    trendBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: Colors.light.success,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.xs,
        borderRadius: Radius.pill,
    },
    trendText: {
        ...Typography.captionStrong,
        color: Colors.light.onSuccess,
        marginLeft: Spacing.xs,
    },
    // Staff Mode Styles
    badgeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.xs,
    },
    staffBadgeText: {
        ...Typography.captionStrong,
        color: Colors.light.tint,
    },
    staffMainNumber: {
        ...Typography.display,
        color: Colors.light.text,
        marginTop: Spacing.sm,
    },
    staffSubLabel: {
        ...Typography.body,
        color: Colors.light.textSecondary,
        marginBottom: Spacing.md,
    },
    staffFooter: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: Colors.light.border,
        paddingTop: Spacing.sm,
    },
    statusIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    activeDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: Colors.light.success,
        marginRight: Spacing.xs,
    },
    statusText: {
        ...Typography.caption,
        color: Colors.light.textSecondary,
    },
});
