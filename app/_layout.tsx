import { useCallback, useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { Stack, router } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LockScreen } from '../components/LockScreen';
import { addNotificationTapListener, configureNotificationHandler } from '../lib/notifications';
import { loadProfile } from '../lib/storage';

type LockState = 'loading' | 'locked' | 'unlocked';

export default function RootLayout() {
  const [lockState, setLockState] = useState<LockState>('loading');

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
    configureNotificationHandler();
    const subscription = addNotificationTapListener((session) => {
      router.push({ pathname: '/checkin', params: { session } });
    });
    return () => {
      subscription.remove();
    };
  }, []);

  if (lockState === 'loading') {
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
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="checkin" options={{ presentation: 'modal', title: 'Check-in' }} />
        <Stack.Screen name="entry/[date]" options={{ title: 'Entry' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
