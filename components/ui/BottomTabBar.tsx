import { Colors } from '@/constants/Colors';
import { Radius, Spacing, TouchTarget } from '@/constants/Layout';
import { Typography } from '@/constants/Typography';
import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter, type Href } from 'expo-router';
import { usePrivacy } from '@/services/PrivacyContext';
import React, { ComponentProps } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

interface TabDefinition {
    path: Href;
    label: string;
    icon: IoniconName;
    activeIcon: IoniconName;
}

const TABS: readonly TabDefinition[] = [
    { path: '/', label: 'Home', icon: 'home-outline', activeIcon: 'home' },
    { path: '/inventory', label: 'Inventory', icon: 'receipt-outline', activeIcon: 'receipt' },
    { path: '/history', label: 'History', icon: 'time-outline', activeIcon: 'time' },
];

/**
 * Minimal Apple-style bottom tab bar: filled icon + black label when active,
 * gray outline when inactive, hairline separator.
 */
export function BottomTabBar() {
    const router = useRouter();
    const pathname = usePathname();
    const insets = useSafeAreaInsets();
    const { isStaffMode } = usePrivacy();

    const handleTabPress = (path: Href) => {
        if (isStaffMode && path === '/history') {
            Alert.alert(
                'Staff Mode Active',
                'Transaction history and ledger audit are locked in Staff Mode. Open Account → Staff Mode on the Home screen to unlock.'
            );
            return;
        }
        router.replace(path);
    };

    return (
        <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, Spacing.sm) }]}>
            {TABS.map(tab => {
                const active = pathname === tab.path;
                return (
                    <TouchableOpacity
                        key={tab.label}
                        style={styles.tab}
                        activeOpacity={0.7}
                        onPress={() => handleTabPress(tab.path)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={tab.label}
                    >
                        <Ionicons
                            name={active ? tab.activeIcon : tab.icon}
                            size={24}
                            color={active ? Colors.light.text : Colors.light.icon}
                        />
                        <Text style={[styles.label, active && styles.labelActive]}>{tab.label}</Text>
                    </TouchableOpacity>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    bar: {
        flexDirection: 'row',
        backgroundColor: Colors.light.background,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: Colors.light.border,
        paddingTop: Spacing.sm,
    },
    tab: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        minHeight: TouchTarget.min,
        borderRadius: Radius.sm,
    },
    label: {
        ...Typography.caption,
        fontSize: 12,
        lineHeight: 16,
        color: Colors.light.textSecondary,
    },
    labelActive: {
        color: Colors.light.text,
        fontWeight: '600',
    },
});
