import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

import { Platform } from 'react-native';

const isConfigured = (value: string | undefined): value is string =>
    typeof value === 'string' &&
    value.length > 0 &&
    !value.includes('placeholder') &&
    !value.includes('your-project') &&
    !value.includes('your-anon-key');

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!isConfigured(supabaseUrl) || !isConfigured(supabaseAnonKey)) {
    throw new Error(
        'Missing EXPO_PUBLIC_SUPABASE_URL/ANON_KEY. Copy .env.example to .env and restart with a clean cache.'
    );
}

// Specialized storage adapter for Expo/React Native that handles SSR safety
const ExpoStorage = {
    getItem: (key: string) => {
        if (Platform.OS === 'web' && typeof window === 'undefined') {
            return Promise.resolve(null);
        }
        return AsyncStorage.getItem(key);
    },
    setItem: (key: string, value: string) => {
        if (Platform.OS === 'web' && typeof window === 'undefined') {
            return Promise.resolve();
        }
        return AsyncStorage.setItem(key, value);
    },
    removeItem: (key: string) => {
        if (Platform.OS === 'web' && typeof window === 'undefined') {
            return Promise.resolve();
        }
        return AsyncStorage.removeItem(key);
    },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        storage: ExpoStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
    },
});
