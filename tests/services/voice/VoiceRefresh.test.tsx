import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { VoiceProvider, useVoice } from '@/services/voice/VoiceContext';
import type { IVoiceProvider, RecordedAudio } from '@/services/voice/interfaces';
import type { VoiceCommandResult } from '@/services/voice/VoiceCommandService';

let mockUser: { id: string } | null = { id: 'u1' };
let mockOnRecording: ((recording: RecordedAudio) => void) | null = null;

const mockExecute = jest.fn();
const mockFlush = jest.fn();
const mockProcessRecording = jest.fn();
const mockRefreshFeed = jest.fn();
const mockRefreshInventory = jest.fn();

const mockAdapter: IVoiceProvider = {
    init: jest.fn().mockResolvedValue(undefined),
    startWakeWordListener: jest.fn().mockResolvedValue(undefined),
    stopWakeWordListener: jest.fn().mockResolvedValue(undefined),
    startCommandListener: jest.fn(async (onRecording: (recording: RecordedAudio) => void) => {
        mockOnRecording = onRecording;
    }),
    stopCommandListener: jest.fn().mockResolvedValue(undefined),
    cancelCommandListener: jest.fn().mockResolvedValue(undefined),
};

jest.mock('@/services/AuthContext', () => ({
    useAuth: () => ({ user: mockUser, isGuest: false }),
}));

jest.mock('@/services/StoreContext', () => ({
    useStore: () => ({ currentStore: { id: 'store-1' } }),
}));

// VoiceProvider is normally nested inside RecentActivityProvider; the feed
// refresh and the inventory broadcast are the observable side effects here.
jest.mock('@/services/RecentActivityContext', () => ({
    useRecentActivity: () => ({ refresh: () => mockRefreshFeed() }),
}));

jest.mock('@/hooks/useInventory', () => ({
    refreshInventory: () => mockRefreshInventory(),
}));

jest.mock('@/hooks/useCommandExecutor', () => ({
    useCommandExecutor: () => ({ execute: (...args: unknown[]) => mockExecute(...args) }),
}));

jest.mock('@/services/voice/VoiceCommandService', () => ({
    processRecording: (...args: unknown[]) => mockProcessRecording(...args),
    pendingRecordingCount: jest.fn().mockResolvedValue(0),
    flushPendingRecordings: (...args: unknown[]) => mockFlush(...args),
}));

jest.mock('@/services/voice/adapters/VoiceAdapter', () => ({
    VoiceAdapter: jest.fn(() => mockAdapter),
}));

const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(VoiceProvider, null, children);

function appliedResult(overrides: Partial<VoiceCommandResult> = {}): VoiceCommandResult {
    return {
        transcript: 'do kilo sugar becha',
        actions: [{ intent: 'SALE', item: 'Sugar', quantity: 2, unit: 'kg', amount: 80 }],
        applied: 1,
        answers: [],
        ...overrides,
    };
}

async function runManualRecording(
    result: ReturnType<typeof useVoice>,
    recording: RecordedAudio = { uri: 'file:///recording.m4a', durationMs: 1200 }
) {
    await act(async () => {
        await result.toggleListening();
    });
    expect(mockOnRecording).not.toBeNull();
    await act(async () => {
        await mockOnRecording!(recording);
    });
}

