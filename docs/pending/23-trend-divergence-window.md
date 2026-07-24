> **Status:** Proposed (2026-07-23) · **Priority:** P1 · Ref: innovation batch (5 new plans),
> extends the landed report overhaul (doc 06) and rolling-average trends (doc 08)

# Trend divergence window ("biggest measured shift")

## Problem / Context

The report's cover summary already computes a trend per metric: `computeTrend`
(`lib/metrics.ts:161-174`) splits the range at its exact midpoint, means each half via
`metricAverage`, and — if both halves clear `MIN_HALF_SAMPLES` and the delta clears
`TREND_DEADBAND` — reports an `up`/`down`/`flat` arrow. That midpoint split is a reasonable
default, but it's an **arbitrary** comparison point: it's where the range happens to be cut in
half, not where the metric actually moved.

This app's own founding thesis (`docs/PLANNING-v0.md`'s "Context") is that a non-stimulant's
effect accumulates over weeks and the useful signal is a slow-building trend — and the
titration-log research behind docs 17–20 reinforced that the shift is often delayed well past
any dose change, sometimes weeks in (doc 19's onset-context framing). Concretely: a 30-day
report where a metric held flat for 20 days and then moved for the last 10 splits at day 15 —
right in the middle of the still-flat stretch — so the midpoint comparison dilutes a real,
sharper shift that happened later. The existing before/after-dose-change section (doc 06/16)
already handles the case where a `DoseChange` explains the timing; this doc is for the
complementary case the current report has no way to show at all: **a shift with no dose change
anywhere near it** — exactly the "the effect finally kicked in" pattern the app is built to
surface, on a dose that never changed.

This is a **descriptive statistic**, not a diagnosis: it reports "this is the split point in
your own logged numbers where the two sides differ the most, by the same threshold that already
gates the arrow you're already shown" — nothing about causation, nothing about the medication
"working." It sits beside the existing midpoint arrow, never replaces it, and is silent whenever
it would just restate the same split.

## Goals / Non-goals

**Goals**

1. A pure helper in `lib/metrics.ts`, alongside `computeTrend`, that searches candidate split
   points within a metric's range and returns the split that **maximizes the measured
   between-half gap**, subject to the exact same `MIN_HALF_SAMPLES` floor and `TREND_DEADBAND`
   `computeTrend` already enforces — so a flat, noisy metric never manufactures a spurious
   "biggest shift" out of nothing.
2. Surface it in the report's cover summary as an additional line **only when** the found split
   differs meaningfully from the midpoint (see Goals §4) — never a redundant restatement.
3. Surface it in-app on `app/(tabs)/trends.tsx` as a small caption under a metric's bars, in the
   same visual register as the existing `meanCaption`/coverage captions.
4. **Suppression rule, stated precisely:** render nothing when the found split's date is within
   a small tolerance of the midpoint (`DIVERGENCE_MIDPOINT_TOLERANCE_DAYS`, see Core logic) — at
   that point it _is_ the same information the arrow already shows, and a second box repeating
   it would just be clutter.

**Non-goals**

- **No causal or clinical claim.** The caption states a date and the two half-means, nothing
  else — never "this is when the medication started working," never a confidence percentage.
- **No coupling to `DoseChange`.** This doc is deliberately for the un-anchored case. If the
  found split lands near an actual dose change, that's already the before/after section's
  territory (doc 06/16); this feature does not cross-reference `DoseChange` or claim to explain
  _why_ a shift happened — captioned "measured shift," not "effect onset."
- **No new chart type.** Renders as a caption + the same two-half-mean numbers the arrow already
  computes, not a new visualization.
- **No per-metric configuration.** Uses the same fixed thresholds as `computeTrend` — no
  Settings toggle, no sensitivity slider.

## Core logic (`lib/metrics.ts`)

Reuses `metricAverage` unchanged; adds one function next to `computeTrend`:

```ts
export type DivergenceWindow =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'found';
      readonly splitDate: IsoDate;
      readonly splitIndex: number;
      readonly trend: Extract<MetricTrend, { kind: 'measured' }>;
    };

// A split within this many rows of the midpoint is treated as "the same split the arrow
// already shows" — rendering it again would be pure restatement, not new information.
const DIVERGENCE_MIDPOINT_TOLERANCE_ROWS = 3;

/**
 * Finds the split point (dividing `rows` into a "before" prefix and "after" suffix) whose
 * `computeTrend` delta has the largest magnitude among candidates where both sides clear
 * `MIN_HALF_SAMPLES`. Returns `none` when no candidate clears `TREND_DEADBAND`, when the range
 * is too short to have two valid halves at all, or when the best candidate is within
 * `DIVERGENCE_MIDPOINT_TOLERANCE_ROWS` of the exact midpoint (already shown by the arrow).
 */
export function findDivergenceWindow(
  rows: readonly DayEntry[],
  pick: (row: DayEntry) => Rating | undefined,
): DivergenceWindow {
  const midpoint = Math.floor(rows.length / 2);
  let best:
    | { readonly index: number; readonly trend: Extract<MetricTrend, { kind: 'measured' }> }
    | undefined;
  for (let i = MIN_HALF_SAMPLES; i <= rows.length - MIN_HALF_SAMPLES; i += 1) {
    const before = metricAverage(rows.slice(0, i), pick);
    const after = metricAverage(rows.slice(i), pick);
    const trend = computeTrend(before, after);
    if (trend.kind !== 'measured') continue;
    if (best === undefined || Math.abs(trend.delta) > Math.abs(best.trend.delta)) {
      best = { index: i, trend };
    }
  }
  if (best === undefined) return { kind: 'none' };
  if (Math.abs(best.index - midpoint) <= DIVERGENCE_MIDPOINT_TOLERANCE_ROWS)
    return { kind: 'none' };
  const row = rows[best.index];
  if (row === undefined) return { kind: 'none' }; // unreachable given the loop bounds; narrows the index access
  return { kind: 'found', splitDate: row.date, splitIndex: best.index, trend: best.trend };
}
```

`MIN_HALF_SAMPLES`/`TREND_DEADBAND`/`computeTrend` are the existing, unexported constants and
function at `lib/metrics.ts:135-174` — this feature imports nothing new from outside the module
it lives in, and changes none of their existing behavior or exports.

**Complexity note, addressed rather than hand-waved:** each candidate split recomputes both
means from scratch, giving O(n²) for a range of length n. Report/Trends ranges in this app cap
at low hundreds of days (the report's own weekly-bucket cap discussion in `docs/DECISIONS.md`
covers ranges up to and beyond 56 days routinely), so this is comfortably fast without a
prefix-sum rewrite; flagged as a straightforward follow-on optimization if a future doc ever
needs this over a much longer range, not a blocker for landing.

## Report (`lib/report-html.ts`)

In the cover summary, immediately below each metric's existing arrow +
`scaleAnchorCaption` line (`lib/report-html.ts:135-161`), render an additional line only when
`findDivergenceWindow` returns `kind: 'found'`.

**Copy, corrected (panel — clinical lens must-fix).** An earlier draft's _"Biggest measured
shift: around {splitDate} ({firstHalf} → {secondHalf})"_ was flagged as the single most
interpretation-inviting surface in this batch: a superlative ("Biggest") anchored to a specific
date reads as a dated clinical inflection point ("this is when it kicked in") even though the
doc's own Non-goals explicitly forbid that reading. The rendered copy must carry the same
discipline the prose does — a statement about the logged numbers over two periods, never an
event. Corrected wording, always including the metric's scale anchor so a bare pair of numbers
can't be misread as good-or-bad without context (reusing the same anchor text
`scaleAnchorCaption` already renders for the arrow above it):

