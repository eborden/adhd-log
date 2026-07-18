import {
  EVENING_RATING_KEYS,
  type EveningCheckin,
  type EveningRatingKey,
  type MorningCheckin,
  type Rating,
  type RatingKey,
  type SideEffect,
} from './types';

/**
 * The editable check-in form state. Both sessions share one Draft; `ratings` is keyed by
 * `RatingKey` so a new scale metric flows through save/hydrate by looping the schema key
 * lists below — no per-field enumeration to keep in sync.
 */
export interface Draft {
  readonly doseTaken: boolean;
  readonly ratings: Readonly<Partial<Record<RatingKey, Rating>>>;
  readonly sleepHours: number | undefined;
  readonly sideEffects: readonly SideEffect[];
  readonly notes: string;
}

// A typical night, not the stepper's floor — starting at 0 meant a normal
// 7-8 hour night took a dozen-plus taps to reach.
const DEFAULT_SLEEP_HOURS = 7;

export const EMPTY_DRAFT: Draft = {
  // Enabled by default: the common case is that the dose was taken, so a fresh
  // morning check-in starts with this on. Editing an existing entry still
  // hydrates the stored value via draftFromMorning.
  doseTaken: true,
  ratings: {},
  sleepHours: DEFAULT_SLEEP_HOURS,
  sideEffects: [],
  notes: '',
};

/**
 * The persisted evening ratings sub-object, built by looping `EVENING_RATING_KEYS` rather than
 * naming each field. Only defined values are assigned (respecting `exactOptionalPropertyTypes`).
 */
export function eveningRatingsFromDraft(
  ratings: Readonly<Partial<Record<RatingKey, Rating>>>,
): Partial<Record<EveningRatingKey, Rating>> {
  const out: Partial<Record<EveningRatingKey, Rating>> = {};
  for (const key of EVENING_RATING_KEYS) {
    const value = ratings[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export function draftFromMorning(checkin: MorningCheckin): Draft {
  return {
    doseTaken: checkin.doseTaken,
    ratings: { sleepQuality: checkin.sleepQuality, wakingMood: checkin.wakingMood },
    sleepHours: checkin.sleepHours ?? DEFAULT_SLEEP_HOURS,
    sideEffects: [],
    notes: '',
  };
}

export function draftFromEvening(checkin: EveningCheckin): Draft {
  const ratings: Partial<Record<EveningRatingKey, Rating>> = {};
  for (const key of EVENING_RATING_KEYS) {
    const value = checkin[key];
    if (value !== undefined) ratings[key] = value;
  }
  return {
    doseTaken: false,
    ratings,
    sleepHours: undefined,
    sideEffects: checkin.sideEffects,
    notes: checkin.notes ?? '',
  };
}
