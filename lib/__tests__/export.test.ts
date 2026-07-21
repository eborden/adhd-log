import { beforeEach, describe, expect, it } from 'vitest';
import { __setMockFileExists, __setMockPickedText } from '../__mocks__/expo-file-system';
import {
  adherenceInWindow,
  averageOf,
  beforeAfterDose,
  bucketByDosePeriod,
  bucketByWeek,
  buildBackup,
  buildReportHtml,
  collectNotes,
  computeAdherence,
  computeTrend,
  coverage,
  dailyLogCell,
  dailyLogColumns,
  dailyLogHasValue,
  exportJsonBackup,
  exportPdfReport,
  importJsonBackup,
  loggingStartDate,
  metricAverage,
  parseBackup,
  ratingAccessor,
  rowsInRange,
  severityRunLength,
  sideEffectSummary,
  toMetricAverage,
  type MetricAverage,
  type ReportOptions,
} from '../export';
import { addDays, formatIsoDate, isoTimestampNow } from '../storage';
import { palette } from '../tokens';
import type { DayEntry, DoseChange, IsoDate, Metric, Profile, Rating, SideEffect } from '../types';

const NO_ONSET = new Map<SideEffect, IsoDate>();

const DAY_1 = '2026-07-01' as IsoDate;
const DAY_2 = '2026-07-02' as IsoDate;
const DAY_3 = '2026-07-03' as IsoDate;

function morningRow(date: IsoDate, sleepQuality: Rating): DayEntry {
  return {
    date,
    morning: {
      ratings: { sleepQuality, wakingMood: 3 },
      doseTaken: true,
      completedAt: isoTimestampNow(),
    },
  };
}

function eveningRatingRow(date: IsoDate, mood: Rating, anxiety: Rating): DayEntry {
  return {
    date,
    evening: { ratings: { mood, anxiety }, sideEffects: {}, completedAt: isoTimestampNow() },
  };
}

/** `count` consecutive evening days from `start` with the same mood/anxiety value each day. */
function eveningDays(start: IsoDate, count: number, value: Rating): DayEntry[] {
  const rows: DayEntry[] = [];
  let date = start;
  for (let i = 0; i < count; i += 1) {
    rows.push(eveningRatingRow(date, value, value));
    date = addDays(date, 1);
  }
  return rows;
}

function entriesFrom(rows: readonly DayEntry[]): Record<IsoDate, DayEntry> {
  const entries: Record<IsoDate, DayEntry> = {};
  for (const row of rows) entries[row.date] = row;
  return entries;
}

/**
 * `buildReportHtml` takes the full entries map + explicit range and computes onset internally.
 * These render tests are still most legible in terms of a row list, so this adapter maps rows to
 * an entries record and infers the range from the first/last row's date.
 */
function htmlFromRows(
  profile: Profile | null,
  doses: readonly DoseChange[],
  rows: readonly DayEntry[],
  options?: ReportOptions,
): string {
  const entries: Record<IsoDate, DayEntry> = {};
  for (const row of rows) entries[row.date] = row;
  const start = rows[0]?.date ?? DAY_1;
  const end = rows[rows.length - 1]?.date ?? start;
  return options === undefined
    ? buildReportHtml(profile, doses, entries, start, end)
    : buildReportHtml(profile, doses, entries, start, end, options);
}

const DOSE_TAKEN_METRIC: Metric = { kind: 'toggle', key: 'doseTaken', label: "Took today's dose" };
const SLEEP_HOURS_METRIC: Metric = {
  kind: 'stepper',
  key: 'sleepHours',
  label: 'Hours slept',
  min: 0,
  max: 14,
  step: 1,
};
const MOOD_METRIC: Metric = {
  kind: 'scale',
  key: 'mood',
  label: 'Overall mood today',
  low: 'Low',
  high: 'Great',
  direction: 'higher-better',
};
const SIDE_EFFECTS_METRIC: Metric = {
  kind: 'chips',
  key: 'sideEffects',
  label: 'Side effects',
  options: [],
};
const NOTES_METRIC: Metric = { kind: 'text', key: 'notes', label: 'Anything else' };

describe('daily log columns', () => {
  it('includes exactly the metrics with captured data, in schema order', () => {
    const rows: readonly DayEntry[] = [
      {
        date: DAY_1,
        morning: {
          ratings: { sleepQuality: 4 },
          doseTaken: true,
          sleepHours: 8,
          completedAt: isoTimestampNow(),
        },
        evening: {
          ratings: { mood: 3, focus: 4 },
          sideEffects: { nausea: { severity: 'mild' } },
          completedAt: isoTimestampNow(),
        },
      },
    ];
    const labels = dailyLogColumns(rows).map((metric) => metric.label);
    expect(labels).toEqual([
      "Took today's dose",
      'Sleep quality',
      'Hours slept',
      'Overall mood today',
      'Focus / attention',
      'Side effects',
    ]);
  });

  it('omits metrics that were never captured', () => {
    const rows: readonly DayEntry[] = [eveningRatingRow(DAY_1, 3, 2)];
    const labels = dailyLogColumns(rows).map((metric) => metric.label);
    expect(labels).toEqual(['Overall mood today', 'Anxiety / irritability']);
    expect(labels).not.toContain('Hours slept');
    expect(labels).not.toContain("Took today's dose");
  });

  it('never includes free-text notes as a column', () => {
    const rows: readonly DayEntry[] = [
      {
        date: DAY_1,
        evening: {
          ratings: { mood: 3 },
          sideEffects: {},
          notes: 'felt good',
          completedAt: isoTimestampNow(),
        },
      },
    ];
    expect(dailyLogColumns(rows).some((metric) => metric.kind === 'text')).toBe(false);
    expect(dailyLogHasValue(NOTES_METRIC, rows[0] ?? { date: DAY_1 })).toBe(false);
  });
});