> _"Largest measured change in your logged {metricLabel} ratings ({scaleAnchor}): {firstHalf} →
> {secondHalf}, comparing the days before and after {splitDate}."_

"Largest measured change... in your logged ratings" keeps the sentence about the numbers, not an
event; "comparing the days before and after" (rather than "shift... around") removes the
date-as-inflection-point framing while still saying which day divides the two periods.

Rendered via the same `formatAverage`/`escapeHtml` helpers already used nearby. Absent entirely
when `kind: 'none'` — the common case for a genuinely flat or short-range metric, so most
reports gain nothing extra to scan.

## In-app Trends (`app/(tabs)/trends.tsx`)

**Placement, corrected (panel — UX lens must-fix).** An earlier draft said "below each metric's
existing coverage caption" — but `trends.tsx` has no per-metric coverage caption; the coverage
line is a single global "logged X of Y days" string (`app/(tabs)/trends.tsx:235-239`), and each
metric block is otherwise just label → `barsRow` → `markersRow`. The real slot is **after each
metric's `markersRow`**, in the same muted `typography.caption` style used elsewhere on the
screen, so the new line sits subordinate to and below the bars→markers visual grouping rather
than floating between unrelated elements.

An optional one-line caption there, using the same `findDivergenceWindow` call over the
currently-selected range's rows and the **same corrected wording** as the report (including the
scale anchor — required here even more than in the report, since Trends renders no midpoint
arrow at all today, so this would be the first surfacing of a "shift" caption in-app with
nothing else nearby to supply direction-of-better context). Same suppression rule, so it only
appears when it says something the bars don't already make obvious. Purely derived from
already-loaded `entries` — no new load, no new state beyond the computed value.

## Test plan (`lib/__tests__/metrics.test.ts`)

1. **Step-function fixture** — a series flat at one rating for the first 20 rows and a
   different rating for the last 10: `findDivergenceWindow` finds the split at (or within
   tolerance of) row 20, not the midpoint at row 15.
2. **Flat/noisy fixture** — small random-ish wobble around one mean, no real shift:
   `findDivergenceWindow` returns `{ kind: 'none' }` (no candidate clears `TREND_DEADBAND`).
3. **Short range** — fewer than `2 * MIN_HALF_SAMPLES` rows: `{ kind: 'none' }`, no candidate
   loop iteration is even valid.
