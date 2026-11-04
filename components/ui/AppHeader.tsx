import { Colors } from '@/constants/Colors';
import { Spacing, TouchTarget } from '@/constants/Layout';
import { Typography } from '@/constants/Typography';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface AppHeaderProps {
    title: string;
    rightElement?: React.ReactNode;
    showBack?: boolean;
}

export function AppHeader({ title, rightElement, showBack = true }: AppHeaderProps) {
    const router = useRouter();

    const handleBack = () => {
        if (router.canGoBack()) {
            router.back();
        } else {
            router.replace('/');
        }
    };

    return (
        <View style={styles.header}>
            <View style={styles.headerLeft}>
                {showBack && (
                    <TouchableOpacity
                        onPress={handleBack}
                        style={styles.backButton}
                        accessibilityRole="button"
                        accessibilityLabel="Go back"
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                        <Ionicons name="chevron-back" size={26} color={Colors.light.text} />
                    </TouchableOpacity>
                )}
                <Text style={styles.headerTitle}>{title}</Text>
            </View>
            {rightElement && (
                <View style={styles.headerRight}>
                    {rightElement}
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.xl,
        paddingVertical: Spacing.lg,
        backgroundColor: Colors.light.background,
    },
    headerLeft: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
    },
    backButton: {
        width: TouchTarget.min,
        height: TouchTarget.min,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: Spacing.xs,
        marginLeft: -Spacing.md,
    },
    headerTitle: {
        ...Typography.title,
        flexShrink: 1,
        color: Colors.light.text,
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: Spacing.md,
    },
});