describe('dailyLogCell', () => {
  const empty: DayEntry = { date: DAY_1 };
  const full: DayEntry = {
    date: DAY_1,
    morning: {
      ratings: { sleepQuality: 4 },
      doseTaken: false,
      sleepHours: 7,
      completedAt: isoTimestampNow(),
    },
    evening: {
      ratings: { mood: 5 },
      sideEffects: { headache: { severity: 'moderate' } },
      completedAt: isoTimestampNow(),
    },
  };

  it('renders a toggle as Yes / No / dash', () => {
    expect(dailyLogCell(DOSE_TAKEN_METRIC, full)).toBe('No');
    expect(dailyLogCell(DOSE_TAKEN_METRIC, empty)).toBe('—');
  });

  it('renders a scale rating or a dash', () => {
    expect(dailyLogCell(MOOD_METRIC, full)).toBe('5');
    expect(dailyLogCell(MOOD_METRIC, empty)).toBe('—');
  });

  it('renders sleep hours or a dash', () => {
    expect(dailyLogCell(SLEEP_HOURS_METRIC, full)).toBe('7');
    expect(dailyLogCell(SLEEP_HOURS_METRIC, empty)).toBe('—');
  });

  it('renders side effects or a dash', () => {
    expect(dailyLogCell(SIDE_EFFECTS_METRIC, full)).toBe('Headache (Moderate)');
    expect(dailyLogCell(SIDE_EFFECTS_METRIC, empty)).toBe('—');
  });

  it('renders a dash for the excluded text metric', () => {
    expect(dailyLogCell(NOTES_METRIC, full)).toBe('—');
  });
});

describe('averageOf', () => {
  it('averages the values an accessor picks out, skipping missing days', () => {
    const rows: readonly DayEntry[] = [morningRow(DAY_1, 2), { date: DAY_2 }, morningRow(DAY_3, 4)];
    const average = averageOf(rows, (row) => row.morning?.ratings.sleepQuality);
    expect(average).toBe(3);
  });

  it('returns null when no row has a value', () => {
    const rows: readonly DayEntry[] = [{ date: DAY_1 }, { date: DAY_2 }];
    expect(averageOf(rows, (row) => row.morning?.ratings.sleepQuality)).toBeNull();
  });
});

describe('coverage', () => {
  const sleepPick = (row: DayEntry): Rating | undefined => row.morning?.ratings.sleepQuality;

  it('returns logged === total on a fully logged range (unbounded)', () => {
    const rows: readonly DayEntry[] = [morningRow(DAY_1, 2), morningRow(DAY_2, 3)];
    expect(coverage(rows, sleepPick)).toEqual({ logged: 2, total: 2 });
    expect(rows).toHaveLength(2);
  });

  it('counts only the logged rows on a partially logged range (unbounded)', () => {
    const rows: readonly DayEntry[] = [morningRow(DAY_1, 2), { date: DAY_2 }, morningRow(DAY_3, 4)];
    expect(coverage(rows, sleepPick)).toEqual({ logged: 2, total: 3 });
    expect(rows).toHaveLength(3);
  });

  it('returns logged: 0 on an all-unlogged range (unbounded)', () => {
    const rows: readonly DayEntry[] = [{ date: DAY_1 }, { date: DAY_2 }];
    expect(coverage(rows, sleepPick)).toEqual({ logged: 0, total: 2 });
    expect(rows).toHaveLength(2);
  });

  it('returns logged: 0, total: 0 on an empty range (unbounded)', () => {
    expect(coverage([], sleepPick)).toEqual({ logged: 0, total: 0 });
  });

  it('floors total to rows on/after `since`, without dropping any logged day', () => {
    const day0 = '2026-06-30' as IsoDate;
    const rows: readonly DayEntry[] = [{ date: day0 }, morningRow(DAY_1, 2), { date: DAY_2 }];
    expect(coverage(rows, sleepPick, DAY_1)).toEqual({ logged: 1, total: 2 });
  });

  it('agrees with metricAverage.n on the logged count', () => {
    const rows: readonly DayEntry[] = [morningRow(DAY_1, 2), { date: DAY_2 }, morningRow(DAY_3, 4)];
    const avg = metricAverage(rows, sleepPick);
    const n = avg.kind === 'value' ? avg.n : 0;
    expect(coverage(rows, sleepPick).logged).toBe(n);
  });

  it('agrees with averageOf: logged is zero iff the average is null', () => {
    const loggedRows: readonly DayEntry[] = [morningRow(DAY_1, 2), { date: DAY_2 }];
    const emptyRows: readonly DayEntry[] = [{ date: DAY_1 }, { date: DAY_2 }];
    expect(coverage(loggedRows, sleepPick).logged === 0).toBe(
      averageOf(loggedRows, sleepPick) === null,
    );
    expect(coverage(emptyRows, sleepPick).logged === 0).toBe(
      averageOf(emptyRows, sleepPick) === null,
    );
  });
});

