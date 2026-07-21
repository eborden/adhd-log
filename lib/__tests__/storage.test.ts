import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addDays,
  appendDoseChange,
  type CheckinInput,
  computeStreak,
  datesInRange,
  doseActiveOn,
  doseChangeMarkers,
  firstOnsetDates,
  formatIsoDate,
  isDayEntry,
  isDoseChangeList,
  isEveningCheckin,
  isEveningRatingKey,
  isIsoDate,
  isIsoTimestamp,
  isMedName,
  isProfile,
  isRating,
  isSideEffect,
  isSideEffectSeverity,
  isoTimestampNow,
  lastNDates,
  loadDoseChanges,
  loadEntries,
  loadProfile,
  loggedDateRange,
  parseEntries,
  parseEntriesTolerant,
  parseEveningCheckin,
  parseIsoDate,
  parseProfile,
  restoreBackup,
  saveCheckin,
  saveProfile,
  todayIsoDate,
} from '../storage';
import { buildBackup } from '../export';
import type { Backup } from '../export';
import type { DayEntry, DoseChange, IsoDate, Profile } from '../types';

const VALID_PROFILE = {
  medName: 'Atomoxetine',
  startDate: '2026-01-01',
  currentDose: { amount: 40, unit: 'mg' },
  morningReminder: { hour: 8, minute: 0 },
  eveningReminder: { hour: 20, minute: 30 },
  lockEnabled: true,
  createdAt: '2026-01-01T09:00:00.000Z',
};

function buildProfile(): Profile {
  return {
    medName: 'Atomoxetine' as Profile['medName'],
    startDate: todayIsoDate(),
    currentDose: { amount: 40, unit: 'mg' },
    morningReminder: { hour: 8, minute: 0 },
    eveningReminder: { hour: 20, minute: 0 },
    lockEnabled: false,
    createdAt: isoTimestampNow(),
  };
}

beforeEach(async () => {
  await AsyncStorage.multiRemove(await AsyncStorage.getAllKeys());
});

describe('isRating', () => {
  it('accepts 1 through 5', () => {
    expect([1, 2, 3, 4, 5].every(isRating)).toBe(true);
  });

  it('rejects out-of-range numbers and non-numbers', () => {
    expect(isRating(0)).toBe(false);
    expect(isRating(6)).toBe(false);
    expect(isRating('3')).toBe(false);
    expect(isRating(null)).toBe(false);
    expect(isRating(undefined)).toBe(false);
  });
});

describe('isSideEffect', () => {
  it('accepts a known side effect and rejects everything else', () => {
    expect(isSideEffect('nausea')).toBe(true);
    expect(isSideEffect('migraine')).toBe(false);
    expect(isSideEffect(1)).toBe(false);
  });
});

describe('isEveningRatingKey', () => {
  it('accepts a known evening rating key and rejects everything else', () => {
    expect(isEveningRatingKey('mood')).toBe(true);
    expect(isEveningRatingKey('libido')).toBe(true);
    expect(isEveningRatingKey('sleepQuality')).toBe(false);
    expect(isEveningRatingKey('bogus')).toBe(false);
    expect(isEveningRatingKey(1)).toBe(false);
  });
});

describe('isIsoDate / isIsoTimestamp / isMedName', () => {
  it('validates well-formed values', () => {
    expect(isIsoDate('2026-07-17')).toBe(true);
    expect(isIsoTimestamp('2026-07-17T09:00:00.000Z')).toBe(true);
    expect(isMedName('Atomoxetine')).toBe(true);
  });

  it('rejects malformed values', () => {
    expect(isIsoDate('07/17/2026')).toBe(false);
    expect(isIsoDate(20260717)).toBe(false);
    expect(isIsoTimestamp('not a date')).toBe(false);
    expect(isMedName('')).toBe(false);
    expect(isMedName('   ')).toBe(false);
  });
});

