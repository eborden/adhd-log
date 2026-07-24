> **Status:** Proposed (2026-07-23) · **Priority:** P2 · Ref: innovation batch, round 2

# Day-of-week descriptive pattern

## Problem / Context

Every statistical view this app renders slices time by calendar position — a rolling window
(doc 08, landed), a fixed midpoint (the report's cover arrows), or a best-fit split (doc 23).
None of them slice by **weekday**, even though weekday-linked patterns are common and
clinically legible for exactly this app's use case: dose timing often shifts on weekends (later
wake time, a skipped or delayed morning dose), work-day stress differs from weekend stress, and
a medication holiday is sometimes taken deliberately on lower-stakes days. "Fridays average
lower focus than the rest of the week" is a fact a provider can act on (ask about weekend dosing
habits, work-schedule stress) that a rolling 7-day average — which blends all seven days evenly
every time — structurally cannot surface.

This is the same statistical posture as doc 23 (a descriptive extension of the existing
mean/threshold machinery, not a new interpretive layer), applied along a different axis: grouping
by weekday instead of searching for a split point in time.

## Goals / Non-goals

**Goals**

1. A pure helper that buckets a metric's values by weekday and reports each bucket as a
   `MetricAverage` (the exact existing type, so "too few samples" is `{ kind: 'empty' }`, not a
   noisy mean from one or two data points).
2. Surface it as a collapsed-by-default, optional view — in-app on Trends and as a compact
   report table — never expanding the primary bars/table by default.
3. Reuse the existing minimum-sample discipline rather than inventing a new threshold.

**Non-goals**

- **No automatic explanation.** The view states "Friday averages 2.8, other days average 3.6" —
  never "this might be because of weekend dosing," never a suggested cause. The provider and
  patient supply the why.
- **No highlighting of a weekday as an anomaly or problem.** No red flag, no "worst day"
  callout — every weekday bucket renders in the same neutral style; a reader compares the
  numbers themselves.
- **No new UI surface of its own.** Lives inside Trends (a per-metric expandable row) and the
  report (a small optional table), not a new tab or screen.
- **No coupling to adherence or dose timing.** This doc buckets rating values only; a follow-on
  could bucket `doseTaken`/timing by weekday too, but that is out of scope here to keep this
  doc's surface small and reviewable.

## Core logic (`lib/metrics.ts`, alongside `computeTrend`)

```ts
export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** `IsoDate` → its weekday, via the existing `parseIsoDate` (local calendar day). */
export function weekdayOf(date: IsoDate): Weekday {
  const day = parseIsoDate(date).getDay(); // 0=Sunday..6=Saturday
  const weekday = WEEKDAYS[day];
  if (weekday === undefined) throw new Error(`Unreachable: getDay() out of range (${String(day)})`);
  return weekday;
}

/**
 * Buckets `rows` by weekday and means each bucket via the existing `metricAverage`, so a
 * weekday with too few logged values reads as `{ kind: 'empty' }` rather than a noise-driven
 * mean — no new threshold invented; this is the same posture `computeTrend` already enforces,
 * applied per weekday instead of per half-range.
 */
export function weekdayAverages(
  rows: readonly DayEntry[],
  pick: (row: DayEntry) => Rating | undefined,
): Readonly<Record<Weekday, MetricAverage>> {
  const buckets = new Map<Weekday, DayEntry[]>(WEEKDAYS.map((w) => [w, []]));
  for (const row of rows) {
    const bucket = buckets.get(weekdayOf(row.date));
    bucket?.push(row); // weekdayOf's return is always a WEEKDAYS member, so this Map.get is total in practice
  }
  const out: Partial<Record<Weekday, MetricAverage>> = {};
  for (const weekday of WEEKDAYS) {
    out[weekday] = metricAverage(buckets.get(weekday) ?? [], pick);
  }
  return out as Readonly<Record<Weekday, MetricAverage>>;
}
```

Reuses `metricAverage` (`lib/metrics.ts:143-154`, unchanged) so every weekday bucket is exactly
as sample-size-honest as every other average this app already renders — no new deadband, no new
minimum-sample constant to keep in sync with the existing ones.

