import { Colors } from '@/constants/Colors';
import { Radius, Spacing } from '@/constants/Layout';
import { Typography } from '@/constants/Typography';
import { useVoice } from '@/services/voice/VoiceContext';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

/**
 * Shows the answer to a read-only voice query (stock/profit/low stock).
 * Cleared automatically by VoiceContext after a few seconds.
 */
export function VoiceAnswerBanner() {
    const { lastAnswer } = useVoice();

    if (!lastAnswer) return null;

    return (
        <View
            style={styles.banner}
            accessibilityLiveRegion="polite"
            accessibilityLabel={lastAnswer}
        >
            <Ionicons name="sparkles-outline" size={18} color={Colors.light.text} />
            <Text style={styles.text}>{lastAnswer}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    banner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: Colors.light.surface,
        borderRadius: Radius.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: Colors.light.border,
        paddingVertical: Spacing.md,
        paddingHorizontal: Spacing.lg,
    },
    text: {
        ...Typography.body,
        color: Colors.light.text,
        flex: 1,
        marginLeft: Spacing.sm,
    },
});
