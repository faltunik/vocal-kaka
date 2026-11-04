import { useCommandExecutor } from '@/hooks/useCommandExecutor';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../AuthContext';
import { useStore } from '../StoreContext';
import { GUEST_USER_ID } from '../InventoryService';
import { devLog, devWarn } from '@/utils/devLog';
import { VoiceAdapter } from './adapters/VoiceAdapter';
import { IVoiceProvider, RecordedAudio } from './interfaces';
import {
    VoiceCommandResult,
    flushPendingRecordings,
    pendingRecordingCount,
    processRecording,
} from './VoiceCommandService';

export type VoiceTransactionStatus = 'idle' | 'success' | 'error';

export interface VoiceContextType {
    isListening: boolean;
    isProcessing: boolean;
    pendingCount: number;
    toggleListening: () => void;
    retryPending: () => void;
    lastAnswer: string | null;
    lastStatus?: VoiceTransactionStatus | null;
}

const VoiceContext = createContext<VoiceContextType | null>(null);

export const VoiceProvider = ({ children }: { children: React.ReactNode }) => {
    const { user, isGuest } = useAuth();
    const { currentStore } = useStore();

    // Construct the adapter once, lazily (useRef evaluates its argument on every render)
    const adapterRef = useRef<IVoiceProvider | null>(null);
    if (!adapterRef.current) {
        adapterRef.current = new VoiceAdapter();
    }
    const adapter = adapterRef.current;

    const [isListening, setIsListening] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [pendingCount, setPendingCount] = useState(0);
    const [lastAnswer, setLastAnswer] = useState<string | null>(null);
    const [lastStatus, setLastStatus] = useState<VoiceTransactionStatus | null>(null);

    const commandExecutor = useCommandExecutor();
    const executorRef = useRef(commandExecutor);
    executorRef.current = commandExecutor;

    // Latest account, so async flushes can detect a sign-out/sign-in
    const userRef = useRef(user);
    userRef.current = user;
    // Synchronous guard against overlapping recordings (state updates lag)
    const processingRef = useRef(false);

    const refreshPendingCount = useCallback(async () => {
        try {
            const uid = userRef.current?.id;
            // Without an account the queue belongs to nobody we can report.
            setPendingCount(uid ? await pendingRecordingCount(uid) : 0);
        } catch {
            // Count is informational only
        }
    }, []);

    useEffect(() => {
        void refreshPendingCount();
    }, [refreshPendingCount, user?.id]);

    /**
     * Runs processed results through the executor and reports answers.
     * Results captured for one account are never applied to another.
     */
    const applyResults = useCallback(async (results: VoiceCommandResult[], expectedUserId?: string) => {
        if (results.length === 0) return;
        if (expectedUserId && userRef.current?.id !== expectedUserId) {
            devWarn('[Voice] Discarding flush results: account changed');
            return;
        }
        const answerTexts: string[] = [];
        for (const result of results) {
            const answers = await executorRef.current.execute(result);
            answerTexts.push(...answers.map(answer => answer.text));
        }
        setLastAnswer(answerTexts.length > 0
            ? answerTexts.join(' • ')
            : `Processed ${results.length} offline command${results.length === 1 ? '' : 's'}`);
    }, []);

    const retryPending = useCallback(async () => {
        const flushUserId = user?.id;
        if (!flushUserId || isProcessing) return;
        setIsProcessing(true);
        try {
            const results = await flushPendingRecordings(flushUserId);
            await applyResults(results, flushUserId);
        } finally {
            await refreshPendingCount();
            setIsProcessing(false);
        }
    }, [user?.id, isProcessing, applyResults, refreshPendingCount]);

    // Recording is uploaded and processed server-side (ASR + LLM + ledger)
    const handleRecording = useCallback(async (recording: RecordedAudio) => {
        const userId = user?.id ?? (isGuest ? GUEST_USER_ID : null);
        if (!userId) return;

        if (userId === GUEST_USER_ID) {
            setLastAnswer('Guest mode: commands are not saved');
            return;
        }

        if (processingRef.current) {
            devWarn('[Voice] Already processing a recording, ignoring duplicate');
            return;
        }
        processingRef.current = true;

        devLog('[Voice] processing recording', { uri: recording.uri, durationMs: recording.durationMs });
        setLastAnswer(null);
        setIsProcessing(true);
        try {
            const result = await processRecording(recording.uri, userId, currentStore?.id ?? null, recording.durationMs);
            devLog('[Voice] result', {
                queued: result.queued,
                queuedReason: result.queuedReason,
                applied: result.applied,
                transcript: result.transcript,
                error: result.error,
            });

            if (result.queued) {
                setLastStatus('success');
                setLastAnswer(result.queuedReason === 'offline'
                    ? `Offline: command saved and will be processed when online${result.error ? ` (${result.error})` : ''}`
                    : `Server busy: command saved and will be retried${result.error ? ` (${result.error})` : ''}`);
                return;
            }

            const answers = await commandExecutor.execute(result);

            const isUnrecognized = (!result.actions || result.actions.length === 0 || result.actions.some(a => a.intent === 'UNKNOWN')) && answers.length === 0 && result.applied === 0;

            if (result.error || isUnrecognized) {
                setLastStatus('error');
            } else if (result.applied > 0 || answers.length > 0) {
                setLastStatus('success');
            } else {
                setLastStatus(result.transcript ? 'success' : 'error');
            }

            if (answers.length > 0) {
                setLastAnswer(answers.map(answer => answer.text).join(' • '));
            } else if (result.error) {
                setLastAnswer(result.error);
            } else if (result.transcript) {
                setLastAnswer(result.applied > 0 ? `Recorded: ${result.transcript}` : `Heard: ${result.transcript}`);
            }
        } catch (err) {
            setLastStatus('error');
            setLastAnswer('Could not process command.');
        } finally {
            processingRef.current = false;
            await refreshPendingCount();
            setIsProcessing(false);
        }
    }, [commandExecutor, user?.id, isGuest, currentStore?.id, refreshPendingCount]);

    // Auto-dismiss the answer banner so it does not go stale
    useEffect(() => {
        if (!lastAnswer) return;
        const timer = setTimeout(() => setLastAnswer(null), 8000);
        return () => clearTimeout(timer);
    }, [lastAnswer]);

    // Stable callback for the loop
    const onWakeWordDetected = useCallback(() => {
        devLog('VoiceContext: Wake Word Triggered!');
        setLastStatus('idle');
        setIsListening(true);

        adapter.stopWakeWordListener().then(() => {
            adapter.startCommandListener(
                async (recording) => {
                    setIsListening(false);
                    await handleRecording(recording);

                    adapter.startWakeWordListener(onWakeWordDetected);
                },
                () => {
                    devWarn('VoiceContext: Verification Failed');
                    setLastStatus('error');
                    setIsListening(false);
                    adapter.startWakeWordListener(onWakeWordDetected);
                }
            );
        });
    }, [adapter, handleRecording]);

    // -------------------------------------------------------------------------
    // MANUAL LISTENING MODE (PUSH-TO-TALK)
    // -------------------------------------------------------------------------
    const toggleListening = useCallback(async () => {
        if (isListening) {
            devLog('[VoiceContext] Stopping Manual Listening...');
            await adapter.stopCommandListener();
            setIsListening(false);
            return;
        }

        if (processingRef.current) {
            devWarn('[VoiceContext] Still processing the previous command');
            return;
        }

        devLog('[VoiceContext] Manual Listening Triggered');
        setLastStatus('idle');
        setIsListening(true);

        adapter.startCommandListener(
            async (recording) => {
                setIsListening(false);
                await handleRecording(recording);
            },
            () => {
                devWarn('VoiceContext: Verification/Recognition Failed');
                setLastStatus('error');
                setIsListening(false);
            }
        );
    }, [isListening, adapter, handleRecording]);

    // Release the microphone when the account/session changes (sign-out/sign-in)
    useEffect(() => {
        setIsListening(false);
        setIsProcessing(false);
        setLastAnswer(null);
        void adapter.cancelCommandListener();
    }, [adapter, user?.id, isGuest]);

    // Cleanup on unmount
    useEffect(() => {
        const initVoice = async () => {
            try {
                await adapter.init();
            } catch (e) {
                console.error('[VoiceContext] Failed to initialize voice adapter:', e);
            }
        };

        initVoice();

        return () => {
            setIsListening(false);
            void adapter.cancelCommandListener();
            void adapter.stopWakeWordListener();
        };
    }, [adapter]); // Only init once

    // Retry queued recordings once the user session is ready
    useEffect(() => {
        if (!user?.id) return;
        let cancelled = false;

        const flushUserId = user.id;
        void (async () => {
            try {
                const results = await flushPendingRecordings(flushUserId);
                if (cancelled) return;
                await applyResults(results, flushUserId);
            } catch (e) {
                console.error('[VoiceContext] Failed to flush queued recordings:', e);
            } finally {
                if (!cancelled) void refreshPendingCount();
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [user?.id, applyResults, refreshPendingCount]);

    // Retry queued recordings when the app returns to the foreground
    useEffect(() => {
        if (!user?.id) return;
        const flushUserId = user.id;
        const subscription = AppState.addEventListener('change', (state) => {
            if (state !== 'active') return;
            void (async () => {
                try {
                    const results = await flushPendingRecordings(flushUserId);
                    await applyResults(results, flushUserId);
                } catch {
                    // Retried again on the next foreground/session change
                } finally {
                    void refreshPendingCount();
                }
            })();
        });

        return () => subscription.remove();
    }, [user?.id, applyResults, refreshPendingCount]);

    return (
        <VoiceContext.Provider value={{ isListening, isProcessing, pendingCount, toggleListening, retryPending, lastAnswer, lastStatus }}>
            {children}
        </VoiceContext.Provider>
    );
};

export const useVoice = () => {
    const context = useContext(VoiceContext);
    if (!context) throw new Error('useVoice must be used within VoiceProvider');
    return context;
};
