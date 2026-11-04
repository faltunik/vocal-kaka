import { BottomTabBar } from '@/components/ui/BottomTabBar';
import { RecentActivityList } from '@/components/dashboard/RecentActivityList';
import { VoiceAnswerBanner } from '@/components/dashboard/VoiceAnswerBanner';
import { VoiceOrb } from '@/components/dashboard/VoiceOrb';
import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { StaffModeModal } from '@/components/store/StaffModeModal';
import { StoreSwitcherModal } from '@/components/store/StoreSwitcherModal';
import { Colors } from '@/constants/Colors';
import { Radius, Spacing, TouchTarget } from '@/constants/Layout';
import { Typography } from '@/constants/Typography';
import { useLowStock } from '@/hooks/useLowStock';
import { useOfflineStatus } from '@/hooks/useOfflineStatus';
import { useAuth } from '@/services/AuthContext';
import { usePrivacy } from '@/services/PrivacyContext';
import { useStore } from '@/services/StoreContext';
import { getStoreDisplayName } from '@/utils/storeName';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, AlertButton, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function DashboardScreen() {
    const router = useRouter();
    const { user, signOut } = useAuth();
    const { currentStore, currentRole } = useStore();
    const { isStaffMode } = usePrivacy();
    const { count: lowStockCount } = useLowStock(5);
    const { pendingCount, hasPendingSync } = useOfflineStatus();
    const [switcherVisible, setSwitcherVisible] = useState(false);
    const [staffModeVisible, setStaffModeVisible] = useState(false);

    const storeName = getStoreDisplayName({
        storeName: currentStore?.name,
        metadataName: user?.user_metadata?.store_name,
        email: user?.email,
    });
    const avatarInitial = (storeName || 'S').trim().charAt(0).toUpperCase();

    const handleAccountPress = () => {
        // Store-role staff cannot leave staff mode, so don't offer the toggle.
        const buttons: AlertButton[] = [
            { text: 'Switch Store', onPress: () => setSwitcherVisible(true) },
        ];
        if (currentRole !== 'staff') {
            buttons.push({
                text: isStaffMode ? 'Disable Staff Mode' : 'Staff Mode',
                onPress: () => setStaffModeVisible(true),
            });
        }
        buttons.push({ text: 'Sign out', style: 'destructive', onPress: () => { void signOut(); } });

        Alert.alert(storeName, `Signed in as ${user?.email || 'Guest'}\nRole: ${currentRole.toUpperCase()}`, buttons);
    };

    return (
        <ScreenLayout>
            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                {/* Header */}
                <View style={styles.header}>
                    <View style={styles.headerText}>
                        <Text style={styles.appName}>Kaka</Text>
                        <TouchableOpacity
                            style={styles.storeRow}
                            activeOpacity={0.7}
                            onPress={() => setSwitcherVisible(true)}
                            accessibilityRole="button"
                            accessibilityLabel={`Store: ${storeName}. Tap to switch store`}
                        >
                            <Text style={styles.storeName}>{storeName}</Text>
                            {currentRole === 'staff' && (
                                <View style={styles.staffTag}>
                                    <Text style={styles.staffTagText}>Staff</Text>
                                </View>
                            )}
                            <Ionicons name="chevron-down" size={16} color={Colors.light.textSecondary} />
                        </TouchableOpacity>
                    </View>
                    <View style={styles.headerActions}>
                        {!isStaffMode && (
                            <TouchableOpacity
                                style={styles.headerIconButton}
                                onPress={() => router.navigate('/analytics')}
                                accessibilityRole="button"
                                accessibilityLabel="Open business analytics"
                            >
                                <Ionicons name="stats-chart-outline" size={22} color={Colors.light.tint} />
                            </TouchableOpacity>
                        )}
                        <TouchableOpacity
                            style={styles.avatar}
                            onPress={handleAccountPress}
                            accessibilityRole="button"
                            accessibilityLabel="Account and stores"
                        >
                            <Text style={styles.avatarText}>{avatarInitial}</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Pending-sync indicator (offline queue) */}
                {hasPendingSync && (
                    <View
                        style={styles.syncBadge}
                        accessibilityRole="text"
                        accessibilityLabel={`Pending sync. ${pendingCount} change${pendingCount === 1 ? '' : 's'} queued`}
                    >
                        <Ionicons name="cloud-offline-outline" size={16} color={Colors.light.warning} />
                        <Text style={styles.syncBadgeText}>
                            Pending sync — {pendingCount} change{pendingCount === 1 ? '' : 's'} queued
                        </Text>
                    </View>
                )}

                {/* Low stock alert */}
                {lowStockCount > 0 && (
                    <TouchableOpacity
                        style={styles.lowStockCard}
                        activeOpacity={0.8}
                        onPress={() => router.navigate('/low-stock')}
                        accessibilityRole="button"
                        accessibilityLabel={`Low stock: ${lowStockCount} items need attention`}
                    >
                        <View style={styles.lowStockIcon}>
                            <Ionicons name="alert" size={16} color={Colors.light.onDanger} />
                        </View>
                        <View style={styles.lowStockText}>
                            <Text style={styles.lowStockTitle}>Low stock</Text>
                            <Text style={styles.lowStockSubtitle}>
                                {lowStockCount} item{lowStockCount === 1 ? '' : 's'} need attention
                            </Text>
                        </View>
                        <Text style={styles.lowStockCount}>{lowStockCount}</Text>
                        <Ionicons name="chevron-forward" size={18} color={Colors.light.textSecondary} />
                    </TouchableOpacity>
                )}

                {/* Voice */}
                <VoiceOrb />
                <VoiceAnswerBanner />

                {/* Manual fallback when voice/camera is unavailable */}
                <TouchableOpacity
                    style={styles.quickCounter}
                    onPress={() => router.navigate('/quick-counter')}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel="Open quick counter"
                >
                    <Ionicons name="calculator-outline" size={18} color={Colors.light.onTint} />
                    <Text style={styles.quickCounterText}>Quick Counter</Text>
                </TouchableOpacity>

                {/* Recent transactions */}
                <View>
                    <View style={styles.sectionHeader}>
                        <Text style={styles.sectionTitle}>Recent transactions</Text>
                        <TouchableOpacity
                            style={styles.seeAll}
                            onPress={() => router.navigate('/history')}
                            accessibilityRole="button"
                            accessibilityLabel="See all transactions"
                        >
                            <Text style={styles.seeAllText}>See all</Text>
                            <Ionicons name="chevron-forward" size={14} color={Colors.light.textSecondary} />
                        </TouchableOpacity>
                    </View>
                    <RecentActivityList limit={5} />
                </View>
            </ScrollView>

            <BottomTabBar />
            <StoreSwitcherModal
                visible={switcherVisible}
                onClose={() => setSwitcherVisible(false)}
            />
            <StaffModeModal
                visible={staffModeVisible}
                onClose={() => setStaffModeVisible(false)}
            />
        </ScreenLayout>
    );
}

