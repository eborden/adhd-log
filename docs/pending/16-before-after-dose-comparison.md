docs/design/11-before-after-dose-comparison.md

> **Status:** Proposed — pending implementation · **Priority:** P2 · Ref: analysis #10 · Panel-reviewed (4 lenses, all approve; must-fixes applied)

# Before/after dose-change comparison

## Problem / Context

The whole reason this app exists is that a non-stimulant ADHD medication's effect
accumulates over _weeks_, and the decision that actually matters — "did this titration step
do anything?" — is made by comparing the stretch _before_ a dose change to the stretch
_after_ it. Today the app can show a raw sparkline (`app/(tabs)/trends.tsx`) and a grand-mean
averages table in the PDF (`lib/export.ts` `buildReportHtml`), but neither is anchored to the
`DoseChange` events the user already logs via `appendDoseChange`. `doseChangeMarkers` drops a
dot on the Trends timeline, yet nothing quantifies the two sides of that dot.

So the user (and their provider) is left eyeballing a bar chart and mentally partitioning it
at each marker. For a signal that is slow, noisy, and day-to-day jittery, that is exactly the
comparison a human is worst at doing by eye. The concrete gap: **there is no place that says
"mood averaged 2.4 across the 14 days before the 40 mg step and 3.1 across the 14 days
after."** That pair of numbers is the atomic unit of a titration conversation.

This document specifies a pure, tested helper `beforeAfterDose` and the surfaces that render
it. It is deliberately _descriptive_: it shows the numbers and stops. Following the panel's
clinical review, "the numbers" now include the two structural facts that make the pair
_interpretable_ — **how many days actually carried a value (n)** and **how many of those days
the dose was taken (adherence)** — because a bare `2.4 → 3.1` pair silently hides whether the
"after" window reflects consistent dosing or was confounded by missed doses, and whether it
rests on one logged day or fourteen. It still renders no verdict, delta, or score. It supplies
the same helper that `01-provider-report-overhaul` consumes, so the report and the in-app view
never diverge.

## Goals / Non-goals

**Goals**

- A pure, RN-free, unit-tested `beforeAfterDose(entries, doses, accessor, windowDays)` in
  `lib/export.ts` returning, per `DoseChange`, a summary of `windowDays` before vs after for a
  chosen metric accessor. Each side carries **four numbers, not one**: the mean, the count of
  logged values (`n`), the count of days the dose was taken, and the count of days with any
  check-in — all derived the same gap-filled way the existing `rowsInRange` produces rows.
- Correct handling of the three edge cases: a side with no logged data (`average: null`,
  `count: 0`), overlapping windows between two close-together dose changes, and windows that
  run off the start of history.
- A Trends sub-view and a report section, both built _only_ from that helper.
- Zero new persisted shape (reads existing `entries` + `doses`), so no migration risk.

**Non-goals**

- No verdict, delta arrow, "improvement" label, percent change, effect size, or significance
  test. We render each side's summary and let the provider interpret.
- No new tracked metric, no schema change, no notification change.
- No windowing UI beyond reusing the existing `RANGE_OPTIONS` value as `windowDays`.
- No cross-metric ranking or "which metric moved most" summary — that is interpretation.
- **Side-effect before/after counts are out of scope for v1** — see "Alternatives / fast-follow";
  they are specced there as an explicit follow-up rather than left implicit.

## Mission fit & guardrails

Stays squarely inside collect → log → provider. It invents no new data collection; it
re-partitions data the user already logged (ratings, `doseTaken`, presence of a check-in)
around events the user already recorded. The adherence and `n` counts added per the clinical
review are not new interpretation — they are _more of the raw data_, surfaced so the provider
is not misled by a mean's absent denominator. Output stays counts and means with no clinical
framing and no scoring.

Copy stays in the sanctioned register: section header "Around dose changes", column headers
"Before" / "After", the counts rendered as plain annotations ("n=3", "12/14 doses taken"), and
a caption "Averages of logged values in the window before and after each dose change, with how
many days were logged and dosed. Discuss trends with your provider." A window that is short
relative to the drug's onset is a calibration hazard, so the window length is **labeled
prominently** next to the numbers ("14-day windows") rather than left implicit — see UI.