describe('isProfile', () => {
  it('accepts a well-formed profile', () => {
    expect(isProfile(VALID_PROFILE)).toBe(true);
  });

  it('rejects a profile missing a required field', () => {
    const { lockEnabled, ...withoutLock } = VALID_PROFILE;
    expect(lockEnabled).toBe(true);
    expect(isProfile(withoutLock)).toBe(false);
  });

  it('rejects a profile with a malformed dose', () => {
    expect(isProfile({ ...VALID_PROFILE, currentDose: { amount: 40, unit: 'kg' } })).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(isProfile(null)).toBe(false);
    expect(isProfile('profile')).toBe(false);
    expect(isProfile([])).toBe(false);
  });

  it('accepts a profile with a valid enabledEveningMetrics array', () => {
    expect(isProfile({ ...VALID_PROFILE, enabledEveningMetrics: ['mood', 'libido'] })).toBe(true);
  });

  it('accepts a profile without enabledEveningMetrics (falls back to defaults elsewhere)', () => {
    expect(isProfile(VALID_PROFILE)).toBe(true);
  });

  it('rejects a profile whose enabledEveningMetrics contains a non-evening key', () => {
    expect(isProfile({ ...VALID_PROFILE, enabledEveningMetrics: ['sleepQuality'] })).toBe(false);
  });

  it('rejects a profile whose enabledEveningMetrics contains a non-string element', () => {
    expect(isProfile({ ...VALID_PROFILE, enabledEveningMetrics: ['mood', 1] })).toBe(false);
  });
});

describe('isDayEntry', () => {
  const validEntry = {
    date: '2026-07-17',
    morning: {
      ratings: { sleepQuality: 4, wakingMood: 3 },
      doseTaken: true,
      completedAt: '2026-07-17T07:00:00.000Z',
    },
  };

  it('accepts a day entry with only a morning session', () => {
    expect(isDayEntry(validEntry)).toBe(true);
  });

  it('rejects a day entry with a malformed morning session', () => {
    expect(
      isDayEntry({
        ...validEntry,
        morning: { ...validEntry.morning, ratings: { sleepQuality: 9 } },
      }),
    ).toBe(false);
  });
});

describe('isEveningCheckin', () => {
  it('accepts a checkin with only some ratings present', () => {
    expect(
      isEveningCheckin({
        ratings: { mood: 4, focus: 3 },
        sideEffects: [],
        completedAt: '2026-07-17T20:00:00.000Z',
      }),
    ).toBe(true);
  });

  it('accepts a checkin with no ratings at all', () => {
    expect(
      isEveningCheckin({ ratings: {}, sideEffects: [], completedAt: '2026-07-17T20:00:00.000Z' }),
    ).toBe(true);
  });

  it('rejects a checkin where a present rating is invalid', () => {
    expect(
      isEveningCheckin({
        ratings: { mood: 9 },
        sideEffects: [],
        completedAt: '2026-07-17T20:00:00.000Z',
      }),
    ).toBe(false);
  });

  it('rejects a checkin missing the ratings record entirely', () => {
    expect(isEveningCheckin({ sideEffects: [], completedAt: '2026-07-17T20:00:00.000Z' })).toBe(
      false,
    );
  });
});

describe('isSideEffectSeverity', () => {
  it('accepts the three severities and rejects anything else', () => {
    expect(['mild', 'moderate', 'severe'].every(isSideEffectSeverity)).toBe(true);
    expect(isSideEffectSeverity('critical')).toBe(false);
    expect(isSideEffectSeverity(2)).toBe(false);
  });
});