const styles = StyleSheet.create({
    scrollContent: {
        paddingHorizontal: Spacing.xl,
        paddingTop: Spacing.lg,
        paddingBottom: Spacing.xxl,
        gap: Spacing.xl,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    syncBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        backgroundColor: Colors.light.warningSoft,
        borderRadius: Radius.md,
        paddingVertical: Spacing.sm,
        paddingHorizontal: Spacing.md,
    },
    syncBadgeText: {
        ...Typography.captionStrong,
        color: Colors.light.warningText,
    },
    quickCounter: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: Spacing.sm,
        backgroundColor: Colors.light.tint,
        borderRadius: Radius.pill,
        minHeight: TouchTarget.min,
        paddingHorizontal: Spacing.xl,
        alignSelf: 'center',
    },
    quickCounterText: {
        ...Typography.bodyStrong,
        color: Colors.light.onTint,
    },
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
    },
    headerIconButton: {
        width: TouchTarget.min,
        height: TouchTarget.min,
        borderRadius: Radius.pill,
        backgroundColor: Colors.light.surfaceElevated,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerText: {
        flexShrink: 1,
    },
    appName: {
        ...Typography.largeTitle,
        color: Colors.light.text,
    },
    storeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.xs,
        marginTop: Spacing.xs,
        minHeight: 28,
    },
    storeName: {
        ...Typography.body,
        color: Colors.light.textSecondary,
    },
    staffTag: {
        backgroundColor: 'rgba(0, 122, 255, 0.15)',
        paddingHorizontal: Spacing.xs,
        paddingVertical: 1,
        borderRadius: Radius.sm,
    },
    staffTagText: {
        fontSize: 10,
        fontWeight: 'bold',
        color: Colors.light.tint,
    },
    avatar: {
        width: 44,
        height: 44,
        borderRadius: Radius.pill,
        backgroundColor: Colors.light.surfaceElevated,
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarText: {
        ...Typography.bodyStrong,
        color: Colors.light.text,
    },
    lowStockCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: Colors.light.dangerSoft,
        borderRadius: Radius.lg,
        paddingVertical: Spacing.lg,
        paddingHorizontal: Spacing.lg,
        gap: Spacing.md,
    },
    lowStockIcon: {
        width: 26,
        height: 26,
        borderRadius: Radius.pill,
        backgroundColor: Colors.light.danger,
        alignItems: 'center',
        justifyContent: 'center',
    },
    lowStockText: {
        flex: 1,
    },
    lowStockTitle: {
        ...Typography.bodyStrong,
        color: Colors.light.text,
    },
    lowStockSubtitle: {
        ...Typography.caption,
        color: Colors.light.textSecondary,
        marginTop: 2,
    },
    lowStockCount: {
        ...Typography.bodyStrong,
        color: Colors.light.text,
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: Spacing.sm,
    },
    sectionTitle: {
        ...Typography.heading,
        color: Colors.light.text,
    },
    seeAll: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.xs,
        minHeight: TouchTarget.min,
        paddingLeft: Spacing.md,
    },
    seeAllText: {
        ...Typography.body,
        color: Colors.light.textSecondary,
    },
});