Local-only is untouched: the helper is a pure function over in-memory `entries`/`doses`; it
performs no I/O. The derived numbers are computed only for the on-device Trends view and the
user-initiated PDF report; **they are never added to the JSON backup shape** — `buildBackup`/
`parseBackup`/`Backup` continue to export only the raw `entries`/`doses` they already do (see
"Storage & guards").

## Data model

**No new persisted types.** The comparison is derived, not stored, so `lib/types.ts` gains
only result shapes (plain readonly interfaces — they never touch AsyncStorage, so they need no
guard and no brand beyond the `IsoDate` they already carry):

```ts
// lib/types.ts — derived view types; never persisted, never parsed from JSON, never guarded.

/** One side (before or after) of a dose change, over a fixed-length day window. */
export interface DoseWindowSummary {
  /** Mean of logged accessor values in the window; null iff `count === 0`. */
  readonly average: number | null;
  /** Days in the window that carried a value for this metric (the mean's denominator, n). */
  readonly count: number;
  /** Days in the window whose morning check-in recorded the dose as taken. */
  readonly dosesTaken: number;
  /** Days in the window with any check-in at all (morning or evening). */
  readonly daysLogged: number;
}

export interface DoseComparisonRow {
  readonly changeDate: IsoDate;
  readonly before: DoseWindowSummary;
  readonly after: DoseWindowSummary;
}
```

Design notes, addressing the strict-type and clinical lenses together:

- `average` is `number | null`, deliberately **not** `Rating | null`: averaging a set of
  `Rating` values (`1|2|3|4|5`) produces an arbitrary real (2.4, 3.1), which is not a `Rating`.
  We keep the honest `number` and never cast back — this mirrors `averageOf`'s existing
  `number | null` return.
- The empty state has **one** representation: `average: null` co-occurs with `count: 0` by
  construction (the same loop produces both), so there is no `hasData` boolean to desync. The
  invariant "null iff count 0" is maintained by the single code path that builds the summary,
  not by a redundant flag — no optional-flag soup.
- `count` is the metric's own denominator (days with a non-`undefined` accessor value);
  `daysLogged` is broader (any check-in present). They are distinct on purpose: a window can
  have 10 check-ins but only 3 days where _this_ evening metric was rated, and the provider
  needs the 3, not the 10, to weight the mean. `dosesTaken` is always read from the morning
  side regardless of which metric the accessor targets, because adherence is a property of the
  day, not of the metric being compared.

## Schema

**n/a.** `beforeAfterDose` is metric-agnostic: it takes an `accessor` produced by the existing
`ratingAccessor(session, key)`, so it already ranges over every `RatingKey` the schema defines.
Adding a metric to `lib/schema.ts` later automatically flows into this view via
`ratingAccessor` with no edit here. No new `Metric` variant, label, or default. Adherence
(`doseTaken`) is read directly off `MorningCheckin`, not through a schema metric, so no
`toggle`-kind metric handling is involved.

## Storage & guards

The helper belongs in `lib/export.ts` (alongside `ratingAccessor`, `averageOf`, `rowsInRange`,
`formatAverage` — all of which it reuses), but it depends on `addDays`/`lastNDates` from
`lib/storage.ts` — both already exported and pure. **No new guard is required**:
`beforeAfterDose` consumes already-parsed `Readonly<Record<IsoDate, DayEntry>>` and
`readonly DoseChange[]`, i.e. values that have _already_ cleared `parseEntries` /
`parseDoseChangeList` at the storage boundary. It introduces no new persisted key and reads no
untrusted JSON, so parse-don't-validate is satisfied by the existing guards. `DoseWindowSummary`
/`DoseComparisonRow` are derived-only and never round-trip through JSON, so they correctly get
**no** `Parsed<T>` guard (only persisted/untrusted data needs one).

