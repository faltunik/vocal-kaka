import { Colors } from '@/constants/Colors';
import { Radius, Spacing, TouchTarget } from '@/constants/Layout';
import { Typography } from '@/constants/Typography';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
    DimensionValue,
    KeyboardAvoidingView,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const ignoreClose = () => undefined;

interface AppModalProps {
    visible: boolean;
    onClose: () => void;
    title: string;
    variant?: 'center' | 'sheet';
    height?: DimensionValue;
    closeDisabled?: boolean;
    scrollable?: boolean;
    children: React.ReactNode;
}

export function AppModal({
    visible,
    onClose,
    title,
    variant = 'center',
    height,
    closeDisabled = false,
    scrollable = true,
    children,
}: AppModalProps) {
    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={closeDisabled ? ignoreClose : onClose}
        >
            <KeyboardAvoidingView
                style={styles.keyboardAvoiding}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
                <View style={[styles.overlay, variant === 'sheet' && styles.overlayBottom]}>
                    <View
                        style={[
                            styles.container,
                            variant === 'sheet' ? styles.sheet : styles.center,
                            height != null && { height },
                        ]}
                    >
                        {variant === 'sheet' && <View style={styles.grabber} />}
                        <View style={styles.header}>
                            <Text style={styles.title} numberOfLines={2}>{title}</Text>
                            {!closeDisabled && (
                                <TouchableOpacity
                                    onPress={onClose}
                                    style={styles.closeButton}
                                    accessibilityRole="button"
                                    accessibilityLabel="Close"
                                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                >
                                    <Ionicons name="close" size={26} color={Colors.light.text} />
                                </TouchableOpacity>
                            )}
                        </View>
                        {scrollable ? (
                            <ScrollView
                                style={styles.scroll}
                                keyboardShouldPersistTaps="handled"
                                showsVerticalScrollIndicator={false}
                            >
                                {children}
                            </ScrollView>
                        ) : (
                            <View style={styles.scroll}>{children}</View>
                        )}
                    </View>
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    keyboardAvoiding: {
        flex: 1,
    },
    overlay: {
        flex: 1,
        backgroundColor: Colors.light.overlay,
        justifyContent: 'center',
        padding: Spacing.xl,
    },
    overlayBottom: {
        justifyContent: 'flex-end',
        padding: 0,
    },
    container: {
        backgroundColor: Colors.light.card,
        borderRadius: Radius.lg,
        padding: Spacing.xl,
    },
    center: {
        borderRadius: Radius.lg,
    },
    sheet: {
        borderRadius: Radius.lg,
        paddingBottom: Spacing.xxxl,
    },
    grabber: {
        width: 36,
        height: 4,
        borderRadius: Radius.pill,
        backgroundColor: Colors.light.border,
        alignSelf: 'center',
        marginBottom: Spacing.md,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: Spacing.lg,
    },
    title: {
        flex: 1,
        marginRight: Spacing.md,
        ...Typography.title,
        color: Colors.light.text,
    },
    closeButton: {
        width: TouchTarget.min,
        height: TouchTarget.min,
        alignItems: 'center',
        justifyContent: 'center',
    },
    scroll: {
        flexShrink: 1,
    },
});
