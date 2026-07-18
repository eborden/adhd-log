import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Card } from '../../components/Card';
import { SIDE_EFFECT_LABELS, directionForRatingKey } from '../../lib/schema';
import { isIsoDate, loadEntries, todayIsoDate } from '../../lib/storage';
import { ratingColor, space, typography, useTheme } from '../../lib/theme';
import type { DayEntry, IsoDate, Rating, RatingKey } from '../../lib/types';

function DetailRow({
  label,
  value,
  color,
}: {
  readonly label: string;
  readonly value: string;
  readonly color?: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[typography.body, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[typography.bodyStrong, { color: color ?? theme.text }]}>{value}</Text>
    </View>
  );
}

function RatingRow({
  label,
  metricKey,
  value,
}: {
  readonly label: string;
  readonly metricKey: RatingKey;
  readonly value: Rating | undefined;
}) {
  const theme = useTheme();
  const direction = directionForRatingKey(metricKey);
  const valueColor =
    value !== undefined && direction !== undefined
      ? ratingColor(theme, value, direction)
      : theme.text;
  return (
    <DetailRow label={label} value={value === undefined ? '—' : String(value)} color={valueColor} />
  );
}

function SectionHeader({
  title,
  action,
  onPress,
}: {
  readonly title: string;
  readonly action: string;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <Text style={[typography.sectionLabel, { color: theme.textMuted }]}>{title}</Text>
      <Pressable accessibilityRole="button" onPress={onPress}>
        <Text style={[typography.bodyStrong, { color: theme.accent }]}>{action}</Text>
      </Pressable>
    </View>
  );
}

export default function Entry() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ date?: string }>();
  const date: IsoDate = isIsoDate(params.date) ? params.date : todayIsoDate();
  const [entry, setEntry] = useState<DayEntry | undefined>(undefined);

  const refresh = useCallback((): void => {
    loadEntries()
      .then((entries) => {
        setEntry(entries[date]);
      })
      .catch(() => undefined);
  }, [date]);

  useFocusEffect(refresh);

  const morning = entry?.morning;
  const evening = entry?.evening;

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
    >
      <Text style={[typography.title, styles.title, { color: theme.text }]}>{date}</Text>

      <Card style={styles.section}>
        <SectionHeader
          title="Morning"
          action={morning !== undefined ? 'Edit' : 'Log'}
          onPress={() => {
            router.push({ pathname: '/checkin', params: { session: 'morning', date } });
          }}
        />
        {morning !== undefined ? (
          <>
            <RatingRow
              label="Sleep quality"
              metricKey="sleepQuality"
              value={morning.sleepQuality}
            />
            <RatingRow label="Waking mood" metricKey="wakingMood" value={morning.wakingMood} />
            <DetailRow label="Took dose" value={morning.doseTaken ? 'Yes' : 'No'} />
            {morning.sleepHours !== undefined ? (
              <DetailRow label="Hours slept" value={String(morning.sleepHours)} />
            ) : null}
          </>
        ) : (
          <Text style={[typography.body, { color: theme.textMuted }]}>Not logged.</Text>
        )}
      </Card>

      <Card style={styles.section}>
        <SectionHeader
          title="Evening"
          action={evening !== undefined ? 'Edit' : 'Log'}
          onPress={() => {
            router.push({ pathname: '/checkin', params: { session: 'evening', date } });
          }}
        />
        {evening !== undefined ? (
          <>
            <RatingRow label="Mood" metricKey="mood" value={evening.mood} />
            <RatingRow label="Focus" metricKey="focus" value={evening.focus} />
            <RatingRow label="Impulsivity" metricKey="impulsivity" value={evening.impulsivity} />
            <RatingRow label="Anxiety" metricKey="anxiety" value={evening.anxiety} />
            <RatingRow label="Energy" metricKey="energy" value={evening.energy} />
            <RatingRow label="Appetite" metricKey="appetite" value={evening.appetite} />
            <RatingRow label="Libido" metricKey="libido" value={evening.libido} />
            {evening.sideEffects.length > 0 ? (
              <DetailRow
                label="Side effects"
                value={evening.sideEffects.map((effect) => SIDE_EFFECT_LABELS[effect]).join(', ')}
              />
            ) : null}
            {evening.notes !== undefined ? (
              <View style={styles.notes}>
                <Text style={[typography.body, { color: theme.textMuted }]}>{evening.notes}</Text>
              </View>
            ) : null}
          </>
        ) : (
          <Text style={[typography.body, { color: theme.textMuted }]}>Not logged.</Text>
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: space.xl,
  },
  title: {
    marginBottom: space.xl,
  },
  section: {
    marginBottom: space.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },
  notes: {
    marginTop: space.sm,
  },
});