describe('parseEveningCheckin (migration + normalization)', () => {
  const completedAt = '2026-07-17T20:00:00.000Z';

  it('migrates a legacy SideEffect[] to a marked moderate default', () => {
    const parsed = parseEveningCheckin({ ratings: {}, sideEffects: ['nausea'], completedAt });
    expect(parsed?.sideEffects).toEqual({
      nausea: { severity: 'moderate', origin: 'migrated' },
    });
  });

  it('dedupes a repeated legacy effect to a single key', () => {
    const parsed = parseEveningCheckin({
      ratings: {},
      sideEffects: ['nausea', 'nausea'],
      completedAt,
    });
    expect(Object.keys(parsed?.sideEffects ?? {})).toEqual(['nausea']);
  });

  it('accepts the new keyed-record form verbatim, preserving and omitting origin', () => {
    const parsed = parseEveningCheckin({
      ratings: { mood: 3 },
      sideEffects: {
        nausea: { severity: 'severe' },
        headache: { severity: 'mild', origin: 'migrated' },
      },
      completedAt,
    });
    expect(parsed?.sideEffects).toEqual({
      nausea: { severity: 'severe' },
      headache: { severity: 'mild', origin: 'migrated' },
    });
    expect(parsed?.ratings.mood).toBe(3);
  });

  it('rejects a detail missing severity, a bad severity, and a non-array/non-record', () => {
    expect(
      parseEveningCheckin({ ratings: {}, sideEffects: { nausea: {} }, completedAt }),
    ).toBeUndefined();
    expect(
      parseEveningCheckin({ ratings: {}, sideEffects: { nausea: { severity: 'x' } }, completedAt }),
    ).toBeUndefined();
    expect(parseEveningCheckin({ ratings: {}, sideEffects: 'nope', completedAt })).toBeUndefined();
  });

  it('preserves notes when present and omits it when absent', () => {
    const withNotes = parseEveningCheckin({
      ratings: {},
      sideEffects: {},
      notes: 'hi',
      completedAt,
    });
    expect(withNotes?.notes).toBe('hi');
    const withoutNotes = parseEveningCheckin({ ratings: {}, sideEffects: {}, completedAt });
    expect(withoutNotes !== undefined && 'notes' in withoutNotes).toBe(false);
  });
});

describe('loadEntries migrates legacy days on read', () => {
  it('normalizes a stored legacy SideEffect[] day to the keyed record', async () => {
    await AsyncStorage.setItem(
      'entries',
      JSON.stringify({
        '2026-07-01': {
          date: '2026-07-01',
          evening: {
            ratings: { mood: 3 },
            sideEffects: ['nausea', 'headache'],
            completedAt: '2026-07-01T20:00:00.000Z',
          },
        },
      }),
    );
    const entries = await loadEntries();
    const evening = entries['2026-07-01' as IsoDate]?.evening;
    expect(evening?.sideEffects).toEqual({
      nausea: { severity: 'moderate', origin: 'migrated' },
      headache: { severity: 'moderate', origin: 'migrated' },
    });
  });
});

describe('firstOnsetDates', () => {
  it('returns the earliest date each effect appears across the full log', () => {
    const entries: Record<IsoDate, DayEntry> = {
      ['2026-07-03' as IsoDate]: {
        date: '2026-07-03' as IsoDate,
        evening: {
          ratings: {},
          sideEffects: { nausea: { severity: 'mild' } },
          completedAt: '2026-07-03T20:00:00.000Z' as ReturnType<typeof isoTimestampNow>,
        },
      },
      ['2026-07-01' as IsoDate]: {
        date: '2026-07-01' as IsoDate,
        evening: {
          ratings: {},
          sideEffects: { nausea: { severity: 'moderate' }, headache: { severity: 'mild' } },
          completedAt: '2026-07-01T20:00:00.000Z' as ReturnType<typeof isoTimestampNow>,
        },
      },
      ['2026-07-02' as IsoDate]: { date: '2026-07-02' as IsoDate },
    };
    const onset = firstOnsetDates(entries);
    expect(onset.get('nausea')).toBe('2026-07-01');
    expect(onset.get('headache')).toBe('2026-07-01');
    expect(onset.has('dizziness')).toBe(false);
  });

  it('is empty for an empty log', () => {
    expect(firstOnsetDates({}).size).toBe(0);
  });
});

