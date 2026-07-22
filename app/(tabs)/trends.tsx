import { useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DoseChangeCard, type DoseChangeCardRow } from '../../components/DoseChangeCard';
import { useFocusLoad } from '../../hooks/useFocusLoad';
import {
  daysLoggedCoverage,
  FEW_LOGGED_DAYS_THRESHOLD,
  loggingStartDate,
  ratingAccessor,
  rowsInRange,
  type MetricAverage,
} from '../../lib/metrics';
import { beforeAfterDose, formatDose, type BeforeAfter } from '../../lib/report-metrics';
import { EVENING_METRICS, MORNING_METRICS } from '../../lib/schema';
import {
  doseChangeMarkers,
  lastNDates,
  loadDoseChanges,
  loadEntries,
  loadProfile,
  todayIsoDate,
} from '../../lib/storage';
import { radius, ratingColor, space, typography, useTheme, type Theme } from '../../lib/theme';
import {
  defaultWindowForRange,
  dosePeriodBoundaries,
  rollingAverage,
  smoothedLineSegments,
} from '../../lib/trends';
import type {
  DayEntry,
  DoseChange,
  IsoDate,
  Metric,
  Profile,
  Rating,
  ScaleDirection,
  Session,
} from '../../lib/types';

const RANGE_OPTIONS = [7, 14, 30] as const;

// Shared with the geometry in lib/trends.ts's `smoothedLineSegments` — both the raw bars and the
// smoothed line must agree on the row's pixel height and the gap between columns.
const BARS_ROW_HEIGHT = 48;
const COLUMN_GAP = 2;
const SMOOTHED_LINE_THICKNESS = 2;
// Raw bars dim (rather than disappear) while smoothing is on, so the line reads as the primary
// trend signal without erasing an acute single-day spike — the data always survives in the bar.
const DIMMED_BAR_OPACITY = 0.2;

interface TaggedMetric {
  readonly metric: Metric;
  readonly session: Session;
}

interface TrendsData {
  readonly dates: readonly IsoDate[];
  readonly rows: readonly DayEntry[];
  readonly markers: ReadonlySet<IsoDate>;
  readonly doses: readonly DoseChange[];
  readonly profile: Profile | null;
  // Most-recent-first, one per DoseChange, windowed to the selected range.
  readonly beforeAfterItems: readonly BeforeAfter[];
}

const EMPTY_TRENDS: TrendsData = {
  dates: [],
  rows: [],
  markers: new Set<IsoDate>(),
  doses: [],
  profile: null,
  beforeAfterItems: [],
};

function barHeight(rating: Rating): number {
  return 8 + rating * 8;
}

/**
 * Buckets a window mean into a `Rating` for coloring only — the decimal mean stays the text
 * shown to the user. An explicit comparison ladder, not `Math.round` (which returns a bare
 * `number`, not the `1|2|3|4|5` literal union `ratingColor` requires).
 */
function toRating(mean: number): Rating {
  return mean >= 4.5 ? 5 : mean >= 3.5 ? 4 : mean >= 2.5 ? 3 : mean >= 1.5 ? 2 : 1;
}

function formatMean(average: MetricAverage): string {
  return average.kind === 'empty' ? '—' : average.mean.toFixed(1);
}

function meanCaption(average: MetricAverage): string {
  const n = average.kind === 'empty' ? 0 : average.n;
  return n < FEW_LOGGED_DAYS_THRESHOLD ? `n=${String(n)} · few logged days` : `n=${String(n)}`;
}

function meanColor(theme: Theme, average: MetricAverage, direction: ScaleDirection): string {
  return average.kind === 'empty'
    ? theme.textMuted
    : ratingColor(theme, toRating(average.mean), direction);
}

/** One dose-change card's data: rows for metrics with data on either side, or null if none. */
function doseChangeCardData(
  theme: Theme,
  item: BeforeAfter,
  scaleMetrics: readonly TaggedMetric[],
): { readonly rows: readonly DoseChangeCardRow[]; readonly adherenceCaption: string } | null {
  const rows: DoseChangeCardRow[] = scaleMetrics.flatMap(({ metric, session }) => {
    if (metric.kind !== 'scale') return [];
    const before = item.before.get(metric.key) ?? { kind: 'empty' as const };
    const after = item.after.get(metric.key) ?? { kind: 'empty' as const };
    if (before.kind === 'empty' && after.kind === 'empty') return [];
    return [
      {
        key: `${session}-${metric.key}`,
        label: metric.label,
        beforeText: formatMean(before),
        beforeColor: meanColor(theme, before, metric.direction),
        beforeCaption: meanCaption(before),
        afterText: formatMean(after),
        afterColor: meanColor(theme, after, metric.direction),
        afterCaption: meanCaption(after),
      },
    ];
  });
  if (rows.length === 0) return null;
  const beforeLogged = item.beforeAdherence.takenCount + item.beforeAdherence.notTakenCount;
  const afterLogged = item.afterAdherence.takenCount + item.afterAdherence.notTakenCount;
  const adherenceCaption = `Doses taken — before: ${String(item.beforeAdherence.takenCount)}/${String(beforeLogged)} · after: ${String(item.afterAdherence.takenCount)}/${String(afterLogged)}`;
  return { rows, adherenceCaption };
}

