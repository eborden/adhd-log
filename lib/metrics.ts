import { formatIsoDate, isEveningRatingKey, isMorningRatingKey } from './storage';
import type {
  DayEntry,
  IsoDate,
  Profile,
  Rating,
  RatingKey,
  Session,
  TrendDirection,
} from './types';

// ---------------------------------------------------------------------------
// Generic DayEntry selectors and descriptive stats — RN-free, reused by
// report building and by screens (Trends, entry detail) that need the same
// per-row rating access without pulling in the report/backup machinery.
// ---------------------------------------------------------------------------

/**
 * The accessor for a scale metric's value, keyed by which session it belongs to. Under
 * `noUncheckedIndexedAccess` a keyed read is already `Rating | undefined`, so a single generic
 * accessor replaces the hand-written per-key maps. The session/key pairing is narrowed through
 * the schema key guards (a key that doesn't belong to the session always reads `undefined`).
 */
export function ratingAccessor(
  session: Session,
  key: RatingKey,
): (row: DayEntry) => Rating | undefined {
  if (session === 'morning') {
    if (!isMorningRatingKey(key)) return () => undefined;
    return (row) => row.morning?.ratings[key];
  }
  if (!isEveningRatingKey(key)) return () => undefined;
  return (row) => row.evening?.ratings[key];
}

/** Rows for a date range, oldest first, filling gaps with empty (unlogged) days. */
export function rowsInRange(
  entries: Readonly<Record<IsoDate, DayEntry>>,
  dates: readonly IsoDate[],
): readonly DayEntry[] {
  return dates.map((date) => entries[date] ?? { date });
}

export function averageOf(
  rows: readonly DayEntry[],
  pick: (row: DayEntry) => Rating | undefined,
): number | null {
  const values = rows.map(pick).filter((value): value is Rating => value !== undefined);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Logged-vs-total day count for one metric over a date range. Purely descriptive. */
export interface Coverage {
  readonly logged: number;
  readonly total: number;
}

/**
 * The first calendar day on which logging was possible — the date the profile
 * was created. Coverage denominators floor here so days before the app existed
 * are never counted as "missing". Not `startDate`: the medication start can
 * precede or follow install; the honest "could-have-logged" floor is app
 * existence (`createdAt`), not the med timeline.
 */
export function loggingStartDate(profile: Profile): IsoDate {
  return formatIsoDate(new Date(profile.createdAt));
}

/**
 * Counts logged (non-undefined) vs total rows for one accessor, purely
 * descriptively. When `since` is supplied, `total` is floored to rows on or
 * after that date, so days before logging was possible are not counted as
 * missing. Both counts derive from the same floored window, so `logged <= total`
 * holds structurally — and no logged entry can predate `createdAt`, so flooring
 * only ever removes empty pre-tenure gap rows, never a logged day.
 */
export function coverage(
  rows: readonly DayEntry[],
  pick: (row: DayEntry) => Rating | undefined,
  since?: IsoDate,
): Coverage {
  const inWindow = since === undefined ? rows : rows.filter((row) => row.date >= since);
  const logged = inWindow.filter((row) => pick(row) !== undefined).length;
  return { logged, total: inWindow.length };
}

/** Whether a day has any logged session at all (morning or evening). */
export function isDayLogged(row: DayEntry): boolean {
  return row.morning !== undefined || row.evening !== undefined;
}

/**
 * Page-level coverage: days with any logged session vs total days in the window. Floors `total`
 * to `since` exactly like `coverage()`, so pre-tenure days are never counted as missing.
 */
export function daysLoggedCoverage(rows: readonly DayEntry[], since?: IsoDate): Coverage {
  const inWindow = since === undefined ? rows : rows.filter((row) => row.date >= since);
  const logged = inWindow.filter(isDayLogged).length;
  return { logged, total: inWindow.length };
}

/**
 * A computed average is either a real mean over >=1 sample, or explicitly empty. No NaN, no magic
 * -1: the empty case is a distinct variant, so `noUncheckedIndexedAccess` concerns vanish and a
 * missing average can never be read as a number. This is the single canonical "maybe a mean" the
 * whole report module uses.
 */
export type MetricAverage =
  | { readonly kind: 'value'; readonly mean: number; readonly n: number }
  | { readonly kind: 'empty' };

/**
 * A trend is the descriptive comparison of two halves. `flat` still carries the halves and delta,
 * so the renderer never recomputes or branches on missing data; `insufficient` is a distinct
 * variant, never `direction: 'flat'` masquerading as a measured comparison.
 */
export type MetricTrend =
  | { readonly kind: 'insufficient' } // empty half, or < MIN_HALF_SAMPLES in either half
  | {
      readonly kind: 'measured';
      readonly direction: TrendDirection;
      readonly firstHalf: number;
      readonly secondHalf: number;
      readonly delta: number;
    };

// Neutral deadband: |delta| below this renders 'flat'. Chosen at 0.3 of a 1..5 point so a
// rounding-level wobble never reads as a direction.
const TREND_DEADBAND = 0.3;

// Minimum samples per half before a delta is presented as a measured trend. Below this,
// day-to-day Likert noise clears the deadband, so we return 'insufficient' instead of a
// confident-looking arrow.
const MIN_HALF_SAMPLES = 3;

/** Canonical average producer: counts samples and means them, yielding a `MetricAverage`. */
export function metricAverage(
  rows: readonly DayEntry[],
  pick: (row: DayEntry) => Rating | undefined,
): MetricAverage {
  const values = rows.map(pick).filter((value): value is Rating => value !== undefined);
  if (values.length === 0) return { kind: 'empty' };
  return {
    kind: 'value',
    mean: values.reduce((sum, v) => sum + v, 0) / values.length,
    n: values.length,
  };
}

/**
 * Descriptive comparison of two halves. Consumes two `MetricAverage`s (one absence idiom, not
 * three) and enforces both the deadband and the minimum-sample floor, so a short range returns
 * `insufficient` rather than a noise-driven arrow.
 */
export function computeTrend(first: MetricAverage, second: MetricAverage): MetricTrend {
  if (
    first.kind === 'empty' ||
    second.kind === 'empty' ||
    first.n < MIN_HALF_SAMPLES ||
    second.n < MIN_HALF_SAMPLES
  ) {
    return { kind: 'insufficient' };
  }
  const delta = second.mean - first.mean;
  const direction: TrendDirection =
    Math.abs(delta) < TREND_DEADBAND ? 'flat' : delta > 0 ? 'up' : 'down';
  return { kind: 'measured', direction, firstHalf: first.mean, secondHalf: second.mean, delta };
}