4. **Shift at the very edge** — a step so close to one end that the larger side has
   `< MIN_HALF_SAMPLES` on the far side of the true break: asserts the function correctly skips
   that candidate and either finds a nearby valid one or returns `none`, never an
   out-of-bounds slice.
5. **Suppression** — a step exactly at the midpoint: `{ kind: 'none' }` (within tolerance of the
   midpoint, so it's the arrow's job to show it, not this feature's).
6. **Report/Trends rendering** — `kind: 'found'` renders the extra line with escaped values;
   `kind: 'none'` renders nothing (byte-identical to a report/Trends view without this feature
   for that metric).

Golden report fixtures (`lib/__fixtures__/reports/*.html`) regenerated via `vitest -u` if any
scenario's data happens to produce a `found` window for a rendered metric.

## Gate compliance

No `any`/`!`/`@ts-*`/eslint-disable. `DivergenceWindow` is a discriminated union; any future
render site must `switch` on `.kind` to an `assertNever` default, matching this codebase's
existing `MetricTrend`/`MetricAverage` pattern. `rows[best.index]` is guarded (not asserted)
under `noUncheckedIndexedAccess`, with the guard's `unreachable`-in-practice branch documented
rather than silently trusted. No persisted state — this is a pure read/derive feature exactly
like doc 08's rolling averages; `Backup`, `Profile`, and every guard are untouched. `npm run
check` must pass before commit.

## Dependencies & sequencing

Builds only on landed code (`lib/metrics.ts`'s `computeTrend`/`metricAverage`, doc 06's report
cover summary) — no dependency on any other pending doc in this batch. Independent of doc 22
and doc 25; if doc 24 (visit decisions) or doc 17 (measurements) land first, this feature still
never references `DoseChange`/`Visit`/`Measurement`, so ordering doesn't matter.

## Alternatives considered

- **Cross-reference the found split against `DoseChange` and caption it as "near your dose
  change on X":** rejected for this doc — that's precisely what the existing before/after-dose
  section already does more rigorously (fixed, dose-anchored windows, not a best-fit search). A
  future doc could add a **disambiguating note** when the two happen to coincide, but conflating
  them here risks implying the search "found" the dose change, when it's a generic statistical
  search that had no idea a `DoseChange` existed.
- **Multiple candidate splits (top-3) instead of just the best one:** rejected as scope creep —
  a single, most-prominent shift is legible at a glance; a ranked list invites over-reading
  secondary noise as a second "shift."
- **Exposing the raw search as a user-configurable sensitivity control:** rejected — reusing the
  exact thresholds `computeTrend` already uses keeps this feature's output consistent with the
  arrow it sits beside, and a tunable threshold is exactly the kind of "looks like a clinical
  knob" surface the mission's non-goals guard against.

## Panel review

Run through the 4-lens panel (2026-07-23): approve (strict-TS, scope), approve-with-changes
(clinical, UX). Must-fixes applied above.

- **Clinical — approve-with-changes.** _Must-fix (applied):_ the rendered caption's superlative
  ("Biggest measured shift") anchored to a specific date read as a dated clinical inflection
  point despite the doc's own non-goals forbidding that reading — reworded to "Largest measured
  change... comparing the days before and after {splitDate}," a statement about the numbers, not
  an event. _Must-fix (applied):_ the report copy already sat below `scaleAnchorCaption`, but the
  in-app Trends caption did not — Trends renders no midpoint arrow to supply direction-of-better
  context, so the corrected copy now includes the scale anchor there too, not just in the report.
  Confirmed the core statistic reuses the exact landed `MIN_HALF_SAMPLES`/`TREND_DEADBAND`
  thresholds and never references `DoseChange`, so it can't imply it "found" a dose effect.
- **Strict-TypeScript architect — approve.** Confirmed `computeTrend`/`MIN_HALF_SAMPLES`/
  `TREND_DEADBAND` are accessible as module-private symbols within `lib/metrics.ts` (no new
  export needed); `rows[best.index]` is guarded, not asserted, and is provably in-bounds given
  the loop's range; `Extract<MetricTrend, { kind: 'measured' }>` and the `DivergenceWindow`
  union are well-formed against the real exported `MetricTrend`. No must-fix.
- **Mobile UX / friction — approve-with-changes.** _Must-fix (applied):_ the doc's claimed Trends
  placement ("below each metric's existing coverage caption") doesn't exist on the real screen —
  corrected to the actual slot, immediately after each metric's `markersRow`, in muted
  `typography.caption`, so the new line stays visually subordinate to the bars→markers grouping
  rather than floating between unrelated elements. Confirmed the suppression rule keeps this
  genuinely rare, so it adds negligible clutter to an already-dense screen, and it's a static
  caption with no dismiss/pressure — not a nag.
- **Data-model / migration + privacy + scope — approve.** Zero persisted state confirmed: no
  `Backup`/`Profile`/`STORAGE_KEYS`/guard changes, a pure derive over already-loaded `entries`.
  In-mission: a descriptive statistic reusing existing thresholds, no causal claim, no
  `DoseChange` coupling, no sensitivity knob. No must-fix.
