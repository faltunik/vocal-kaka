import { Colors } from '@/constants/Colors';
import { Radius, Spacing } from '@/constants/Layout';
import { Typography } from '@/constants/Typography';
import { FeedbackService } from '@/services/FeedbackService';
import { VoiceTransactionStatus, useVoice } from '@/services/voice/VoiceContext';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
    Easing,
    cancelAnimation,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming,
} from 'react-native-reanimated';

export interface VoiceOrbProps {
    onPressIn?: () => void;
    onPress?: () => void;
    testID?: string;
}

/**
 * Voice orb with three visual states:
 *   idle       - calm green, soft static halo
 *   listening  - expanding green rings + pulsing glow
 *   processing - amber breathing pulse (ASR + parsing in flight)
 */
export function VoiceOrb({ onPressIn, onPress, testID = 'voice-orb-button' }: VoiceOrbProps = {}) {
    const { toggleListening, isListening, isProcessing, pendingCount, retryPending, lastAnswer, lastStatus } = useVoice();
    const pulse = useSharedValue(0);
    const startedRef = useRef(false);
    const prevStatusRef = useRef<VoiceTransactionStatus | null | undefined>(null);
    const prevProcessingRef = useRef(isProcessing);

    const handlePressIn = () => {
        if (!isListening && !isProcessing) {
            startedRef.current = true;
            void FeedbackService.triggerRecordStart();
        }
        onPressIn?.();
    };

    const handlePress = () => {
        if (!isListening && !isProcessing) {
            if (!startedRef.current) {
                void FeedbackService.triggerRecordStart();
            }
            startedRef.current = false;
        } else if (isListening) {
            void FeedbackService.triggerRecordStop();
        }
        toggleListening();
        onPress?.();
    };

    // Trigger success / error feedback when voice transaction finishes
    useEffect(() => {
        if (lastStatus && lastStatus !== prevStatusRef.current) {
            if (lastStatus === 'success') {
                void FeedbackService.triggerSuccess();
                void FeedbackService.playChime('applied');
            } else if (lastStatus === 'error') {
                void FeedbackService.triggerError();
                void FeedbackService.playChime('error');
            }
        }
        prevStatusRef.current = lastStatus;
    }, [lastStatus]);

    // Resilient fallback when lastStatus is not provided in context
    useEffect(() => {
        if (lastStatus === undefined && prevProcessingRef.current && !isProcessing) {
            if (lastAnswer) {
                const lower = lastAnswer.toLowerCase();
                const isErr = lower.includes('error') || lower.includes('unrecognized') || lower.includes('could not') || lower.includes('failed');
                if (isErr) {
                    void FeedbackService.triggerError();
                    void FeedbackService.playChime('error');
                } else {
                    void FeedbackService.triggerSuccess();
                    void FeedbackService.playChime('applied');
                }
            }
        }
        prevProcessingRef.current = isProcessing;
    }, [isProcessing, lastAnswer, lastStatus]);

    useEffect(() => {
        cancelAnimation(pulse);
        if (isListening) {
            pulse.value = 0;
            pulse.value = withRepeat(
                withTiming(1, { duration: 1500, easing: Easing.out(Easing.quad) }),
                -1,
                false
            );
        } else if (isProcessing) {
            pulse.value = 0;
            pulse.value = withRepeat(
                withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
                -1,
                true
            );
        } else {
            pulse.value = withTiming(0, { duration: 220 });
        }
    }, [isListening, isProcessing, pulse]);

    const ringOneStyle = useAnimatedStyle(() => ({
        opacity: isListening ? 0.45 * (1 - pulse.value) : 0,
        transform: [{ scale: 1 + pulse.value * 0.5 }],
    }));

    const ringTwoStyle = useAnimatedStyle(() => {
        const phase = (pulse.value + 0.5) % 1;
        return {
            opacity: isListening ? 0.3 * (1 - phase) : 0,
            transform: [{ scale: 1 + phase * 0.5 }],
        };
    });

    const orbStyle = useAnimatedStyle(() => ({
        shadowOpacity:
            (isListening ? 0.3 : isProcessing ? 0.22 : 0.16)
            + pulse.value * (isListening ? 0.45 : isProcessing ? 0.28 : 0.06),
        elevation: 6 + pulse.value * (isListening ? 8 : isProcessing ? 4 : 0),
        transform: [{
            scale: 1 + pulse.value * (isListening ? 0.035 : isProcessing ? 0.02 : 0.008),
        }],
    }));

    const orbColor = isProcessing
        ? Colors.light.warning
        : isListening ? '#2F6246' : Colors.light.success;

    const title = isListening ? 'Listening…' : isProcessing ? 'Processing…' : 'Tap to speak';
    const subtitle = isListening
        ? 'Bol rahe hain…'
        : isProcessing ? 'Ek second…' : 'Boliye, kya add karna hai?';

    return (
        <View style={styles.container}>
            <TouchableOpacity
                testID={testID}
                activeOpacity={0.85}
                onPressIn={handlePressIn}
                onPress={handlePress}
                disabled={isProcessing}
                accessibilityRole="button"
                accessibilityLabel={isListening ? 'Stop listening' : 'Start voice command'}
                accessibilityState={{ busy: isListening || isProcessing }}
            >
                <View style={styles.haloOuter}>
                    <Animated.View style={[styles.pulseRing, ringTwoStyle]} />
                    <Animated.View style={[styles.pulseRing, ringOneStyle]} />
                    <View style={styles.haloInner}>
                        <Animated.View style={[styles.orb, { backgroundColor: orbColor }, orbStyle]}>
                            <Ionicons
                                name={isProcessing ? 'hourglass-outline' : 'mic'}
                                size={44}
                                color="#FFFFFF"
                            />
                        </Animated.View>
                    </View>
                </View>
            </TouchableOpacity>

            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>

            {pendingCount > 0 && (
                <TouchableOpacity
                    style={styles.pendingChip}
                    onPress={retryPending}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={`Retry ${pendingCount} pending command`}
                >
                    <Ionicons name="cloud-offline-outline" size={16} color={Colors.light.text} />
                    <Text style={styles.pendingText}>
                        {pendingCount} command{pendingCount === 1 ? '' : 's'} waiting to sync · Retry
                    </Text>
                </TouchableOpacity>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        paddingVertical: Spacing.lg,
    },
    haloOuter: {
        width: 208,
        height: 208,
        borderRadius: Radius.pill,
        backgroundColor: 'rgba(61, 122, 87, 0.08)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    pulseRing: {
        position: 'absolute',
        width: 208,
        height: 208,
        borderRadius: Radius.pill,
        borderWidth: 2,
        borderColor: 'rgba(61, 122, 87, 0.55)',
    },
    haloInner: {
        width: 164,
        height: 164,
        borderRadius: Radius.pill,
        backgroundColor: 'rgba(61, 122, 87, 0.14)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    orb: {
        width: 124,
        height: 124,
        borderRadius: Radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: Colors.light.success,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 8 },
    },
    title: {
        ...Typography.heading,
        color: Colors.light.text,
        marginTop: Spacing.xl,
    },
    subtitle: {
        ...Typography.body,
        color: Colors.light.textSecondary,
        marginTop: Spacing.xs,
        textAlign: 'center',
    },
    pendingChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        marginTop: Spacing.lg,
        paddingVertical: Spacing.sm,
        paddingHorizontal: Spacing.lg,
        borderRadius: Radius.pill,
        backgroundColor: Colors.light.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: Colors.light.border,
    },
    pendingText: {
        ...Typography.caption,
        color: Colors.light.text,
    },
});
