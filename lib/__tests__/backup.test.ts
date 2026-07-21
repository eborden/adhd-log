import { describe, expect, it } from 'vitest';
import { buildBackup, parseBackup } from '../backup';
import { isoTimestampNow } from '../storage';
import type { DayEntry, DoseChange, IsoDate, Rating } from '../types';

const DAY_1 = '2026-07-01' as IsoDate;

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
