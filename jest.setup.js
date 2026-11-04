// jest.setup.js
import 'react-native-gesture-handler/jestSetup';

jest.mock('@react-native-async-storage/async-storage', () =>
    require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-file-system', () => {
    class MockFile {
        constructor(...parts) {
            this.uri = parts.map(part => (part && part.uri ? part.uri : String(part))).join('/');
        }
        async bytes() {
            return new Uint8Array();
        }
        copy() {}
        delete() {}
    }
    class MockDirectory {
        constructor(...parts) {
            this.uri = parts.map(part => (part && part.uri ? part.uri : String(part))).join('/');
            this.exists = true;
        }
        create() {}
    }
    return {
        File: MockFile,
        Directory: MockDirectory,
        Paths: { document: { uri: 'file:///mock-document' } },
    };
});

// Required env vars are read at module load time
// AI provider keys are test-only (production uses Supabase Vault + Edge Functions)
process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'test-groq-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-openrouter-key';
process.env.EXPO_PUBLIC_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'test-anon-key';

// Mock Supabase
jest.mock('@/lib/supabase', () => {
    const defaultQueryResult = { data: null, error: null, status: 200 };

    const createQueryBuilder = () => ({
        select: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        ilike: jest.fn().mockReturnThis(),
        lt: jest.fn().mockReturnThis(),
        lte: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        range: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
        then: jest.fn((resolve, reject) => Promise.resolve(defaultQueryResult).then(resolve, reject)),
    });

    return {
        supabase: {
            from: jest.fn(() => createQueryBuilder()),
            rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
            storage: {
                from: jest.fn(() => ({
                    upload: jest.fn().mockResolvedValue({ data: { path: 'test' }, error: null }),
                    download: jest.fn().mockResolvedValue({ data: null, error: null }),
                })),
            },
            functions: {
                invoke: jest.fn().mockResolvedValue({ data: null, error: null }),
            },
            channel: jest.fn(() => ({
                on: jest.fn().mockReturnThis(),
                subscribe: jest.fn().mockReturnThis(),
                unsubscribe: jest.fn(),
            })),
            auth: {
                getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
                onAuthStateChange: jest.fn(() => ({
                    data: { subscription: { unsubscribe: jest.fn() } },
                })),
                signInWithPassword: jest.fn().mockResolvedValue({ data: {}, error: null }),
                signUp: jest.fn().mockResolvedValue({ data: {}, error: null }),
                signOut: jest.fn().mockResolvedValue({ data: {}, error: null }),
            },
        },
    };
});

// Mock Expo Router with stable, overridable jest.fn()s
const mockRouterReplace = jest.fn();

jest.mock('expo-router', () => {
    const React = require('react');
    return {
        useRouter: jest.fn(() => ({
            push: jest.fn(),
            replace: mockRouterReplace,
            back: jest.fn(),
            canGoBack: jest.fn(() => true),
        })),
        useSegments: jest.fn(() => []),
        useLocalSearchParams: jest.fn(() => ({})),
        useFocusEffect: (effect) => {
            React.useEffect(effect, [effect]);
        },
        Link: ({ children }) => children,
        Stack: Object.assign(({ children }) => children ?? null, { Screen: () => null }),
    };
});

jest.mock('expo-haptics', () => ({
    impactAsync: jest.fn().mockResolvedValue(undefined),
    notificationAsync: jest.fn().mockResolvedValue(undefined),
    selectionAsync: jest.fn().mockResolvedValue(undefined),
    ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
    NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

jest.mock('expo-crypto', () => {
    const crypto = require('crypto');
    return {
        CryptoDigestAlgorithm: {
            SHA256: 'SHA-256',
        },
        digestStringAsync: jest.fn(async (_algo, data) => {
            return crypto.createHash('sha256').update(String(data)).digest('hex');
        }),
    };
});

jest.mock('expo-sharing', () => ({
    isAvailableAsync: jest.fn().mockResolvedValue(true),
    shareAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-print', () => ({
    printToFileAsync: jest.fn().mockResolvedValue({ uri: 'file:///mock/print.pdf' }),
}));

jest.mock('expo-av', () => {
    const mockSound = {
        playAsync: jest.fn().mockResolvedValue(undefined),
        replayAsync: jest.fn().mockResolvedValue(undefined),
        setPositionAsync: jest.fn().mockResolvedValue(undefined),
        setVolumeAsync: jest.fn().mockResolvedValue(undefined),
        unloadAsync: jest.fn().mockResolvedValue(undefined),
        getStatusAsync: jest.fn().mockResolvedValue({ isLoaded: true }),
    };

    return {
        Audio: {
            setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
            Sound: {
                createAsync: jest.fn().mockResolvedValue({
                    sound: mockSound,
                    status: { isLoaded: true },
                }),
            },
        },
    };
});
