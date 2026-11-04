import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { flushPendingRecordings } from '@/services/voice/VoiceCommandService';

const QUEUE_KEY = 'vocalstock:pending-recordings';

describe('Voice queue concurrency', () => {
    beforeEach(async () => {
        jest.clearAllMocks();
        await AsyncStorage.clear();
        (supabase.functions.invoke as jest.Mock).mockResolvedValue({
            data: { transcript: 'test', actions: [], applied: 1, answers: [] },
            error: null,
        });
    });

    it('serializes concurrent flushes so recordings are processed exactly once', async () => {
        const now = Date.now();
        await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([
            { recordingId: 'r1', userId: 'u1', uri: 'file://a.m4a', createdAt: now },
            { recordingId: 'r2', userId: 'u1', uri: 'file://b.m4a', createdAt: now + 1 },
        ]));

        const [first, second] = await Promise.all([
            flushPendingRecordings('u1'),
            flushPendingRecordings('u1'),
        ]);

        expect(first.length + second.length).toBe(2);
        expect(supabase.functions.invoke).toHaveBeenCalledTimes(2);

        const remaining = JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) ?? '[]');
        expect(remaining).toHaveLength(0);
    });

    it('leaves other users recordings untouched', async () => {
        await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([
            { recordingId: 'r3', userId: 'other-user', uri: 'file://c.m4a', createdAt: Date.now() },
        ]));

        const processed = await flushPendingRecordings('u1');

        expect(processed).toHaveLength(0);
        expect(supabase.functions.invoke).not.toHaveBeenCalled();
        expect(JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) ?? '[]')).toHaveLength(1);
    });
});
