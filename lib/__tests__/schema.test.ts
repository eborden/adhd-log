import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENABLED_EVENING_METRICS,
  EVENING_METRICS,
  MORNING_METRICS,
  SIDE_EFFECT_LABELS,
  SIDE_EFFECT_SEVERITY_LABELS,
  cycleSeverity,
  directionForRatingKey,
  enabledEveningMetricKeys,
  isSideEffectSelected,
  withEveningMetricToggled,
  withSideEffectSeverity,
  withSideEffectToggled,
} from '../schema';
import { EVENING_RATING_KEYS, SIDE_EFFECTS, SIDE_EFFECT_SEVERITIES } from '../types';
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

describe('SIDE_EFFECT_SEVERITY_LABELS', () => {
  it('has a label for every severity', () => {
    for (const severity of SIDE_EFFECT_SEVERITIES) {
      expect(SIDE_EFFECT_SEVERITY_LABELS[severity]).toBeTruthy();
    }
  });
});

describe('cycleSeverity', () => {
  it('cycles mild -> moderate -> severe -> mild', () => {
    expect(cycleSeverity('mild')).toBe('moderate');
    expect(cycleSeverity('moderate')).toBe('severe');
    expect(cycleSeverity('severe')).toBe('mild');
  });
});

describe('withSideEffectToggled / isSideEffectSelected', () => {
  it('adds a new selection at mild severity', () => {
    const next = withSideEffectToggled({}, 'nausea');
    expect(next).toEqual({ nausea: { severity: 'mild' } });
    expect(isSideEffectSelected(next, 'nausea')).toBe(true);
    expect(isSideEffectSelected(next, 'headache')).toBe(false);
  });

  it('removes an existing selection, rebuilding without the key', () => {
    const start = {
      nausea: { severity: 'moderate' as const },
      headache: { severity: 'mild' as const },
    };
    const next = withSideEffectToggled(start, 'nausea');
    expect(next).toEqual({ headache: { severity: 'mild' } });
    expect('nausea' in next).toBe(false);
  });
});

describe('withSideEffectSeverity', () => {
  it('updates only the matching effect and drops the origin marker', () => {
    const start = {
      nausea: { severity: 'moderate' as const, origin: 'migrated' as const },
      headache: { severity: 'mild' as const },
    };
    const next = withSideEffectSeverity(start, 'nausea', 'severe');
    expect(next.nausea).toEqual({ severity: 'severe' });
    expect(next.headache).toEqual({ severity: 'mild' });
  });

  it('is a no-op on an unselected effect', () => {
    const start = { nausea: { severity: 'mild' as const } };
    expect(withSideEffectSeverity(start, 'headache', 'severe')).toBe(start);
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

describe('directionForRatingKey', () => {
  it('resolves the direction for every tracked scale metric', () => {
    expect(directionForRatingKey('sleepQuality')).toBe('higher-better');
    expect(directionForRatingKey('impulsivity')).toBe('lower-better');
    expect(directionForRatingKey('appetite')).toBe('neutral');
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
