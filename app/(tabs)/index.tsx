import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Card } from '../../components/Card';
import { useFocusLoad } from '../../hooks/useFocusLoad';
import { WEEKLY_IMPRESSION_LABELS } from '../../lib/schema';
import {
  computeStreak,
  lastCompletedWeekStart,
  loadEntries,
  loadWeekly,
  todayIsoDate,
} from '../../lib/storage';
import { radius, space, typography, useTheme } from '../../lib/theme';
import type { DayEntry, IsoDate, WeeklyCheckin } from '../../lib/types';

interface TodayData {
  readonly entries: Readonly<Record<IsoDate, DayEntry>>;
  readonly weekly: Readonly<Record<IsoDate, WeeklyCheckin>>;
}

export default function Today() {
  const theme = useTheme();
  const { data } = useFocusLoad<TodayData>(
    async () => {
      const [entries, weekly] = await Promise.all([loadEntries(), loadWeekly()]);
      return { entries, weekly };
    },
    { entries: {}, weekly: {} },
  );
  const { entries, weekly } = data;
  const today = todayIsoDate();
  const entry = entries[today];
  const streak = computeStreak(entries, today);
  const weeklyCheckin = weekly[lastCompletedWeekStart(today)];

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

      <WeeklyCard checkin={weeklyCheckin} />
    </View>
  );
}

/**
 * Self-resolving, no dismiss chrome: while unanswered it's a single quiet prompt row; once
 * logged it collapses to a minimal one-line summary. There is nothing to dismiss, so cold-start
 * re-nagging (Today opens ≥ twice a day) is structurally impossible. Still a `Card` — a bare text
 * row read as inert, not tappable — but slimmer than the `SessionCard`s (no icon, no status pill)
 * so it stays visually secondary to the daily loop.
 */
function WeeklyCard({ checkin }: { readonly checkin: WeeklyCheckin | undefined }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        router.push('/weekly');
      }}
    >
      <Card style={styles.weeklyCard}>
        <Text style={[typography.caption, styles.weeklyText, { color: theme.textMuted }]}>
          {checkin === undefined
            ? 'How was last week overall? Tap to log.'
            : `Last week: ${WEEKLY_IMPRESSION_LABELS[checkin.overall]}`}
        </Text>
        <Ionicons
          name={checkin === undefined ? 'chevron-forward' : 'pencil-outline'}
          size={16}
          color={theme.textMuted}
        />
      </Card>
    </Pressable>
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
  weeklyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.md,
  },
  weeklyText: {
    flex: 1,
    marginRight: space.md,
  },
});
