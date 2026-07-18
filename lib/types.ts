/**
 * Domain types — single source of truth. No raw `number`/`string` for meaningful
 * values; branded types, literal unions, and discriminated unions make illegal
 * states unrepresentable.
 */

// Branded primitives — a plain string can't be passed where these are expected.
type Brand<T, B> = T & { readonly __brand: B };

/** "YYYY-MM-DD", local calendar day. */
export type IsoDate = Brand<string, 'IsoDate'>;
/** Full ISO instant, e.g. from `new Date().toISOString()`. */
export type IsoTimestamp = Brand<string, 'IsoTimestamp'>;
export type MedName = Brand<string, 'MedName'>;

export type Rating = 1 | 2 | 3 | 4 | 5;

export type Session = 'morning' | 'evening';

export const HOURS = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
] as const;
export type Hour = (typeof HOURS)[number];

export const MINUTES = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50,
  51, 52, 53, 54, 55, 56, 57, 58, 59,
] as const;
export type Minute = (typeof MINUTES)[number];

export type DoseUnit = 'mg' | 'mcg' | 'mL';

export const SIDE_EFFECTS = [
  'nausea',
  'headache',
  'dizziness',
  'dryMouth',
  'giUpset',
  'insomnia',
  'sweating',
  'racingHeart',
  'other',
] as const;
export type SideEffect = (typeof SIDE_EFFECTS)[number];

export interface TimeOfDay {
  readonly hour: Hour;
  readonly minute: Minute;
}

export interface Dose {
  readonly amount: number;
  readonly unit: DoseUnit;
}

export interface Profile {
  readonly medName: MedName;
  readonly startDate: IsoDate;
  readonly currentDose: Dose;
  readonly morningReminder: TimeOfDay;
  readonly eveningReminder: TimeOfDay;
  readonly lockEnabled: boolean;
  readonly createdAt: IsoTimestamp;
}

export interface DoseChange {
  readonly date: IsoDate;
  readonly dose: Dose;
  readonly note?: string;
}

export interface MorningCheckin {
  readonly doseTaken: boolean;
  readonly sleepQuality: Rating;
  readonly sleepHours?: number;
  readonly wakingMood: Rating;
  readonly completedAt: IsoTimestamp;
}

export interface EveningCheckin {
  readonly mood: Rating;
  readonly focus: Rating;
  readonly impulsivity: Rating;
  readonly anxiety: Rating;
  readonly energy: Rating;
  readonly appetite: Rating;
  readonly libido: Rating;
  readonly sideEffects: readonly SideEffect[];
  readonly notes?: string;
  readonly completedAt: IsoTimestamp;
}

export interface DayEntry {
  readonly date: IsoDate;
  readonly morning?: MorningCheckin;
  readonly evening?: EveningCheckin;
}

/** Every Rating-valued field across both check-in sessions. */
export type RatingKey =
  | 'sleepQuality'
  | 'wakingMood'
  | 'mood'
  | 'focus'
  | 'impulsivity'
  | 'anxiety'
  | 'energy'
  | 'appetite'
  | 'libido';

export type ScaleDirection = 'higher-better' | 'lower-better' | 'neutral';

/**
 * Discriminated union driving generic, exhaustive check-in rendering — see
 * `lib/schema.ts`. `switch (metric.kind)` must end with a `never` assertion so
 * adding a variant here forces every consumer to handle it.
 */
export type Metric =
  | {
      readonly kind: 'scale';
      readonly key: RatingKey;
      readonly label: string;
      readonly low: string;
      readonly high: string;
      readonly direction: ScaleDirection;
    }
  | { readonly kind: 'toggle'; readonly key: 'doseTaken'; readonly label: string }
  | {
      readonly kind: 'stepper';
      readonly key: 'sleepHours';
      readonly label: string;
      readonly min: number;
      readonly max: number;
      readonly step: number;
    }
  | {
      readonly kind: 'chips';
      readonly key: 'sideEffects';
      readonly label: string;
      readonly options: readonly SideEffect[];
    }
  | { readonly kind: 'text'; readonly key: 'notes'; readonly label: string };

/** Storage-boundary result: parse-don't-validate, no exceptions swallowed. */
export type Parsed<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

export function assertNever(value: never): never {
  throw new Error(`Unreachable case: ${JSON.stringify(value)}`);
}
