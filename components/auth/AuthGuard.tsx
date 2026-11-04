import { Colors } from '@/constants/Colors';
import { useAuth } from '@/services/AuthContext';
import { useRouter, useSegments } from 'expo-router';
import React, { useEffect } from 'react';

import { StyleSheet, Text, View } from 'react-native';

export function AuthGuard({ children }: { children: React.ReactNode }) {
    const { session, isLoading, isGuest } = useAuth();
    const segments = useSegments();
    const router = useRouter();

    // Are we already on the login page? (avoids redirect loops)
    const inAuthGroup = segments[0] === 'login';

    useEffect(() => {
        if (isLoading) return;

        if (!session && !isGuest && !inAuthGroup) {
            router.replace('/login');
        } else if ((session || isGuest) && inAuthGroup) {
            router.replace('/');
        }
    }, [session, isGuest, isLoading, inAuthGroup, router]);

    if (isLoading) {
        return (
            <View style={styles.loading}>
                <Text style={styles.loadingText}>Loading...</Text>
            </View>
        );
    }

    // Allow if session exists OR is guest OR we are on the login screen
    if (!session && !isGuest && !inAuthGroup) {
        return null;
    }
    return <>{children}</>;
}

const styles = StyleSheet.create({
    loading: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: Colors.light.background,
    },
    loadingText: {
        color: Colors.light.text,
    },
});