**Backward compatibility:** total. Neither result type is ever written to disk, appears in a
stored `Profile`/`DayEntry`/`Backup`, or changes any existing shape. Historical `entries`/
`doses` are read but never mutated. No re-onboarding, no migrate-on-read, no `parseBackup`/
`Backup` change — a device that upgrades to this build computes the comparison from data it
already has. (Contrast: a future doc that adds a _persisted_ field owns its migration; this one
adds none, which is precisely why we reject "store the comparison" below.)

Implementation, reusing existing primitives — note `Rating` is **already imported** in
`lib/export.ts`'s existing `import type { … } from './types'` block (verified at line 13), so
the new symbols merge into that block; no separate `Rating` import is added:

```ts
// lib/export.ts
// Existing import block gains the two derived types (Rating/DayEntry/DoseChange/IsoDate
// are already imported here today):
import type {
  DayEntry,
  DoseChange,
  DoseComparisonRow,
  DoseWindowSummary,
  IsoDate,
  Rating,
} from './types';
import { addDays, lastNDates } from './storage';
// rowsInRange, averageOf, formatAverage are already defined in this module — REUSE them,
// do not re-declare (formatAverage already exists at lib/export.ts:111).

/**
 * For each dose change, summarize `windowDays` logged days strictly BEFORE the change date
 * vs the change day and the following `windowDays - 1` days (after, INCLUSIVE of the change
 * day: a dose taken that day counts as "after"). Purely descriptive: mean plus the counts
 * (n logged, doses taken, days logged) that make the mean honest. No verdict, no delta.
 */
export function beforeAfterDose(
  entries: Readonly<Record<IsoDate, DayEntry>>,
  doses: readonly DoseChange[],
  accessor: (row: DayEntry) => Rating | undefined,
  windowDays: number,
): readonly DoseComparisonRow[] {
  return doses.map((change): DoseComparisonRow => {
    const afterEnd = addDays(change.date, windowDays - 1);
    const beforeEnd = addDays(change.date, -1);
    // lastNDates(n, end) === [end-n+1 .. end], so afterDates === [change.date .. afterEnd]
    // (change day is the first "after" day) and beforeDates ends the day before the change.
    const afterDates = lastNDates(windowDays, afterEnd);
    const beforeDates = lastNDates(windowDays, beforeEnd);
    return {
      changeDate: change.date,
      before: summarizeWindow(rowsInRange(entries, beforeDates), accessor),
      after: summarizeWindow(rowsInRange(entries, afterDates), accessor),
    };
  });
}

function summarizeWindow(
  rows: readonly DayEntry[],
  accessor: (row: DayEntry) => Rating | undefined,
): DoseWindowSummary {
  let sum = 0;
  let count = 0;
  let dosesTaken = 0;
  let daysLogged = 0;
  for (const row of rows) {
    if (row.morning !== undefined || row.evening !== undefined) {
      daysLogged += 1;
    }
    if (row.morning?.doseTaken === true) {
      dosesTaken += 1;
    }
    const value = accessor(row);
    if (value !== undefined) {
      sum += value;
      count += 1;
    }
  }
  return { average: count === 0 ? null : sum / count, count, dosesTaken, daysLogged };
}
```

Two changes made in direct response to the strict-TypeScript review:

- The `after` window no longer carries a `.filter((date) => date >= change.date)`. By
  construction `lastNDates(windowDays, afterEnd)` already yields exactly
  `[change.date .. afterEnd]`, so the filter was a provable no-op that read as load-bearing.
  Window inclusivity is now guaranteed by the `afterEnd`/`beforeEnd` arithmetic and locked by
  test #7 — no dead predicate.
- Gap-filling reuses the exported `rowsInRange(entries, dates)` directly instead of a
  near-duplicate private `rowsForDates`; `summarizeWindow` operates on the resulting `DayEntry`
  rows (the `{ date }`-only gap rows contribute to neither `count` nor `daysLogged`).

Edge cases, all handled without special-casing:

