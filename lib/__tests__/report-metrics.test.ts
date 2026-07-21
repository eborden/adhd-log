import { describe, expect, it } from 'vitest';
import {
  adherenceInWindow,
  beforeAfterDose,
  bucketByDosePeriod,
  bucketByWeek,
  collectNotes,
  computeAdherence,
  severityRunLength,
  sideEffectSummary,
} from '../report-metrics';
import { addDays, isoTimestampNow } from '../storage';
import type { DayEntry, DoseChange, IsoDate, Rating, SideEffect } from '../types';

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
