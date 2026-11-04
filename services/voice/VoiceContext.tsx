import { useCommandExecutor } from '@/hooks/useCommandExecutor';
import { refreshInventory } from '@/hooks/useInventory';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../AuthContext';
import { useRecentActivity } from '../RecentActivityContext';
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

const noop = () => {};

/**
 * The recent-activity provider owns the Home feed and is always mounted in the
 * app shell. VoiceProvider must still work when rendered in isolation (tests
 * or previews), so a missing provider degrades to a no-op refresh rather than
 * crashing the whole screen.
 */
function useRecentActivityRefresh(): () => void {
    try {
        return useRecentActivity().refresh;
    } catch {
        return noop;
    }
}

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

    const refreshRecentActivity = useRecentActivityRefresh();
    // The context recreates `refresh` on each provider render; keep it in a ref
    // so `applyResults` stays stable and the flush effects do not re-run.
    const refreshRecentActivityRef = useRef(refreshRecentActivity);
    refreshRecentActivityRef.current = refreshRecentActivity;

    // Latest account, so async flushes can detect a sign-out/sign-in
    const userRef = useRef(user);
    userRef.current = user;
    // Synchronous guard against overlapping recordings (state updates lag)
    const processingRef = useRef(false);
    // Async flushes must not touch state or caches after the provider unmounts
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    /**
     * Refreshes the ledger-derived views the app caches locally after a
     * server-applied command: the Home feed and every mounted inventory query.
     * The edge function writes inventory/events server-side, so nothing local
     * knows to refetch; without this both keep showing pre-command data until
     * the next focus.
     */
    const refreshLedgerViews = useCallback((expectedUserId?: string) => {
        if (!mountedRef.current) return;

        const activeUserId = userRef.current?.id;
        // Guest actions are never persisted, and queued results never applied.
        if (!activeUserId || activeUserId === GUEST_USER_ID) return;
        if (expectedUserId && activeUserId !== expectedUserId) {
            devWarn('[Voice] Skipping ledger refresh: account changed');
            return;
        }

        refreshRecentActivityRef.current();
        refreshInventory();
    }, []);

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
        if (!mountedRef.current) return;
        if (expectedUserId && userRef.current?.id !== expectedUserId) {
            devWarn('[Voice] Discarding flush results: account changed');
            return;
        }
        const answerTexts: string[] = [];
        let appliedCount = 0;
        for (const result of results) {
            const answers = await executorRef.current.execute(result);
            // A server clarification (e.g. the UNKNOWN "kharida ya becha?"
            // hint) must surface even if the executor short-circuits.
            const surfacedAnswers = answers.length > 0 ? answers : (result.answers ?? []);
            answerTexts.push(...surfacedAnswers.map(answer => answer.text));
            if (!result.queued && result.applied > 0) {
                appliedCount += result.applied;
            }
        }

        // A sign-out/sign-in during the loop must not post another account's
        // answers or refresh its views.
        if (expectedUserId && userRef.current?.id !== expectedUserId) {
            devWarn('[Voice] Discarding flush answers: account changed');
            return;
        }
        if (!mountedRef.current) return;

        setLastAnswer(answerTexts.length > 0
            ? answerTexts.join(' • ')
            : `Processed ${results.length} offline command${results.length === 1 ? '' : 's'}`);

        // Only results that actually wrote to the ledger invalidate views;
        // queued/offline results stay untouched until a later flush applies them.
        if (appliedCount > 0) {
            refreshLedgerViews(expectedUserId);
        }
    }, [refreshLedgerViews]);

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
            // Never drop a server clarification (e.g. the UNKNOWN "kharida ya
            // becha?" hint) just because the executor short-circuited.
            const surfacedAnswers = answers.length > 0 ? answers : (result.answers ?? []);

            // Report only to the account that recorded the command.
            if (!mountedRef.current) return;
            if (userRef.current?.id !== userId) {
                devWarn('[Voice] Discarding result: account changed');
                return;
            }

            const isUnrecognized = (!result.actions || result.actions.length === 0 || result.actions.some(a => a.intent === 'UNKNOWN')) && surfacedAnswers.length === 0 && result.applied === 0;

            if (result.error || isUnrecognized) {
                setLastStatus('error');
            } else if (result.applied > 0 || surfacedAnswers.length > 0) {
                setLastStatus('success');
            } else {
                setLastStatus(result.transcript ? 'success' : 'error');
            }

            if (surfacedAnswers.length > 0) {
                setLastAnswer(surfacedAnswers.map(answer => answer.text).join(' • '));
            } else if (result.error) {
                setLastAnswer(result.error);
            } else if (result.transcript) {
                setLastAnswer(result.applied > 0 ? `Recorded: ${result.transcript}` : `Heard: ${result.transcript}`);
            }

            // The ledger rows already exist server-side; refetch the feed,
            // catalog and stats so the Home screen reflects the command.
            if (result.applied > 0) {
                refreshLedgerViews(userId);
            }
        } catch (err) {
            setLastStatus('error');
            setLastAnswer('Could not process command.');
        } finally {
            processingRef.current = false;
            await refreshPendingCount();
            setIsProcessing(false);
        }
    }, [commandExecutor, user?.id, isGuest, currentStore?.id, refreshPendingCount, refreshLedgerViews]);

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
