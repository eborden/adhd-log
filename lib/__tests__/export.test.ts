import { beforeEach, describe, expect, it } from 'vitest';
import { __setMockFileExists, __setMockPickedText } from '../__mocks__/expo-file-system';
import {
  averageOf,
  buildBackup,
  buildReportHtml,
  exportJsonBackup,
  exportPdfReport,
  importJsonBackup,
  parseBackup,
  ratingAccessor,
  rowsInRange,
} from '../export';
import { isoTimestampNow } from '../storage';
import type { DayEntry, DoseChange, IsoDate, Profile, Rating } from '../types';

const DAY_1 = '2026-07-01' as IsoDate;
const DAY_2 = '2026-07-02' as IsoDate;
const DAY_3 = '2026-07-03' as IsoDate;

function morningRow(date: IsoDate, sleepQuality: Rating): DayEntry {
  return {
    date,
    morning: { doseTaken: true, sleepQuality, wakingMood: 3, completedAt: isoTimestampNow() },
  };
}

describe('averageOf', () => {
  it('averages the values an accessor picks out, skipping missing days', () => {
    const rows: readonly DayEntry[] = [morningRow(DAY_1, 2), { date: DAY_2 }, morningRow(DAY_3, 4)];
    const average = averageOf(rows, (row) => row.morning?.sleepQuality);
    expect(average).toBe(3);
  });

  it('returns null when no row has a value', () => {
    const rows: readonly DayEntry[] = [{ date: DAY_1 }, { date: DAY_2 }];
    expect(averageOf(rows, (row) => row.morning?.sleepQuality)).toBeNull();
  });
});

describe('rowsInRange', () => {
  it('fills gaps with an empty entry for the missing date', () => {
    const entries = { [DAY_1]: morningRow(DAY_1, 5) };
    const rows = rowsInRange(entries, [DAY_1, DAY_2]);
    expect(rows).toEqual([morningRow(DAY_1, 5), { date: DAY_2 }]);
  });
});

describe('ratingAccessor', () => {
  it('reads morning ratings only from the morning session', () => {
    const accessor = ratingAccessor('morning', 'sleepQuality');
    expect(accessor?.(morningRow(DAY_1, 5))).toBe(5);
  });

  it('returns undefined for a key that does not belong to the session', () => {
    expect(ratingAccessor('morning', 'mood')).toBeUndefined();
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
    const html = buildReportHtml(profile, doses, rows);

    expect(html).toContain('Atomoxetine');
    expect(html).toContain('Morning averages');
    expect(html).toContain('Sleep quality');
    expect(html).toContain(DAY_1);
    expect(html).toContain(DAY_2);
    expect(html).toContain('Dose changes');
    expect(html).toContain('titrating up');
  });

  it('lists side effects for a day that logged any', () => {
    const rowWithSideEffects: DayEntry = {
      date: DAY_1,
      evening: {
        mood: 3,
        focus: 3,
        impulsivity: 2,
        anxiety: 2,
        energy: 3,
        appetite: 3,
        libido: 3,
        sideEffects: ['nausea', 'headache'],
        completedAt: isoTimestampNow(),
      },
    };
    const html = buildReportHtml(null, [], [rowWithSideEffects]);
    expect(html).toContain('Nausea, Headache');
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
    const html = buildReportHtml(profile, [], [{ date: DAY_1 }]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
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
