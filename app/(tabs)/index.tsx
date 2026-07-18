import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { computeStreak, loadEntries, todayIsoDate } from '../../lib/storage';
import { useTheme } from '../../lib/theme';
import type { DayEntry } from '../../lib/types';

export default function Today() {
  const theme = useTheme();
  const [entry, setEntry] = useState<DayEntry | undefined>(undefined);
  const [streak, setStreak] = useState(0);

  const refresh = useCallback((): void => {
    loadEntries()
      .then((entries) => {
        const today = todayIsoDate();
        setEntry(entries[today]);
        setStreak(computeStreak(entries, today));
      })
      .catch(() => undefined);
  }, []);

  useFocusEffect(refresh);

  const morningDone = entry?.morning !== undefined;
  const eveningDone = entry?.evening !== undefined;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Text style={[styles.streak, { color: theme.text }]}>
        {streak > 0 ? `${String(streak)} day streak` : 'Start your streak today'}
      </Text>
      <Text style={[styles.subtitle, { color: theme.textMuted }]}>
        Private, on this device. Log this and discuss trends with your provider.
      </Text>

      <SessionCard
        title="Morning check-in"
        done={morningDone}
        onPress={() => {
          router.push({ pathname: '/checkin', params: { session: 'morning' } });
        }}
      />
      <SessionCard
        title="Evening check-in"
        done={eveningDone}
        onPress={() => {
          router.push({ pathname: '/checkin', params: { session: 'evening' } });
        }}
      />
    </View>
  );
}

function SessionCard({
  title,
  done,
  onPress,
}: {
  readonly title: string;
  readonly done: boolean;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
    >
      <Text style={[styles.cardTitle, { color: theme.text }]}>{title}</Text>
      <Text style={{ color: done ? theme.good : theme.textMuted }}>
        {done ? 'Done — tap to edit' : 'Not logged yet'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  streak: {
    fontSize: 26,
    fontWeight: '700',
    marginTop: 12,
  },
  subtitle: {
    fontSize: 13,
    marginTop: 6,
    marginBottom: 24,
  },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 18,
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 6,
  },
});
