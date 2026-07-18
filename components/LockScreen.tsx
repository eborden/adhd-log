import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { useTheme } from '../lib/theme';

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
      <Text style={[styles.title, { color: theme.text }]}>This is private, on this device.</Text>
      {error !== null ? <Text style={[styles.error, { color: theme.bad }]}>{error}</Text> : null}
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          attemptUnlock().catch(() => {
            setError("Couldn't verify — try again.");
          });
        }}
        style={[styles.button, { backgroundColor: theme.accent }]}
      >
        <Text style={styles.buttonText}>Unlock</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  error: {
    fontSize: 14,
  },
  button: {
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
