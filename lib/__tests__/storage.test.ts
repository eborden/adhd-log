import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addDays,
  appendDoseChange,
  clearAllData,
  computeStreak,
  doseChangeMarkers,
  formatIsoDate,
  isDayEntry,
  isDoseChangeList,
  isEntries,
  isIsoDate,
  isIsoTimestamp,
  isMedName,
  isProfile,
  isRating,
  isSideEffect,
  isoTimestampNow,
  lastNDates,
  loadDoseChanges,
  loadEntries,
  loadProfile,
  parseDoseChangeList,
  parseEntries,
  parseIsoDate,
  parseProfile,
  saveCheckin,
  saveProfile,
  todayIsoDate,
} from '../storage';
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
  await clearAllData();
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
});

describe('isDayEntry / isEntries', () => {
  const validEntry = {
    date: '2026-07-17',
    morning: {
      doseTaken: true,
      sleepQuality: 4,
      wakingMood: 3,
      completedAt: '2026-07-17T07:00:00.000Z',
    },
  };

  it('accepts a day entry with only a morning session', () => {
    expect(isDayEntry(validEntry)).toBe(true);
  });

  it('rejects a day entry with a malformed morning session', () => {
    expect(isDayEntry({ ...validEntry, morning: { ...validEntry.morning, sleepQuality: 9 } })).toBe(
      false,
    );
  });

  it('rejects an entries map with a bad date key', () => {
    expect(isEntries({ 'not-a-date': validEntry })).toBe(false);
  });

  it('accepts an empty entries map', () => {
    expect(isEntries({})).toBe(true);
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

describe('parseProfile / parseDoseChangeList / parseEntries', () => {
  it('returns ok:true for valid JSON', () => {
    expect(parseProfile(VALID_PROFILE)).toEqual({ ok: true, value: VALID_PROFILE });
    expect(parseDoseChangeList([])).toEqual({ ok: true, value: [] });
    expect(parseEntries({})).toEqual({ ok: true, value: {} });
  });

  it('returns ok:false with a reason for malformed JSON', () => {
    const badProfile = parseProfile({ medName: 'x' });
    expect(badProfile.ok).toBe(false);
    if (!badProfile.ok) expect(badProfile.reason).toMatch(/profile/i);

    const badDoses = parseDoseChangeList([{}]);
    expect(badDoses.ok).toBe(false);

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
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3, completedAt: isoTimestampNow() },
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
      checkin: { doseTaken: true, sleepQuality: 4, wakingMood: 4, completedAt: isoTimestampNow() },
    });
    await saveCheckin(date, {
      session: 'evening',
      checkin: {
        mood: 3,
        focus: 3,
        impulsivity: 2,
        anxiety: 2,
        energy: 3,
        appetite: 3,
        libido: 3,
        sideEffects: [],
        completedAt: isoTimestampNow(),
      },
    });
    const entries = await loadEntries();
    const entry = entries[date];
    expect(entry?.morning?.doseTaken).toBe(true);
    expect(entry?.evening?.mood).toBe(3);

    await saveCheckin(date, {
      session: 'morning',
      checkin: { doseTaken: false, sleepQuality: 2, wakingMood: 2, completedAt: isoTimestampNow() },
    });
    const updated = (await loadEntries())[date];
    expect(updated?.morning?.sleepQuality).toBe(2);
    expect(updated?.evening?.mood).toBe(3);
  });

  it('clearAllData removes profile, doses, and entries', async () => {
    await saveProfile(buildProfile());
    await appendDoseChange({ date: '2026-07-01' as IsoDate, dose: { amount: 20, unit: 'mg' } });
    await saveCheckin('2026-07-17' as IsoDate, {
      session: 'morning',
      checkin: { doseTaken: true, sleepQuality: 4, wakingMood: 4, completedAt: isoTimestampNow() },
    });

    await clearAllData();

    expect(await loadProfile()).toBeNull();
    expect(await loadDoseChanges()).toEqual([]);
    expect(await loadEntries()).toEqual({});
  });
});
