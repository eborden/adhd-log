> **Status:** Rescoped (2026-07-19) — the report before/after **section** already shipped with the
> provider-report overhaul (`docs/DECISIONS.md` → "Provider report overhaul"). What remains is the
> clinical enrichment that section still lacks, plus the never-built in-app surface. · **Priority:**
> P2 · Ref: analysis #10

# Before/after dose-change comparison

## What already shipped (and why this doc changed)

The original plan specced a pure `beforeAfterDose` helper, its result types, a Trends sub-view, and
a report section — all from scratch, with `01/06-provider-report-overhaul` slated to _consume_ the
helper. The overhaul landed first and **reimplemented** this instead of importing it, on a different
internal architecture. So today, already in `lib/export.ts`:

- `beforeAfterDose(entries, change, windowDays): BeforeAfter` — per **dose change** (not the whole
  `doses[]` at once), returning `{ change, windowDays, before, after }` where each side is a
  `ReadonlyMap<RatingKey, MetricAverage>` over `REPORT_RATING_ORDER`.
- `MetricAverage = { kind: 'value'; mean; n } | { kind: 'empty' }` — the mean **already carries its
  sample count `n`**, it just isn't rendered.
- `beforeAfterHtml(...)` — the report's "Before / after dose changes" section: one small table per
  in-range change, one row per metric, columns Before · After · change arrow (via `computeTrend`)
  with a value-free scale-anchor caption.
- `computeAdherence(rows): AdherenceSummary` — taken / not-taken / no-entry counts over any row set.

**Obsolete from the old plan** (do not implement as written): the accessor-based
`beforeAfterDose(entries, doses, accessor, windowDays)` signature; the `DoseWindowSummary` /
`DoseComparisonRow` types; the `formatAverage`-at-line-111 references; the
`buildReportHtml(profile, doses, rows)` signature. All superseded by the shapes above.

## Remaining problem

The section renders each side's **mean and an arrow, and nothing about the denominator behind
them**. A bare `2.4 → 3.1` silently hides the two facts that make a titration comparison
interpretable, both of which the data already contains:

- **Sample size (n).** A window mean over 12 logged days and one over a single logged day render
  identically. `MetricAverage.n` is computed but dropped on the floor.
- **Adherence.** "After" looking flat could be no efficacy _or_ missed doses. `doseTaken` is logged
  per day but never partitioned around the change.

And the **in-app Trends surface was never built** — `app/(tabs)/trends.tsx` shows per-day bars and
`doseChangeMarkers` dots, but nothing quantifies the two sides of a marker on-device.

## Goals / Non-goals

**Goals**

1. **Surface `n` and adherence in the before/after comparison.** Beneath each Before/After mean,
   show `n=<count>` (from `MetricAverage.n`) and `<taken>/<logged> doses`, and flag a side with
   `n < 3` as "few logged days". Purely descriptive — more of the raw data, no new interpretation.
2. **Build the in-app "Around dose changes" Trends view** from the existing `beforeAfterDose`
   helper: one collapsible card per `DoseChange`, metrics as compact rows inside.
3. Zero new persisted shape — all derived from existing `entries` + `doses`; never added to
   `Backup` / `buildBackup` / `parseBackup`.

**Non-goals** (unchanged from the original): no verdict, delta, "improvement" label, percent change,
effect size, or significance test; no new tracked metric or schema change; no notification change;
side-effect before/after counts remain a separate fast-follow (they need a `SideEffect` accessor,
not a `Rating` one).

## Data model

**No new persisted types.** One report-internal extension to the existing `BeforeAfter` so the
adherence for each window travels with the means already there — reusing `AdherenceSummary`, not a
new shape:

```ts
// lib/export.ts — extend the existing interface (derived-only, never persisted, no guard).
export interface BeforeAfter {
  readonly change: DoseChange;
  readonly windowDays: number;
  readonly before: ReadonlyMap<RatingKey, MetricAverage>;
  readonly after: ReadonlyMap<RatingKey, MetricAverage>;
  readonly beforeAdherence: AdherenceSummary; // NEW — from computeAdherence(beforeRows)
  readonly afterAdherence: AdherenceSummary; // NEW — from computeAdherence(afterRows)
}
```