**A week-long range is a degenerate case, stated plainly:** with a 7-day report/Trends range,
every weekday bucket holds at most one sample — `metricAverage` still returns `{ kind: 'value', n:
1 }` rather than `{ kind: 'empty' }` (there is no minimum-sample floor _inside_ `metricAverage`
itself; that floor lives in `computeTrend`'s two-sample comparison, which this doc does not use).
The UI must therefore gate visibility on range length (see UI, below) rather than relying on the
data to self-suppress — a single-sample "average" per weekday over one week is not a pattern, and
rendering it as one would be actively misleading.

## In-app Trends (`app/(tabs)/trends.tsx`)

**One consolidated section, not one toggle per metric (panel — UX lens must-fix).** An earlier
draft proposed "an expandable row per metric," which multiplies into 4–6 separate collapse
toggles scattered down an already-long Trends scroll (per-metric bars, a smoothed-line overlay,
`markersRow`, the "Around dose changes" cards) — collapsed-by-default caps each one's height but
not the count of affordances the screen gains. Instead: a single "By day of week" section, one
collapse toggle, containing one row per metric inside it once expanded — the scroll gains exactly
one new affordance, not six. **Only offered at all when the selected range spans at least
`MIN_DAYOFWEEK_RANGE_DAYS` (21) days** — below three weeks, a weekday bucket can hold at most 2–3
samples, too thin to be worth surfacing at all; below that threshold the section (the single
collapse toggle itself, not just its contents) does not render, so there is nothing to
show-then-find-empty.

**Neutral color only, never value-tinted (panel — clinical lens must-fix).** An earlier draft
said weekday buckets render "in the same `formatAverage`/`meanColor` styling the rest of Trends
already uses." `meanColor` tints a value toward an "alert" hue at the low end of a
higher-better metric — applied across seven weekday cells, that tinting **is** a highlighting
mechanism, directly contradicting this doc's own Non-goal ("No highlighting of a weekday as an
anomaly or problem… every weekday bucket renders in the same neutral style"). Weekday buckets
render via `formatAverage` for the text only, in one fixed neutral `theme` color regardless of
value — a reader compares the seven numbers themselves; the screen never points at one for them.

## Report (`lib/report-html.ts`)

A small optional table, ordered after the existing per-period average tables, gated by the same
`MIN_DAYOFWEEK_RANGE_DAYS` range-length rule. One row per metric with data, one column per
weekday, cell = mean or an em dash for an empty bucket. Renders nothing when the range is too
short — the common case for a 7 or 14-day export — so most reports gain nothing extra to scan.

## Test plan (`lib/__tests__/metrics.test.ts`)

1. `weekdayOf` — round-trips a handful of known dates against their real calendar weekday.
2. `weekdayAverages` — a fixture with values on only Mondays and Fridays produces `{ kind:
'value' }` for those two weekdays and `{ kind: 'empty' }` for the other five; an empty `rows`
   array produces all-empty buckets; agrees with a hand-computed mean for a constructed
   multi-week fixture.
3. **Range-length gating** — a helper (or inline check) asserting the UI/report visibility rule
   activates only at `>= MIN_DAYOFWEEK_RANGE_DAYS` days, tested at the boundary.

## Gate compliance

No `any`/`!`/`@ts-*`/eslint-disable. `weekdayOf`'s `WEEKDAYS[day]` read is guarded (not
asserted) under `noUncheckedIndexedAccess`, even though `Date.getDay()` can only return 0–6 by
its own contract — the guard documents that rather than casting past it. `Record<Weekday,
MetricAverage>` construction runs through a full loop over the closed `WEEKDAYS` union rather
than a partial-then-cast; the one `as Readonly<Record<...>>` is a completeness assertion after
every key has been assigned in the preceding loop, not a shortcut around missing data — flagged
here for the TS lens to confirm this is the acceptable shape rather than a `Partial` return type.
No persisted state — pure derive, matching doc 08/23's precedent exactly. `npm run check` must
pass before commit.

## Dependencies & sequencing

Builds only on landed code (`lib/metrics.ts`'s `metricAverage`, `parseIsoDate`). Independent of
every other doc in this batch and the prior round (22–27) — shares no code with doc 23 beyond
both living in `lib/metrics.ts`.

## Alternatives considered

- **A statistical significance test (e.g., comparing one weekday's mean against the rest via a
  formal hypothesis test):** rejected as over-engineering — this app's own precedent (the
  `TREND_DEADBAND`/`MIN_HALF_SAMPLES` heuristics in `computeTrend`) is a simple, legible
  threshold, not inferential statistics a patient or provider would need explained to trust.
- **Bucketing by weekday AND time-of-day (e.g. "Friday evenings"):** rejected — a 7×2 grid is a
  much larger surface for a first version of this idea, and the plain 7-bucket view is already a
  meaningful step beyond "no weekday view at all."
- **Auto-generating a plain-language sentence ("Fridays tend to be lower"):** rejected — reads as
  an interpretation even in careful wording; a bare table of seven numbers lets the reader draw
  their own conclusion, matching this app's consistent house style.

## Panel review

Run through the 4-lens panel (2026-07-23): approve (strict-TS), approve-with-changes (clinical,
UX, scope-flagged-not-blocking). Must-fixes applied above.

- **Clinical — approve-with-changes.** _Must-fix (applied):_ the doc's own UI spec
  (value-tinted `meanColor` styling) contradicted its stated Non-goal (no highlighting/anomaly
  framing) — resolved in favor of the Non-goal: all seven weekday cells render in one neutral
  color, text-only via `formatAverage`. The bucketing logic itself, the `MIN_DAYOFWEEK_RANGE_DAYS`
  gate, and keeping the motivating "ask about weekend dosing" reasoning confined to
  Problem/Context rather than user-facing copy were all confirmed sound.
- **Strict-TypeScript architect — approve.** Confirmed the flagged `out as
Readonly<Record<Weekday, MetricAverage>>` cast is acceptable — a completeness assertion after
  every `WEEKDAYS` key is assigned in the preceding loop, exempt under
  `type-coverage --ignore-as-assertion` the same way branded-constructor assertions already are;
  `weekdayOf`'s guarded `WEEKDAYS[day]` read and `parseIsoDate`/`metricAverage` usage are correct
  against the real exports. No must-fix.
- **Mobile UX / friction — approve-with-changes.** _Must-fix (applied):_ consolidated the
  per-metric expandable-row design into one single "By day of week" section with one collapse
  toggle, so the Trends scroll gains one new affordance instead of 4–6; confirmed the range gate
  hides the section itself (not just its contents) below `MIN_DAYOFWEEK_RANGE_DAYS`.
- **Data-model / migration + privacy + scope — approve.** No persisted state, no migration,
  on-device only. _Flagged, not a must-fix:_ this is the batch's scope-boundary case — a weekday
  breakdown is a generic-analytics shape that stays in-mission only because of its Non-goals (no
  anomaly highlighting, no auto-explanation, range-gated, reuses `metricAverage`'s existing
  sample discipline). Recorded here so a future follow-on (e.g. a weekday × time-of-day grid)
  doesn't quietly widen this into a general analytics surface without the same scrutiny.
