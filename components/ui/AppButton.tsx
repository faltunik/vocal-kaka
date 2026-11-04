import { Colors } from '@/constants/Colors';
import { Radius, Spacing } from '@/constants/Layout';
import { Typography } from '@/constants/Typography';
import React from 'react';
import { ActivityIndicator, ColorValue, StyleProp, StyleSheet, Text, TextStyle, TouchableOpacity, ViewStyle } from 'react-native';

type ButtonVariant = 'primary' | 'success' | 'outline' | 'ghost' | 'danger';

interface AppButtonProps {
    title: string;
    onPress: () => void;
    variant?: ButtonVariant;
    loading?: boolean;
    disabled?: boolean;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
    testID?: string;
}

export function AppButton({
    title,
    onPress,
    variant = 'primary',
    loading = false,
    disabled = false,
    style,
    textStyle,
    testID,
}: AppButtonProps) {
    const getBackgroundColor = (): ColorValue | undefined => {
        if (disabled) return Colors.light.surfaceElevated;
        switch (variant) {
            case 'primary': return Colors.light.tint;
            case 'success': return Colors.light.success;
            case 'danger': return Colors.light.danger;
            case 'outline': return 'transparent';
            case 'ghost': return 'transparent';
            default: return Colors.light.tint;
        }
    };

    const getTextColor = (): ColorValue => {
        if (disabled) return Colors.light.textSecondary;
        switch (variant) {
            case 'primary': return Colors.light.onTint;
            case 'success': return Colors.light.onSuccess;
            case 'danger': return Colors.light.onDanger;
            case 'outline': return Colors.light.text;
            case 'ghost': return Colors.light.textSecondary;
            default: return Colors.light.onTint;
        }
    };

    const getBorderColor = (): ColorValue | undefined => {
        if (variant === 'outline') return Colors.light.borderStrong;
        return undefined;
    };

    const getBorderWidth = (): number => {
        if (variant === 'outline') return 1;
        return 0;
    };

    return (
        <TouchableOpacity
            testID={testID}
            style={[
                styles.button,
                {
                    backgroundColor: getBackgroundColor(),
                    borderColor: getBorderColor(),
                    borderWidth: getBorderWidth(),
                },
                style,
            ]}
            onPress={onPress}
            disabled={disabled || loading}
            accessibilityRole="button"
            accessibilityState={{ disabled: disabled || loading, busy: loading }}
        >
            {loading ? (
                <ActivityIndicator color={getTextColor()} />
            ) : (
                <Text style={[
                    styles.text,
                    { color: getTextColor() },
                    textStyle
                ]}>
                    {title}
                </Text>
            )}
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    button: {
        minHeight: 56,
        borderRadius: Radius.md,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: Spacing.xxl,
        paddingVertical: Spacing.md,
    },
    text: {
        ...Typography.bodyStrong,
        textAlign: 'center',
    },
});
