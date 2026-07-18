import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SIDE_EFFECT_LABELS, directionForRatingKey } from '../../lib/schema';
import { isIsoDate, loadEntries, todayIsoDate } from '../../lib/storage';
import { ratingColor, useTheme } from '../../lib/theme';
import type { DayEntry, IsoDate, Rating, RatingKey } from '../../lib/types';

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
    <View style={styles.row}>
      <Text style={{ color: theme.textMuted }}>{label}</Text>
      <Text style={{ color: valueColor, fontWeight: '600' }}>{value ?? '—'}</Text>
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
      <Text style={[styles.title, { color: theme.text }]}>{date}</Text>

      <View style={[styles.section, { borderColor: theme.border }]}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Morning</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              router.push({ pathname: '/checkin', params: { session: 'morning', date } });
            }}
          >
            <Text style={{ color: theme.accent, fontWeight: '600' }}>
              {morning !== undefined ? 'Edit' : 'Log'}
            </Text>
          </Pressable>
        </View>
        {morning !== undefined ? (
          <>
            <RatingRow
              label="Sleep quality"
              metricKey="sleepQuality"
              value={morning.sleepQuality}
            />
            <RatingRow label="Waking mood" metricKey="wakingMood" value={morning.wakingMood} />
            <View style={styles.row}>
              <Text style={{ color: theme.textMuted }}>Took dose</Text>
              <Text style={{ color: theme.text, fontWeight: '600' }}>
                {morning.doseTaken ? 'Yes' : 'No'}
              </Text>
            </View>
            {morning.sleepHours !== undefined ? (
              <View style={styles.row}>
                <Text style={{ color: theme.textMuted }}>Hours slept</Text>
                <Text style={{ color: theme.text, fontWeight: '600' }}>{morning.sleepHours}</Text>
              </View>
            ) : null}
          </>
        ) : (
          <Text style={{ color: theme.textMuted }}>Not logged.</Text>
        )}
      </View>

      <View style={[styles.section, { borderColor: theme.border }]}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Evening</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              router.push({ pathname: '/checkin', params: { session: 'evening', date } });
            }}
          >
            <Text style={{ color: theme.accent, fontWeight: '600' }}>
              {evening !== undefined ? 'Edit' : 'Log'}
            </Text>
          </Pressable>
        </View>
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
              <View style={styles.row}>
                <Text style={{ color: theme.textMuted }}>Side effects</Text>
                <Text style={{ color: theme.text, fontWeight: '600' }}>
                  {evening.sideEffects.map((effect) => SIDE_EFFECT_LABELS[effect]).join(', ')}
                </Text>
              </View>
            ) : null}
            {evening.notes !== undefined ? (
              <View style={styles.notes}>
                <Text style={{ color: theme.textMuted }}>{evening.notes}</Text>
              </View>
            ) : null}
          </>
        ) : (
          <Text style={{ color: theme.textMuted }}>Not logged.</Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 20,
  },
  section: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  notes: {
    marginTop: 8,
  },
});
