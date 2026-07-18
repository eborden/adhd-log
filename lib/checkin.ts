import {
  type EveningCheckin,
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
 * The persisted ratings sub-object for a session, built by looping that session's key list rather
 * than naming each field. Only defined values are assigned (respecting `exactOptionalPropertyTypes`).
 */
export function ratingsFromDraft<K extends RatingKey>(
  keys: readonly K[],
  ratings: Readonly<Partial<Record<RatingKey, Rating>>>,
): Partial<Record<K, Rating>> {
  const out: Partial<Record<K, Rating>> = {};
  for (const key of keys) {
    const value = ratings[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export function draftFromMorning(checkin: MorningCheckin): Draft {
  return {
    doseTaken: checkin.doseTaken,
    ratings: { ...checkin.ratings },
    sleepHours: checkin.sleepHours ?? DEFAULT_SLEEP_HOURS,
    sideEffects: [],
    notes: '',
  };
}

export function draftFromEvening(checkin: EveningCheckin): Draft {
  return {
    doseTaken: false,
    ratings: { ...checkin.ratings },
    sleepHours: undefined,
    sideEffects: checkin.sideEffects,
    notes: checkin.notes ?? '',
  };
}

/** Parses a dose-amount text field to a positive finite number, or undefined if invalid. */
export function parseDoseAmount(text: string): number | undefined {
  const amount = Number(text);
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}
