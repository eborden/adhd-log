import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusLoad } from '../../hooks/useFocusLoad';
import { ratingAccessor, rowsInRange } from '../../lib/export';
import { EVENING_METRICS, MORNING_METRICS } from '../../lib/schema';
import {
  doseChangeMarkers,
  lastNDates,
  loadDoseChanges,
  loadEntries,
  todayIsoDate,
} from '../../lib/storage';
import { radius, ratingColor, space, typography, useTheme } from '../../lib/theme';
import type { DayEntry, IsoDate, Metric, Session } from '../../lib/types';

const RANGE_OPTIONS = [7, 14, 30] as const;

interface TaggedMetric {
  readonly metric: Metric;
  readonly session: Session;
}

interface TrendsData {
  readonly dates: readonly IsoDate[];
  readonly rows: readonly DayEntry[];
  readonly markers: ReadonlySet<IsoDate>;
}

const EMPTY_TRENDS: TrendsData = { dates: [], rows: [], markers: new Set<IsoDate>() };

function barHeight(rating: number | undefined): number {
  if (rating === undefined) return 4;
  return 8 + rating * 8;
}

export default function Trends() {
  const theme = useTheme();
  const [range, setRange] = useState<number>(14);

  const { data } = useFocusLoad<TrendsData>(
    async () => {
      const [entries, doses] = await Promise.all([loadEntries(), loadDoseChanges()]);
      const rangeDates = lastNDates(range, todayIsoDate());
      return {
        dates: rangeDates,
        rows: rowsInRange(entries, rangeDates),
        markers: doseChangeMarkers(doses, rangeDates),
      };
    },
    EMPTY_TRENDS,
    [range],
  );
  const { dates, rows, markers } = data;

  const visibleScaleMetrics: readonly TaggedMetric[] = [
    ...MORNING_METRICS.filter((metric) => metric.kind === 'scale').map((metric) => ({
      metric,
      session: 'morning' as const,
    })),
    ...EVENING_METRICS.filter((metric) => {
      if (metric.kind !== 'scale') return false;
      const accessor = ratingAccessor('evening', metric.key);
      return rows.some((row) => accessor(row) !== undefined);
    }).map((metric) => ({ metric, session: 'evening' as const })),
  ];

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
                { backgroundColor: active ? theme.accentSoft : theme.surfaceMuted },
              ]}
            >
              <Text style={[typography.caption, { color: active ? theme.accent : theme.text }]}>
                {option}d
              </Text>
            </Pressable>
          );
        })}
      </View>

      {visibleScaleMetrics.map(({ metric, session }) => {
        if (metric.kind !== 'scale') return null;
        const accessor = ratingAccessor(session, metric.key);
        return (
          <View key={`${session}-${metric.key}`} style={styles.metricBlock}>
            <Text style={[typography.sectionLabel, styles.metricLabel, { color: theme.textMuted }]}>
              {metric.label}
            </Text>
            <View style={styles.barsRow}>
              {rows.map((row, index) => {
                const rating = accessor(row);
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
    padding: space.xl,
  },
  rangeRow: {
    flexDirection: 'row',
    gap: space.sm,
    marginBottom: space.xxl,
  },
  rangeChip: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
  },
  metricBlock: {
    marginBottom: space.xxl,
  },
  metricLabel: {
    marginBottom: space.sm,
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
    borderRadius: radius.xs,
  },
  markersRow: {
    flexDirection: 'row',
    gap: 2,
    marginTop: space.xs,
  },
  markerDot: {
    width: 4,
    height: 4,
    borderRadius: radius.pill,
  },
});
