import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { VoiceProvider, useVoice } from '@/services/voice/VoiceContext';

let mockUser: { id: string } | null = { id: 'u1' };
const mockExecute = jest.fn().mockResolvedValue([]);
const mockFlush = jest.fn();
const resolvers: Array<(value: unknown) => void> = [];

jest.mock('@/services/AuthContext', () => ({
    useAuth: () => ({ user: mockUser, isGuest: false }),
}));

jest.mock('@/services/StoreContext', () => ({
    useStore: () => ({ currentStore: { id: 'store-1' } }),
}));

jest.mock('@/hooks/useCommandExecutor', () => ({
    useCommandExecutor: () => ({ execute: mockExecute }),
}));

jest.mock('@/services/voice/VoiceCommandService', () => ({
    processRecording: jest.fn(),
    pendingRecordingCount: jest.fn().mockResolvedValue(0),
    flushPendingRecordings: (...args: unknown[]) => mockFlush(...args),
}));

jest.mock('@/services/voice/adapters/VoiceAdapter', () => ({
    VoiceAdapter: class {
        init = jest.fn().mockResolvedValue(undefined);
        cancelCommandListener = jest.fn().mockResolvedValue(undefined);
        stopWakeWordListener = jest.fn().mockResolvedValue(undefined);
        startWakeWordListener = jest.fn();
        startCommandListener = jest.fn();
        stopCommandListener = jest.fn();
    },
}));

const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(VoiceProvider, null, children);

describe('VoiceContext flush account guard', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resolvers.length = 0;
        mockUser = { id: 'u1' };
        mockFlush.mockImplementation(() => new Promise(resolve => { resolvers.push(resolve); }));
    });

    it('never applies flush results to a different account', async () => {
        const { rerender } = renderHook(() => useVoice(), { wrapper });
        await waitFor(() => expect(mockFlush).toHaveBeenCalled());
        expect(resolvers.length).toBeGreaterThanOrEqual(1);

        // Sign out/in before the flush resolves
        mockUser = { id: 'u2' };
        rerender({});

        await act(async () => {
            resolvers[0]([{ transcript: 'old', actions: [], applied: 1, answers: [{ intent: 'X', text: 'old answer' }] }]);
            await Promise.resolve();
        });

        expect(mockExecute).not.toHaveBeenCalled();
    });
});
