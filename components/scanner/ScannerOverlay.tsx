import { Colors } from '@/constants/Colors';
import { Spacing } from '@/constants/Layout';
import { Typography } from '@/constants/Typography';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export function ScannerOverlay() {
    return (
        <View style={styles.overlay}>
            <View style={styles.topOverlay}>
                <Text style={styles.scanText}>Position barcode in the frame</Text>
            </View>

            <View style={styles.middleContainer}>
                <View style={styles.sideOverlay} />
                <View style={styles.focusedContainer}>
                    <View style={styles.cornerTL} />
                    <View style={styles.cornerTR} />
                    <View style={styles.cornerBL} />
                    <View style={styles.cornerBR} />
                </View>
                <View style={styles.sideOverlay} />
            </View>

            <View style={styles.bottomOverlay} />
        </View>
    );
}

const overlayColor = Colors.light.overlay;
const cornerColor = Colors.light.tint;
const cornerWidth = 5;
const cornerLength = 36;

const styles = StyleSheet.create({
    overlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
    },
    topOverlay: {
        flex: 1,
        backgroundColor: overlayColor,
        justifyContent: 'center',
        alignItems: 'center',
    },
    bottomOverlay: {
        flex: 1,
        backgroundColor: overlayColor,
    },
    middleContainer: {
        flexDirection: 'row',
        height: 250,
    },
    sideOverlay: {
        flex: 1,
        backgroundColor: overlayColor,
    },
    focusedContainer: {
        width: 250,
        position: 'relative',
    },
    scanText: {
        ...Typography.bodyStrong,
        color: '#FFFFFF',
        marginBottom: Spacing.xl,
    },

    // Corners
    cornerTL: {
        position: 'absolute',
        top: 0,
        left: 0,
        width: cornerLength,
        height: cornerWidth,
        backgroundColor: cornerColor,
    },
    cornerTR: {
        position: 'absolute',
        top: 0,
        right: 0,
        width: cornerLength,
        height: cornerWidth,
        backgroundColor: cornerColor,
    },
    cornerBL: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        width: cornerLength,
        height: cornerWidth,
        backgroundColor: cornerColor,
    },
    cornerBR: {
        position: 'absolute',
        bottom: 0,
        right: 0,
        width: cornerLength,
        height: cornerWidth,
        backgroundColor: cornerColor,
    },
});
