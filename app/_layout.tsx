import React, { useEffect } from 'react';
import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { AuthGuard } from '@/components/auth/AuthGuard';
import { Colors } from '@/constants/Colors';
import { AuthProvider } from '@/services/AuthContext';
import { container } from '@/services/Container';
import { FeedbackService } from '@/services/FeedbackService';
import { PrivacyProvider } from '@/services/PrivacyContext';
import { RecentActivityProvider } from '@/services/RecentActivityContext';
import { StoreProvider } from '@/services/StoreContext';
import { VoiceProvider } from '@/services/voice/VoiceContext';

const CustomLightTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: Colors.light.background,
    card: Colors.light.card,
    text: Colors.light.text,
    border: Colors.light.border,
    primary: Colors.light.tint,
  }
}

export default function RootLayout() {
  useEffect(() => {
    void FeedbackService.init();
    // Flush counter/scanner events queued while offline (foreground + periodic)
    const stopOfflineFlush = container.inventoryService.startOfflineAutoFlush();
    return stopOfflineFlush;
  }, []);
  return (
    <AuthProvider>
      <StoreProvider>
        <PrivacyProvider>
          <RecentActivityProvider>
            <VoiceProvider>
              <ThemeProvider value={CustomLightTheme}>
                <AuthGuard>
                  <Stack screenOptions={{ headerShown: false }}>
                    <Stack.Screen name="index" />
                    <Stack.Screen name="login" />
                    <Stack.Screen name="+not-found" />
                  </Stack>
                  <StatusBar style="dark" />
                </AuthGuard>
              </ThemeProvider>
            </VoiceProvider>
          </RecentActivityProvider>
        </PrivacyProvider>
      </StoreProvider>
    </AuthProvider>
  );
}