describe('loggingStartDate', () => {
  it('returns the calendar date of profile.createdAt', () => {
    const profile: Profile = {
      medName: 'Atomoxetine' as Profile['medName'],
      startDate: DAY_1,
      currentDose: { amount: 40, unit: 'mg' },
      morningReminder: { hour: 8, minute: 0 },
      eveningReminder: { hour: 20, minute: 0 },
      lockEnabled: false,
      createdAt: '2026-06-15T09:30:00.000Z' as Profile['createdAt'],
    };
    expect(loggingStartDate(profile)).toBe(formatIsoDate(new Date(profile.createdAt)));
  });
});

describe('rowsInRange', () => {
  it('fills gaps with an empty entry for the missing date', () => {
    const day1Row = morningRow(DAY_1, 5);
    const entries = { [DAY_1]: day1Row };
    const rows = rowsInRange(entries, [DAY_1, DAY_2]);
    expect(rows).toEqual([day1Row, { date: DAY_2 }]);
  });
});

describe('ratingAccessor', () => {
  it('reads morning ratings from the morning session', () => {
    const accessor = ratingAccessor('morning', 'sleepQuality');
    expect(accessor(morningRow(DAY_1, 5))).toBe(5);
  });

  it('reads evening ratings from the evening session', () => {
    const row: DayEntry = {
      date: DAY_1,
      evening: { ratings: { mood: 4 }, sideEffects: {}, completedAt: isoTimestampNow() },
    };
    expect(ratingAccessor('evening', 'mood')(row)).toBe(4);
  });

  it('reads undefined for an absent value', () => {
    expect(ratingAccessor('morning', 'sleepQuality')({ date: DAY_1 })).toBeUndefined();
  });

  it('reads undefined for a key that does not belong to the session', () => {
    // 'mood' is an evening key; asking for it in the morning session yields undefined.
    expect(ratingAccessor('morning', 'mood')(morningRow(DAY_1, 5))).toBeUndefined();
  });
});

describe('toMetricAverage', () => {
  it('maps a null mean or zero samples to empty, and a real mean to value', () => {
    expect(toMetricAverage(null, 0)).toEqual({ kind: 'empty' });
    expect(toMetricAverage(3.2, 0)).toEqual({ kind: 'empty' });
    expect(toMetricAverage(3.2, 4)).toEqual({ kind: 'value', mean: 3.2, n: 4 });
  });
});

describe('metricAverage', () => {
  it('counts samples and means them, skipping missing days', () => {
    const rows: readonly DayEntry[] = [morningRow(DAY_1, 2), { date: DAY_2 }, morningRow(DAY_3, 4)];
    expect(metricAverage(rows, (row) => row.morning?.ratings.sleepQuality)).toEqual({
      kind: 'value',
      mean: 3,
      n: 2,
    });
  });

  it('is empty when no row has a value', () => {
    expect(metricAverage([{ date: DAY_1 }], (row) => row.morning?.ratings.sleepQuality)).toEqual({
      kind: 'empty',
    });
  });
});

describe('computeTrend', () => {
  const val = (mean: number, n: number): MetricAverage => ({ kind: 'value', mean, n });

  it('reports a measured up trend when both halves clear the sample floor and deadband', () => {
    const trend = computeTrend(val(2.8, 4), val(3.6, 4));
    expect(trend.kind).toBe('measured');
    if (trend.kind === 'measured') {
      expect(trend.direction).toBe('up');
      expect(trend.firstHalf).toBe(2.8);
      expect(trend.secondHalf).toBe(3.6);
    }
  });

  it('reports flat when the delta is within the deadband', () => {
    const trend = computeTrend(val(3.0, 5), val(3.2, 5));
    expect(trend.kind === 'measured' && trend.direction).toBe('flat');
  });

  it('is insufficient when a half is empty', () => {
    expect(computeTrend({ kind: 'empty' }, val(3.6, 4))).toEqual({ kind: 'insufficient' });
  });

  it('is insufficient when a half has fewer than MIN_HALF_SAMPLES, even with a real delta', () => {
    // n=2 each, delta 2.0 well past the deadband — still insufficient (the sample floor, not the deadband).
    expect(computeTrend(val(2, 2), val(4, 2))).toEqual({ kind: 'insufficient' });
  });
});

describe('bucketByWeek', () => {
  it('splits display rows into 7-day calendar buckets with labels and per-metric averages', () => {
    const weeks = bucketByWeek(eveningDays('2026-07-01' as IsoDate, 10, 3));
    expect(weeks).toHaveLength(2);
    expect(weeks[0]?.label).toBe('Week 1');
    expect(weeks[1]?.label).toBe('Week 2');
    expect(weeks[0]?.evening.get('mood')).toEqual({ kind: 'value', mean: 3, n: 7 });
    // a metric never logged in the bucket is explicitly empty, not a zero or a NaN
    expect(weeks[0]?.evening.get('libido')).toEqual({ kind: 'empty' });
  });
});

