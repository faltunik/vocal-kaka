import { Colors } from '@/constants/Colors';
import React, { PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';
import { Edge, SafeAreaView } from 'react-native-safe-area-context';

interface ScreenLayoutProps extends PropsWithChildren {
    /** Safe-area edges to inset. Tab screens exclude the bottom (the tab bar handles it). */
    edges?: Edge[];
}

export function ScreenLayout({ children, edges = ['top', 'left', 'right'] }: ScreenLayoutProps) {
    return (
        <SafeAreaView style={styles.container} edges={edges}>
            <View style={styles.content}>
                {children}
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: Colors.light.background,
    },
    content: {
        flex: 1,
    }
});
