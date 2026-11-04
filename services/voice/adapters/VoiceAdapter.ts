import { Audio } from 'expo-av';
import { IVoiceProvider, RecordedAudio } from '../interfaces';
import { devLog } from '@/utils/devLog';

export class VoiceAdapter implements IVoiceProvider {
    private isListening = false;
    private recording: Audio.Recording | null = null;
    private recordingPromise: Promise<void> | null = null;
    private recordingSessionId: number | null = null;
    private sessionId = 0;
    private onRecordingCallback: ((recording: RecordedAudio) => void) | null = null;
    private onVerificationFailedCallback: (() => void) | null = null;

    async init(): Promise<void> {
        devLog('[VoiceAdapter] Initializing...');
        const permission = await Audio.requestPermissionsAsync();
        if (permission.status !== 'granted') {
            console.warn('[VoiceAdapter] Audio permission not granted');
        }

        await Audio.setAudioModeAsync({
            allowsRecordingIOS: true,
            playsInSilentModeIOS: true,
        });
    }

    async startWakeWordListener(onWakeWord: () => void): Promise<void> {
        console.warn('[VoiceAdapter] Wake word not supported in this version.');
    }

    async stopWakeWordListener(): Promise<void> {
        // No-op
    }

    async startCommandListener(
        onRecording: (recording: RecordedAudio) => void,
        onVerificationFailed: () => void
    ): Promise<void> {
        // Never leave an old recording behind if start is called twice
        if (this.isListening || this.recording || this.recordingPromise) {
            await this.cancelCommandListener();
        }

        devLog('[VoiceAdapter] Starting Command Listener (Recording)');
        this.isListening = true;
        this.onRecordingCallback = onRecording;
        this.onVerificationFailedCallback = onVerificationFailed;

        const sessionId = ++this.sessionId;

        this.recordingPromise = (async () => {
            try {
                await Audio.setAudioModeAsync({
                    allowsRecordingIOS: true,
                    playsInSilentModeIOS: true,
                });

                const { recording } = await Audio.Recording.createAsync(
                    Audio.RecordingOptionsPresets.HIGH_QUALITY
                );

                // The user may have stopped (or a new session started) while the recorder was starting
                if (!this.isListening || sessionId !== this.sessionId) {
                    await recording.stopAndUnloadAsync().catch(() => undefined);
                    return;
                }

                this.recording = recording;
                this.recordingSessionId = sessionId;
                this.recordingPromise = null;
                devLog('[VoiceAdapter] Recording started');

            } catch (err) {
                console.error('[VoiceAdapter] Failed to start recording', err);
                if (sessionId !== this.sessionId) return;
                this.isListening = false;
                if (this.onVerificationFailedCallback) this.onVerificationFailedCallback();
            }
        })();

        await this.recordingPromise;
    }

    async stopCommandListener(): Promise<void> {
        devLog('[VoiceAdapter] Stopping Command Listener');
        if (!this.isListening && !this.recording) return;

        const sessionId = this.sessionId;
        const onRecording = this.onRecordingCallback;
        const onFailed = this.onVerificationFailedCallback;

        this.isListening = false;

        // Wait for a concurrently starting recorder so we don't leak an active recording
        if (this.recordingPromise) {
            try {
                await this.recordingPromise;
            } catch {
                // Already reported by startCommandListener
            }
        }

        // Bail out BEFORE touching state if this session was superseded/cancelled
        if (sessionId !== this.sessionId || this.recordingSessionId !== sessionId) return;

        const recording = this.recording;
        this.recording = null;
        this.recordingSessionId = null;
        this.recordingPromise = null;

        if (!recording) return;

        try {
            const status = await recording.getStatusAsync();
            await recording.stopAndUnloadAsync();

            // The session was cancelled while we were stopping
            if (sessionId !== this.sessionId) return;

            const uri = recording.getURI();
            devLog('[VoiceAdapter] Recording stopped, URI:', uri);

            if (uri && onRecording) {
                onRecording({ uri, durationMs: status?.durationMillis });
            } else if (onFailed) {
                onFailed();
            }
        } catch (err) {
            console.error('[VoiceAdapter] Failed to stop recording', err);
            if (sessionId === this.sessionId && onFailed) onFailed();
        }
    }

    /**
     * Stops an active/starting recording without handing it off.
     * Used on unmount/logout to guarantee the microphone is released.
     */
    async cancelCommandListener(): Promise<void> {
        this.sessionId++;
        this.isListening = false;

        if (this.recordingPromise) {
            try {
                await this.recordingPromise;
            } catch {
                // Ignore: the start path already reported the failure
            }
        }

        const recording = this.recording;
        this.recording = null;
        this.recordingSessionId = null;
        this.recordingPromise = null;

        if (recording) {
            try {
                await recording.stopAndUnloadAsync();
            } catch {
                // Ignore: the recording may already be unloaded
            }
        }
    }
}
