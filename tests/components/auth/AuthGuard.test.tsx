import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { useAuth } from '@/services/AuthContext';
import { useRouter, useSegments } from 'expo-router';
import { Text } from 'react-native';

// Mock dependencies
jest.mock('@/services/AuthContext');

describe('AuthGuard', () => {
    const mockReplace = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        (useRouter as jest.Mock).mockReturnValue({ replace: mockReplace });
    });

    it('should show a loading state while auth is resolving', () => {
        (useAuth as jest.Mock).mockReturnValue({ session: null, user: null, isGuest: false, isLoading: true });
        (useSegments as jest.Mock).mockReturnValue([]);

        const { getByText, queryByText } = render(
            <AuthGuard>
                <Text>Protected Content</Text>
            </AuthGuard>
        );

        expect(getByText('Loading...')).toBeTruthy();
        expect(queryByText('Protected Content')).toBeNull();
        expect(mockReplace).not.toHaveBeenCalled();
    });

    it('should redirect to login if not authenticated and not in auth group', async () => {
        (useAuth as jest.Mock).mockReturnValue({ session: null, user: null, isGuest: false, isLoading: false });
        (useSegments as jest.Mock).mockReturnValue(['index']);

        const { queryByText } = render(
            <AuthGuard>
                <Text>Protected Content</Text>
            </AuthGuard>
        );

        await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
        expect(queryByText('Protected Content')).toBeNull();
    });

    it('should redirect authenticated users away from the login screen', async () => {
        (useAuth as jest.Mock).mockReturnValue({
            session: { user: { id: '1' } },
            user: { id: '1' },
            isGuest: false,
            isLoading: false
        });
        (useSegments as jest.Mock).mockReturnValue(['login']);

        render(
            <AuthGuard>
                <Text>Login Page</Text>
            </AuthGuard>
        );

        await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    });

    it('should allow guests through protected routes', () => {
        (useAuth as jest.Mock).mockReturnValue({ session: null, user: null, isGuest: true, isLoading: false });
        (useSegments as jest.Mock).mockReturnValue(['index']);

        const { getByText } = render(
            <AuthGuard>
                <Text>Protected Content</Text>
            </AuthGuard>
        );

        expect(getByText('Protected Content')).toBeTruthy();
        expect(mockReplace).not.toHaveBeenCalled();
    });

    it('should render children if authenticated and in protected route', () => {
        (useAuth as jest.Mock).mockReturnValue({
            session: { user: { id: '1' } },
            user: { id: '1' },
            isGuest: false,
            isLoading: false
        });
        (useSegments as jest.Mock).mockReturnValue(['index']);

        const { getByText } = render(
            <AuthGuard>
                <Text>Protected Content</Text>
            </AuthGuard>
        );

        expect(getByText('Protected Content')).toBeTruthy();
        expect(mockReplace).not.toHaveBeenCalled();
    });
});
