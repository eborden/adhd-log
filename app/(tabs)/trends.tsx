import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { ratingAccessor, rowsInRange } from '../../lib/export';
import { EVENING_METRICS, MORNING_METRICS } from '../../lib/schema';
import {
  doseChangeMarkers,
  lastNDates,
  loadDoseChanges,
  loadEntries,
  todayIsoDate,
} from '../../lib/storage';
import { ratingColor, useTheme } from '../../lib/theme';
import type { DayEntry, IsoDate, Metric, Session } from '../../lib/types';

const RANGE_OPTIONS = [7, 14, 30] as const;

interface TaggedMetric {
  readonly metric: Metric;
  readonly session: Session;
}

const SCALE_METRICS: readonly TaggedMetric[] = [
  ...MORNING_METRICS.filter((metric) => metric.kind === 'scale').map((metric) => ({
    metric,
    session: 'morning' as const,
  })),
  ...EVENING_METRICS.filter((metric) => metric.kind === 'scale').map((metric) => ({
    metric,
    session: 'evening' as const,
  })),
];

function barHeight(rating: number | undefined): number {
  if (rating === undefined) return 4;
  return 8 + rating * 8;
}

export default function Trends() {
  const theme = useTheme();
  const [range, setRange] = useState<number>(14);
  const [dates, setDates] = useState<readonly IsoDate[]>([]);
  const [rows, setRows] = useState<readonly DayEntry[]>([]);
  const [markers, setMarkers] = useState<ReadonlySet<IsoDate>>(new Set());

  const refresh = useCallback((): void => {
    Promise.all([loadEntries(), loadDoseChanges()])
      .then(([entries, doses]) => {
        const rangeDates = lastNDates(range, todayIsoDate());
        setDates(rangeDates);
        setRows(rowsInRange(entries, rangeDates));
        setMarkers(doseChangeMarkers(doses, rangeDates));
      })
      .catch(() => undefined);
  }, [range]);

  useFocusEffect(refresh);

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
    >
      <View style={styles.rangeRow}>
        {RANGE_OPTIONS.map((option) => {
          const active = option === range;
          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              onPress={() => {
                setRange(option);
              }}
              style={[
                styles.rangeChip,
                {
                  backgroundColor: active ? theme.accent : theme.surface,
                  borderColor: theme.border,
                },
              ]}
            >
              <Text style={{ color: active ? '#FFFFFF' : theme.text }}>{option}d</Text>
            </Pressable>
          );
        })}
      </View>

      {SCALE_METRICS.map(({ metric, session }) => {
        if (metric.kind !== 'scale') return null;
        const accessor = ratingAccessor(session, metric.key);
        return (
          <View key={`${session}-${metric.key}`} style={styles.metricBlock}>
            <Text style={[styles.metricLabel, { color: theme.text }]}>{metric.label}</Text>
            <View style={styles.barsRow}>
              {rows.map((row, index) => {
                const rating = accessor?.(row);
                return (
                  <View key={dates[index] ?? index} style={styles.barColumn}>
                    <View
                      style={[
                        styles.bar,
                        {
                          height: barHeight(rating),
                          backgroundColor:
                            rating === undefined
                              ? theme.border
                              : ratingColor(theme, rating, metric.direction),
                        },
                      ]}
                    />
                  </View>
                );
              })}
            </View>
            <View style={styles.markersRow}>
              {dates.map((date) => (
                <View key={date} style={styles.barColumn}>
                  {markers.has(date) ? (
                    <View style={[styles.markerDot, { backgroundColor: theme.neutral }]} />
                  ) : null}
                </View>
              ))}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
  },
  rangeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 24,
  },
  rangeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
  },
  metricBlock: {
    marginBottom: 24,
  },
  metricLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 48,
    gap: 2,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
  },
  bar: {
    width: '100%',
    borderRadius: 2,
  },
  markersRow: {
    flexDirection: 'row',
    gap: 2,
    marginTop: 4,
  },
  markerDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
});