describe('loggedDateRange', () => {
  const morningEntry = (date: string): DayEntry => ({
    date: date as IsoDate,
    morning: {
      ratings: {},
      doseTaken: true,
      completedAt: `${date}T08:00:00.000Z` as ReturnType<typeof isoTimestampNow>,
    },
  });
  const eveningEntry = (date: string): DayEntry => ({
    date: date as IsoDate,
    evening: {
      ratings: {},
      sideEffects: {},
      completedAt: `${date}T20:00:00.000Z` as ReturnType<typeof isoTimestampNow>,
    },
  });

  it('returns null for an empty log', () => {
    expect(loggedDateRange({})).toBeNull();
  });

  it('is a single day (start === end) when only one day is logged', () => {
    const entries: Record<IsoDate, DayEntry> = {
      ['2026-07-05' as IsoDate]: morningEntry('2026-07-05'),
    };
    expect(loggedDateRange(entries)).toEqual({ start: '2026-07-05', end: '2026-07-05' });
  });

  it('spans earliest to latest across an interior gap, regardless of insertion order', () => {
    const entries: Record<IsoDate, DayEntry> = {
      ['2026-07-10' as IsoDate]: eveningEntry('2026-07-10'),
      ['2026-07-01' as IsoDate]: morningEntry('2026-07-01'),
      // 2026-07-05 deliberately absent — a skipped day stays inside the range.
    };
    expect(loggedDateRange(entries)).toEqual({ start: '2026-07-01', end: '2026-07-10' });
  });

  it('counts morning-only and evening-only days but excludes gap-filled empty entries', () => {
    const entries: Record<IsoDate, DayEntry> = {
      ['2026-07-01' as IsoDate]: { date: '2026-07-01' as IsoDate }, // no check-in → excluded
      ['2026-07-02' as IsoDate]: morningEntry('2026-07-02'),
      ['2026-07-03' as IsoDate]: eveningEntry('2026-07-03'),
      ['2026-07-09' as IsoDate]: { date: '2026-07-09' as IsoDate }, // no check-in → excluded
    };
    expect(loggedDateRange(entries)).toEqual({ start: '2026-07-02', end: '2026-07-03' });
  });
});

describe('doseActiveOn', () => {
  const doses: readonly DoseChange[] = [
    { date: '2026-07-01' as IsoDate, dose: { amount: 20, unit: 'mg' } },
    { date: '2026-07-10' as IsoDate, dose: { amount: 40, unit: 'mg' } },
  ];

  it('returns the last change on or before the date', () => {
    expect(doseActiveOn(doses, '2026-07-05' as IsoDate)).toEqual({ amount: 20, unit: 'mg' });
    expect(doseActiveOn(doses, '2026-07-10' as IsoDate)).toEqual({ amount: 40, unit: 'mg' });
    expect(doseActiveOn(doses, '2026-07-20' as IsoDate)).toEqual({ amount: 40, unit: 'mg' });
  });

  it('returns undefined before the first change', () => {
    expect(doseActiveOn(doses, '2026-06-30' as IsoDate)).toBeUndefined();
    expect(doseActiveOn([], '2026-07-05' as IsoDate)).toBeUndefined();
  });
});

describe('isDoseChangeList', () => {
  it('accepts a well-formed list', () => {
    expect(
      isDoseChangeList([
        { date: '2026-07-01', dose: { amount: 40, unit: 'mg' }, note: 'titrating up' },
      ]),
    ).toBe(true);
  });

  it('rejects a non-array or a list with a malformed entry', () => {
    expect(isDoseChangeList('not an array')).toBe(false);
    expect(isDoseChangeList([{ date: '2026-07-01', dose: { amount: 40 } }])).toBe(false);
  });
});

describe('parseProfile / parseEntries', () => {
  it('returns ok:true for valid JSON', () => {
    expect(parseProfile(VALID_PROFILE)).toEqual({ ok: true, value: VALID_PROFILE });
    expect(parseEntries({})).toEqual({ ok: true, value: {} });
  });

  it('returns ok:false with a reason for malformed JSON', () => {
    const badProfile = parseProfile({ medName: 'x' });
    expect(badProfile.ok).toBe(false);
    if (!badProfile.ok) expect(badProfile.reason).toMatch(/profile/i);

    const badEntries = parseEntries({ bad: {} });
    expect(badEntries.ok).toBe(false);
  });
});

