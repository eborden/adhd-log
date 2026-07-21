import { describe, expect, it } from 'vitest';
import {
  averageOf,
  computeTrend,
  coverage,
  loggingStartDate,
  metricAverage,
  ratingAccessor,
  rowsInRange,
  type MetricAverage,
} from '../metrics';
import { formatIsoDate, isoTimestampNow } from '../storage';
import type { DayEntry, IsoDate, Profile, Rating } from '../types';

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
