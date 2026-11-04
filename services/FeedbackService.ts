import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export type HapticType =
    | 'TOUCH_DOWN'
    | 'RELEASE_STOP'
    | 'MUTATION_APPLIED'
    | 'QUERY_ANSWER'
    | 'OFFLINE_QUEUED'
    | 'ERROR'
    | 'SCAN_BEEP'
    | 'BUTTON_TAP';

export type ChimeType =
    | 'listening'
    | 'applied'
    | 'error'
    | 'processing'
    | 'scan'
    | 'LISTENING'
    | 'APPLIED'
    | 'ERROR'
    | 'PROCESSING'
    | 'SCAN';

export interface FeedbackSettings {
    hapticsEnabled: boolean;
    soundEnabled: boolean;
    volume: number; // 0.0 to 1.0
}

const STORAGE_KEYS = {
    HAPTICS: 'vocalstock:feedback:haptics_enabled',
    SOUND: 'vocalstock:feedback:sound_enabled',
    VOLUME: 'vocalstock:feedback:volume',
};

const SOUND_ASSETS: Record<string, number> = {
    listening: require('@/assets/sounds/listening.mp3'),
    processing: require('@/assets/sounds/processing.mp3'),
    applied: require('@/assets/sounds/applied.mp3'),
    error: require('@/assets/sounds/error.mp3'),
    scan: require('@/assets/sounds/listening.mp3'),
};

export class FeedbackServiceImpl {
    private soundCache = new Map<string, Audio.Sound>();
    private isInitialized = false;
    private initPromise: Promise<void> | null = null;

    private settings: FeedbackSettings = {
        hapticsEnabled: true,
        soundEnabled: true,
        volume: 1.0,
    };

