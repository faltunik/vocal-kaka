import { useAuth } from '@/services/AuthContext';
import { useRecentActivity } from '@/services/RecentActivityContext';
import { VoiceAnswer, VoiceCommandResult } from '@/services/voice/VoiceCommandService';
import { useRef } from 'react';

/**
 * Consumes a server-processed voice command. The ledger rows already exist
 * server-side (process-recording inserted them), so this only refreshes the
 * feed and returns query answers — no optimistic rows are added, which avoids
 * unit-mismatched duplicates (spoken "bori" vs stored "kg").
 */
export const useCommandExecutor = () => {
    const { user, isGuest } = useAuth();
    const { refresh } = useRecentActivity();
    const processingRef = useRef(false);

    // Latest identity, kept current across renders so stale `execute` closures
    // (e.g. a recording started before sign-out) can detect account changes
    const identityRef = useRef<{ userId: string | null; isGuest: boolean }>({
        userId: user?.id ?? null,
        isGuest,
    });
    identityRef.current = { userId: user?.id ?? null, isGuest };

    const execute = async (result: VoiceCommandResult): Promise<VoiceAnswer[]> => {
        if (!user?.id && !isGuest) {
            console.warn('[useCommandExecutor] No user logged in');
            return [];
        }

        if (processingRef.current) {
            console.warn('[useCommandExecutor] Already processing a command, ignoring');
            return [];
        }

        if (result.queued) return [];

        const capturedUserId = user?.id ?? null;
        const capturedIsGuest = isGuest;

        processingRef.current = true;
        try {
            const latest = identityRef.current;
            if (latest.userId !== capturedUserId || latest.isGuest !== capturedIsGuest) {
                console.warn('[useCommandExecutor] Account changed before processing, aborting command');
                return [];
            }

            if (result.applied > 0) {
                refresh();
            }

            return result.answers ?? [];
        } finally {
            processingRef.current = false;
        }
    };

    return { execute };
};
