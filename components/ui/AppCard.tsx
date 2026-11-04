import { Colors } from '@/constants/Colors';
import { Radius, Spacing } from '@/constants/Layout';
import React from 'react';
import { StyleProp, StyleSheet, TouchableOpacity, View, ViewStyle } from 'react-native';

interface AppCardProps {
    children: React.ReactNode;
    style?: StyleProp<ViewStyle>;
    onPress?: () => void;
    testID?: string;
}

export function AppCard({ children, style, onPress, testID }: AppCardProps) {
    const Container = onPress ? TouchableOpacity : View;

    return (
        <Container
            testID={testID}
            style={[styles.card, style]}
            onPress={onPress}
            activeOpacity={onPress ? 0.85 : undefined}
        >
            {children}
        </Container>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: Colors.light.surface,
        borderRadius: Radius.lg,
        padding: Spacing.lg,
        shadowColor: '#000',
        shadowOpacity: 0.04,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 2 },
        elevation: 1,
    },
});
