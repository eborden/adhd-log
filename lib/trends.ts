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
  for (const [i, d] of dates.entries()) {
    if (doseDates.has(d)) {
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

/**
 * A straight segment between two adjacent smoothed points, described as a `View`-friendly
 * rectangle: rendered at `(left, top)` with `width` and rotated `rotationDeg` around its own
 * center — the standard RN "draw a line between two points" technique (no SVG/canvas
 * dependency). `top`/`left` mark the segment's center; the renderer offsets by half its own
 * line thickness, which is a style concern, not a geometry one.
 */
export interface LineSegment {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly rotationDeg: number;
}

/**
 * Connects consecutive non-null `smoothed` points into line segments, so the overlay reads as
 * one continuous trend line rather than a scatter of per-day dots. Columns are assumed to be
 * `columnWidth`-wide separated by `gap`, matching the raw bars' row layout; `rowHeight` maps a
 * value the same way the raw bars do (`8 + value * 8`), so the line tracks the same vertical
 * scale. A `null` on either end of a pair (an empty smoothing window) breaks the line rather
 * than interpolating across it — skipping data is honest; inventing a bridge is not.
 */
export function smoothedLineSegments(
  smoothed: readonly SmoothedValue[],
  columnWidth: number,
  gap: number,
  rowHeight: number,
): readonly LineSegment[] {
  const centerX = (index: number): number => index * (columnWidth + gap) + columnWidth / 2;
  const pointY = (value: number): number => rowHeight - (8 + value * 8);
  const segments: LineSegment[] = [];
  let prev: { readonly index: number; readonly value: number } | undefined;
  for (const [index, value] of smoothed.entries()) {
    if (value === null) {
      prev = undefined;
      continue;
    }
    if (prev !== undefined) {
      const ax = centerX(prev.index);
      const ay = pointY(prev.value);
      const bx = centerX(index);
      const by = pointY(value);
      const dx = bx - ax;
      const dy = by - ay;
      segments.push({
        left: (ax + bx) / 2 - Math.sqrt(dx * dx + dy * dy) / 2,
        top: (ay + by) / 2,
        width: Math.sqrt(dx * dx + dy * dy),
        rotationDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
      });
    }
    prev = { index, value };
  }
  return segments;
}
