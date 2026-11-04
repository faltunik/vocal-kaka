import { AppButton } from '@/components/ui/AppButton';
import { Colors } from '@/constants/Colors';
import { Radius, Spacing, TouchTarget } from '@/constants/Layout';
import { Typography } from '@/constants/Typography';
import { useAuth } from '@/services/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Image, StyleSheet, Text, TextInput, View } from 'react-native';

export default function LoginScreen() {
    const router = useRouter();
    const { signIn, signUp, enterGuestMode } = useAuth();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);

    const validateCredentials = (): boolean => {
        const trimmedEmail = email.trim();
        if (!trimmedEmail || !password) {
            Alert.alert('Error', 'Please enter both email and password');
            return false;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
            Alert.alert('Invalid email', 'Please enter a valid email address.');
            return false;
        }
        if (password.length < 6) {
            Alert.alert('Invalid password', 'Password must be at least 6 characters.');
            return false;
        }
        return true;
    };

    const handleSignIn = async () => {
        if (!validateCredentials()) return;

        setLoading(true);
        try {
            const { error } = await signIn(email.trim(), password);
            if (error) {
                Alert.alert('Login Failed', error.message);
            } else {
                router.replace('/');
            }
        } catch (e) {
            console.error('[Login] Sign in failed:', e);
            Alert.alert('Login Failed', 'Could not reach the server. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleSignUp = async () => {
        if (!validateCredentials()) return;

        setLoading(true);
        try {
            const { error } = await signUp(email.trim(), password);
            if (error) {
                Alert.alert('Sign Up Failed', error.message);
            } else {
                Alert.alert('Success', 'Account created! Please check your email to verify.');
            }
        } catch (e) {
            console.error('[Login] Sign up failed:', e);
            Alert.alert('Sign Up Failed', 'Could not reach the server. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Image
                    source={require('@/assets/images/icon.png')}
                    style={styles.logo}
                    accessibilityLabel="Vocal Kaka logo"
                />
                <Text style={styles.title}>Kaka</Text>
                <Text style={styles.subtitle}>Your voice, your shop.</Text>
            </View>

            <View style={styles.form}>
                <View style={styles.inputContainer}>
                    <Ionicons name="mail-outline" size={20} color={Colors.light.textSecondary} style={styles.inputIcon} />
                    <TextInput
                        style={styles.input}
                        placeholder="Email"
                        placeholderTextColor={Colors.light.textSecondary}
                        value={email}
                        onChangeText={setEmail}
                        autoCapitalize="none"
                        keyboardType="email-address"
                    />
                </View>

                <View style={styles.inputContainer}>
                    <Ionicons name="lock-closed-outline" size={20} color={Colors.light.textSecondary} style={styles.inputIcon} />
                    <TextInput
                        style={styles.input}
                        placeholder="Password"
                        placeholderTextColor={Colors.light.textSecondary}
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry
                    />
                </View>

                <AppButton
                    title="Sign In"
                    onPress={handleSignIn}
                    loading={loading}
                    disabled={loading}
                    style={styles.buttonSpacing}
                />

                <AppButton
                    title="Create Account"
                    onPress={handleSignUp}
                    variant="outline"
                    loading={loading}
                    disabled={loading}
                    style={styles.buttonSpacing}
                />

                <AppButton
                    title="Try without sign in"
                    onPress={() => {
                        enterGuestMode();
                        router.replace('/');
                    }}
                    variant="ghost"
                    disabled={loading}
                    style={styles.guestButton}
                    textStyle={styles.guestText}
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: Colors.light.background,
        padding: Spacing.xxl,
        justifyContent: 'center',
    },
    header: {
        alignItems: 'center',
        marginBottom: Spacing.xxxl,
    },
    logo: {
        width: 72,
        height: 72,
        borderRadius: Radius.lg,
    },
    title: {
        ...Typography.largeTitle,
        color: Colors.light.text,
        marginTop: Spacing.lg,
    },
    subtitle: {
        ...Typography.body,
        color: Colors.light.textSecondary,
        marginTop: Spacing.xs,
    },
    form: {
        gap: Spacing.md,
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 52,
        borderRadius: Radius.md,
        backgroundColor: Colors.light.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: Colors.light.border,
        paddingHorizontal: Spacing.lg,
    },
    inputIcon: {
        marginRight: Spacing.md,
    },
    input: {
        flex: 1,
        ...Typography.body,
        color: Colors.light.text,
    },
    buttonSpacing: {
        width: '100%',
    },
    guestButton: {
        marginTop: Spacing.xs,
        minHeight: TouchTarget.min,
    },
    guestText: {
        ...Typography.bodyStrong,
        color: Colors.light.textSecondary,
        textDecorationLine: 'underline',
    }
});
