import { Colors } from '@/constants/Colors';
import { Radius, Spacing } from '@/constants/Layout';
import { Typography } from '@/constants/Typography';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const KEYS: readonly string[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'DEL'];

interface QuantityNumpadProps {
    onKeyPress: (key: string) => void;
}

/** Manual counter keypad used when voice/camera input is unavailable. */
export function QuantityNumpad({ onKeyPress }: QuantityNumpadProps) {
    return (
        <View style={styles.grid}>
            {KEYS.map(key => (
                <TouchableOpacity
                    key={key}
                    style={styles.key}
                    onPress={() => onKeyPress(key)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={key === 'DEL' ? 'Backspace' : key}
                    testID={`numpad-${key}`}
                >
                    {key === 'DEL' ? (
                        <Ionicons name="backspace-outline" size={22} color={Colors.light.text} />
                    ) : (
                        <Text style={styles.keyText}>{key}</Text>
                    )}
                </TouchableOpacity>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: Spacing.sm,
    },
    key: {
        width: '30.5%',
        minHeight: 52,
        borderRadius: Radius.md,
        backgroundColor: Colors.light.surfaceElevated,
        borderWidth: 1,
        borderColor: Colors.light.border,
        alignItems: 'center',
        justifyContent: 'center',
    },
    keyText: {
        ...Typography.heading,
        color: Colors.light.text,
    },
});