describe('bucketByDosePeriod', () => {
  it('cuts the range at each dose change, labeling periods by the active dose', () => {
    const entries = entriesFrom(eveningDays('2026-07-01' as IsoDate, 16, 3));
    const doses: readonly DoseChange[] = [
      { date: '2026-07-01' as IsoDate, dose: { amount: 20, unit: 'mg' } },
      { date: '2026-07-08' as IsoDate, dose: { amount: 40, unit: 'mg' } },
    ];
    const periods = bucketByDosePeriod(
      entries,
      doses,
      '2026-07-01' as IsoDate,
      '2026-07-16' as IsoDate,
    );
    expect(periods).toHaveLength(2);
    expect(periods[0]?.label).toBe('20mg (Jul 1–Jul 7)');
    expect(periods[1]?.label).toBe('40mg (Jul 8–Jul 16)');
    expect(periods[0]?.startDate).toBe('2026-07-01');
    expect(periods[1]?.startDate).toBe('2026-07-08');
  });

  it('reaches back before rangeStart to the dose-change date, pulling data from the full map', () => {
    // Dose set Jun 25, data logged from Jun 25, but the display range only starts Jul 1.
    const entries = entriesFrom(eveningDays('2026-06-25' as IsoDate, 20, 4));
    const doses: readonly DoseChange[] = [
      { date: '2026-06-25' as IsoDate, dose: { amount: 20, unit: 'mg' } },
    ];
    const periods = bucketByDosePeriod(
      entries,
      doses,
      '2026-07-01' as IsoDate,
      '2026-07-05' as IsoDate,
    );
    expect(periods).toHaveLength(1);
    expect(periods[0]?.startDate).toBe('2026-06-25');
    // Jun 25 → Jul 5 is 11 days, all mood 4 — proves it averaged data from outside the window.
    expect(periods[0]?.evening.get('mood')).toEqual({ kind: 'value', mean: 4, n: 11 });
  });
});

describe('beforeAfterDose', () => {
  it('averages the window before vs on/after a dose change, reaching into the full entries map', () => {
    const entries = entriesFrom([
      ...eveningDays('2026-07-01' as IsoDate, 3, 2), // Jul 1–3, mood 2 (before)
      ...eveningDays('2026-07-04' as IsoDate, 5, 4), // Jul 4–8, mood 4 (on/after)
    ]);
    const change: DoseChange = { date: '2026-07-04' as IsoDate, dose: { amount: 40, unit: 'mg' } };
    const ba = beforeAfterDose(entries, change, 14);
    expect(ba.before.get('mood')).toEqual({ kind: 'value', mean: 2, n: 3 });
    expect(ba.after.get('mood')).toEqual({ kind: 'value', mean: 4, n: 5 });
    // uneven, and a never-logged metric is empty on both sides (routes to insufficient via computeTrend)
    expect(ba.before.get('libido')).toEqual({ kind: 'empty' });
  });
});