- **No data on one side** → `accessor` yields `undefined` for every gap-filled row, so
  `count` stays 0 and `average` is `null`. `before`/`after` land independently.
- **Overlapping windows** (two changes < `windowDays` apart) → each change's windows are
  computed independently, so a day can legitimately count in one change's "after" and the
  next change's "before". Intentional: each row answers "what did the data look like around
  _this_ change," and the provider sees both `changeDate`s (open question below).
- **Boundary underflow** → `addDays` just produces earlier `IsoDate`s; `entries[date]` is
  `undefined` for never-logged days; they gap-fill and drop out of every counter. No throw, no
  clamp.

`ratingAccessor` returns `((row) => Rating | undefined) | undefined`, so callers narrow it
(`if (accessor === undefined) return;`) before passing it in — `beforeAfterDose` itself takes
the already-narrowed non-optional accessor.

## UI touch points

**`app/(tabs)/trends.tsx` (fully schema-driven seam — the primary surface).** Add an
"Around dose changes" block **below** the existing per-day bars (never above or interleaved —
the sparkline the user relies on daily must remain the first thing on screen, per the UX
review). The block:

- **Renders nothing at all — not even the section header — when `doses.length === 0`.** This
  is the common early-titration state (the first weeks after onboarding, before any step) and
  a long-stable-dose user. Guarding on empty `doses` mirrors the per-row "drop if both sides
  empty" rule and keeps the screen identical to today's for those users. (Must-fix from both
  the UX and data-model lenses.)
- **Groups by dose change, not by metric.** To avoid the N-metrics × M-changes flat list the
  UX review flagged as burying the bars, the block renders **one card per `DoseChange`**, with
  the enabled metrics as compact rows _inside_ that card (metric label · Before cell · After
  cell). All cards **except the most recent change are collapsed by default**; tapping a card
  header expands its per-metric grid. This is pure component `useState` — no new persisted
  preference, no migration. It keeps "core value at a glance" while hiding nothing.
- Uses the selected range value as `windowDays` and **labels it in the card header**
  ("14-day windows") so the provider calibrates against the drug's slow onset; the caption
  additionally notes short windows may predate a non-stimulant's effect.
- For each enabled metric it resolves `ratingAccessor(session, key)`, narrows the `undefined`,
  and reads the matching `DoseComparisonRow`. Each Before/After cell shows the mean via the
  existing `formatAverage` (one decimal, em-dash for `null`), colored with
  `ratingColor(theme, Math.round(value), direction)` (round for _color bucketing_ only; the
  displayed number keeps its decimal; `null` → em-dash in `theme.textMuted`). Under the mean,
  a caption line shows `n=<count>` and `<dosesTaken>/<daysLogged> doses`. Rows with `count < 3`
  are additionally tagged with a muted "few logged days" caption so a near-empty window is not
  mistaken for a stable reading (clinical must-fix on sample size).

**Non-generic seams — flag explicitly. None of the check-in seams are touched.** Because this
is a read-only derived view over existing data, we do **not** edit:

- `app/checkin.tsx` — no new `Draft` field, no `renderMetric` switch arm, no `handleSave`
  conditional spread, no `draftFrom*` hydration line. (Confirmed: no new `Metric` variant, so
  the `assertNever` default in `renderMetric` is not disturbed.)
- `app/(tabs)/settings.tsx` — no new profile field or toggle.
- `app/entry/[date].tsx` — the hard-coded `RatingRow` list is _not_ extended (no new rating
  key exists).
- `components/` — reuse existing primitives (`Card`, tokens). One small presentational
  component `components/DoseChangeCard.tsx` (collapsible header + per-metric Before/After grid
  with the count captions) may be added purely to keep `trends.tsx` thin; it holds only local
  expand/collapse UI state, no domain logic.

## Export / report

`lib/export.ts` gains a **new report section**, "Around dose changes", inserted after the
dose-change `<ul>` and before the averages tables in `buildReportHtml(profile, doses, rows)`.

