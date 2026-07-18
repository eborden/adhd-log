import { SIDE_EFFECTS, type Metric, type SideEffect } from './types';

/**
 * Single source of truth for check-in fields. Both check-in sessions render
 * generically from these arrays — add or rename a tracked metric here only.
 */
export const MORNING_METRICS: readonly Metric[] = [
  { kind: 'toggle', key: 'doseTaken', label: "Took today's dose" },
  {
    kind: 'scale',
    key: 'sleepQuality',
    label: 'Sleep quality',
    low: 'Poor',
    high: 'Great',
    direction: 'higher-better',
  },
  { kind: 'stepper', key: 'sleepHours', label: 'Hours slept', min: 0, max: 14, step: 0.5 },
  {
    kind: 'scale',
    key: 'wakingMood',
    label: 'How you feel waking up',
    low: 'Rough',
    high: 'Great',
    direction: 'higher-better',
  },
] as const;

export const EVENING_METRICS: readonly Metric[] = [
  {
    kind: 'scale',
    key: 'mood',
    label: 'Overall mood today',
    low: 'Low',
    high: 'Great',
    direction: 'higher-better',
  },
  {
    kind: 'scale',
    key: 'focus',
    label: 'Focus / attention',
    low: 'Scattered',
    high: 'Sharp',
    direction: 'higher-better',
  },
  {
    kind: 'scale',
    key: 'impulsivity',
    label: 'Impulsivity',
    low: 'In control',
    high: 'Very impulsive',
    direction: 'lower-better',
  },
  {
    kind: 'scale',
    key: 'anxiety',
    label: 'Anxiety / irritability',
    low: 'Calm',
    high: 'On edge',
    direction: 'lower-better',
  },
  {
    kind: 'scale',
    key: 'energy',
    label: 'Energy',
    low: 'Drained',
    high: 'Energized',
    direction: 'higher-better',
  },
  {
    kind: 'scale',
    key: 'appetite',
    label: 'Appetite',
    low: 'None',
    high: 'Ravenous',
    direction: 'neutral',
  },
  {
    kind: 'scale',
    key: 'libido',
    label: 'Libido',
    low: 'Low',
    high: 'High',
    direction: 'neutral',
  },
  { kind: 'chips', key: 'sideEffects', label: 'Side effects', options: SIDE_EFFECTS },
  { kind: 'text', key: 'notes', label: 'Anything else' },
] as const;

export const SIDE_EFFECT_LABELS: Readonly<Record<SideEffect, string>> = {
  nausea: 'Nausea',
  headache: 'Headache',
  dizziness: 'Dizziness',
  dryMouth: 'Dry mouth',
  giUpset: 'Stomach / GI',
  insomnia: 'Insomnia',
  sweating: 'Sweating',
  racingHeart: 'Racing heart',
  other: 'Other',
};