describe('VoiceContext post-apply refresh', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUser = { id: 'u1' };
        mockOnRecording = null;
        mockExecute.mockResolvedValue([]);
        mockFlush.mockResolvedValue([]);
    });

    it('refreshes the feed and inventory once when a flush applies a result', async () => {
        mockFlush.mockResolvedValue([appliedResult()]);

        renderHook(() => useVoice(), { wrapper });

        await waitFor(() => expect(mockRefreshFeed).toHaveBeenCalledTimes(1));
        expect(mockRefreshInventory).toHaveBeenCalledTimes(1);
    });

    it('refreshes the feed and inventory once after a manual applied command', async () => {
        mockProcessRecording.mockResolvedValue(appliedResult());
        mockExecute.mockResolvedValue([{ intent: 'SALE', text: 'Recorded 2 kg Sugar' }]);

        const { result } = renderHook(() => useVoice(), { wrapper });
        await waitFor(() => expect(mockFlush).toHaveBeenCalled());
        await runManualRecording(result.current);

        expect(mockRefreshFeed).toHaveBeenCalledTimes(1);
        expect(mockRefreshInventory).toHaveBeenCalledTimes(1);
    });

    it('does not refresh for results that were only queued offline', async () => {
        mockFlush.mockResolvedValue([{
            transcript: '',
            actions: [],
            applied: 0,
            answers: [],
            queued: true,
            queuedReason: 'offline',
        }]);

        renderHook(() => useVoice(), { wrapper });

        await waitFor(() => expect(mockExecute).toHaveBeenCalledTimes(1));
        expect(mockRefreshFeed).not.toHaveBeenCalled();
        expect(mockRefreshInventory).not.toHaveBeenCalled();
    });

    it('does not refresh when a manual recording is queued for later sync', async () => {
        mockProcessRecording.mockResolvedValue({
            transcript: '',
            actions: [],
            applied: 0,
            answers: [],
            queued: true,
            queuedReason: 'offline',
        });

        const { result } = renderHook(() => useVoice(), { wrapper });
        await waitFor(() => expect(mockFlush).toHaveBeenCalled());
        await runManualRecording(result.current);

        expect(mockExecute).not.toHaveBeenCalled();
        expect(result.current.lastAnswer).toContain('Offline: command saved');
        expect(mockRefreshFeed).not.toHaveBeenCalled();
        expect(mockRefreshInventory).not.toHaveBeenCalled();
    });

    it('does not refresh when the account changed before the flush resolved', async () => {
        const resolvers: Array<(value: VoiceCommandResult[]) => void> = [];
        mockFlush.mockImplementation(() => new Promise(resolve => { resolvers.push(resolve); }));

        const { rerender } = renderHook(() => useVoice(), { wrapper });
        await waitFor(() => expect(mockFlush).toHaveBeenCalled());
        expect(resolvers.length).toBeGreaterThanOrEqual(1);

        // Sign out/in before the flush resolves
        mockUser = { id: 'u2' };
        rerender({});

        await act(async () => {
            resolvers[0]([appliedResult()]);
            await Promise.resolve();
        });

        expect(mockExecute).not.toHaveBeenCalled();
        expect(mockRefreshFeed).not.toHaveBeenCalled();
        expect(mockRefreshInventory).not.toHaveBeenCalled();
    });

    it('does not refresh after the provider unmounted', async () => {
        const resolvers: Array<(value: VoiceCommandResult[]) => void> = [];
        mockFlush.mockImplementation(() => new Promise(resolve => { resolvers.push(resolve); }));

        const { unmount } = renderHook(() => useVoice(), { wrapper });
        await waitFor(() => expect(mockFlush).toHaveBeenCalled());
        unmount();

        await act(async () => {
            resolvers[0]([appliedResult()]);
            await Promise.resolve();
        });

        expect(mockRefreshFeed).not.toHaveBeenCalled();
        expect(mockRefreshInventory).not.toHaveBeenCalled();
    });

    it('surfaces the UNKNOWN clarification answer even if the executor drops it', async () => {
        const hint = 'Kharida ya becha? Boliye: "do kilo tamatar kharida" ya "do kilo tamatar becha".';
        mockProcessRecording.mockResolvedValue({
            transcript: 'do kilo tamatar',
            actions: [{ intent: 'UNKNOWN', original_text: 'do kilo tamatar' }],
            applied: 0,
            answers: [{ intent: 'UNKNOWN', text: hint }],
        });
        mockExecute.mockResolvedValue([]);

        const { result } = renderHook(() => useVoice(), { wrapper });
        await waitFor(() => expect(mockFlush).toHaveBeenCalled());
        await runManualRecording(result.current);

        expect(result.current.lastAnswer).toBe(hint);
        expect(result.current.lastStatus).toBe('success');
        expect(mockRefreshFeed).not.toHaveBeenCalled();
        expect(mockRefreshInventory).not.toHaveBeenCalled();
    });
});
