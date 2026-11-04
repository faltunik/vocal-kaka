import { Colors } from '@/constants/Colors';
import { Radius, Spacing } from '@/constants/Layout';
import { Typography } from '@/constants/Typography';
import React from 'react';
import { StyleProp, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';

interface AppTextFieldProps extends TextInputProps {
    label?: string;
    containerStyle?: StyleProp<ViewStyle>;
}

export function AppTextField({ label, containerStyle, style, ...inputProps }: AppTextFieldProps) {
    return (
        <View style={containerStyle}>
            {label && <Text style={styles.label}>{label}</Text>}
            <TextInput
                {...inputProps}
                accessibilityLabel={inputProps.accessibilityLabel ?? label}
                style={[styles.input, style]}
                placeholderTextColor={Colors.light.textSecondary}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    label: {
        ...Typography.captionStrong,
        color: Colors.light.textSecondary,
        marginBottom: Spacing.sm,
    },
    input: {
        ...Typography.body,
        backgroundColor: Colors.light.surface,
        color: Colors.light.text,
        padding: Spacing.lg,
        borderRadius: Radius.md,
        borderWidth: 1,
        borderColor: Colors.light.border,
        minHeight: 52,
        marginBottom: Spacing.lg,
    },
});