- **Omitted entirely (no header) when `doses` is empty**, matching the Trends guard.
- Structured the same way as the Trends block — **one small table per dose change** rather
  than one row per metric across all changes — so a long titration history does not produce a
  single unbounded table. Each table: change date + window length in its caption, then one row
  per enabled scale metric with Before and After columns. Each cell shows the mean (via the
  **existing `formatAverage`**), then `n=<count>` and `<dosesTaken>/<daysLogged> doses` beneath
  it. A per-change table gets a CSS `page-break-inside: avoid` so a change's table is not split
  mid-way across PDF pages (UX review, report-pagination suggestion).
- Reuse the existing **`formatAverage` helper already defined at `lib/export.ts:111`** —
  do **not** declare a second `formatAverage` (doing so is a duplicate-implementation compile
  error). The count annotations are integers rendered inline; if a shared formatter is wanted,
  add a distinctly named `formatWindowCounts(summary)`, never a second `formatAverage`.
  (Strict-TypeScript must-fix.)
- `escapeHtml` every interpolated string (dates, labels, formatted numbers, count strings).
  Cell colors come from the same Layer-1 `palette` the rest of the report uses.
- Drop a change's table entirely only if _both_ sides have `count === 0` for _every_ metric
  (nothing to show).

This is the shared helper `01-provider-report-overhaul` depends on — that doc consumes
`beforeAfterDose` (now including the counts) for its restructured provider report rather than
reimplementing the partitioning. Coordinate so the helper lands here first.

## Notifications

**n/a.** No trigger, channel, or scheduling change in `lib/notifications.ts`.

## Test plan

New spec `lib/__tests__/beforeAfterDose.test.ts` (covered module: `lib/export.ts`), importing
`{ describe, it, expect } from 'vitest'`, using the sanctioned `as IsoDate` / `as IsoTimestamp`
literal fixture idiom, and narrowing inside assertions rather than asserting types. Cases:

1. **Happy path** — one change; logged ratings both sides; `before.average`/`after.average`
   equal the hand-computed means; assert exact numbers (e.g. `2.5`, `3.75`).
2. **No-data-before** — change on the first logged day → `before.average === null` and
   `before.count === 0`; `after.average` numeric.
3. **No-data-after** — change with only prior data → `after.average === null`, `after.count === 0`.
4. **Both sides empty** — no entries in either window → both `average === null`, both `count === 0`.
5. **Boundary underflow** — window extends before earliest entry; assert no throw and that
   the mean and `count` use only the days that exist.
6. **Overlapping windows** — two changes within `windowDays`; assert a shared day contributes
   to both the earlier change's `after` and the later change's `before`, and both rows exist.
7. **Window inclusivity** — assert the change day counts in `after`, not `before`, and that
   `after.count` includes it (guards the `afterEnd`/`beforeEnd` split now that no filter exists).
8. **Accessor genericity** — run with a morning accessor (`sleepQuality`) and an evening
   accessor (`mood`) via `ratingAccessor`, asserting each reads the right session.
9. **Averaging yields non-Rating** — inputs `2` and `3` → `average === 2.5`; assert it is a
   `number` not in `Rating`, locking in the no-cast decision.
10. **Adherence count** — window with mixed `doseTaken` (some `true`, some `false`, some days
    with no morning check-in) → assert `dosesTaken` counts only `true` mornings and
    `daysLogged` counts any check-in, independent of the metric accessor used.
11. **Sample-size count** — window where the metric is rated on only some logged days →
    assert `count` equals the number of days with a non-`undefined` accessor value, strictly
    less than `daysLogged`, and that `average` uses `count` as its denominator.

Keep coverage ≥ thresholds (lines/statements/functions 90, branches 85): the `count === 0 ?
null : …` branch, the `morning?.doseTaken === true` branch, and the `daysLogged` branch are
each hit by a dedicated case above.

## Gate compliance

- **No `any` / unsafe-any**: signatures are fully typed over `DayEntry`, `DoseChange`,
  `Rating`, `IsoDate`, `DoseWindowSummary`; the accessor type is explicit.
