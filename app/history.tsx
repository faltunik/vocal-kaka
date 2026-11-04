import { AppHeader } from '@/components/ui/AppHeader';
import { AppModal } from '@/components/ui/AppModal';
import { BottomTabBar } from '@/components/ui/BottomTabBar';
import { ProfitPulseCard } from '@/components/dashboard/ProfitPulseCard';
import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { Colors } from '@/constants/Colors';
import { Radius, Spacing, TouchTarget } from '@/constants/Layout';
import { Typography } from '@/constants/Typography';
import { useDashboardStats } from '@/hooks/useDashboardStats';
import { HistoryTab, useHistoryAggregator } from '@/hooks/useHistoryAggregator';
import { useAuth } from '@/services/AuthContext';
import { usePrivacy } from '@/services/PrivacyContext';
import { useStore } from '@/services/StoreContext';
import { ActivityIntent, formatClockTime, formatFriendlyQuantity, formatReportDate, isSameLocalDay } from '@/utils/format';
import { getStoreDisplayName } from '@/utils/storeName';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import React, { useEffect, useState } from 'react';
import { Alert, FlatList, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const HISTORY_TABS: readonly { value: HistoryTab; label: string }[] = [
    { value: 'ALL', label: 'All' },
    { value: 'SALE', label: 'Sales' },
    { value: 'PURCHASE', label: 'Stock In' },
    { value: 'WRITE_OFF', label: 'Wastage' },
    { value: 'EXPENSE', label: 'Expenses' },
    { value: 'ADJUSTMENT', label: 'Adjustments' },
];

/**
 * The aggregated feed keys rows by intent, so "All" can show Tomatoes twice:
 * one Stock In row and one Sales row. Label the intent or they read as dupes.
 */
const INTENT_LABELS: Record<string, string> = {
    SALE: 'Sales',
    PURCHASE: 'Stock In',
    WRITE_OFF: 'Wastage',
    EXPENSE: 'Expenses',
    ADJUSTMENT: 'Adjustments',
    CUSTOMER_RETURN: 'Returns',
    VENDOR_RETURN: 'Vendor returns',
};

/** PDF badge class per ledger intent (FEAT-06 audit report). */
function pdfBadgeClass(intent: ActivityIntent): string {
    switch (intent) {
        case 'SALE': return 'sale';
        case 'PURCHASE': return 'purchase';
        case 'EXPENSE': return 'expense';
        case 'WRITE_OFF': return 'writeoff';
        default: return 'returns';
    }
}

function activityKey(item: { intent: ActivityIntent; name?: string; item?: string; unit: string }): string {
    return `${item.intent}::${item.name ?? item.item ?? ''}::${item.unit}`;
}

export default function HistoryScreen() {
    const { isStaffMode } = usePrivacy();
    const {
        activeTab,
        setActiveTab,
        aggregatedData,
        selectedDate,
        setSelectedDate,
        rangeMode,
        setRangeMode,
        isToday,
        loading,
        error,
        refetch,
        rawActivities,
        totalStats
    } = useHistoryAggregator({ enabled: !isStaffMode });

    const [selectedItem, setSelectedItem] = useState<string | null>(null);
    const [exporting, setExporting] = useState(false);
    const stats = useDashboardStats({ enabled: !isStaffMode });
    const { currentStore } = useStore();
    const { user } = useAuth();

    // A drill-down opened for another date/tab must not linger with stale data.
    useEffect(() => {
        setSelectedItem(null);
    }, [selectedDate, activeTab]);

    const selectedEntry = selectedItem
        ? aggregatedData.find(d => activityKey({ intent: d.intent, name: d.name, unit: d.unit }) === selectedItem)
        : undefined;
    const drillDownList = selectedEntry?.items || [];

    // Close the sheet if the aggregate disappears underneath it (refetch/void).
    useEffect(() => {
        if (selectedItem && !selectedEntry) {
            setSelectedItem(null);
        }
    }, [selectedItem, selectedEntry]);

    const storeName = getStoreDisplayName({
        storeName: currentStore?.name,
        metadataName: user?.user_metadata?.store_name,
        email: user?.email,
    });

    // Deep links must not bypass the staff ledger lock enforced by the tab bar
    if (isStaffMode) {
        return (
            <ScreenLayout>
                <AppHeader title="History" showBack={false} />
                <View style={styles.lockedWrap}>
                    <Ionicons name="lock-closed-outline" size={56} color={Colors.light.icon} />
                    <Text style={styles.lockedText}>
                        Transaction history and ledger corrections are locked in staff mode.
                    </Text>
                </View>
                <BottomTabBar />
            </ScreenLayout>
        );
    }

    const closeModal = () => setSelectedItem(null);

    const escapeHtml = (value: unknown) => String(value ?? '').replace(
        /[&<>"']/g,
        (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string)
    );

    const generateHTML = () => {
        const isWeekly = rangeMode === 'WEEK';
        const weekEnd = (() => {
            const end = new Date(weekStart);
            end.setDate(end.getDate() + 6);
            return end;
        })();
        const dateStr = isWeekly
            ? `Week of ${weekStart.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${weekEnd.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
            : formatReportDate(selectedDate);

        const { totalSales, totalPurchases } = totalStats;

        const tableRows = rawActivities.map(item => `
            <tr>
                ${isWeekly ? `<td>${escapeHtml(new Date(item.timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }))}</td>` : ''}
                <td>${escapeHtml(formatClockTime(item.timestamp))}</td>
                <td><span class="badge ${pdfBadgeClass(item.intent)}">${escapeHtml(item.intent)}</span></td>
                <td>${escapeHtml(item.item)}</td>
                <td>${escapeHtml(item.quantity)} ${escapeHtml(item.unit || '')}</td>
                <td style="text-align: right;">${escapeHtml(item.amount)}</td>
                <td style="font-size: 10px; color: #888;">${escapeHtml(item.eventId ?? '')}</td>
            </tr>
        `).join('');

        return `
            <html>
                <head>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no" />
                    <style>
                        body { font-family: 'Helvetica', sans-serif; padding: 20px; color: #333; }
                        h1 { color: #0a84ff; margin-bottom: 5px; }
                        .header { border-bottom: 2px solid #eee; padding-bottom: 20px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-end; }
                        .store-name { font-size: 24px; font-weight: bold; }
                        .date { color: #666; font-size: 14px; }
                        .summary { display: flex; gap: 20px; margin-bottom: 30px; }
                        .card { background: #f8f9fa; padding: 15px; border-radius: 8px; flex: 1; border: 1px solid #eee; }
                        .card-title { color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px; }
                        .card-value { font-size: 24px; font-weight: bold; }
                        table { width: 100%; border-collapse: collapse; font-size: 14px; }
                        th { text-align: left; padding: 12px; background: #f8f9fa; border-bottom: 2px solid #ddd; color: #666; }
                        td { padding: 12px; border-bottom: 1px solid #eee; }
                        tr:nth-child(even) { background-color: #fafafa; }
                        .badge { padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: bold; color: white; }
                        .sale { background-color: #28a745; }
                        .purchase { background-color: #007bff; }
                        .expense { background-color: #6c757d; }
                        .writeoff { background-color: #dc3545; }
                        .returns { background-color: #fd7e14; }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <div>
                            <div class="store-name">${escapeHtml(storeName)}</div>
                            <div class="date">${dateStr}</div>
                        </div>
                        <div style="text-align: right;">
                            <div>${isWeekly ? 'Weekly Transaction Report' : 'Daily Transaction Report'}</div>
                        </div>
                    </div>

                    <div class="summary">
                        <div class="card">
                            <div class="card-title">Sales Transactions</div>
                            <div class="card-value">${totalSales}</div>
                        </div>
                        <div class="card">
                            <div class="card-title">Purchase Transactions</div>
                            <div class="card-value">${totalPurchases}</div>
                        </div>
                    </div>

                    <table>
                        <thead>
                            <tr>
                                ${isWeekly ? '<th>Date</th>' : ''}
                                <th>Time</th>
                                <th>Type</th>
                                <th>Item</th>
                                <th>Qty</th>
                                <th style="text-align: right;">Amount</th>
                                <th>Ledger ID</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRows}
                        </tbody>
                    </table>
                </body>
            </html>
        `;
    };

    const handleDownloadPDF = async () => {
        if (exporting || loading || error) return;
        setExporting(true);
        try {
            const html = generateHTML();
            const { uri } = await Print.printToFileAsync({ html });
            await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
        } catch (error) {
            console.error('Failed to generate PDF:', error);
            Alert.alert('Export failed', 'Could not generate the PDF. Please try again.');
        } finally {
            setExporting(false);
        }
    };


    const shiftDate = (direction: 1 | -1) => {
        const stepDays = rangeMode === 'WEEK' ? 7 : 1;
        setSelectedDate(prev => {
            const next = new Date(prev);
            next.setDate(next.getDate() + direction * stepDays);
            return next;
        });
    };

    const selectDay = (date: Date) => {
        setRangeMode('DAY');
        setSelectedDate(date);
    };

    const selectToday = () => selectDay(new Date());

    const selectYesterday = () => {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        selectDay(yesterday);
    };

    const selectThisWeek = () => {
        setRangeMode('WEEK');
        setSelectedDate(new Date());
    };

    const weekStart = (() => {
        const start = new Date(selectedDate);
        start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
        return start;
    })();

    const yesterday = (() => {
        const date = new Date();
        date.setDate(date.getDate() - 1);
        return date;
    })();

    const isCurrentWeek = rangeMode === 'WEEK'
        && (() => {
            const nowStart = new Date();
            nowStart.setDate(nowStart.getDate() - ((nowStart.getDay() + 6) % 7));
            return nowStart.toDateString() === weekStart.toDateString();
        })();
    const atLatestRange = rangeMode === 'WEEK' ? isCurrentWeek : isToday;

    const dateLabel = rangeMode === 'WEEK'
        ? (isCurrentWeek
            ? 'This Week'
            : `Week of ${weekStart.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`)
        : (isToday
            ? 'Today'
            : selectedDate.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }));

    const quickRanges: readonly { label: string; active: boolean; onPress: () => void }[] = [
        { label: 'Today', active: rangeMode === 'DAY' && isToday, onPress: selectToday },
        { label: 'Yesterday', active: rangeMode === 'DAY' && isSameLocalDay(selectedDate, yesterday), onPress: selectYesterday },
        { label: 'This Week', active: rangeMode === 'WEEK' && isCurrentWeek, onPress: selectThisWeek },
    ];

    const renderItem = ({ item }: { item: typeof aggregatedData[0] }) => (
        <TouchableOpacity
            style={styles.row}
            onPress={() => setSelectedItem(activityKey({ intent: item.intent, name: item.name, unit: item.unit }))}
            activeOpacity={0.7}
        >
            <View style={styles.cardHeader}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.totalQty}>{formatFriendlyQuantity(item.totalQty, item.unit)} Total</Text>
            </View>
            <Text style={styles.subtext}>
                {activeTab === 'ALL' ? `${INTENT_LABELS[item.intent] ?? item.intent} · ` : ''}
                {item.count} {item.count === 1 ? 'transaction' : 'transactions'}
            </Text>
        </TouchableOpacity>
    );

    return (
        <ScreenLayout>
            <AppHeader
                title="History"
                showBack={false}
                rightElement={
                    <TouchableOpacity
                        onPress={handleDownloadPDF}
                        style={[styles.downloadButton, (exporting || loading || error != null) && styles.downloadButtonDisabled]}
                        disabled={exporting || loading || error != null}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: exporting || loading || error != null }}
                        accessibilityLabel="Download report PDF"
                    >
                        <Ionicons name="download-outline" size={26} color={Colors.light.tint} />
                    </TouchableOpacity>
                }
            />

            {error != null && (
                <View style={styles.errorBanner}>
                    <Ionicons name="cloud-offline-outline" size={16} color={Colors.light.danger} />
                    <Text style={styles.errorBannerText}>
                        Could not load this day’s ledger.
                    </Text>
                    <TouchableOpacity
                        onPress={refetch}
                        accessibilityRole="button"
                        accessibilityLabel="Retry loading history"
                    >
                        <Text style={styles.errorRetry}>Retry</Text>
                    </TouchableOpacity>
                </View>
            )}

            <View style={styles.dateNav}>
                <TouchableOpacity
                    onPress={() => shiftDate(-1)}
                    style={styles.dateNavButton}
                    accessibilityRole="button"
                    accessibilityLabel="Previous day"
                >
                    <Ionicons name="chevron-back" size={20} color={Colors.light.text} />
                </TouchableOpacity>
                <View style={styles.dateNavCenter}>
                    <Text style={styles.dateNavLabel}>{dateLabel}</Text>
                    {!atLatestRange && (
                        <TouchableOpacity
                            onPress={selectToday}
                            accessibilityRole="button"
                            accessibilityLabel="Jump to today"
                        >
                            <Text style={styles.todayLink}>Today</Text>
                        </TouchableOpacity>
                    )}
                </View>
                <TouchableOpacity
                    onPress={() => shiftDate(1)}
                    style={[styles.dateNavButton, atLatestRange && styles.dateNavButtonDisabled]}
                    disabled={atLatestRange}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: atLatestRange }}
                    accessibilityLabel="Next day"
                >
                    <Ionicons
                        name="chevron-forward"
                        size={20}
                        color={atLatestRange ? Colors.light.borderStrong : Colors.light.text}
                    />
                </TouchableOpacity>
            </View>

            <View style={styles.quickRow}>
                {quickRanges.map(range => (
                    <TouchableOpacity
                        key={range.label}
                        style={[styles.quickChip, range.active && styles.quickChipActive]}
                        onPress={range.onPress}
                        accessibilityRole="button"
                        accessibilityState={{ selected: range.active }}
                        accessibilityLabel={range.label}
                    >
                        <Text style={[styles.quickChipText, range.active && styles.quickChipTextActive]}>
                            {range.label}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.tabsScroll}
                contentContainerStyle={styles.tabsContent}
            >
                {HISTORY_TABS.map(tab => {
                    const active = tab.value === activeTab;
                    return (
                        <TouchableOpacity
                            key={tab.value}
                            style={[styles.tabPill, active && styles.tabPillActive]}
                            onPress={() => setActiveTab(tab.value)}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active }}
                            accessibilityLabel={tab.label}
                        >
                            <Text style={[styles.tabPillText, active && styles.tabPillTextActive]}>
                                {tab.label}
                            </Text>
                        </TouchableOpacity>
                    );
                })}
            </ScrollView>

            <FlatList
                data={aggregatedData}
                keyExtractor={item => activityKey({ intent: item.intent, name: item.name, unit: item.unit })}
                renderItem={renderItem}
                contentContainerStyle={styles.listContent}
                ListHeaderComponent={
                    <View style={styles.summaryWrap}>
                        <ProfitPulseCard
                            loading={stats.loading}
                            profit={stats.profit}
                            sales={stats.sales}
                            transactionCount={stats.transactionCount}
                        />
                    </View>
                }
                ListEmptyComponent={
                    <Text style={styles.emptyText}>
                        {loading ? 'Loading history…' : 'No transactions found for this day.'}
                    </Text>
                }
            />

            <BottomTabBar />

            {/* Drill Down Modal */}
            <AppModal
                visible={!!selectedItem}
                onClose={closeModal}
                title={`${selectedEntry?.name ?? ''} History`}
                variant="sheet"
                height="70%"
                scrollable={false}
            >
                <FlatList
                    data={drillDownList}
                    keyExtractor={item => item.id}
                    renderItem={({ item }) => (
                        <View style={styles.drillItem}>
                            <View style={styles.drillText}>
                                <Text style={styles.drillTitle} numberOfLines={2}>{item.title}</Text>
                                <Text style={styles.drillSubtitle}>{item.subtitle}</Text>
                            </View>
                            <Text style={styles.drillTime}>{formatClockTime(item.timestamp)}</Text>
                        </View>
                    )}
                    ListEmptyComponent={
                        <Text style={styles.emptyText}>This item is no longer in today’s list.</Text>
                    }
                />
            </AppModal>
        </ScreenLayout>
    );
}

const styles = StyleSheet.create({
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
    downloadButton: {
        width: TouchTarget.min,
        height: TouchTarget.min,
        borderRadius: Radius.md,
        backgroundColor: Colors.light.surfaceElevated,
        alignItems: 'center',
        justifyContent: 'center',
    },
    downloadButtonDisabled: {
        opacity: 0.5,
    },
    dateNav: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginHorizontal: Spacing.xl,
        marginBottom: Spacing.sm,
    },
    errorBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        marginHorizontal: Spacing.xl,
        marginBottom: Spacing.sm,
        padding: Spacing.md,
        borderRadius: Radius.md,
        backgroundColor: Colors.light.dangerSoft,
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
    dateNavButton: {
        width: TouchTarget.min,
        height: TouchTarget.min,
        borderRadius: Radius.sm,
        backgroundColor: Colors.light.surfaceElevated,
        alignItems: 'center',
        justifyContent: 'center',
    },
    dateNavButtonDisabled: {
        opacity: 0.5,
    },
    dateNavCenter: {
        alignItems: 'center',
        gap: 2,
    },
    dateNavLabel: {
        ...Typography.bodyStrong,
        color: Colors.light.text,
    },
    todayLink: {
        ...Typography.captionStrong,
        color: Colors.light.tint,
    },
    quickRow: {
        flexDirection: 'row',
        gap: Spacing.sm,
        paddingHorizontal: Spacing.xl,
        marginBottom: Spacing.sm,
    },
    quickChip: {
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.xs,
        borderRadius: Radius.pill,
        backgroundColor: Colors.light.surfaceElevated,
        borderWidth: 1,
        borderColor: Colors.light.border,
    },
    quickChipActive: {
        backgroundColor: Colors.light.tint,
        borderColor: Colors.light.tint,
    },
    quickChipText: {
        ...Typography.caption,
        color: Colors.light.textSecondary,
    },
    quickChipTextActive: {
        color: Colors.light.onTint,
        fontWeight: '600',
    },
    tabsScroll: {
        flexGrow: 0,
        marginBottom: Spacing.lg,
    },
    tabsContent: {
        paddingHorizontal: Spacing.xl,
        gap: Spacing.sm,
    },
    tabPill: {
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.sm,
        borderRadius: Radius.pill,
        backgroundColor: Colors.light.surfaceElevated,
        minHeight: TouchTarget.min,
        justifyContent: 'center',
    },
    tabPillActive: {
        backgroundColor: Colors.light.tint,
    },
    tabPillText: {
        ...Typography.captionStrong,
        color: Colors.light.textSecondary,
    },
    tabPillTextActive: {
        color: Colors.light.onTint,
    },
    listContent: {
        paddingHorizontal: Spacing.xl,
        paddingBottom: Spacing.xl,
    },
    summaryWrap: {
        marginBottom: Spacing.xl,
    },
    row: {
        paddingVertical: Spacing.lg,
        borderBottomWidth: 1,
        borderBottomColor: Colors.light.border,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: Spacing.xs,
    },
    itemName: {
        ...Typography.heading,
        color: Colors.light.text,
        flexShrink: 1,
    },
    totalQty: {
        ...Typography.bodyStrong,
        color: Colors.light.tint,
        marginLeft: Spacing.sm,
    },
    subtext: {
        ...Typography.caption,
        color: Colors.light.textSecondary,
    },
    emptyText: {
        ...Typography.body,
        color: Colors.light.textSecondary,
        textAlign: 'center',
        marginTop: Spacing.xxxl,
    },
    drillItem: {
        paddingVertical: Spacing.lg,
        borderBottomWidth: 1,
        borderBottomColor: Colors.light.border,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    drillText: {
        flex: 1,
        marginRight: Spacing.md,
    },
    drillTitle: {
        ...Typography.body,
        color: Colors.light.text,
        marginBottom: Spacing.xs,
    },
    drillSubtitle: {
        ...Typography.caption,
        color: Colors.light.textSecondary,
    },
    drillTime: {
        ...Typography.caption,
        color: Colors.light.textSecondary,
    },
});
