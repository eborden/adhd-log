import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addDays,
  isWeeklyCheckin,
  isWeeklyImpression,
  isWeeklyRecord,
  lastCompletedWeekStart,
  loadWeekly,
  parseWeekly,
  saveWeeklyCheckin,
  weekStart,
} from '../storage';
import type { IsoDate, WeeklyCheckin } from '../types';

// 2026-01-05 is a Monday (2026-01-01 is a Thursday, so the week's Monday is 2025-12-29 and the
// next Monday is 2026-01-05) — used throughout as the canonical week-start fixture.
const MONDAY = '2026-01-05' as IsoDate;
const COMPLETED_AT = '2026-01-12T09:00:00.000Z' as WeeklyCheckin['completedAt'];

beforeEach(async () => {
  await AsyncStorage.multiRemove(await AsyncStorage.getAllKeys());
});

describe('weekStart', () => {
  it('maps a Monday to itself', () => {
    expect(weekStart(MONDAY)).toBe(MONDAY);
  });

  it("maps Tuesday through Saturday back to that week's Monday", () => {
    expect(weekStart(addDays(MONDAY, 1))).toBe(MONDAY); // Tue
    expect(weekStart(addDays(MONDAY, 2))).toBe(MONDAY); // Wed
    expect(weekStart(addDays(MONDAY, 3))).toBe(MONDAY); // Thu
    expect(weekStart(addDays(MONDAY, 4))).toBe(MONDAY); // Fri
    expect(weekStart(addDays(MONDAY, 5))).toBe(MONDAY); // Sat
  });

  it('maps Sunday to the previous Monday (the dow === 0 branch)', () => {
    expect(weekStart(addDays(MONDAY, 6))).toBe(MONDAY); // Sun, last day of MONDAY's week
  });

  it('crosses a month/year boundary correctly', () => {
    expect(weekStart('2026-01-01' as IsoDate)).toBe('2025-12-29');
  });

  it('is idempotent', () => {
    expect(weekStart(weekStart(MONDAY))).toBe(weekStart(MONDAY));
    expect(weekStart(weekStart('2026-01-01' as IsoDate))).toBe(weekStart('2026-01-01' as IsoDate));
  });
});

describe('lastCompletedWeekStart', () => {
  it('returns the Monday exactly 7 days before weekStart(today)', () => {
    expect(lastCompletedWeekStart(MONDAY)).toBe(addDays(MONDAY, -7));
  });

  it('is stable across every day of the current week', () => {
    for (let i = 0; i < 7; i += 1) {
      expect(lastCompletedWeekStart(addDays(MONDAY, i))).toBe('2025-12-29');
    }
  });

  it('crosses a year boundary correctly', () => {
    expect(lastCompletedWeekStart('2026-01-01' as IsoDate)).toBe('2025-12-22');
  });
});

describe('isWeeklyImpression', () => {
  it('accepts the three literals', () => {
    expect(['worse', 'same', 'better'].every(isWeeklyImpression)).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isWeeklyImpression('improved')).toBe(false);
    expect(isWeeklyImpression(3)).toBe(false);
    expect(isWeeklyImpression(null)).toBe(false);
    expect(isWeeklyImpression(undefined)).toBe(false);
  });
});

describe('isWeeklyCheckin', () => {
  const full = {
    weekOf: MONDAY,
    overall: 'better',
    note: 'felt sharper',
    completedAt: COMPLETED_AT,
  };
  const noteless = { weekOf: MONDAY, overall: 'same', completedAt: COMPLETED_AT };

  it('accepts a full fixture and a note-less fixture', () => {
    expect(isWeeklyCheckin(full)).toBe(true);
    expect(isWeeklyCheckin(noteless)).toBe(true);
  });

  it('rejects a bad overall value', () => {
    expect(isWeeklyCheckin({ ...full, overall: 'improved' })).toBe(false);
  });

  it('rejects a missing weekOf', () => {
    const { weekOf, ...withoutWeekOf } = full;
    expect(weekOf).toBe(MONDAY);
    expect(isWeeklyCheckin(withoutWeekOf)).toBe(false);
  });

  it('rejects a non-string note', () => {
    expect(isWeeklyCheckin({ ...full, note: 42 })).toBe(false);
  });

  it('rejects a bad completedAt', () => {
    expect(isWeeklyCheckin({ ...full, completedAt: 'not a timestamp' })).toBe(false);
  });

  it('rejects a structurally valid but non-Monday weekOf', () => {
    expect(isWeeklyCheckin({ ...full, weekOf: addDays(MONDAY, 1) })).toBe(false);
  });

  it('rejects non-record input', () => {
    expect(isWeeklyCheckin(null)).toBe(false);
    expect(isWeeklyCheckin('nope')).toBe(false);
  });
});

describe('isWeeklyRecord', () => {
  const checkin: WeeklyCheckin = { weekOf: MONDAY, overall: 'better', completedAt: COMPLETED_AT };

  it('accepts an empty map and a valid map', () => {
    expect(isWeeklyRecord({})).toBe(true);
    expect(isWeeklyRecord({ [MONDAY]: checkin })).toBe(true);
  });

  it('rejects a map whose key does not equal entry.weekOf', () => {
    const otherMonday = addDays(MONDAY, 7);
    expect(isWeeklyRecord({ [otherMonday]: checkin })).toBe(false);
  });

  it('rejects a non-record', () => {
    expect(isWeeklyRecord('nope')).toBe(false);
    expect(isWeeklyRecord([])).toBe(false);
  });

  it('rejects a map with one bad entry among good ones', () => {
    const secondMonday = addDays(MONDAY, 7);
    expect(
      isWeeklyRecord({
        [MONDAY]: checkin,
        [secondMonday]: { ...checkin, weekOf: secondMonday, overall: 'not-a-real-value' },
      }),
    ).toBe(false);
  });
});

describe('parseWeekly', () => {
  it('returns ok:true for a valid map, including empty', () => {
    expect(parseWeekly({})).toEqual({ ok: true, value: {} });
  });

  it('returns ok:false with a reason for malformed JSON', () => {
    const result = parseWeekly({ bad: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/weekly/i);
  });
});

describe('saveWeeklyCheckin', () => {
  it('upserts by weekOf, leaving other weeks untouched', async () => {
    const week1: WeeklyCheckin = { weekOf: MONDAY, overall: 'worse', completedAt: COMPLETED_AT };
    const week2Monday = addDays(MONDAY, 7);
    const week2: WeeklyCheckin = {
      weekOf: week2Monday,
      overall: 'better',
      completedAt: COMPLETED_AT,
    };

    await saveWeeklyCheckin(week1);
    await saveWeeklyCheckin(week2);
    expect(await loadWeekly()).toEqual({ [MONDAY]: week1, [week2Monday]: week2 });

    const week1Edited: WeeklyCheckin = { ...week1, overall: 'same', note: 'revised' };
    await saveWeeklyCheckin(week1Edited);
    expect(await loadWeekly()).toEqual({ [MONDAY]: week1Edited, [week2Monday]: week2 });
  });

  it('loadWeekly returns {} when nothing is stored or the store is malformed', async () => {
    expect(await loadWeekly()).toEqual({});
    await AsyncStorage.setItem('weekly', JSON.stringify({ bad: {} }));
    expect(await loadWeekly()).toEqual({});
  });
});