export default function Trends() {
  const theme = useTheme();
  const [range, setRange] = useState<number>(14);
  const [smoothingOn, setSmoothingOn] = useState<boolean>(false);
  const [barsRowWidth, setBarsRowWidth] = useState<number>(0);

  const { data } = useFocusLoad<TrendsData>(
    async () => {
      const [entries, doses, profile] = await Promise.all([
        loadEntries(),
        loadDoseChanges(),
        loadProfile(),
      ]);
      const rangeDates = lastNDates(range, todayIsoDate());
      // Most-recent-first, so the card list opens with the change closest to today expanded.
      const recentFirstDoses = [...doses].sort((a, b) => b.date.localeCompare(a.date));
      return {
        dates: rangeDates,
        rows: rowsInRange(entries, rangeDates),
        markers: doseChangeMarkers(doses, rangeDates),
        doses,
        profile,
        beforeAfterItems: recentFirstDoses.map((change) => beforeAfterDose(entries, change, range)),
      };
    },
    EMPTY_TRENDS,
    [range],
  );
  const { dates, rows, markers, doses, profile, beforeAfterItems } = data;
  const since = profile ? loggingStartDate(profile) : undefined;
  const dayCoverage = daysLoggedCoverage(rows, since);
  const smoothingWindow = defaultWindowForRange(range);
  const boundaries = dosePeriodBoundaries(dates, doses);
  // Every metric block renders a same-width barsRow (same ScrollView content width, same
  // padding), so one measurement is reused everywhere rather than re-measuring per block.
  const columnWidth =
    rows.length === 0 ? 0 : (barsRowWidth - COLUMN_GAP * (rows.length - 1)) / rows.length;

  function handleBarsRowLayout(event: LayoutChangeEvent): void {
    setBarsRowWidth(event.nativeEvent.layout.width);
  }

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

      <View style={styles.smoothRow}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setSmoothingOn((prev) => !prev);
          }}
          style={[
            styles.smoothChip,
            { backgroundColor: smoothingOn ? theme.accentSoft : theme.surfaceMuted },
          ]}
        >
          <Text style={[typography.caption, { color: smoothingOn ? theme.accent : theme.text }]}>
            Smooth ({smoothingWindow}d avg)
          </Text>
        </Pressable>
      </View>

      {dayCoverage.total > 0 ? (
        <Text style={[typography.caption, styles.coverageCaption, { color: theme.textMuted }]}>
          logged {dayCoverage.logged} of {dayCoverage.total} days
        </Text>
      ) : null}

      {visibleScaleMetrics.map(({ metric, session }, blockIndex) => {
        if (metric.kind !== 'scale') return null;
        const accessor = ratingAccessor(session, metric.key);
        const values = rows.map((row) => accessor(row));
        const smoothed = smoothingOn ? rollingAverage(values, smoothingWindow, boundaries) : null;
        const segments =
          smoothed !== null && columnWidth > 0
            ? smoothedLineSegments(smoothed, columnWidth, COLUMN_GAP, BARS_ROW_HEIGHT)
            : [];
        return (
          <View key={`${session}-${metric.key}`} style={styles.metricBlock}>
            <Text style={[typography.sectionLabel, styles.metricLabel, { color: theme.textMuted }]}>
              {metric.label}
            </Text>
            <View style={styles.barsRowWrapper}>
              <View
                style={styles.barsRow}
                onLayout={blockIndex === 0 ? handleBarsRowLayout : undefined}
              >
                {rows.map((row, index) => {
                  const rating = accessor(row);
                  return (
                    <View key={dates[index] ?? index} style={styles.barColumn}>
                      {rating === undefined ? (
                        <View style={[styles.gapPlaceholder, { borderColor: theme.border }]} />
                      ) : (
                        <View
                          style={[
                            styles.bar,
                            {
                              height: barHeight(rating),
                              backgroundColor: ratingColor(theme, rating, metric.direction),
                              opacity: smoothingOn ? DIMMED_BAR_OPACITY : 1,
                            },
                          ]}
                        />
                      )}
                    </View>
                  );
                })}
              </View>
              <View style={styles.smoothedLineLayer} pointerEvents="none">
                {segments.map((segment, index) => (
                  <View
                    key={index}
                    style={[
                      styles.smoothedLineSegment,
                      {
                        left: segment.left,
                        top: segment.top - SMOOTHED_LINE_THICKNESS / 2,
                        width: segment.width,
                        backgroundColor: theme.trendLine,
                        transform: [{ rotate: `${String(segment.rotationDeg)}deg` }],
                      },
                    ]}
                  />
                ))}
              </View>
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

      {doses.length === 0 ? null : (
        <View style={styles.doseChangesSection}>
          <Text style={[typography.sectionLabel, styles.metricLabel, { color: theme.textMuted }]}>
            Around dose changes
          </Text>
          {beforeAfterItems.map((item, index) => {
            const cardData = doseChangeCardData(theme, item, visibleScaleMetrics);
            if (cardData === null) return null;
            return (
              <DoseChangeCard
                key={`${item.change.date}-${String(index)}`}
                title={`${formatDose(item.change.dose)} on ${item.change.date}`}
                windowLabel={`${String(range)}-day windows`}
                rows={cardData.rows}
                adherenceCaption={cardData.adherenceCaption}
                defaultExpanded={index === 0}
              />
            );
          })}
        </View>
      )}
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
    marginBottom: space.lg,
  },
  rangeChip: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
  },
  smoothRow: {
    flexDirection: 'row',
    marginBottom: space.xxl,
  },
  smoothChip: {
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
  doseChangesSection: {
    marginTop: space.md,
  },
  coverageCaption: {
    marginBottom: space.sm,
  },
  barsRowWrapper: {
    position: 'relative',
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: BARS_ROW_HEIGHT,
    gap: COLUMN_GAP,
  },
  smoothedLineLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  smoothedLineSegment: {
    position: 'absolute',
    height: SMOOTHED_LINE_THICKNESS,
    borderRadius: SMOOTHED_LINE_THICKNESS / 2,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
  },
  bar: {
    width: '100%',
    borderRadius: radius.xs,
  },
  gapPlaceholder: {
    width: '100%',
    height: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
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
