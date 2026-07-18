import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENABLED_EVENING_METRICS,
  EVENING_METRICS,
  MORNING_METRICS,
  SIDE_EFFECT_LABELS,
  enabledEveningMetricKeys,
  withEveningMetricToggled,
} from '../schema';
import { EVENING_RATING_KEYS, SIDE_EFFECTS } from '../types';
import type { Profile } from '../types';

describe('MORNING_METRICS', () => {
  it('tracks dose, sleep quality, sleep hours, and waking mood', () => {
    const keys = MORNING_METRICS.map((metric) => metric.key);
    expect(keys).toEqual(['doseTaken', 'sleepQuality', 'sleepHours', 'wakingMood']);
  });

  it('marks sleep quality and waking mood as higher-is-better scales', () => {
    const sleepQuality = MORNING_METRICS.find((metric) => metric.key === 'sleepQuality');
    expect(sleepQuality?.kind).toBe('scale');
    if (sleepQuality?.kind === 'scale') {
      expect(sleepQuality.direction).toBe('higher-better');
    }
  });
});

describe('EVENING_METRICS', () => {
  it('tracks all seven ratings plus side effects and notes', () => {
    const keys = EVENING_METRICS.map((metric) => metric.key);
    expect(keys).toEqual([
      'mood',
      'focus',
      'impulsivity',
      'anxiety',
      'energy',
      'appetite',
      'libido',
      'sideEffects',
      'notes',
    ]);
  });

  it('marks impulsivity and anxiety as lower-is-better scales', () => {
    const inverted = EVENING_METRICS.filter(
      (metric) => metric.kind === 'scale' && metric.direction === 'lower-better',
    );
    expect(inverted.map((metric) => metric.key)).toEqual(['impulsivity', 'anxiety']);
  });
});

describe('SIDE_EFFECT_LABELS', () => {
  it('has a human-readable label for every side effect', () => {
    for (const effect of SIDE_EFFECTS) {
      expect(SIDE_EFFECT_LABELS[effect]).toBeTruthy();
    }
  });
});

describe('DEFAULT_ENABLED_EVENING_METRICS', () => {
  it('is mood, focus, energy, anxiety', () => {
    expect(DEFAULT_ENABLED_EVENING_METRICS).toEqual(['mood', 'focus', 'energy', 'anxiety']);
  });

  it('every entry is a valid evening rating key', () => {
    for (const key of DEFAULT_ENABLED_EVENING_METRICS) {
      expect(EVENING_RATING_KEYS).toContain(key);
    }
  });
});

describe('enabledEveningMetricKeys', () => {
  const profileWithout: Profile = {
    medName: 'Atomoxetine' as Profile['medName'],
    startDate: '2026-01-01' as Profile['startDate'],
    currentDose: { amount: 40, unit: 'mg' },
    morningReminder: { hour: 8, minute: 0 },
    eveningReminder: { hour: 20, minute: 0 },
    lockEnabled: false,
    createdAt: '2026-01-01T09:00:00.000Z' as Profile['createdAt'],
  };

  it('falls back to the default set for a null profile', () => {
    expect(enabledEveningMetricKeys(null)).toEqual(DEFAULT_ENABLED_EVENING_METRICS);
  });

  it('falls back to the default set when the profile has no field set', () => {
    expect(enabledEveningMetricKeys(profileWithout)).toEqual(DEFAULT_ENABLED_EVENING_METRICS);
  });

  it('returns the profile field when set', () => {
    const profileWith = { ...profileWithout, enabledEveningMetrics: ['mood', 'libido'] as const };
    expect(enabledEveningMetricKeys(profileWith)).toEqual(['mood', 'libido']);
  });
});

describe('withEveningMetricToggled', () => {
  it('adds a key that is not yet enabled', () => {
    expect(withEveningMetricToggled(['mood'], 'focus', true)).toEqual(['mood', 'focus']);
  });

  it('does not duplicate a key that is already enabled', () => {
    expect(withEveningMetricToggled(['mood', 'focus'], 'focus', true)).toEqual(['mood', 'focus']);
  });

  it('removes a key that is enabled', () => {
    expect(withEveningMetricToggled(['mood', 'focus'], 'focus', false)).toEqual(['mood']);
  });

  it('is a no-op removing a key that is not enabled', () => {
    expect(withEveningMetricToggled(['mood'], 'libido', false)).toEqual(['mood']);
  });

  it('seeds from the default set before adding', () => {
    const seeded = withEveningMetricToggled(enabledEveningMetricKeys(null), 'libido', true);
    expect(seeded).toEqual(['mood', 'focus', 'energy', 'anxiety', 'libido']);
  });
});
