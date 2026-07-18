import {
  SIDE_EFFECTS,
  type EveningRatingKey,
  type Metric,
  type Profile,
  type RatingKey,
  type ScaleDirection,
  type SideEffect,
} from './types';

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
  { kind: 'stepper', key: 'sleepHours', label: 'Hours slept', min: 0, max: 14, step: 1 },
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

/** Evening ratings active out of the box — the rest stay toggleable in Settings. */
export const DEFAULT_ENABLED_EVENING_METRICS: readonly EveningRatingKey[] = [
  'mood',
  'focus',
  'energy',
  'anxiety',
] as const;

export function enabledEveningMetricKeys(profile: Profile | null): readonly EveningRatingKey[] {
  return profile?.enabledEveningMetrics ?? DEFAULT_ENABLED_EVENING_METRICS;
}

export function withEveningMetricToggled(
  enabled: readonly EveningRatingKey[],
  key: EveningRatingKey,
  isEnabled: boolean,
): readonly EveningRatingKey[] {
  if (isEnabled) return enabled.includes(key) ? enabled : [...enabled, key];
  return enabled.filter((existing) => existing !== key);
}

type ScaleMetric = Extract<Metric, { kind: 'scale' }>;

/** The good/bad direction for a scale metric's key, looked up from the schema. */
export function directionForRatingKey(key: RatingKey): ScaleDirection | undefined {
  const metric = [...MORNING_METRICS, ...EVENING_METRICS].find(
    (candidate): candidate is ScaleMetric => candidate.kind === 'scale' && candidate.key === key,
  );
  return metric?.direction;
}
