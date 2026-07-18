import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { radius, space, typography, useTheme } from '../lib/theme';
import { Button } from './Button';

export interface LockScreenProps {
  readonly onUnlock: () => void;
}

export function LockScreen({ onUnlock }: LockScreenProps) {
  const theme = useTheme();
  const [error, setError] = useState<string | null>(null);

  const attemptUnlock = async (): Promise<void> => {
    setError(null);
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock your check-in data',
    });
    if (result.success) {
      onUnlock();
    } else if (result.error !== 'user_cancel' && result.error !== 'app_cancel') {
      setError("Couldn't verify — try again.");
    }
  };

  useEffect(() => {
    attemptUnlock().catch(() => {
      setError("Couldn't verify — try again.");
    });
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.iconWrap, { backgroundColor: theme.surfaceMuted }]}>
        <Ionicons name="lock-closed" size={32} color={theme.accent} />
      </View>
      <Text style={[typography.cardTitle, styles.title, { color: theme.text }]}>
        This is private, on this device.
      </Text>
      {error !== null ? <Text style={[typography.body, { color: theme.bad }]}>{error}</Text> : null}
      <Button
        label="Unlock"
        onPress={() => {
          attemptUnlock().catch(() => {
            setError("Couldn't verify — try again.");
          });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xxl,
    gap: space.lg,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    textAlign: 'center',
  },
});