describe('date helpers', () => {
  it('formatIsoDate and parseIsoDate round-trip', () => {
    const date = new Date(2026, 6, 17);
    const iso = formatIsoDate(date);
    expect(iso).toBe('2026-07-17');
    const parsed = parseIsoDate(iso);
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(6);
    expect(parsed.getDate()).toBe(17);
  });

  it('addDays moves forward and backward across month boundaries', () => {
    expect(addDays('2026-07-31' as IsoDate, 1)).toBe('2026-08-01');
    expect(addDays('2026-08-01' as IsoDate, -1)).toBe('2026-07-31');
  });

  it('lastNDates returns n dates ending at the given date, oldest first', () => {
    const dates = lastNDates(3, '2026-07-17' as IsoDate);
    expect(dates).toEqual(['2026-07-15', '2026-07-16', '2026-07-17']);
  });

  it('datesInRange returns every day from start to end inclusive, oldest first', () => {
    expect(datesInRange('2026-07-30' as IsoDate, '2026-08-02' as IsoDate)).toEqual([
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
    ]);
  });

  it('datesInRange is a single day when start equals end, and empty when end precedes start', () => {
    expect(datesInRange('2026-07-17' as IsoDate, '2026-07-17' as IsoDate)).toEqual(['2026-07-17']);
    expect(datesInRange('2026-07-17' as IsoDate, '2026-07-16' as IsoDate)).toEqual([]);
  });

  it('todayIsoDate and isoTimestampNow produce validly-formatted values', () => {
    expect(isIsoDate(todayIsoDate())).toBe(true);
    expect(isIsoTimestamp(isoTimestampNow())).toBe(true);
  });

  it('parseIsoDate rejects a value that was cast to IsoDate without matching the format', () => {
    expect(() => parseIsoDate('not-a-date' as IsoDate)).toThrow(/Invalid IsoDate/);
  });

  it('formatIsoDate rejects a year that overflows the 4-digit format', () => {
    expect(() => formatIsoDate(new Date(12026, 0, 1))).toThrow(/Invalid IsoDate/);
  });
});

describe('computeStreak', () => {
  const today = '2026-07-17' as IsoDate;

  function entryWithMorning(date: IsoDate): DayEntry {
    return {
      date,
      morning: {
        ratings: { sleepQuality: 3, wakingMood: 3 },
        doseTaken: true,
        completedAt: isoTimestampNow(),
      },
    };
  }

  it('is zero with no entries', () => {
    expect(computeStreak({}, today)).toBe(0);
  });

  it('counts consecutive logged days ending today', () => {
    const entries: Record<IsoDate, DayEntry> = {
      [today]: entryWithMorning(today),
      [addDays(today, -1)]: entryWithMorning(addDays(today, -1)),
      [addDays(today, -2)]: entryWithMorning(addDays(today, -2)),
    };
    expect(computeStreak(entries, today)).toBe(3);
  });

  it('stops at the first gap', () => {
    const entries: Record<IsoDate, DayEntry> = {
      [today]: entryWithMorning(today),
      [addDays(today, -2)]: entryWithMorning(addDays(today, -2)),
    };
    expect(computeStreak(entries, today)).toBe(1);
  });
});

describe('doseChangeMarkers', () => {
  it('returns only the dates that have a dose change', () => {
    const dates = lastNDates(5, '2026-07-17' as IsoDate);
    const doses: readonly DoseChange[] = [
      { date: '2026-07-15' as IsoDate, dose: { amount: 40, unit: 'mg' } },
      { date: '2099-01-01' as IsoDate, dose: { amount: 60, unit: 'mg' } },
    ];
    const markers = doseChangeMarkers(doses, dates);
    expect(Array.from(markers)).toEqual(['2026-07-15']);
  });
});

