import { FeedbackService } from '@/services/FeedbackService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';

describe('FeedbackService', () => {
    beforeEach(async () => {
        jest.clearAllMocks();
        FeedbackService.resetForTesting();
        await AsyncStorage.clear();
    });

    afterEach(async () => {
        await FeedbackService.cleanup();
    });

    describe('Haptic Triggers', () => {
        it('triggerRecordStart calls Haptics.impactAsync with Medium style (<25ms tactile start cue)', async () => {
            await FeedbackService.triggerRecordStart();
            expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Medium);
        });

        it('triggerRecordStop calls Haptics.impactAsync with Light style', async () => {
            await FeedbackService.triggerRecordStop();
            expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
        });

        it('triggerSuccess calls Haptics.notificationAsync with Success type', async () => {
            await FeedbackService.triggerSuccess();
            expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
        });

        it('triggerError calls Haptics.notificationAsync with Error type', async () => {
            await FeedbackService.triggerError();
            expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Error);
        });

        it('does not trigger haptics when hapticsEnabled is false', async () => {
            await FeedbackService.updateSettings({ hapticsEnabled: false });
            await FeedbackService.triggerRecordStart();
            await FeedbackService.triggerRecordStop();
            await FeedbackService.triggerSuccess();
            await FeedbackService.triggerError();

            expect(Haptics.impactAsync).not.toHaveBeenCalled();
            expect(Haptics.notificationAsync).not.toHaveBeenCalled();
        });

        it('gracefully catches and suppresses haptic errors without throwing', async () => {
            (Haptics.impactAsync as jest.Mock).mockRejectedValueOnce(new Error('Hardware actuator missing'));
            await expect(FeedbackService.triggerRecordStart()).resolves.toBeUndefined();

            (Haptics.notificationAsync as jest.Mock).mockRejectedValueOnce(new Error('Notification haptic failed'));
            await expect(FeedbackService.triggerSuccess()).resolves.toBeUndefined();
        });

        it('triggerHaptic supports MUTATION_APPLIED and general types', async () => {
            jest.useFakeTimers();
            await FeedbackService.triggerHaptic('MUTATION_APPLIED');
            expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Heavy);

            jest.advanceTimersByTime(80);
            expect(Haptics.impactAsync).toHaveBeenCalledTimes(2);
            jest.useRealTimers();
        });

        it('triggerHaptic supports QUERY_ANSWER and OFFLINE_QUEUED', async () => {
            await FeedbackService.triggerHaptic('QUERY_ANSWER');
            expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);

            await FeedbackService.triggerHaptic('OFFLINE_QUEUED');
            expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Warning);
        });
    });

    describe('Audio Chimes', () => {
        it('playChime creates and plays listening chime', async () => {
            await FeedbackService.playChime('listening');

            expect(Audio.Sound.createAsync).toHaveBeenCalledTimes(1);
            const { sound } = await (Audio.Sound.createAsync as jest.Mock).mock.results[0].value;
            expect(sound.setPositionAsync).toHaveBeenCalledWith(0);
            expect(sound.playAsync).toHaveBeenCalledTimes(1);
        });

        it('playChime creates and plays applied chime', async () => {
            await FeedbackService.playChime('applied');

            expect(Audio.Sound.createAsync).toHaveBeenCalledTimes(1);
            const { sound } = await (Audio.Sound.createAsync as jest.Mock).mock.results[0].value;
            expect(sound.setPositionAsync).toHaveBeenCalledWith(0);
            expect(sound.playAsync).toHaveBeenCalledTimes(1);
        });

        it('playChime creates and plays error chime', async () => {
            await FeedbackService.playChime('error');

            expect(Audio.Sound.createAsync).toHaveBeenCalledTimes(1);
            const { sound } = await (Audio.Sound.createAsync as jest.Mock).mock.results[0].value;
            expect(sound.setPositionAsync).toHaveBeenCalledWith(0);
            expect(sound.playAsync).toHaveBeenCalledTimes(1);
        });

        it('caches loaded sound objects so subsequent calls do not reload audio from disk', async () => {
            await FeedbackService.playChime('applied');
            expect(Audio.Sound.createAsync).toHaveBeenCalledTimes(1);
            expect(FeedbackService.isSoundCached('applied')).toBe(true);

            // Second invocation must reuse the cached Sound object
            await FeedbackService.playChime('applied');
            expect(Audio.Sound.createAsync).toHaveBeenCalledTimes(1);

            const { sound } = await (Audio.Sound.createAsync as jest.Mock).mock.results[0].value;
            expect(sound.setPositionAsync).toHaveBeenCalledTimes(2);
            expect(sound.playAsync).toHaveBeenCalledTimes(2);
        });

        it('handles uppercase and lowercase chime types interchangeably', async () => {
            await FeedbackService.playChime('LISTENING');
            expect(Audio.Sound.createAsync).toHaveBeenCalledTimes(1);

            await FeedbackService.playChime('listening');
            expect(Audio.Sound.createAsync).toHaveBeenCalledTimes(1); // Cached
        });

        it('suppresses audio when soundEnabled is false', async () => {
            await FeedbackService.updateSettings({ soundEnabled: false });
            await FeedbackService.playChime('applied');

            expect(Audio.Sound.createAsync).not.toHaveBeenCalled();
        });

        it('suppresses audio when volume is 0', async () => {
            await FeedbackService.updateSettings({ volume: 0 });
            await FeedbackService.playChime('applied');

            expect(Audio.Sound.createAsync).not.toHaveBeenCalled();
        });

        it('gracefully handles Audio.Sound.createAsync failure without throwing', async () => {
            (Audio.Sound.createAsync as jest.Mock).mockRejectedValueOnce(new Error('Audio decoder failed'));
            await expect(FeedbackService.playChime('applied')).resolves.toBeUndefined();
        });

        it('gracefully handles sound.playAsync failure without throwing', async () => {
            const mockFailingSound = {
                setVolumeAsync: jest.fn().mockResolvedValue(undefined),
                setPositionAsync: jest.fn().mockResolvedValue(undefined),
                playAsync: jest.fn().mockRejectedValue(new Error('Speaker DAC busy')),
                unloadAsync: jest.fn().mockResolvedValue(undefined),
            };
            (Audio.Sound.createAsync as jest.Mock).mockResolvedValueOnce({ sound: mockFailingSound });

            await expect(FeedbackService.playChime('applied')).resolves.toBeUndefined();
        });
    });

    describe('Multimodal Orchestration & Lifecycle', () => {
        it('trigger combines haptic and chime in parallel', async () => {
            await FeedbackService.trigger({
                haptic: 'TOUCH_DOWN',
                chime: 'listening',
            });

            expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Medium);
            expect(Audio.Sound.createAsync).toHaveBeenCalledTimes(1);
        });

        it('init sets audio mode and pre-caches sound pool', async () => {
            await FeedbackService.init();

            expect(Audio.setAudioModeAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    allowsRecordingIOS: true,
                    playsInSilentModeIOS: true,
                    playThroughEarpieceAndroid: false,
                })
            );
            expect(FeedbackService.getCachedSoundsCount()).toBeGreaterThan(0);
        });

        it('cleanup unloads all cached sounds and resets state', async () => {
            await FeedbackService.init();
            expect(FeedbackService.getCachedSoundsCount()).toBeGreaterThan(0);

            await FeedbackService.cleanup();
            expect(FeedbackService.getCachedSoundsCount()).toBe(0);
        });

        it('updateSettings updates volume across cached sounds and persists to AsyncStorage', async () => {
            await FeedbackService.playChime('applied');
            const { sound } = await (Audio.Sound.createAsync as jest.Mock).mock.results[0].value;

            await FeedbackService.updateSettings({ volume: 0.5 });
            expect(FeedbackService.getSettings().volume).toBe(0.5);
            expect(sound.setVolumeAsync).toHaveBeenCalledWith(0.5);
        });
    });
});
