import { beforeEach, describe, expect, it } from 'vitest';
import { __setMockFileExists, __setMockPickedText } from '../__mocks__/expo-file-system';
import {
  adherenceInRange,
  averageOf,
  buildBackup,
  buildReportHtml,
  collectNotes,
  exportJsonBackup,
  exportPdfReport,
  importJsonBackup,
  parseBackup,
  ratingAccessor,
  rowsInRange,
  severityRunLength,
  sideEffectSummary,
  type ReportOptions,
} from '../export';
import { isoTimestampNow } from '../storage';
import type { DayEntry, DoseChange, IsoDate, Profile, Rating, SideEffect } from '../types';

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
    expect(html).toContain('Morning averages');
    expect(html).toContain('Sleep quality');
    expect(html).toContain(DAY_1);
    expect(html).toContain(DAY_2);
    expect(html).toContain('Dose changes');
    expect(html).toContain('titrating up');
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

    // mood/focus answered both days: (5+3)/2 = 4.0
    expect(html).toContain('<td>Overall mood today</td><td>4.0</td>');
    expect(html).toContain('<td>Focus / attention</td><td>4.0</td>');
    // libido answered only on DAY_2: average is still 4.0, just from one day
    expect(html).toContain('<td>Libido</td><td>4.0</td>');
    // anxiety never answered on either day: omitted entirely, not shown with a dash
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
    expect(html).toContain('Dose taken on 1 of 2 logged mornings in this range.');
    expect(html).toContain('Nausea');
    expect(html).toContain('Moderate×1, Severe×1');
    expect(html).toContain('40mg');
    // hasMigratedDays → asterisk + footnote
    expect(html).toContain('Nausea *');
    expect(html).toContain('defaulted when migrating');
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

describe('adherenceInRange', () => {
  it('counts doses taken over logged mornings, ignoring evening-only days', () => {
    const rows: readonly DayEntry[] = [
      morningRow(DAY_1, 3), // doseTaken true
      { date: DAY_2 }, // no morning
      {
        date: DAY_3,
        morning: { ratings: {}, doseTaken: false, completedAt: isoTimestampNow() },
      },
    ];
    expect(adherenceInRange(rows)).toEqual({ dosesTaken: 1, loggedMornings: 2 });
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