`beforeAfterDose` already builds `beforeRows` / `afterRows` via `rowsInRange` + `datesInRange`; it
just calls the existing `computeAdherence` on each and adds the two fields. `n` needs no new field —
it is read off each `MetricAverage` at render. `daysLogged` is expressed as
`takenCount + notTakenCount` (logged mornings), the honest denominator for "X/Y doses taken".

Invariant preserved: `MetricAverage`'s `empty` variant still means "no logged value", so `n` and the
mean can never desync (one union, no `hasData` flag).

## Report changes (`lib/export.ts`)

Enrich `beforeAfterHtml` only — the section, ordering, and per-change table structure already exist:

- Under each Before/After mean cell, render `n=<n>` (0 for an `empty` side) and, once per table (not
  per metric — adherence is a property of the day), the window's `<taken>/<logged> doses` from
  `before/afterAdherence`. Add a muted "few logged days" note when a side's `n < 3`.
- Keep the existing `computeTrend` arrow + scale-anchor caption. Reuse the section's existing
  number formatter (the local `fmt` over `MetricAverage.mean.toFixed(1)`); do **not** add a second.
- `escapeHtml` every interpolated string; count annotations are integers.

_Optional, same mechanism:_ the cover-summary and period-average tables also drop `n`; surfacing it
there is a natural follow-on but out of this doc's core scope.

## In-app Trends view (`app/(tabs)/trends.tsx`)

Add an "Around dose changes" block **below** the existing per-day bars (never above/interleaved):

- **Renders nothing — not even the header — when `doses.length === 0`** (the common early-titration
  / long-stable state), matching the report's guard.
- **One collapsible card per `DoseChange`**, enabled metrics as compact `label · Before · After`
  rows inside. All but the most recent change **collapsed by default** — pure component `useState`,
  no persisted preference.
- Uses the selected `RANGE_OPTIONS` value (`useState<number>(14)`) as `windowDays`, **labeled in the
  card header** ("14-day windows") since a 7-day window can predate a non-stimulant's onset.
- For each metric: resolve `ratingAccessor(session, key)`, read the matching side from
  `beforeAfterDose(...)`, format the mean (em-dash for `empty`), color via
  `ratingColor(theme, Math.round(mean), direction)` (round for color bucketing only; keep the
  decimal shown). Under each mean show `n=<n>`; under the card, `<taken>/<logged> doses` and the
  `n < 3` flag.
- A small presentational `components/DoseChangeCard.tsx` may hold the collapse state to keep
  `trends.tsx` thin; no domain logic in it. No check-in/settings/schema seam is touched (read-only
  derived view).

## Test plan

Extend `lib/__tests__/export.test.ts` (the before/after section is already exercised there):

1. **n surfaced** — a window with a known count renders `n=<count>` for each side; an `empty` side
   renders `n=0` and an em-dash mean.
2. **Adherence surfaced** — a window mixing `doseTaken` true/false and no-morning days renders
   `<taken>/<logged> doses` where `taken` counts only `true` mornings and `logged = taken+notTaken`.
3. **Few-logged flag** — a side with `n < 3` gets the "few logged days" note; `n >= 3` does not.
4. **Adherence is per-window, not whole-range** — two changes with different dosing in their windows
   get distinct counts (guards that `computeAdherence` runs on the window rows, not `rows`).

Keep coverage ≥ thresholds; the new render branches (`empty` → `n=0`, `n < 3` flag) each get a case.
The in-app view is RN and not unit-tested under the node Vitest setup (per `CLAUDE.md`).

## Gate compliance

Unchanged in spirit: no `any` / `!` / `@ts-*` / eslint-disable; `AdherenceSummary` and
`MetricAverage` are already fully typed; no new discriminated-union variant (every `assertNever`
stays valid); no duplicate declarations (reuse `computeAdherence`, `rowsInRange`, `datesInRange`,
the section's `fmt`); 100% type-coverage. No `Backup`/`parseBackup` change, so no migration.

## Origin

The `n` + adherence requirements are the clinical panel's original must-fixes for this feature
("distinguish lack of efficacy from non-adherence"; "don't mistake a one-day window for a stable
reading"). They were the point of the plan and remain unmet by the shipped section — this rescope
just re-anchors them (and the unbuilt in-app view) to the architecture that actually landed.