describe('persistence', () => {
  it('round-trips a profile through save/load', async () => {
    const profile = buildProfile();
    await saveProfile(profile);
    expect(await loadProfile()).toEqual(profile);
  });

  it('returns null when no profile has been saved', async () => {
    expect(await loadProfile()).toBeNull();
  });

  it('returns null when the stored profile JSON is corrupted', async () => {
    await AsyncStorage.setItem('profile', '{not valid json');
    expect(await loadProfile()).toBeNull();
  });

  it('returns null when the stored profile is valid JSON but the wrong shape', async () => {
    await AsyncStorage.setItem('profile', JSON.stringify({ medName: 'x' }));
    expect(await loadProfile()).toBeNull();
  });

  it('returns an empty list when the stored doses are the wrong shape', async () => {
    await AsyncStorage.setItem('doses', JSON.stringify([{ date: 'bad' }]));
    expect(await loadDoseChanges()).toEqual([]);
  });

  it('returns an empty map when the stored entries are the wrong shape', async () => {
    await AsyncStorage.setItem('entries', JSON.stringify({ 'not-a-date': {} }));
    expect(await loadEntries()).toEqual({});
  });

  it('appends and sorts dose changes', async () => {
    await appendDoseChange({ date: '2026-07-10' as IsoDate, dose: { amount: 40, unit: 'mg' } });
    const doses = await appendDoseChange({
      date: '2026-07-01' as IsoDate,
      dose: { amount: 20, unit: 'mg' },
    });
    expect(doses.map((change) => change.date)).toEqual(['2026-07-01', '2026-07-10']);
    expect(await loadDoseChanges()).toEqual(doses);
  });

  it('saveCheckin preserves the other session for the same day', async () => {
    const date = '2026-07-17' as IsoDate;
    await saveCheckin(date, {
      session: 'morning',
      checkin: {
        ratings: { sleepQuality: 4, wakingMood: 4 },
        doseTaken: true,
        completedAt: isoTimestampNow(),
      },
    });
    await saveCheckin(date, {
      session: 'evening',
      checkin: {
        ratings: {
          mood: 3,
          focus: 3,
          impulsivity: 2,
          anxiety: 2,
          energy: 3,
          appetite: 3,
          libido: 3,
        },
        sideEffects: {},
        completedAt: isoTimestampNow(),
      },
    });
    const entries = await loadEntries();
    const entry = entries[date];
    expect(entry?.morning?.doseTaken).toBe(true);
    expect(entry?.evening?.ratings.mood).toBe(3);

    await saveCheckin(date, {
      session: 'morning',
      checkin: {
        ratings: { sleepQuality: 2, wakingMood: 2 },
        doseTaken: false,
        completedAt: isoTimestampNow(),
      },
    });
    const updated = (await loadEntries())[date];
    expect(updated?.morning?.ratings.sleepQuality).toBe(2);
    expect(updated?.evening?.ratings.mood).toBe(3);
  });

  it('restoreBackup persists profile, doses, and entries together', async () => {
    const profile = buildProfile();
    const doses: readonly DoseChange[] = [
      { date: '2026-07-01' as IsoDate, dose: { amount: 20, unit: 'mg' } },
    ];
    const entries: Readonly<Record<IsoDate, DayEntry>> = {
      ['2026-07-01' as IsoDate]: {
        date: '2026-07-01' as IsoDate,
        morning: {
          ratings: { sleepQuality: 4, wakingMood: 4 },
          doseTaken: true,
          completedAt: isoTimestampNow(),
        },
      },
    };
    const backup: Backup = { exportedAt: isoTimestampNow(), profile, doses, entries };

    await restoreBackup(backup);

    expect(await loadProfile()).toEqual(profile);
    expect(await loadDoseChanges()).toEqual(doses);
    expect(await loadEntries()).toEqual(entries);
  });

  it('restoreBackup with a null profile leaves the existing profile untouched', async () => {
    const existing = buildProfile();
    await saveProfile(existing);
    const backup: Backup = { exportedAt: isoTimestampNow(), profile: null, doses: [], entries: {} };

    await restoreBackup(backup);

    expect(await loadProfile()).toEqual(existing);
    expect(await loadDoseChanges()).toEqual([]);
  });

  it('round-trips buildBackup -> restoreBackup -> load*', async () => {
    const profile = buildProfile();
    const doses: readonly DoseChange[] = [
      { date: '2026-07-02' as IsoDate, dose: { amount: 40, unit: 'mg' }, note: 'titration' },
    ];
    const entries: Readonly<Record<IsoDate, DayEntry>> = {
      ['2026-07-02' as IsoDate]: {
        date: '2026-07-02' as IsoDate,
        evening: { ratings: { mood: 3 }, sideEffects: {}, completedAt: isoTimestampNow() },
      },
    };
    const backup = buildBackup(profile, doses, entries);

    await restoreBackup(backup);

    expect(await loadProfile()).toEqual(profile);
    expect(await loadDoseChanges()).toEqual(doses);
    expect(await loadEntries()).toEqual(entries);
  });
});

