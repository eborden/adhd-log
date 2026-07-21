/**
 * View-time trend smoothing. Pure, RN-free transforms over data already produced by
 * `lib/storage.ts` / `lib/export.ts` (`rowsInRange`, `doseChangeMarkers`) — no new persisted
 * state, no interpretation. See docs/pending/08-rolling-average-trends.md.
 */
import type { DoseChange, IsoDate, Rating } from './types';

/**
 * A smoothed metric value. Averaging Ratings produces a real number in [1, 5],
 * which is NOT a Rating — keep it distinct so it can never be fed back into a
 * Rating-typed slot. `null` marks a window with no logged data.
 */
export type SmoothedValue = number | null;

/**
 * Trailing simple moving average. For each index i, the mean of the up-to-`window`
 * values ending at i, ignoring `undefined` (unlogged days), yielding `null` when the
 * window contains no logged value. Output length always equals input length, so it
 * stays column-for-column aligned with the daily bars and markersRow.
 *
 * `boundaries` (optional, same length as `values`) marks the first column of a new
 * dosing period with `true`; when present, the trailing window is clamped so it never
 * reaches back past the most recent boundary at or before i. Omit it for a plain,
 * regimen-agnostic moving average (this is the intentionally-generic primitive; the
 * dose-period wiring lives in the callers, and this signature keeps the window<1 test
 * expressible with a bare 2-arg call).
 */
export function rollingAverage(
  values: readonly (Rating | undefined)[],
  window: number,
  boundaries?: readonly boolean[],
): readonly SmoothedValue[] {
  if (window < 1) {
    throw new RangeError(`rollingAverage window must be >= 1, got ${String(window)}`);
  }
  const out: SmoothedValue[] = [];
  let periodStart = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (boundaries?.[i] === true) {
      periodStart = i; // reset: a new dosing period begins at this column
    }
    const start = Math.max(periodStart, i - window + 1);
    let sum = 0;
    let count = 0;
    for (let j = start; j <= i; j += 1) {
      const v = values[j]; // noUncheckedIndexedAccess -> Rating | undefined
      if (v !== undefined) {
        sum += v;
        count += 1;
      }
    }
    out.push(count === 0 ? null : sum / count);
  }
  return out;
}

/**
 * True at each column whose date is a dose-change date, mirroring the alignment of
 * lib/storage.ts `doseChangeMarkers`. Feeds `rollingAverage`'s window reset.
 */
export function dosePeriodBoundaries(
  dates: readonly IsoDate[],
  doses: readonly DoseChange[],
): readonly boolean[] {
  const doseDates = new Set<IsoDate>(doses.map((dc) => dc.date));
  return dates.map((d) => doseDates.has(d));
}

/**
 * The tail dates that make up the "recent" window: the last `window` dates, but never
 * reaching back past the most recent dose-change date in range. This is the exact date
 * span the report's Recent column and its adherence count both describe.
 */
export function recentWindowDates(
  dates: readonly IsoDate[],
  doses: readonly DoseChange[],
  window: number,
): readonly IsoDate[] {
  if (window < 1) {
    throw new RangeError(`recentWindowDates window must be >= 1, got ${String(window)}`);
  }
  const doseDates = new Set<IsoDate>(doses.map((dc) => dc.date));
  let periodStart = 0;
  for (let i = 0; i < dates.length; i += 1) {
    const d = dates[i]; // IsoDate | undefined
    if (d !== undefined && doseDates.has(d)) {
      periodStart = i;
    }
  }
  return dates.slice(Math.max(periodStart, dates.length - window));
}

/** The allowed UI smoothing windows — a literal union so the selector can't pick a nonsense value. */
export const SMOOTHING_WINDOWS = [3, 7] as const;
export type SmoothingWindow = (typeof SMOOTHING_WINDOWS)[number];

/** Sensible trailing window for a given range length. */
export function defaultWindowForRange(rangeDays: number): SmoothingWindow {
  return rangeDays <= 7 ? 3 : 7;
}
