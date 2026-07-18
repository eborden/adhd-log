import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Card } from '../../components/Card';
import { useFocusLoad } from '../../hooks/useFocusLoad';
import { computeStreak, loadEntries, todayIsoDate } from '../../lib/storage';
import { radius, space, typography, useTheme } from '../../lib/theme';
import type { DayEntry, IsoDate } from '../../lib/types';

export default function Today() {
  const theme = useTheme();
  const { data: entries } = useFocusLoad<Readonly<Record<IsoDate, DayEntry>>>(loadEntries, {});
  const today = todayIsoDate();
  const entry = entries[today];
  const streak = computeStreak(entries, today);

  const morningDone = entry?.morning !== undefined;
  const eveningDone = entry?.evening !== undefined;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Text style={[typography.display, styles.streak, { color: theme.text }]}>
        {streak > 0 ? `${String(streak)}-day streak` : 'Start your streak'}
      </Text>
      <Text style={[typography.caption, styles.subtitle, { color: theme.textMuted }]}>
        Private, on this device. Log this and discuss trends with your provider.
      </Text>

      <SessionCard
        title="Morning check-in"
        icon="sunny-outline"
        done={morningDone}
        onPress={() => {
          router.push({ pathname: '/checkin', params: { session: 'morning' } });
        }}
      />
      <SessionCard
        title="Evening check-in"
        icon="moon-outline"
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
  icon,
  done,
  onPress,
}: {
  readonly title: string;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly done: boolean;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.cardPress}>
      <Card style={styles.cardRow}>
        <View style={[styles.iconWrap, { backgroundColor: theme.surfaceMuted }]}>
          <Ionicons name={icon} size={22} color={theme.accent} />
        </View>
        <View style={styles.cardText}>
          <Text style={[typography.cardTitle, { color: theme.text }]}>{title}</Text>
          <Text style={[typography.caption, { color: theme.textMuted }]}>
            {done ? 'Tap to edit' : 'Tap to log'}
          </Text>
        </View>
        <View
          style={[
            styles.statusPill,
            { backgroundColor: done ? theme.accentSoft : theme.surfaceMuted },
          ]}
        >
          <Text style={[typography.caption, { color: done ? theme.accent : theme.text }]}>
            {done ? 'Done' : 'To do'}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: space.xl,
  },
  streak: {
    marginTop: space.md,
  },
  subtitle: {
    marginTop: space.sm,
    marginBottom: space.xxl,
  },
  cardPress: {
    marginBottom: space.md,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: {
    flex: 1,
    gap: space.xs,
  },
  statusPill: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
  },
});
