import { describe, expect, it } from 'vitest';
import { EVENING_METRICS, MORNING_METRICS, SIDE_EFFECT_LABELS } from '../schema';
import { SIDE_EFFECTS } from '../types';

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