- **No `!`**: `entries[date]` (typed `DayEntry | undefined` by `noUncheckedIndexedAccess`) is
  narrowed inside `rowsInRange`; `row.morning?.doseTaken === true` uses optional chaining, not
  assertion; `ratingAccessor`'s optional return is narrowed with an `if`.
- **No `as` on untrusted data**: the only `as` anywhere is `as IsoDate`/`as IsoTimestamp` on
  known-valid literals inside test fixtures — the documented `--ignore-as-assertion`-exempt
  idiom. `average`/counts stay `number`; no `as Rating` back-cast.
- **No `@ts-*` / `eslint-disable`**: none introduced.
- **No duplicate declaration**: `formatAverage`, `rowsInRange`, `averageOf` are reused, not
  re-declared (verified present in `lib/export.ts` today).
- **Correct imports**: `Rating` is already imported in `lib/export.ts`; the diff merges the two
  new derived types into the existing `import type` block rather than adding a conflicting one.
- **Exhaustive switch / `assertNever`**: this feature adds _no_ discriminated-union variant, so
  every existing `switch` (`renderMetric`, etc.) and its `assertNever` default stays valid and
  untouched.
- **100% type-coverage**: every symbol is typed from existing types; `--ignore-as-assertion`
  covers the fixture literals.
- **exactOptionalPropertyTypes / noImplicitReturns**: `beforeAfterDose`'s `.map` callback and
  `summarizeWindow` return on every path; all `DoseWindowSummary`/`DoseComparisonRow` fields
  are required (not optional), so no `exactOptionalPropertyTypes` friction.

## Dependencies & sequencing

- **Enables `01-provider-report-overhaul`** — that doc consumes `beforeAfterDose` (including the
  new counts). Land the helper + tests here first; the report section in this doc and the one
  in `01` share it.
- **Independent of** the check-in/schema docs (no schema or Draft change).
- Suggested order: (1) `beforeAfterDose` + `summarizeWindow` + spec in `lib/export.ts`;
  (2) Trends sub-view (`DoseChangeCard`); (3) report section (or defer to `01`).

## Alternatives considered / open questions

- **Side-effect before/after counts (fast-follow, specced not implicit).** A titration decision
  weighs efficacy against tolerability, and `SideEffect` chips are already-logged data. The
  natural extension, consistent with this doc's guardrails, is a parallel _descriptive_ count
  per side effect — e.g. "nausea logged 2/14 days before vs 6/14 after" — as bare counts, no
  verdict. It is deferred to a dedicated fast-follow (or a section in `01`) because it needs its
  own accessor over `EveningCheckin.sideEffects` (a `readonly SideEffect[]`, not a `Rating`) and
  its own result shape; folding it into `beforeAfterDose`'s `Rating`-typed accessor would blur
  the helper. Scoped here explicitly so it is not lost.
- **Clip overlapping windows at the adjacent change date.** Rejected for v1: each row should
  faithfully describe "the N days around this change," and the provider sees all `changeDate`s.
  Clipping would silently shrink windows and hide that two steps were close together. _Open
  question:_ add an opt-in "non-overlapping windows" mode later if a provider finds overlap
  confusing — still descriptive.
- **Return a `delta` field.** Rejected — a signed delta is one keystroke from an "improvement"
  reading. We hand over each side's summary; the provider does the subtraction.
- **Store the comparison.** Rejected — it is cheap to derive and storing it would create a
  migration surface and a staleness bug for zero benefit; it would also pull the derived types
  into `Backup`, which the privacy/migration lens confirmed we must not do.
- **Embed the window's sparkline next to the numbers.** Deferred: a grand mean can mask a
  still-ramping effect (day-1-to-14 rise reads identical to a flat plateau). Placing the
  existing per-day bars for the window beside the summary would let the provider see shape
  without the app interpreting. Left as a follow-up to keep v1's Trends card compact; the
  prominent window-length label and `n` count are the v1 mitigations.
- **Open question:** window semantics — "after" _includes_ the change day. Confirmed intended,
  documented in the helper's doc comment, locked by test #7.