    /**
     * Initializes audio mode, loads persisted preferences, and pre-caches sounds in memory.
     * Guaranteed safe to call repeatedly; uses idempotency guards.
     */
    async init(): Promise<void> {
        if (this.isInitialized) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            try {
                // 1. Load persisted preferences
                await this.loadSettings();

                // 2. Configure audio session for simultaneous recording & loudspeaker playback
                if (typeof Audio?.setAudioModeAsync === 'function') {
                    await Audio.setAudioModeAsync({
                        allowsRecordingIOS: true,
                        playsInSilentModeIOS: true,
                        staysActiveInBackground: false,
                        shouldDuckAndroid: true,
                        playThroughEarpieceAndroid: false,
                    });
                }

                // 3. Pre-load sound pool into memory for sub-50ms latency
                const soundKeys = ['listening', 'applied', 'error'] as const;
                await Promise.all(
                    soundKeys.map(async (key) => {
                        try {
                            const asset = SOUND_ASSETS[key];
                            if (asset && !this.soundCache.has(key)) {
                                const { sound } = await Audio.Sound.createAsync(
                                    asset,
                                    { volume: this.settings.volume, shouldPlay: false }
                                );
                                this.soundCache.set(key, sound);
                            }
                        } catch (err) {
                            console.warn(`[FeedbackService] Failed to cache sound "${key}":`, err);
                        }
                    })
                );

                this.isInitialized = true;
            } catch (error) {
                console.error('[FeedbackService] Initialization error:', error);
            } finally {
                this.initPromise = null;
            }
        })();

        return this.initPromise;
    }

    private async loadSettings(): Promise<void> {
        try {
            const [haptics, sound, volume] = await Promise.all([
                AsyncStorage.getItem(STORAGE_KEYS.HAPTICS),
                AsyncStorage.getItem(STORAGE_KEYS.SOUND),
                AsyncStorage.getItem(STORAGE_KEYS.VOLUME),
            ]);

            if (haptics !== null) this.settings.hapticsEnabled = haptics === 'true';
            if (sound !== null) this.settings.soundEnabled = sound === 'true';
            if (volume !== null) this.settings.volume = Math.max(0, Math.min(1, parseFloat(volume)));
        } catch {
            // Best-effort fallback to defaults
        }
    }

    // -------------------------------------------------------------------------
    // HAPTIC FEEDBACK TRIGGERS
    // -------------------------------------------------------------------------

    /** Tactile start cue (<25ms): Medium impact */
    async triggerRecordStart(): Promise<void> {
        if (!this.settings.hapticsEnabled || Platform.OS === 'web') return;
        try {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        } catch (e) {
            console.debug('[FeedbackService] Haptic error:', e);
        }
    }

    /** Tactile release/stop cue: Light impact */
    async triggerRecordStop(): Promise<void> {
        if (!this.settings.hapticsEnabled || Platform.OS === 'web') return;
        try {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } catch (e) {
            console.debug('[FeedbackService] Haptic error:', e);
        }
    }

    /** Transaction / Action Success: Success notification */
    async triggerSuccess(): Promise<void> {
        if (!this.settings.hapticsEnabled || Platform.OS === 'web') return;
        try {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (e) {
            console.debug('[FeedbackService] Haptic error:', e);
        }
    }

    /** Transaction / Recognition Failure: Error notification */
    async triggerError(): Promise<void> {
        if (!this.settings.hapticsEnabled || Platform.OS === 'web') return;
        try {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        } catch (e) {
            console.debug('[FeedbackService] Haptic error:', e);
        }
    }

    /**
     * Generalized haptic trigger supporting spec-defined event types.
     */
    async triggerHaptic(type: HapticType): Promise<void> {
        if (!this.settings.hapticsEnabled || Platform.OS === 'web') return;

        try {
            switch (type) {
                case 'TOUCH_DOWN':
                case 'BUTTON_TAP':
                    await this.triggerRecordStart();
                    break;

                case 'RELEASE_STOP':
                case 'SCAN_BEEP':
                    await this.triggerRecordStop();
                    break;

                case 'MUTATION_APPLIED':
                    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                    setTimeout(() => {
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined);
                    }, 80);
                    break;

                case 'QUERY_ANSWER':
                    await this.triggerSuccess();
                    break;

                case 'OFFLINE_QUEUED':
                    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                    break;

                case 'ERROR':
                    await this.triggerError();
                    setTimeout(() => {
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined);
                    }, 60);
                    setTimeout(() => {
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined);
                    }, 120);
                    break;
            }
        } catch (e) {
            console.debug('[FeedbackService] Haptic error:', e);
        }
    }

    // -------------------------------------------------------------------------
    // POS AUDIO CHIME DISPATCHER
    // -------------------------------------------------------------------------

    /**
     * Plays an audio chime with in-memory caching and graceful fallback.
     */
    async playChime(type: 'listening' | 'applied' | 'error' | ChimeType): Promise<void> {
        if (!this.settings.soundEnabled || this.settings.volume <= 0) return;

        const normKey = (type || '').toLowerCase();
        try {
            let sound = this.soundCache.get(normKey);
            if (!sound) {
                const asset = SOUND_ASSETS[normKey];
                if (!asset) {
                    console.warn(`[FeedbackService] Unknown sound chime type: "${type}"`);
                    return;
                }
                const result = await Audio.Sound.createAsync(
                    asset,
                    { volume: this.settings.volume, shouldPlay: false }
                );
                sound = result.sound;
                this.soundCache.set(normKey, sound);
            }

            if (sound) {
                if (typeof sound.setVolumeAsync === 'function') {
                    await sound.setVolumeAsync(this.settings.volume);
                }
                if (typeof sound.setPositionAsync === 'function') {
                    await sound.setPositionAsync(0);
                }
                if (typeof sound.playAsync === 'function') {
                    await sound.playAsync();
                }
            }
        } catch (err) {
            // Graceful fallback: audio playback failure must not interrupt counter workflow
            console.warn(`[FeedbackService] Failed to play chime "${type}":`, err);
        }
    }

    // -------------------------------------------------------------------------
    // COMBINED MULTIMODAL ORCHESTRATOR
    // -------------------------------------------------------------------------
    async trigger(action: { haptic?: HapticType; chime?: ChimeType }): Promise<void> {
        const promises: Promise<void>[] = [];
        if (action.haptic) promises.push(this.triggerHaptic(action.haptic));
        if (action.chime) promises.push(this.playChime(action.chime));
        await Promise.all(promises);
    }

    // -------------------------------------------------------------------------
    // SETTINGS MANAGEMENT & LIFECYCLE
    // -------------------------------------------------------------------------
    getSettings(): FeedbackSettings {
        return { ...this.settings };
    }

    async updateSettings(patch: Partial<FeedbackSettings>): Promise<void> {
        this.settings = { ...this.settings, ...patch };

        const writes: Promise<void>[] = [];
        if (patch.hapticsEnabled !== undefined) {
            writes.push(AsyncStorage.setItem(STORAGE_KEYS.HAPTICS, String(patch.hapticsEnabled)));
        }
        if (patch.soundEnabled !== undefined) {
            writes.push(AsyncStorage.setItem(STORAGE_KEYS.SOUND, String(patch.soundEnabled)));
        }
        if (patch.volume !== undefined) {
            writes.push(AsyncStorage.setItem(STORAGE_KEYS.VOLUME, String(patch.volume)));
            this.soundCache.forEach((sound) => {
                if (typeof sound.setVolumeAsync === 'function') {
                    void sound.setVolumeAsync(patch.volume!).catch(() => undefined);
                }
            });
        }
        await Promise.all(writes);
    }

    getCachedSoundsCount(): number {
        return this.soundCache.size;
    }

    isSoundCached(type: string): boolean {
        return this.soundCache.has(type.toLowerCase());
    }

    async cleanup(): Promise<void> {
        for (const sound of this.soundCache.values()) {
            try {
                if (typeof sound.unloadAsync === 'function') {
                    await sound.unloadAsync();
                }
            } catch {
                // Ignore unloading failures
            }
        }
        this.soundCache.clear();
        this.isInitialized = false;
    }

    resetForTesting(): void {
        this.soundCache.clear();
        this.isInitialized = false;
        this.initPromise = null;
        this.settings = {
            hapticsEnabled: true,
            soundEnabled: true,
            volume: 1.0,
        };
    }
}

export const FeedbackService = new FeedbackServiceImpl();
export const triggerRecordStart = () => FeedbackService.triggerRecordStart();
export const triggerRecordStop = () => FeedbackService.triggerRecordStop();
export const triggerSuccess = () => FeedbackService.triggerSuccess();
export const triggerError = () => FeedbackService.triggerError();
export const playChime = (type: 'listening' | 'applied' | 'error' | ChimeType) => FeedbackService.playChime(type);
export default FeedbackService;
