import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Card } from '../../components/Card';
import { loadEntries } from '../../lib/storage';
import { radius, space, typography, useTheme } from '../../lib/theme';
import type { DayEntry, IsoDate } from '../../lib/types';

export default function History() {
  const theme = useTheme();
  const [days, setDays] = useState<readonly DayEntry[]>([]);

  const refresh = useCallback((): void => {
    loadEntries()
      .then((entries) => {
        const sorted = Object.values(entries).sort((a, b) => b.date.localeCompare(a.date));
        setDays(sorted);
      })
      .catch(() => undefined);
  }, []);

  useFocusEffect(refresh);

  if (days.length === 0) {
    return (
      <View style={[styles.empty, { backgroundColor: theme.background }]}>
        <Text style={[typography.body, { color: theme.textMuted }]}>No check-ins logged yet.</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      data={days}
      keyExtractor={(day) => day.date}
      renderItem={({ item }) => <HistoryRow day={item} />}
    />
  );
}

function Badge({ label, on }: { readonly label: string; readonly on: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.badge, { backgroundColor: on ? theme.accentSoft : theme.surfaceMuted }]}>
      <Text style={[typography.caption, { color: on ? theme.accent : theme.textMuted }]}>
        {label}
      </Text>
    </View>
  );
}

function HistoryRow({ day }: { readonly day: DayEntry }) {
  const theme = useTheme();
  const onPress = (): void => {
    const date: IsoDate = day.date;
    router.push({ pathname: '/entry/[date]', params: { date } });
  };

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.rowPress}>
      <Card style={styles.row}>
        <Text style={[typography.bodyStrong, { color: theme.text }]}>{day.date}</Text>
        <View style={styles.badges}>
          <Badge label="AM" on={day.morning !== undefined} />
          <Badge label="PM" on={day.evening !== undefined} />
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: space.xl,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowPress: {
    marginBottom: space.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badges: {
    flexDirection: 'row',
    gap: space.sm,
  },
  badge: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
  },
});