describe('parseEntriesTolerant', () => {
  const goodDay = {
    date: '2026-07-01',
    morning: {
      ratings: { sleepQuality: 4, wakingMood: 3 },
      doseTaken: true,
      completedAt: '2026-07-01T07:00:00.000Z',
    },
  };

  it('keeps good days and lists the dropped keys', () => {
    const parsed = parseEntriesTolerant({
      '2026-07-01': goodDay,
      '2026-07-02': { date: '2026-07-02', morning: { ratings: { sleepQuality: 9 } } },
      'not-a-date': goodDay,
    });
    expect(Object.keys(parsed.entries)).toEqual(['2026-07-01']);
    expect([...parsed.droppedKeys].sort()).toEqual(['2026-07-02', 'not-a-date']);
    expect(parsed.hardFailure).toBe(false);
  });

  it('reports a hard failure for non-object input', () => {
    expect(parseEntriesTolerant('nope')).toEqual({
      entries: {},
      droppedKeys: [],
      hardFailure: true,
    });
    expect(parseEntriesTolerant([]).hardFailure).toBe(true);
  });
});

describe('tolerant persistence', () => {
  const morningInput: CheckinInput = {
    session: 'morning',
    checkin: {
      ratings: { sleepQuality: 4, wakingMood: 4 },
      doseTaken: true,
      completedAt: isoTimestampNow(),
    },
  };

  it('saveCheckin aborts and quarantines when the stored entries are unreadable', async () => {
    await AsyncStorage.setItem('entries', '{not valid json');
    await expect(saveCheckin('2026-07-17' as IsoDate, morningInput)).rejects.toThrow(/unreadable/);
    // The original bad blob is left intact, not overwritten by the single new day.
    expect(await AsyncStorage.getItem('entries')).toBe('{not valid json');
    const corruptKey = (await AsyncStorage.getAllKeys()).find((key) =>
      key.startsWith('entries.corrupt.'),
    );
    expect(corruptKey).toBeDefined();
    if (corruptKey !== undefined) {
      expect(await AsyncStorage.getItem(corruptKey)).toBe('{not valid json');
    }
  });

  it('saveCheckin writes onto a genuinely empty store', async () => {
    const entry = await saveCheckin('2026-07-17' as IsoDate, morningInput);
    expect(entry.morning?.ratings.sleepQuality).toBe(4);
    expect((await loadEntries())['2026-07-17' as IsoDate]?.morning?.ratings.sleepQuality).toBe(4);
  });

  it('saveCheckin merges onto survivors when some stored days are corrupt', async () => {
    await AsyncStorage.setItem(
      'entries',
      JSON.stringify({
        '2026-07-01': {
          date: '2026-07-01',
          evening: {
            ratings: { mood: 3 },
            sideEffects: [],
            completedAt: '2026-07-01T20:00:00.000Z',
          },
        },
        bad: { nope: true },
      }),
    );
    await saveCheckin('2026-07-02' as IsoDate, morningInput);
    expect(Object.keys(await loadEntries()).sort()).toEqual(['2026-07-01', '2026-07-02']);
    expect(
      (await AsyncStorage.getAllKeys()).some((key) => key.startsWith('entries.corrupt.')),
    ).toBe(true);
  });

  it('loadDoseChanges drops a malformed change and keeps the rest', async () => {
    await AsyncStorage.setItem(
      'doses',
      JSON.stringify([
        { date: '2026-07-01', dose: { amount: 20, unit: 'mg' } },
        { date: 'bad' },
        { date: '2026-07-05', dose: { amount: 40, unit: 'mg' } },
      ]),
    );
    expect((await loadDoseChanges()).map((change) => change.date)).toEqual([
      '2026-07-01',
      '2026-07-05',
    ]);
  });
});
