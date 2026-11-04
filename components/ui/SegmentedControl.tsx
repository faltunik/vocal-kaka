import { Colors } from '@/constants/Colors';
import { Radius, Spacing, TouchTarget } from '@/constants/Layout';
import { Typography } from '@/constants/Typography';
import { Ionicons } from '@expo/vector-icons';
import React, { ComponentProps } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export interface SegmentOption<T extends string> {
    value: T;
    label: string;
    icon?: ComponentProps<typeof Ionicons>['name'];
}

interface SegmentedControlProps<T extends string> {
    options: SegmentOption<T>[];
    value: T;
    onChange: (value: T) => void;
    activeColor?: string;
    style?: object;
}

export function SegmentedControl<T extends string>({
    options,
    value,
    onChange,
    activeColor = Colors.light.tint,
    style,
}: SegmentedControlProps<T>) {
    return (
        <View style={[styles.container, style]}>
            {options.map((option) => {
                const active = option.value === value;
                return (
                    <TouchableOpacity
                        key={option.value}
                        style={[styles.option, active && { backgroundColor: activeColor }]}
                        onPress={() => onChange(option.value)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                    >
                        {option.icon && (
                            <Ionicons
                                name={option.icon}
                                size={22}
                                color={active ? Colors.light.onTint : Colors.light.textSecondary}
                                style={styles.icon}
                            />
                        )}
                        <Text style={[styles.text, active && styles.textActive]}>{option.label}</Text>
                    </TouchableOpacity>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: Colors.light.surfaceElevated,
        borderRadius: Radius.md,
        padding: Spacing.xs,
    },
    option: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: TouchTarget.min,
        borderRadius: Radius.sm,
    },
    icon: {
        marginRight: Spacing.sm,
    },
    text: {
        ...Typography.bodyStrong,
        color: Colors.light.textSecondary,
    },
    textActive: {
        color: Colors.light.onTint,
    },
});
