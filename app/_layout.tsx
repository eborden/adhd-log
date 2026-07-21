import { useCallback, useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { Stack, router } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { EventSubscription } from 'expo-modules-core';
import { useFonts } from 'expo-font';
import { Fraunces_700Bold, Fraunces_800ExtraBold } from '@expo-google-fonts/fraunces';
import { LockScreen } from '../components/LockScreen';
import { addNotificationTapListener, configureNotificationHandler } from '../lib/notifications';
import { loadProfile } from '../lib/storage';
import { typography, useTheme } from '../lib/theme';

type LockState = 'loading' | 'locked' | 'unlocked';

export default function RootLayout() {
  const theme = useTheme();
  const [lockState, setLockState] = useState<LockState>('loading');
  const [fontsLoaded] = useFonts({ Fraunces_700Bold, Fraunces_800ExtraBold });

  const evaluateLock = useCallback(async (): Promise<void> => {
    const profile = await loadProfile();
    setLockState(profile?.lockEnabled === true ? 'locked' : 'unlocked');
  }, []);

  useEffect(() => {
    evaluateLock().catch(() => {
      setLockState('unlocked');
    });
  }, [evaluateLock]);

  useEffect(() => {
    const onChange = (status: AppStateStatus): void => {
      if (status === 'active') {
        evaluateLock().catch(() => undefined);
      }
    };
    const subscription = AppState.addEventListener('change', onChange);
    return () => {
      subscription.remove();
    };
  }, [evaluateLock]);

  useEffect(() => {
    let cancelled = false;
    let subscription: EventSubscription | null = null;

    configureNotificationHandler().catch(() => undefined);
    addNotificationTapListener((session) => {
      router.push({ pathname: '/checkin', params: { session } });
    })
      .then((sub) => {
        if (cancelled) {
          sub?.remove();
        } else {
          subscription = sub;
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);

  if (lockState === 'loading' || !fontsLoaded) {
    return null;
  }

  if (lockState === 'locked') {
    return (
      <SafeAreaProvider>
        <LockScreen
          onUnlock={() => {
            setLockState('unlocked');
          }}
        />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.surface },
          headerShadowVisible: false,
          headerTintColor: theme.text,
          headerTitleStyle: typography.cardTitle,
          contentStyle: { backgroundColor: theme.background },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="checkin" options={{ presentation: 'modal', title: 'Check-in' }} />
        <Stack.Screen name="entry/[date]" options={{ title: 'Entry' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
