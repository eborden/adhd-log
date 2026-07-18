import {
  SIDE_EFFECTS,
  assertNever,
  type EveningRatingKey,
  type Metric,
  type Profile,
  type RatingKey,
  type ScaleDirection,
  type SideEffect,
  type SideEffectDetail,
  type SideEffectReports,
  type SideEffectSeverity,
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

export const SIDE_EFFECT_SEVERITY_LABELS: Readonly<Record<SideEffectSeverity, string>> = {
  mild: 'Mild',
  moderate: 'Moderate',
  severe: 'Severe',
};

/** Bound to the secondary severity control only, never the chip body. Exhaustive → assertNever. */
export function cycleSeverity(current: SideEffectSeverity): SideEffectSeverity {
  switch (current) {
    case 'mild':
      return 'moderate';
    case 'moderate':
      return 'severe';
    case 'severe':
      return 'mild';
    default:
      return assertNever(current);
  }
}

export function isSideEffectSelected(reports: SideEffectReports, effect: SideEffect): boolean {
  return reports[effect] !== undefined;
}

/** Toggle select/deselect. New selections start at 'mild' (freshly-captured, least-assuming). */
export function withSideEffectToggled(
  reports: SideEffectReports,
  effect: SideEffect,
): SideEffectReports {
  if (reports[effect] === undefined) {
    return { ...reports, [effect]: { severity: 'mild' } };
  }
  const next: Partial<Record<SideEffect, SideEffectDetail>> = {};
  for (const key of SIDE_EFFECTS) {
    if (key === effect) continue;
    const detail = reports[key];
    if (detail !== undefined) next[key] = detail; // rebuild without the removed key (no dynamic delete)
  }
  return next;
}

/** Set severity for an already-selected effect. No-op if not selected. */
export function withSideEffectSeverity(
  reports: SideEffectReports,
  effect: SideEffect,
  severity: SideEffectSeverity,
): SideEffectReports {
  if (reports[effect] === undefined) return reports;
  return { ...reports, [effect]: { severity } }; // omits `origin`: now user-entered, not migrated
}

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

/**
 * The order rating metrics appear in the provider report (cover trend arrows, per-period tables).
 * Kept here so report ordering is a single source of truth in the schema, not hard-coded in
 * `export.ts`. Morning keys first, then evening in check-in order.
 */
export const REPORT_RATING_ORDER: readonly RatingKey[] = [
  'sleepQuality',
  'wakingMood',
  'mood',
  'focus',
  'impulsivity',
  'anxiety',
  'energy',
  'appetite',
  'libido',
] as const;

type ScaleMetric = Extract<Metric, { kind: 'scale' }>;

/** The good/bad direction for a scale metric's key, looked up from the schema. */
export function directionForRatingKey(key: RatingKey): ScaleDirection | undefined {
  const metric = [...MORNING_METRICS, ...EVENING_METRICS].find(
    (candidate): candidate is ScaleMetric => candidate.kind === 'scale' && candidate.key === key,
  );
  return metric?.direction;
}
