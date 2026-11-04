export interface RecordedAudio {
    uri: string;
    durationMs?: number;
}

export interface IVoiceProvider {
    /**
     * Initialize the engine with necessary keys/models
     */
    init(): Promise<void>;

    /**
     * Start listening for Wake Word ("Hey Boss")
     */
    startWakeWordListener(onWakeWord: () => void): Promise<void>;

    /**
     * Stop listening for Wake Word
     */
    stopWakeWordListener(): Promise<void>;

    /**
     * Start recording a command. The recording is handed to onRecording after
     * it is stopped; transcription/parsing happen server-side.
     * @param onRecording callback with the recorded file
     * @param onVerificationFailed callback if recording fails
     */
    startCommandListener(
        onRecording: (recording: RecordedAudio) => void,
        onVerificationFailed: () => void
    ): Promise<void>;

    /**
     * Stop command listner
     */
    stopCommandListener(): Promise<void>;

    /**
     * Stop any active/starting recording without handing it off
     */
    cancelCommandListener(): Promise<void>;
}
