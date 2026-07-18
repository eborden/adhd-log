import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { loadEntries } from '../../lib/storage';
import { useTheme } from '../../lib/theme';
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
        <Text style={{ color: theme.textMuted }}>No check-ins logged yet.</Text>
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

function HistoryRow({ day }: { readonly day: DayEntry }) {
  const theme = useTheme();
  const onPress = (): void => {
    const date: IsoDate = day.date;
    router.push({ pathname: '/entry/[date]', params: { date } });
  };

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.row, { borderColor: theme.border, backgroundColor: theme.surface }]}
    >
      <Text style={[styles.date, { color: theme.text }]}>{day.date}</Text>
      <View style={styles.badges}>
        <Text style={{ color: day.morning !== undefined ? theme.good : theme.textMuted }}>AM</Text>
        <Text style={{ color: day.evening !== undefined ? theme.good : theme.textMuted }}>PM</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  date: {
    fontSize: 15,
    fontWeight: '600',
  },
  badges: {
    flexDirection: 'row',
    gap: 12,
  },
});