- **Open question:** default `windowDays` to the selected range vs an independent control.
  v1 reuses the range value; the 7-day option is short relative to a non-stimulant's onset, so
  v1 labels the window length prominently rather than removing the option — revisit disabling
  7-day for this view if it proves misleading.

## Panel review

### Clinical / behavioral-health measurement — approve-with-changes

- **Applied (must-fix, adherence):** added `dosesTaken` and `daysLogged` to
  `DoseWindowSummary`, derived in `summarizeWindow` from `morning.doseTaken`, and rendered as
  "<dosesTaken>/<daysLogged> doses" beside every Before/After mean in both the Trends card and
  the report, so a provider can distinguish lack of efficacy from non-adherence.
- **Applied (must-fix, sample size):** added `count` (n logged values, distinct from
  `daysLogged`), surfaced as "n=<count>" everywhere a mean appears, with a "few logged days"
  flag on rows where `count < 3`.
- **Applied (suggestion, window calibration):** window length is labeled prominently on each
  card/table and the caption notes short windows may predate onset; kept 7/14/30 rather than
  disabling 7-day (a UI-scope call), with removal flagged as an open question.
- **Deferred with rationale (suggestion, side effects):** specced as an explicit fast-follow in
  Alternatives rather than folded in, because it needs a `SideEffect[]` accessor and its own
  result shape distinct from the `Rating` helper.
- **Deferred with rationale (suggestion, sparkline):** noted as a follow-up; v1 mitigates the
  grand-mean-masks-ramp risk with the prominent window label and `n`.

### Strict-TypeScript architect — approve-with-changes

- **Applied (must-fix, missing `Rating` import):** the snippet now merges the new derived types
  into `lib/export.ts`'s existing `import type` block and states explicitly that `Rating` is
  already imported (line 13) and needs no new import.
- **Applied (must-fix, duplicate `formatAverage`):** the report section now says to _reuse_ the
  existing `formatAverage` at `lib/export.ts:111` and warns against re-declaring it; any new
  formatter is distinctly named.
- **Applied (suggestion, reuse `rowsInRange`):** dropped the duplicate `rowsForDates`; the
  helper calls `rowsInRange` directly.
- **Applied (suggestion, no-op filter):** removed the `.filter(date >= change.date)` and
  replaced it with named `afterEnd`/`beforeEnd` locals plus a comment explaining inclusivity.
- **Applied (suggestion, named day-arithmetic locals):** `afterEnd`/`beforeEnd` are now named.
- **Noted, not changed (suggestion, `windowDays` literal union):** left as `number` to match the
  existing `useState<number>(14)` precedent in `trends.tsx`; flagged as an optional pre-existing
  tightening, not this doc's to fix.

### Mobile UX / friction & completion — approve-with-changes

- **Applied (must-fix, empty state):** the Trends block and report section render nothing at all
  (no header) when `doses.length === 0`.
- **Applied (must-fix, layout scaling):** switched from one-row-per-metric-per-change to
  **one collapsible card/table per dose change** with metrics as compact rows inside, all but
  the most recent collapsed by default (pure UI state) — keeps the flat list from burying the
  bars.
- **Applied (suggestion, placement):** stated explicitly that the block sits below the existing
  bars and never above/interleaved.
- **Applied (suggestion, report pagination):** per-change tables get `page-break-inside: avoid`.
- **Applied (suggestion, collapsed-by-default):** adopted as the default layout above.

### Data-model / migration + privacy + scope — approve

- **Applied (suggestion, backup wording):** the guardrails section now says the derived numbers
  are computed only for the on-device Trends view and PDF report and are never added to
  `Backup`/`buildBackup`/`parseBackup`.
- **Applied (suggestion, empty `doses`):** empty-state omission is now specced for both surfaces
  (also a UX must-fix).
- **Applied (suggestion, filter comment):** resolved by removing the no-op filter entirely and
  documenting inclusivity via the `afterEnd`/`beforeEnd` arithmetic.

All lenses approve-with-changes; must-fixes applied.
