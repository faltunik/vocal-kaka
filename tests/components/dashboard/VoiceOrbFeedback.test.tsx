import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { VoiceOrb } from '@/components/dashboard/VoiceOrb';
import { FeedbackService } from '@/services/FeedbackService';
import * as VoiceContextModule from '@/services/voice/VoiceContext';

jest.mock('@/services/FeedbackService', () => ({
    FeedbackService: {
        triggerRecordStart: jest.fn().mockResolvedValue(undefined),
        triggerRecordStop: jest.fn().mockResolvedValue(undefined),
        triggerSuccess: jest.fn().mockResolvedValue(undefined),
        triggerError: jest.fn().mockResolvedValue(undefined),
        playChime: jest.fn().mockResolvedValue(undefined),
    },
}));

describe('VoiceOrb Feedback Integration', () => {
    let mockToggleListening: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        mockToggleListening = jest.fn();
    });

    it('triggers haptic record start when microphone press initiates', () => {
        jest.spyOn(VoiceContextModule, 'useVoice').mockReturnValue({
            isListening: false,
            isProcessing: false,
            pendingCount: 0,
            toggleListening: mockToggleListening,
            retryPending: jest.fn(),
            lastAnswer: null,
            lastStatus: 'idle',
        });

        const { getByTestId } = render(<VoiceOrb />);
        const button = getByTestId('voice-orb-button');

        fireEvent(button, 'pressIn');
        expect(FeedbackService.triggerRecordStart).toHaveBeenCalledTimes(1);

        fireEvent.press(button);
        expect(mockToggleListening).toHaveBeenCalledTimes(1);
    });

    it('triggers haptic record stop when microphone press stops an active recording', () => {
        jest.spyOn(VoiceContextModule, 'useVoice').mockReturnValue({
            isListening: true,
            isProcessing: false,
            pendingCount: 0,
            toggleListening: mockToggleListening,
            retryPending: jest.fn(),
            lastAnswer: null,
            lastStatus: 'idle',
        });

        const { getByTestId } = render(<VoiceOrb />);
        const button = getByTestId('voice-orb-button');

        fireEvent.press(button);
        expect(FeedbackService.triggerRecordStop).toHaveBeenCalledTimes(1);
        expect(mockToggleListening).toHaveBeenCalledTimes(1);
    });

    it('triggers success haptic and chime when voice transaction is successfully processed', () => {
        let currentStatus: VoiceContextModule.VoiceTransactionStatus | null = 'idle';
        const useVoiceSpy = jest.spyOn(VoiceContextModule, 'useVoice').mockImplementation(() => ({
            isListening: false,
            isProcessing: false,
            pendingCount: 0,
            toggleListening: mockToggleListening,
            retryPending: jest.fn(),
            lastAnswer: 'Recorded: 2 Amul Gold',
            lastStatus: currentStatus,
        }));

        const { rerender } = render(<VoiceOrb />);

        // Transaction succeeds
        act(() => {
            currentStatus = 'success';
            rerender(<VoiceOrb />);
        });

        expect(FeedbackService.triggerSuccess).toHaveBeenCalledTimes(1);
        expect(FeedbackService.playChime).toHaveBeenCalledWith('applied');

        useVoiceSpy.mockRestore();
    });

    it('triggers error haptic and chime when voice processing fails or unrecognized', () => {
        let currentStatus: VoiceContextModule.VoiceTransactionStatus | null = 'idle';
        const useVoiceSpy = jest.spyOn(VoiceContextModule, 'useVoice').mockImplementation(() => ({
            isListening: false,
            isProcessing: false,
            pendingCount: 0,
            toggleListening: mockToggleListening,
            retryPending: jest.fn(),
            lastAnswer: 'Unrecognized: "hello world"',
            lastStatus: currentStatus,
        }));

        const { rerender } = render(<VoiceOrb />);

        // Transaction fails / unrecognized
        act(() => {
            currentStatus = 'error';
            rerender(<VoiceOrb />);
        });

        expect(FeedbackService.triggerError).toHaveBeenCalledTimes(1);
        expect(FeedbackService.playChime).toHaveBeenCalledWith('error');

        useVoiceSpy.mockRestore();
    });

    it('uses resilient fallback via lastAnswer when lastStatus is not provided in context', () => {
        let isProcessing = true;
        let lastAnswer: string | null = null;

        const useVoiceSpy = jest.spyOn(VoiceContextModule, 'useVoice').mockImplementation(() => ({
            isListening: false,
            isProcessing,
            pendingCount: 0,
            toggleListening: mockToggleListening,
            retryPending: jest.fn(),
            lastAnswer,
            lastStatus: undefined,
        }));

        const { rerender } = render(<VoiceOrb />);

        // Processing completes with recognized items
        act(() => {
            isProcessing = false;
            lastAnswer = 'Recorded: 5 Milk';
            rerender(<VoiceOrb />);
        });

        expect(FeedbackService.triggerSuccess).toHaveBeenCalledTimes(1);
        expect(FeedbackService.playChime).toHaveBeenCalledWith('applied');

        useVoiceSpy.mockRestore();
    });
});