describe('buildReportHtml', () => {
  it('includes the medication name, dose average, and daily rows', () => {
    const profile: Profile = {
      medName: 'Atomoxetine' as Profile['medName'],
      startDate: DAY_1,
      currentDose: { amount: 40, unit: 'mg' },
      morningReminder: { hour: 8, minute: 0 },
      eveningReminder: { hour: 20, minute: 0 },
      lockEnabled: false,
      createdAt: isoTimestampNow(),
    };
    const rows = [morningRow(DAY_1, 2), morningRow(DAY_2, 4)];
    const doses: readonly DoseChange[] = [
      { date: DAY_1, dose: { amount: 40, unit: 'mg' }, note: 'titrating up' },
    ];
    const html = htmlFromRows(profile, doses, rows);

    expect(html).toContain('Atomoxetine');
    expect(html).toContain('Weekly averages');
    expect(html).toContain('Sleep quality');
    expect(html).toContain(DAY_1);
    expect(html).toContain(DAY_2);
    expect(html).toContain('Dose changes');
    expect(html).toContain('titrating up');
  });

  it('forces only the sparkline bars to print, and drops the page background', () => {
    const html = htmlFromRows(null, [], eveningDays(DAY_1, 3, 3));
    // Sparkline bars carry the .spark class the print-color-adjust rule targets.
    expect(html).toContain('class="spark ');
    expect(html).toContain('print-color-adjust: exact;');
    // Page background is dropped when printing, so a PDF export doesn't flood the page with ink.
    expect(html).toContain('@media print');
    expect(html).toContain('body { background: transparent; }');
  });

  it('lists side effects with severity for a day that logged any', () => {
    const rowWithSideEffects: DayEntry = {
      date: DAY_1,
      evening: {
        ratings: {
          mood: 3,
          focus: 3,
          impulsivity: 2,
          anxiety: 2,
          energy: 3,
          appetite: 3,
          libido: 3,
        },
        sideEffects: {
          nausea: { severity: 'severe' },
          headache: { severity: 'mild' },
        },
        completedAt: isoTimestampNow(),
      },
    };
    const html = htmlFromRows(null, [], [rowWithSideEffects]);
    expect(html).toContain('Nausea (Severe), Headache (Mild)');
  });

  it('reports partial averages for a metric some days omitted, and omits a metric with no data in range at all', () => {
    const rowMoodFocusOnly: DayEntry = {
      date: DAY_1,
      evening: {
        ratings: { mood: 5, focus: 5 },
        sideEffects: {},
        completedAt: isoTimestampNow(),
      },
    };
    const rowWithLibido: DayEntry = {
      date: DAY_2,
      evening: {
        ratings: { mood: 3, focus: 3, libido: 4 },
        sideEffects: {},
        completedAt: isoTimestampNow(),
      },
    };
    const html = htmlFromRows(null, [], [rowMoodFocusOnly, rowWithLibido]);

    // The single weekly bucket means each answered metric: mood/focus (5+3)/2 and libido from
    // its one day are all 4.0 — the metric-with-partial-data path still computes.
    expect(html).toContain('Weekly averages');
    expect(html).toContain('Overall mood today');
    expect(html).toContain('Focus / attention');
    expect(html).toContain('Libido');
    expect(html).toContain('<td>4.0</td>');
    // anxiety never answered on either day: omitted from every section, never shown with a dash
    expect(html).not.toContain('Anxiety / irritability');
  });

  it('escapes HTML in free-text fields', () => {
    const profile: Profile = {
      medName: '<script>alert(1)</script>' as Profile['medName'],
      startDate: DAY_1,
      currentDose: { amount: 40, unit: 'mg' },
      morningReminder: { hour: 8, minute: 0 },
      eveningReminder: { hour: 20, minute: 0 },
      lockEnabled: false,
      createdAt: isoTimestampNow(),
    };
    const html = htmlFromRows(profile, [], [{ date: DAY_1 }]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders the side-effects section with adherence caption, onset, run-length, and migrated footnote', () => {
    const rows: readonly DayEntry[] = [
      {
        date: DAY_1,
        morning: { ratings: {}, doseTaken: true, completedAt: isoTimestampNow() },
        evening: {
          ratings: {},
          sideEffects: { nausea: { severity: 'moderate', origin: 'migrated' } },
          completedAt: isoTimestampNow(),
        },
      },
      {
        date: DAY_2,
        morning: { ratings: {}, doseTaken: false, completedAt: isoTimestampNow() },
        evening: {
          ratings: {},
          sideEffects: { nausea: { severity: 'severe' } },
          completedAt: isoTimestampNow(),
        },
      },
    ];
    const doses: readonly DoseChange[] = [{ date: DAY_1, dose: { amount: 40, unit: 'mg' } }];
    // onset is now computed internally from the entries map (nausea first appears on DAY_1).
    const html = htmlFromRows(null, doses, rows);

    expect(html).toContain('<h2>Side effects</h2>');
    expect(html).toContain('Nausea');
    expect(html).toContain('Moderate×1, Severe×1');
    expect(html).toContain('40mg');
    // hasMigratedDays → asterisk + footnote
    expect(html).toContain('Nausea *');
    expect(html).toContain('defaulted when migrating');
  });

  it('renders a cover summary with trend arrows and value-free scale-anchor captions', () => {
    const rows = [
      eveningRatingRow('2026-07-01' as IsoDate, 2, 4),
      eveningRatingRow('2026-07-02' as IsoDate, 2, 4),
      eveningRatingRow('2026-07-03' as IsoDate, 2, 4),
      eveningRatingRow('2026-07-04' as IsoDate, 4, 2),
      eveningRatingRow('2026-07-05' as IsoDate, 4, 2),
      eveningRatingRow('2026-07-06' as IsoDate, 4, 2),
    ];
    const html = htmlFromRows(null, [], rows);
    expect(html).toContain('<h2>Summary</h2>');
    // mood rose 2.0 → 4.0 across the halves: an up arrow with mood's own anchor.
    expect(html).toContain('▲');
    expect(html).toContain('first half 2.0 → second half 4.0');
    expect(html).toContain('1 = Low, 5 = Great');
    // anxiety fell 4.0 → 2.0: a down arrow, anchored so it can't be read against mood's arrow.
    expect(html).toContain('▼');
    expect(html).toContain('1 = Calm, 5 = On edge');
  });

  it('renders a flat glyph when a metric holds steady across the halves', () => {
    const rows = [
      eveningRatingRow('2026-07-01' as IsoDate, 3, 3),
      eveningRatingRow('2026-07-02' as IsoDate, 3, 3),
      eveningRatingRow('2026-07-03' as IsoDate, 3, 3),
      eveningRatingRow('2026-07-04' as IsoDate, 3, 3),
      eveningRatingRow('2026-07-05' as IsoDate, 3, 3),
      eveningRatingRow('2026-07-06' as IsoDate, 3, 3),
    ];
    const html = htmlFromRows(null, [], rows);
    expect(html).toContain('▬');
    expect(html).toContain('first half 3.0 → second half 3.0');
  });

  it('renders sparkline bars with only the height inline and the color as a class', () => {
    const html = htmlFromRows(null, [], eveningDays('2026-07-01' as IsoDate, 4, 5));
    expect(html).toContain('class="spark spark-good" style="height:48px"'); // mood 5, higher-better → green
    expect(html).toContain(`.spark-good { background: ${palette.greenStrong}; }`); // hue lives in CSS
    expect(html).not.toContain('[object Object]');
  });

  it('scales sparkline bar width to the number of weeks shown', () => {
    const oneWeek = htmlFromRows(null, [], eveningDays('2026-05-01' as IsoDate, 7, 3));
    expect(oneWeek).toContain('class="spark-line spark-w5"'); // ≤ 2 weeks → chunky bars
    const nineWeeks = htmlFromRows(null, [], eveningDays('2026-05-01' as IsoDate, 63, 3));
    expect(nineWeeks).toContain('class="spark-line spark-w2"'); // ≤ 12 weeks
    const twentyWeeks = htmlFromRows(null, [], eveningDays('2026-05-01' as IsoDate, 140, 3));
    expect(twentyWeeks).toContain('class="spark-line spark-w1"'); // long range → 1px bars
  });

  it('renders weekly averages even for a long range, alongside dose-period averages', () => {
    const html = htmlFromRows(null, [], eveningDays('2026-05-01' as IsoDate, 60, 3));
    expect(html).toContain('Weekly averages');
    expect(html).toContain('Dose-period averages');
  });

  it('uses bare "Week N" weekly headers without a date range', () => {
    const html = htmlFromRows(null, [], eveningDays('2026-05-01' as IsoDate, 14, 3));
    expect(html).toContain('>Week 1<');
    expect(html).not.toContain('Week 1 ('); // no "(May 1–May 7)" date range
  });

  it('keeps weekly headers upright at 5 weeks or fewer', () => {
    const html = htmlFromRows(null, [], eveningDays('2026-05-01' as IsoDate, 35, 3)); // 5 weeks
    expect(html).toContain('Weekly averages');
    expect(html).not.toContain('class="vhead"');
  });

  it('switches weekly headers to vertical writing-mode past 5 weeks', () => {
    const html = htmlFromRows(null, [], eveningDays('2026-05-01' as IsoDate, 42, 3)); // 6 weeks
    expect(html).toContain('<th class="vhead">Week 6</th>');
    expect(html).toContain('writing-mode: vertical-lr');
  });

  it('keeps sparklines on one line', () => {
    const html = htmlFromRows(null, [], eveningDays('2026-05-01' as IsoDate, 10, 3));
    expect(html).toContain('class="spark-line '); // spark-line + a density class
    expect(html).toContain('.spark-line { display: inline-block; white-space: nowrap; }');
  });

  it('renders the Recent trend section with a dated span and an adherence caveat', () => {
    const rows = [
      ...eveningDays('2026-07-01' as IsoDate, 7, 2), // grand mean pulled down by the early week
      ...eveningDays('2026-07-08' as IsoDate, 6, 4), // 6 more days at mood/anxiety 4
      morningRow('2026-07-14' as IsoDate, 3), // dose-taken morning on the range's last day
    ];
    const html = htmlFromRows(null, [], rows);
    expect(html).toContain('<h2>Recent trend</h2>');
    // grand mean over 13 rated days (7 days at 2, 6 days at 4 — day 14 has no evening rating)
    // vs. the recent (last 7 days: 7/8–7/14) tail, whose 6 rated days average to 4.0.
    expect(html).toContain('<td>2.9</td><td>4.0</td>');
    expect(html).toContain('Recent (7-day avg) covers 2026-07-08–2026-07-14');
    expect(html).toContain('Doses taken 1 of 1 logged mornings in this window');
    expect(html).toContain('not a validated clinical score');
  });

  it('renders a null Recent tail as an em dash when the recent window has no data for a metric', () => {
    const rows = [
      ...eveningDays('2026-06-25' as IsoDate, 7, 3), // mood/anxiety logged only in the first week
      { date: '2026-07-02' as IsoDate },
      { date: '2026-07-03' as IsoDate },
      { date: '2026-07-04' as IsoDate },
      { date: '2026-07-05' as IsoDate },
      { date: '2026-07-06' as IsoDate },
      { date: '2026-07-07' as IsoDate },
      { date: '2026-07-08' as IsoDate }, // last 7 days of the 14-day range have no evening entries
    ];
    const html = htmlFromRows(null, [], rows);
    expect(html).toContain('<h2>Recent trend</h2>');
    expect(html).toContain('<td>3.0</td><td>—</td>');
  });

  it('shifts the Recent span to start at a dose change inside the window', () => {
    const rows = [
      ...eveningDays('2026-06-25' as IsoDate, 10, 2), // 10 days before the dose change
      ...eveningDays('2026-07-05' as IsoDate, 5, 4), // 5 days on/after it
    ];
    const doses: readonly DoseChange[] = [
      { date: '2026-07-05' as IsoDate, dose: { amount: 40, unit: 'mg' } },
    ];
    const html = htmlFromRows(null, doses, rows);
    // Without clamping, a 7-day window from the 2026-07-09 range end would start 2026-07-03 —
    // inside the prior dose period. Clamped, it starts at the dose-change date instead.
    expect(html).toContain('Recent (7-day avg) covers 2026-07-05–2026-07-09');
    expect(html).toContain('<td>2.7</td><td>4.0</td>');
  });

  it('renders a before/after table with a change arrow for a dose change inside the range', () => {
    const rows = [
      ...eveningDays('2026-07-01' as IsoDate, 4, 2), // before: mood 2
      ...eveningDays('2026-07-05' as IsoDate, 4, 4), // on/after: mood 4
    ];
    const doses: readonly DoseChange[] = [
      { date: '2026-07-05' as IsoDate, dose: { amount: 40, unit: 'mg' } },
    ];
    const html = htmlFromRows(null, doses, rows);
    expect(html).toContain('Before / after dose changes');
    expect(html).toContain('40mg on 2026-07-05');
  });

  it('shows the multi-dose caveat when a dose change falls inside the range', () => {
    const rows = [
      eveningRatingRow('2026-07-01' as IsoDate, 3, 3),
      eveningRatingRow('2026-07-06' as IsoDate, 3, 3),
    ];
    const doses: readonly DoseChange[] = [
      { date: '2026-07-03' as IsoDate, dose: { amount: 40, unit: 'mg' } },
    ];
    const html = htmlFromRows(null, doses, rows);
    expect(html).toContain('This range spans more than one dose');
  });

  it('renders an insufficient-data placeholder instead of an arrow when a metric has too few days', () => {
    const rows = [
      eveningRatingRow('2026-07-01' as IsoDate, 3, 3),
      eveningRatingRow('2026-07-02' as IsoDate, 4, 4),
    ];
    const html = htmlFromRows(null, [], rows);
    expect(html).toContain('not enough logged days to compare halves');
  });

  const noteRow = (date: IsoDate, notes: string): DayEntry => ({
    date,
    evening: { ratings: {}, sideEffects: {}, notes, completedAt: isoTimestampNow() },
  });

  it('renders dated notes, escaped, when includeNotes is on (the default)', () => {
    const html = htmlFromRows(null, [], [noteRow(DAY_1, 'skipped lunch, focus crashed <3pm>')]);
    expect(html).toContain('<h2>Notes</h2>');
    expect(html).toContain(DAY_1);
    expect(html).toContain('skipped lunch, focus crashed &lt;3pm&gt;');
    expect(html).not.toContain('<3pm>');
  });

  it('renders a neutral adherence block with counts foregrounded and dates in an appendix', () => {
    const rows: readonly DayEntry[] = [
      morningRow(DAY_1, 3), // taken
      {
        date: DAY_2,
        morning: { ratings: {}, doseTaken: false, completedAt: isoTimestampNow() },
      }, // not taken
      { date: DAY_3 }, // no entry
    ];
    const html = htmlFromRows(null, [], rows);
    expect(html).toContain('<h2>Adherence</h2>');
    expect(html).toContain('Doses taken: 1 · Not taken: 1 · No entry: 1 (of 3 days)');
    expect(html).toContain('No entry recorded: 2026-07-03');
    // neutral language — a no-morning day is "no entry recorded", never "missed"
    expect(html).not.toContain('missed');
  });

  it('omits the notes section entirely when includeNotes is false', () => {
    const html = htmlFromRows(null, [], [noteRow(DAY_1, 'private note')], {
      beforeAfterWindowDays: 14,
      includeNotes: false,
    });
    expect(html).not.toContain('<h2>Notes</h2>');
    expect(html).not.toContain('private note');
  });
});

describe('collectNotes', () => {
  it('collects only evening notes, oldest first, skipping blank and morning-only days', () => {
    const rows: readonly DayEntry[] = [
      {
        date: DAY_1,
        evening: { ratings: {}, sideEffects: {}, notes: 'day one', completedAt: isoTimestampNow() },
      },
      morningRow(DAY_2, 3), // morning-only, no note
      {
        date: DAY_3,
        evening: { ratings: {}, sideEffects: {}, notes: '   ', completedAt: isoTimestampNow() },
      },
    ];
    expect(collectNotes(rows)).toEqual([{ date: DAY_1, text: 'day one' }]);
  });

  it('trims surrounding whitespace but keeps the raw (unescaped) text', () => {
    const rows: readonly DayEntry[] = [
      {
        date: DAY_1,
        evening: {
          ratings: {},
          sideEffects: {},
          notes: '  <b>hi</b>  ',
          completedAt: isoTimestampNow(),
        },
      },
    ];
    expect(collectNotes(rows)).toEqual([{ date: DAY_1, text: '<b>hi</b>' }]);
  });
});

describe('severityRunLength', () => {
  it('collapses consecutive runs into labeled counts', () => {
    expect(severityRunLength(['mild', 'mild', 'mild', 'moderate', 'moderate'])).toBe(
      'Mild×3, Moderate×2',
    );
  });

  it('is empty for no severities', () => {
    expect(severityRunLength([])).toBe('');
  });
});

describe('computeAdherence', () => {
  it('splits days into taken / not-taken / no-entry with the dates for the appendix', () => {
    const rows: readonly DayEntry[] = [
      morningRow(DAY_1, 3), // doseTaken true
      { date: DAY_2 }, // no morning → no entry
      {
        date: DAY_3,
        morning: { ratings: {}, doseTaken: false, completedAt: isoTimestampNow() },
      },
    ];
    expect(computeAdherence(rows)).toEqual({
      takenCount: 1,
      notTakenCount: 1,
      noEntryCount: 1,
      notTakenDates: [DAY_3],
      noEntryDates: [DAY_2],
    });
  });
});

describe('adherenceInWindow', () => {
  it('counts doseTaken only over rows with a morning entry, excluding no-entry days', () => {
    const rows: readonly DayEntry[] = [
      morningRow(DAY_1, 3), // doseTaken true
      { date: DAY_2 }, // no morning → excluded from both taken and logged
      {
        date: DAY_3,
        morning: { ratings: {}, doseTaken: false, completedAt: isoTimestampNow() },
      },
    ];
    expect(adherenceInWindow(rows)).toEqual({ taken: 1, logged: 2 });
  });

  it('reports taken === logged when every logged morning took the dose', () => {
    const rows: readonly DayEntry[] = [morningRow(DAY_1, 3), morningRow(DAY_2, 4)];
    expect(adherenceInWindow(rows)).toEqual({ taken: 2, logged: 2 });
  });
});

describe('sideEffectSummary', () => {
  const rows: readonly DayEntry[] = [
    {
      date: DAY_1,
      evening: {
        ratings: {},
        sideEffects: { nausea: { severity: 'mild', origin: 'migrated' } },
        completedAt: isoTimestampNow(),
      },
    },
    { date: DAY_2 },
    {
      date: DAY_3,
      evening: {
        ratings: {},
        sideEffects: { nausea: { severity: 'moderate' } },
        completedAt: isoTimestampNow(),
      },
    },
  ];

  it('summarizes onset, range span, ongoing status, days, run-length, and migration flag', () => {
    const onset = new Map<SideEffect, IsoDate>([['nausea', '2026-06-20' as IsoDate]]);
    const doses: readonly DoseChange[] = [
      { date: '2026-06-01' as IsoDate, dose: { amount: 20, unit: 'mg' } },
    ];
    const summary = sideEffectSummary(rows, onset, doses);
    expect(summary).toHaveLength(1);
    const [nausea] = summary;
    expect(nausea?.onsetDate).toBe('2026-06-20');
    expect(nausea?.onsetDose).toEqual({ amount: 20, unit: 'mg' });
    expect(nausea?.onsetBeforeRange).toBe(true);
    expect(nausea?.firstInRange).toBe(DAY_1);
    expect(nausea?.lastInRange).toBe(DAY_3);
    expect(nausea?.ongoingAtRangeEnd).toBe(true);
    expect(nausea?.daysReported).toBe(2);
    expect(nausea?.loggedEveningsInRange).toBe(2);
    expect(nausea?.severityRun).toBe('Mild×1, Moderate×1');
    expect(nausea?.latestSeverity).toBe('moderate');
    expect(nausea?.hasMigratedDays).toBe(true);
  });

  it('falls back to firstInRange when the onset map has no entry', () => {
    const summary = sideEffectSummary(rows, NO_ONSET, []);
    expect(summary[0]?.onsetDate).toBe(DAY_1);
    expect(summary[0]?.onsetBeforeRange).toBe(false);
  });
});

describe('buildBackup / parseBackup', () => {
  it('round-trips profile, doses, and entries', () => {
    const doses: readonly DoseChange[] = [{ date: DAY_1, dose: { amount: 40, unit: 'mg' } }];
    const entries = { [DAY_1]: morningRow(DAY_1, 3) };
    const backup = buildBackup(null, doses, entries);

    const parsed = parseBackup(JSON.parse(JSON.stringify(backup)));
    expect(parsed).toEqual({ ok: true, value: backup });
  });

  it('rejects a backup missing exportedAt', () => {
    const result = parseBackup({ profile: null, doses: [], entries: {} });
    expect(result.ok).toBe(false);
  });

  it('rejects a backup with malformed doses', () => {
    const result = parseBackup({
      exportedAt: isoTimestampNow(),
      profile: null,
      doses: [{ date: DAY_1 }],
      entries: {},
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a backup with a malformed profile', () => {
    const result = parseBackup({
      exportedAt: isoTimestampNow(),
      profile: { medName: 'incomplete' },
      doses: [],
      entries: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('Malformed backup');
    }
  });

  it('rejects a backup with malformed entries', () => {
    const result = parseBackup({
      exportedAt: isoTimestampNow(),
      profile: null,
      doses: [],
      entries: { 'not-a-date': {} },
    });
    expect(result.ok).toBe(false);
  });

  it('normalizes a legacy-entries backup and preserves migrated provenance', () => {
    const result = parseBackup({
      exportedAt: isoTimestampNow(),
      profile: null,
      doses: [],
      entries: {
        [DAY_1]: {
          date: DAY_1,
          evening: {
            ratings: { mood: 3 },
            sideEffects: ['nausea'],
            completedAt: isoTimestampNow(),
          },
        },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const evening = result.value.entries[DAY_1]?.evening;
      expect(evening?.sideEffects).toEqual({
        nausea: { severity: 'moderate', origin: 'migrated' },
      });
    }
  });
});

describe('exportPdfReport', () => {
  it('prints to a file and shares it', async () => {
    await expect(exportPdfReport('<html></html>')).resolves.toBeUndefined();
  });
});

describe('exportJsonBackup', () => {
  it('deletes an existing file before writing, then shares it', async () => {
    __setMockFileExists(true);
    await expect(exportJsonBackup(buildBackup(null, [], {}))).resolves.toBeUndefined();
  });

  it('writes and shares the backup when no file exists yet', async () => {
    __setMockFileExists(false);
    await expect(exportJsonBackup(buildBackup(null, [], {}))).resolves.toBeUndefined();
  });
});

describe('importJsonBackup', () => {
  beforeEach(() => {
    __setMockPickedText(null);
  });

  it('returns ok:false when the user cancels the picker', async () => {
    expect(await importJsonBackup()).toEqual({ ok: false, reason: 'Import canceled' });
  });

  it('returns ok:false when the picked file is not valid JSON', async () => {
    __setMockPickedText('not json');
    const result = await importJsonBackup();
    expect(result.ok).toBe(false);
  });

  it('returns the parsed backup when the picked file is a valid backup', async () => {
    const backup = buildBackup(null, [], {});
    __setMockPickedText(JSON.stringify(backup));
    expect(await importJsonBackup()).toEqual({ ok: true, value: backup });
  });
});
