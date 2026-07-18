> **Status:** Proposed — pending implementation · **Priority:** P1 · Ref: analysis #11–15 · **Panel:** approve-with-changes (all must-fixes applied)

# Provider report overhaul

## Problem / Context

The PDF report is the app's entire reason to exist: it is the one artifact that leaves the phone and lands in front of a clinician. Everything else — the daily check-ins, the trends tab, the streak — exists to feed this document. Today `buildReportHtml(profile, doses, rows)` emits a thin summary: a header, a dose-change `<ul>`, one grand-mean Morning table, one grand-mean Evening table (null-average metrics dropped), and a 5-column daily table (Date, Sleep, Waking mood, Mood, Focus, Side effects).

For a non-stimulant ADHD medication, the clinically useful signal is the **trend over weeks across dose changes**, not a single number. The current report actively hides that signal:

- **One grand mean flattens the titration story.** If the patient was on 25 mg for two weeks then 40 mg for two weeks, a single "mood 3.4" average erases exactly the before/after contrast the provider needs to reason about.
- **Free-text `notes` never reach the provider.** `EveningCheckin.notes` is captured, stored, shown in `entry/[date]`, and then silently dropped from the export. This is often the richest data ("skipped lunch, focus crashed at 3pm").
- **Adherence is invisible.** `MorningCheckin.doseTaken` is collected but never summarized. A provider cannot distinguish "the drug isn't working" from "the patient missed six doses."
- **Side effects are a flat list per day** with no frequency, no first-appearance date, and no sense of whether an early symptom is present in one half of the range or both.
- **No 20-second orientation.** A busy provider gets no cover summary; they must read the whole daily table to form a picture.

This doc redesigns `buildReportHtml` and its pure helpers in `lib/export.ts` to produce a descriptive, printable, provider-grade report. Everything stays in the RN-free pure-assembly layer so it remains substring-testable under Vitest.

## Goals / Non-goals

**Goals**

- A one-screen **cover summary**: med + dose timeline, date range, adherence counts, top side effects, and a per-metric **trend arrow** (▲/▼/▬) computed from first-half vs second-half average delta with a neutral deadband **and a minimum-sample floor**. Every arrow carries a descriptive, non-judgmental scale-anchor caption sourced from the schema (see Mission fit).
- **Per-period averages**: split the range into calendar-week buckets and per-dose-period buckets (bounded by `DoseChange.date`) rendered as compact tables, replacing the single grand mean. Weekly buckets collapse to dose-period-only beyond a bounded range (see below).
- **Before/after each dose change**: mean of the N days before vs N days after each `DoseChange.date`, reaching outside the displayed range for source data.
- **Adherence block**: taken / dose-not-taken / no-entry counts, rendered with neutral copy and counts foregrounded; the per-date list is de-emphasized to an appendix.
- **Side-effect summary**: per-effect frequency, first-appearance date, and strictly **positional** half-membership ("present in first half only" / "present in both halves" / "present in second half only" — never "resolving/persisting/new").
- **Notes**: a dated list, every string through `escapeHtml`, gated by an `includeNotes` option.
- **Inline sparklines**: HTML bars reusing the `barHeight` idea and palette rating hues — no new dependency.
- A **"since last visit" range preset** (soft dependency on `06-visit-anchoring`).

**Non-goals**

- No interpretation, scoring, or recommendation. Arrows and deltas show numbers; captions never say "improving," only the direction of the measured delta with the values shown.
- No change to the on-device UI report trigger beyond the call-site signature and a richer options object (Settings export button).
- No new persisted metrics (that is `03-side-effect-severity`'s job); this doc consumes what exists.
- No patient-rated global impression of change (PGI-C / CGI-I-style "overall, better/same/worse"). This is the standard actionable titration instrument and the computed per-item arrows are **not** a substitute — flagged as a **backlog gap** (a new persisted metric), explicitly out of scope here so the arrows never implicitly stand in for it.
- No charting library. Sparklines are `<span>` bars, same technique as `trends.tsx`.

## Mission fit & guardrails

This sits squarely in **collect → log → provider**. The report is the "reference that data back to a provider" step. Guardrails held explicitly:

- **Descriptive, not interpretive.** A trend arrow is rendered as `mood ▲ (first half 2.8 → second half 3.6; 1 = terrible, 5 = great)`. The arrow is a typographic restatement of the delta sign, not a verdict. No copy contains "consider," "improving," "worse," "should," or any dose guidance.
- **Arrow polarity is resolved, not deferred.** The original draft left "arrow polarity for lower-better metrics" as an open question. **Resolved:** every arrow, including in the cover summary, carries an inline scale-anchor caption drawn from the metric's own `low`/`high` labels in the schema — e.g. `anxiety ▲ (1 = calm, 5 = anxious)`. We never recolor or relabel the arrow "good/bad"; we restate what a higher value means for that item so `anxiety ▲` cannot be pattern-matched against `mood ▲`. This is a value-free schema restatement, not a footnote the reader must cross-reference.
- **Positional, not physiological, side-effect language.** "Resolving/persisting/new" asserts a trajectory the data cannot support (absence in a half could be dose change, tolerance, unrelated illness, or under-logging). The rendered copy is strictly positional: "present in first half only" / "present in both halves" / "present in second half only."
- **Honest arrows require samples, not just a deadband.** At n=1 on a 1–5 Likert, ordinary noise clears a 0.3 deadband. We add a minimum-sample floor (`MIN_HALF_SAMPLES = 3` per half) below which the trend is `insufficient`, applied to `computeTrend` and to every bucket/before-after average that feeds a rendered arrow.
- **Local-only preserved.** All new logic is pure string assembly over already-loaded `profile`/`doses`/`entries`. No network, no new native surface. Export still happens only through the existing user-initiated `exportPdfReport` (expo-print + sharing).
- **Provider supplies meaning.** Every derived section carries the raw counts/values so the clinician reasons from data. Footnotes state the two things the data cannot show — that **side-effect severity is not captured** (silence is not "mild by default") and that **adherence is a taken/not-taken/no-entry binary** with no timing and no intentional-vs-forgotten distinction — so neither is over-read.

## Data model

No change to persisted shapes is required — the report is derived. We add **report-internal value types** in `lib/export.ts` (not `lib/types.ts`, since they never persist and never enter storage). They are modeled as discriminated / literal unions so illegal states are unrepresentable.

The one addition to `lib/types.ts` is a shared, meaningful literal union reused by trend arrows (and usable by the trends tab later):

```ts
// lib/types.ts
export type TrendDirection = 'up' | 'down' | 'flat';
```

Report-internal types (in `lib/export.ts`). `MetricAverage` is the **single canonical "maybe a mean"** representation for the whole module — `computeTrend` consumes two `MetricAverage`s, not raw `averageOf` output, so there is one absence idiom, not three:

```ts
import type {
  DayEntry,
  DoseChange,
  EveningRatingKey,
  IsoDate,
  MorningRatingKey,
  Profile,
  Rating,
  RatingKey,
  ScaleDirection,
  SideEffect,
  TrendDirection,
} from './types';

// A computed average is either a real mean over >=1 sample, or explicitly empty.
// No NaN, no magic -1: the empty case is a distinct variant.
type MetricAverage =
  | { readonly kind: 'value'; readonly mean: number; readonly n: number }
  | { readonly kind: 'empty' };

// A trend is the descriptive comparison of two halves. `flat` carries the delta
// too, so the renderer never has to recompute or branch on missing data.
type MetricTrend =
  | { readonly kind: 'insufficient' } // empty half, or < MIN_HALF_SAMPLES in either half
  | {
      readonly kind: 'measured';
      readonly direction: TrendDirection;
      readonly firstHalf: number;
      readonly secondHalf: number;
      readonly delta: number;
    };

interface PeriodBucket {
  readonly label: string; // e.g. "Week 1 (Jul 1–7)" or "25 mg (Jul 1–14)"
  readonly startDate: IsoDate;
  readonly endDate: IsoDate;
  // Keys narrowed to their session's union so the map cannot admit an
  // evening-only key like 'libido' into the morning column.
  readonly morning: ReadonlyMap<MorningRatingKey, MetricAverage>;
  readonly evening: ReadonlyMap<EveningRatingKey, MetricAverage>;
}

interface BeforeAfter {
  readonly change: DoseChange;
  readonly windowDays: number;
  readonly before: ReadonlyMap<MorningRatingKey | EveningRatingKey, MetricAverage>;
  readonly after: ReadonlyMap<MorningRatingKey | EveningRatingKey, MetricAverage>;
}

interface AdherenceSummary {
  // totalDays is intentionally NOT stored: it is takenCount + notTakenCount +
  // noEntryCount and is derived at render, so the two can never disagree.
  readonly takenCount: number; // logged morning, doseTaken === true
  readonly notTakenCount: number; // logged morning, doseTaken === false
  readonly noEntryCount: number; // no morning checkin for that date
  readonly notTakenDates: readonly IsoDate[];
  readonly noEntryDates: readonly IsoDate[];
}

interface SideEffectStat {
  readonly effect: SideEffect;
  readonly count: number;
  readonly firstSeen: IsoDate;
  readonly inFirstHalf: boolean;
  readonly inSecondHalf: boolean;
}

interface DatedNote {
  readonly date: IsoDate;
  readonly text: string; // escaped at render time, never before
}
```

`ReportModel` is the single pure structure the HTML renderer consumes, so `buildReportHtml` becomes "compute model, then stringify" — keeping each half independently testable:

```ts
interface ReportModel {
  readonly profile: Profile;
  readonly doses: readonly DoseChange[];
  readonly rangeStart: IsoDate;
  readonly rangeEnd: IsoDate;
  readonly spansMultipleDosePeriods: boolean; // cover summary caveat, see below
  readonly adherence: AdherenceSummary;
  readonly trends: ReadonlyMap<RatingKey, MetricTrend>;
  readonly periods: readonly PeriodBucket[];
  readonly beforeAfter: readonly BeforeAfter[];
  readonly sideEffects: readonly SideEffectStat[];
  readonly notes: readonly DatedNote[];
}
```

Illegal states unrepresentable: an average is never a sentinel number; a trend without enough data is a distinct `insufficient` variant, not `direction: 'flat'` masquerading as measured; empty buckets are simply absent from tables. `Map` values are `MetricAverage`, so `noUncheckedIndexedAccess` concerns vanish (`Map.get` already returns `T | undefined` and is narrowed). Derived facts (`totalDays`) stay derived rather than stored.

## Schema

`n/a` for `MORNING_METRICS` / `EVENING_METRICS` — no new tracked metric is introduced. The report iterates the **existing** schema to know which `RatingKey`s exist, their `direction` (via `directionForRatingKey`), and their `low`/`high` anchor labels, which is what drives the non-judgmental polarity caption. We add no `Metric` union variant, so the `renderMetric` `assertNever` in `checkin.tsx` is untouched.

One additive constant lands in `lib/schema.ts` to keep report ordering the single source of truth rather than hard-coded in `export.ts`:

```ts
// lib/schema.ts
export const REPORT_RATING_ORDER: readonly RatingKey[] = [
  'sleepQuality',
  'wakingMood',
  'mood',
  'focus',
  'impulsivity',
  'anxiety',
  'energy',
  'appetite',
  'libido',
];
```

The report filters this list against `enabledEveningMetricKeys(profile)` for evening keys plus the always-present morning keys, so disabled metrics never appear.

`directionForRatingKey` returns `ScaleDirection | undefined` (it `.find`s over the schema arrays). The polarity-caption path **narrows** this return value (`if (direction !== undefined)`) rather than asserting — no `!`, no non-null assertion, at that or any call site. The anchor-label lookup narrows the same way against a `.find` for the matching `kind: 'scale'` metric.

## Storage & guards

No new AsyncStorage key and **no change to any persisted shape**, so there is no forced re-onboarding and historical data is never mutated. `Profile.enabledEveningMetrics?` already being optional means older profiles keep working; `enabledEveningMetricKeys` supplies `DEFAULT_ENABLED_EVENING_METRICS` on read.

Because the report is derived from `loadEntries` / `loadDoseChanges` / `loadProfile` outputs, all data has already passed the existing `parseEntries` / `parseDoseChangeList` / `parseProfile` guards returning `Parsed<T>`. The report layer trusts typed input and adds no new guard.

**Backup unchanged, verified importable.** `TrendDirection` and the report-internal types are computed, never serialized, so `Backup = { exportedAt; profile; doses; entries }` and `parseBackup` are unchanged: **no version bump is needed, and backups produced by the current `buildBackup` remain importable by the new code unchanged** (the import path touches none of the new types). If a future preset persists a visit anchor (owned by `06-visit-anchoring`), that guard lives there; this doc consumes an `IsoDate` range and does not persist one.

**Migrate-on-read:** none required, because no shape changes. This is called out deliberately: the overhaul is purely a read-side/derive-side feature, which is the safest way to ship a P1 change against real logged data.

## UI touch points

The bulk of the change is `lib/export.ts` (pure) + `settings.tsx` (the export trigger). Named seams:

- **`app/(tabs)/settings.tsx`** — the export/backup buttons resolve the display range via the existing `RANGE_OPTIONS` / `lastNDates` idiom (7/14/30, or since-last-visit later), then call `buildReportHtml(profile, doses, entries, rangeStart, rangeEnd, options)` and `exportPdfReport(...)`. **The call site passes the full `entries` map, not the range-clipped rows** (see Export section — before/after and dose-period math must reach outside the display window). If the "since last visit" preset ships, add a small range-preset selector here. This selector lives on the **export screen only** — it is never surfaced in the Today/checkin flow, so it never becomes a step between opening the app and tapping save. This is the **only** interactive seam. A `includeNotes` Toggle (default on) can also live here so a user who previews the PDF may exclude free-text notes from a given export.
- **`app/checkin.tsx`** — **no edits.** No new `Metric` variant, so no new `renderMetric` switch arm, no `Draft` field, no `handleSave` spread, no `draftFrom*` hydration line. Explicitly flagged and to be preserved verbatim through implementation: this feature deliberately avoids the non-generic check-in seam entirely. Any future revision that starts touching `checkin.tsx` is a scope violation.
- **`app/(tabs)/trends.tsx`** — no required edits. Optional future reuse: `MetricTrend` and the sparkline helper could feed trends, but that is out of scope here.
- **`app/entry/[date].tsx`** — no edits. It hard-codes `RatingRow`s per rating, but the report does not touch that file; we do not add a rating.
- **`components/`** — no new component. Sparklines are inline HTML strings in `export.ts`, not RN components (the report is HTML for print, not a rendered screen).

Net: exactly one file with a behavioral UI change (`settings.tsx`), which keeps the blast radius tiny for a P1.

## Export / report

All of the following is in `lib/export.ts`. **Inventory:** the hand-written per-key `MORNING_ACCESSORS`/`EVENING_ACCESSORS` maps no longer exist — the single generic `ratingAccessor(session, key)` replaced them. Public exports are `ratingAccessor`, `averageOf`, `rowsInRange`, `buildBackup`, `parseBackup`, `exportPdfReport`.

**Signature change (must-fix, deliberate).** The original `buildReportHtml(profile, doses, rows)` took only range-clipped `rows`. That silently breaks before/after and dose-period buckets: a 7-day report with a dose change 20 days prior still needs a 14-day "before" window, and a dose-period bucket can start weeks before the display range. Passing only `rows` would report "no data" for periods that have data on the phone — the exact failure this artifact exists to avoid. So the signature changes to take the full `entries` map plus an explicit range:

```ts
export function buildReportHtml(
  profile: Profile,
  doses: readonly DoseChange[],
  entries: Readonly<Record<IsoDate, DayEntry>>,
  rangeStart: IsoDate,
  rangeEnd: IsoDate,
  options: ReportOptions = DEFAULT_REPORT_OPTIONS,
): string;
```

`rowsInRange(entries, lastNDates(...))` produces the display rows internally; the dose-period and before/after helpers read from `entries` directly so they reach beyond the window. Existing call sites (`settings.tsx`) and the `export.test.ts` fixtures update to the new arity — a mechanical, one-line-per-call-site change.

**`ReportOptions` — one canonical shape, range excluded.** Range is resolved _before_ `buildReportHtml` via `RANGE_OPTIONS`/`lastNDates` (same as `trends.tsx`) and arrives as `rangeStart`/`rangeEnd` params; it is deliberately **not** a field on `ReportOptions`. Every section references exactly this type:

```ts
export interface ReportOptions {
  readonly beforeAfterWindowDays: number; // default 14
  readonly includeNotes: boolean; // default true; Settings toggle can exclude free-text notes
}

const DEFAULT_REPORT_OPTIONS: ReportOptions = {
  beforeAfterWindowDays: 14,
  includeNotes: true,
};

// Neutral deadband: |delta| below this renders 'flat'. Chosen at 0.3 of a
// 1..5 point so a rounding-level wobble never reads as a direction.
const TREND_DEADBAND = 0.3;

// Minimum samples per half before a delta is presented as a measured trend.
// Below this, day-to-day Likert noise clears the deadband, so we return
// 'insufficient' instead of a confident-looking arrow.
const MIN_HALF_SAMPLES = 3;

// Beyond this range length, weekly buckets are omitted and only dose-period
// buckets render, keeping the PDF scannable (resolves the "cap week buckets"
// open question at a concrete threshold: 8 weeks).
const MAX_WEEKLY_BUCKET_DAYS = 56;
```

**New pure helpers (all tested, RN-free):**

```ts
// The single adapter from legacy `number | null` means to the canonical union.
export function toMetricAverage(mean: number | null, n: number): MetricAverage {
  return mean === null || n === 0 ? { kind: 'empty' } : { kind: 'value', mean, n };
}

// computeTrend consumes two MetricAverages — one absence idiom, not three —
// and enforces both the deadband and the minimum-sample floor.
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

export function computeAdherence(rows: readonly DayEntry[]): AdherenceSummary {
  /* counts doseTaken true/false/absent, collects not-taken & no-entry dates */
}

export function bucketByWeek(rows: readonly DayEntry[]): readonly PeriodBucket[] {
  /* 7-day calendar buckets; averages via toMetricAverage */
}

export function bucketByDosePeriod(
  entries: Readonly<Record<IsoDate, DayEntry>>,
  doses: readonly DoseChange[],
  rangeStart: IsoDate,
  rangeEnd: IsoDate,
): readonly PeriodBucket[] {
  /* bounds from sorted DoseChange.date; reads full entries */
}

export function beforeAfterDose(
  entries: Readonly<Record<IsoDate, DayEntry>>,
  change: DoseChange,
  windowDays: number,
): BeforeAfter {
  /* reuse addDays + lastNDates; shared helper per 02-before-after-dose */
}

export function summarizeSideEffects(rows: readonly DayEntry[]): readonly SideEffectStat[] {
  /* freq, firstSeen, positional half-membership flags */
}

export function collectNotes(rows: readonly DayEntry[]): readonly DatedNote[] {
  /* evening.notes, dated, unescaped text */
}
```

A `MetricAverage` that feeds a rendered arrow always passes through `computeTrend`, so the `MIN_HALF_SAMPLES` floor governs `bucketByWeek` / `bucketByDosePeriod` / `beforeAfterDose` arrow rendering uniformly — the raw means still show in tables, but a comparison arrow only appears when both sides clear the floor.

The trend-arrow renderer maps `TrendDirection` with an **exhaustive switch ending in `assertNever`**:

```ts
function arrowGlyph(d: TrendDirection): string {
  switch (d) {
    case 'up':
      return '▲';
    case 'down':
      return '▼';
    case 'flat':
      return '▬';
    default:
      return assertNever(d);
  }
}
```

**Polarity caption** is a value-free schema restatement, narrowing the `.find` result rather than asserting:

```ts
function scaleAnchorCaption(key: RatingKey): string {
  const metric = [...MORNING_METRICS, ...EVENING_METRICS].find(
    (m): m is Extract<Metric, { kind: 'scale' }> => m.kind === 'scale' && m.key === key,
  );
  if (metric === undefined) {
    return '';
  }
  // e.g. "1 = calm, 5 = anxious" — states the scale, never "better/worse".
  return `1 = ${metric.low}, 5 = ${metric.high}`;
}
```

**Cover-summary caveat.** The cover arrows are first-half vs second-half of the _selected range_, which can straddle a dose change. When `spansMultipleDosePeriods` is true, the cover renders a neutral one-line caveat — "This range spans more than one dose. See the per-dose-period and before/after sections below for the split view." — pointing to the sections that disambiguate, so a range-wide arrow is never read as steady response to the current dose.

**Sparklines** reuse the trends `barHeight` idea with no dependency, and `ratingHexFor` has an explicit `string`-returning signature so both ternary branches are provably `string` (the original draft interpolated the whole `palette` object — a real bug and a `restrict-template-expressions` failure; fixed to a concrete token):

```ts
function ratingHexFor(rating: Rating, direction: ScaleDirection): string {
  /* same green / clay / ochre rating hues ratingColor uses, from lib/tokens.ts palette */
}

function sparklineHtml(values: readonly (Rating | undefined)[], direction: ScaleDirection): string {
  return values
    .map((v) => {
      const height = v === undefined ? 4 : 8 + v * 8; // same formula as trends.tsx
      const bg = v === undefined ? palette.warm300 : ratingHexFor(v, direction);
      return `<span style="display:inline-block;width:4px;height:${String(height)}px;background:${bg};vertical-align:bottom;margin-right:1px"></span>`;
    })
    .join('');
}
```

Every free-text field (`notes`, `MedName`, dose `note`) still goes through `escapeHtml`. **Adherence copy is neutral:** counts are foregrounded ("Doses taken: 22 · Not taken: 1 · No entry: 5"), a no-morning day reads "no entry recorded" (never "missed"), and the itemized per-date list is de-emphasized to an appendix at the end of the block — matching the app's calm, non-judgmental language so a self-previewing user does not read a report card. A one-line footnote states adherence is a taken/not-taken/no-entry binary without timing or intent. The side-effect block carries a one-line footnote that severity is not currently captured. The daily table keeps its readable 5-ish columns; the deep data lives in the dedicated sections above it, so the printable daily table stays scannable rather than ballooning to 12 columns.

Report section order: cover summary (with polarity captions + multi-dose caveat) → dose timeline → per-period averages (+ sparkline per metric; weekly buckets omitted beyond `MAX_WEEKLY_BUCKET_DAYS`) → before/after each dose change → adherence → side-effect summary → dated notes (if `includeNotes`) → daily log table.

## Notifications

`n/a`. No reminder or scheduling change. `lib/notifications.ts` is untouched.

## Test plan

All new logic lives in the coverage-scoped `lib/export.ts`, so tests keep coverage ≥ thresholds (lines/statements/functions 90, branches 85). Specs go in `lib/__tests__/export.test.ts`, importing `{ describe, it, expect }` from `vitest`, narrowing discriminated unions rather than asserting, and using the sanctioned `as IsoDate` literal-fixture idiom.

- **`toMetricAverage`**: `(null, 0)` and `(3.2, 0)` → `{kind:'empty'}`; `(3.2, 4)` → `{kind:'value', mean:3.2, n:4}`.
- **`computeTrend`**: (a) both halves ≥3 samples, delta above deadband up → `{kind:'measured', direction:'up'}` with exact `firstHalf`/`secondHalf`; (b) delta within `±TREND_DEADBAND` → `'flat'`; (c) empty first half → `{kind:'insufficient'}`; **(d) both halves populated but n=2 each → `{kind:'insufficient'}` (the `MIN_HALF_SAMPLES` floor, distinct from the deadband).** Narrow on `result.kind === 'measured'` before reading `delta`.
- **`computeAdherence`**: fixture of 5 dates — 3 `doseTaken:true`, 1 `false`, 1 no morning — asserts `takenCount:3`, `notTakenCount:1`, `noEntryCount:1`, exact `notTakenDates`/`noEntryDates`, and that render derives `totalDays:5` from the three counts.
- **`bucketByWeek` / `bucketByDosePeriod`**: 16-day range with a `DoseChange` at day 8 → assert bucket count, labels, boundary dates; a metric with no samples in a bucket yields `MetricAverage` of `kind:'empty'`; a >56-day range asserts weekly buckets are omitted and only dose-period buckets render.
- **`bucketByDosePeriod` reach-back**: a dose period starting before `rangeStart` still populates from `entries` (proves the full-map data path, not range-clipped rows).
- **`beforeAfterDose`**: window 14, change mid-range, uneven sample counts before/after → assert both means and `n`; empty side → `kind:'empty'`; a side with <3 samples yields `insufficient` when routed through `computeTrend`.
- **`summarizeSideEffects`**: `nausea` present days 1–3 only, `headache` day 12 only → assert `firstSeen`, `count`, and positional flags (`nausea` first-half-only; `headache` second-half-only). Assert the rendered copy contains "present in first half only" and **does not** contain "resolving"/"persisting"/"new".
- **`collectNotes`**: only evening notes collected, sorted by date, text returned raw; with `includeNotes:false` the notes section is absent from the HTML.
- **`buildReportHtml` substring assertions** (house idiom): contains the adherence counts string with neutral "no entry recorded" wording (and **not** "missed"), contains `▲`/`▼`/`▬` for a known trend, contains a scale-anchor caption (`1 = calm, 5 = anxious`) adjacent to a `lower-better` arrow, contains the multi-dose caveat when the range spans a dose change, contains a per-period label, contains an escaped note (`&lt;script&gt;` when a note holds `<script>`), contains a sparkline `<span` with a computed `height:` and a concrete hex background (not `[object Object]`), and that a disabled evening metric label is **absent**.
- **`assertNever` reachability**: `arrowGlyph` covered by exercising all three `TrendDirection`s.

## Gate compliance

- **No `any` / unsafe-any**: all inputs are already-typed `Profile` / `DoseChange[]` / `Record<IsoDate,DayEntry>`; no untrusted data enters here.
- **No `!`**: `Map.get` returns `T | undefined` and is narrowed; `averageOf` returns `number | null`, funneled through `toMetricAverage` before use; `directionForRatingKey` and the `.find` for scale anchors return `… | undefined` and are narrowed with explicit `undefined` checks, never asserted.
- **`restrict-template-expressions`**: `ratingHexFor` returns `string`; both `sparklineHtml` branches are provably `string`; numeric `height` is wrapped in `String(...)`. No object is ever interpolated into a template literal.
- **No `@ts-*` / `eslint-disable`**: none needed.
- **100% type-coverage**: the only assertions are `as IsoDate` on known-valid literals in test fixtures (exempt under `--ignore-as-assertion`); production code mints branded dates via existing guard-and-throw helpers (`formatIsoDate`, `addDays`). No `as` in `export.ts` production paths.
- **Exhaustive switch**: `arrowGlyph` ends in `default: return assertNever(d)`; adding a `TrendDirection` member fails to compile until handled.
- **`exactOptionalPropertyTypes`**: report-internal interfaces use required fields plus explicit union variants instead of optional flags, so no `| undefined` vs absent ambiguity. Any HTML options built with conditional spreads follow the existing `handleSave` idiom.

## Dependencies & sequencing

- **Soft-enables / depends on `06-visit-anchoring`**: the "since last visit" range preset needs a persisted visit anchor. Ship the report overhaul first with the 7/14/30 presets; wire the preset when `06` lands. Nothing here blocks on it — the range arrives as explicit `rangeStart`/`rangeEnd` params.
- **Shares a helper with `02-before-after-dose`**: `beforeAfterDose(entries, change, windowDays)` is the single shared pure helper. Whichever ships first exports it from `lib/export.ts`; the other imports it. Coordinate this signature now.
- **Consumes side-effect severity if `03-side-effect-severity` ships**: `summarizeSideEffects` is written against the current flat `readonly SideEffect[]`. If severity is added later as an additive shape, extend `SideEffectStat` then — this doc does not block on it. (Corrected cross-references: `02` is before-after-dose, `03` is side-effect severity/adherence; the Non-goals bullet is fixed to name `03`.)
- **Enables**: a richer provider conversation without any new data collection — pure leverage over data already logged.

## Alternatives considered / open questions

- **Compute in the renderer vs a `ReportModel`.** Chosen: build a pure `ReportModel` first, stringify second. It makes every derivation unit-testable without asserting on HTML, and keeps `buildReportHtml`'s substring tests focused on presentation.
- **Statistical significance instead of a deadband.** Rejected as the _only_ guard. Per-day n is tiny and the mission forbids implying significance. We keep the fixed 0.3 deadband _and_ add a `MIN_HALF_SAMPLES = 3` floor so short ranges cannot render a confident arrow off one or two noisy days; the report footnote explains both plainly.
- **Week buckets vs dose-period buckets.** We render **both** up to 8 weeks, because a titrating provider cares about dose periods while weeks are the natural cadence for a "how's it trending" read. **Resolved:** beyond `MAX_WEEKLY_BUCKET_DAYS` (56 days) weekly buckets are omitted and only dose-period buckets render, keeping a long report scannable.
- **SVG sparklines vs `<span>` bars.** Chose HTML bars to exactly match `trends.tsx` and avoid any new rendering path in expo-print.
- **Arrow polarity for `lower-better` metrics — resolved.** Every arrow carries an inline scale-anchor caption from the schema (`1 = <low>, 5 = <high>`); we never recolor or relabel the arrow. This is a value-free restatement, not a footnote to cross-reference.
- **Notes default-on for previously-unexported free text.** These notes were written before the user had reason to expect a provider PDF. Still user-initiated and on-device, but we add an `includeNotes` Settings toggle (default on) so a user previewing the export can exclude free text for a given share, rather than a silent default-on.
- **Patient global impression (PGI-C) — backlog gap.** The computed arrows are a per-item proxy, not the patient's own overall read, which is the standard titration instrument. Explicitly out of scope (needs a new persisted metric); flagged so the arrows never implicitly substitute for it.

## Panel review

### Clinical / behavioral-health measurement — approve-with-changes

- Resolved the arrow-polarity open question: every trend arrow (cover summary included) now carries an inline, value-free scale-anchor caption (`1 = <low>, 5 = <high>`) sourced from the schema via `scaleAnchorCaption`, so `anxiety ▲` cannot be misread against `mood ▲`.
- Dropped "resolving/persisting/new" from all rendered copy and types; side-effect half-membership is now strictly positional ("present in first half only" / "…both halves" / "…second half only").
- Added `MIN_HALF_SAMPLES = 3` per-half floor in `computeTrend`, applied uniformly to the bucket and before/after arrows, so short ranges return `insufficient` instead of a noise-driven arrow.
- Folded in suggestions: PGI-C flagged as an explicit backlog gap (out of scope); a multi-dose-period caveat added to the cover summary; severity-not-captured and adherence-binary limitation footnotes added; week-bucket cap resolved at 56 days.

### Strict-TypeScript architect — approve-with-changes

- Fixed the `sparklineHtml` bug: the undefined branch now uses `palette.warm300`, and `ratingHexFor` has an explicit `(rating: Rating, direction: ScaleDirection) => string` signature, so both branches are provably `string` and `restrict-template-expressions` passes.
- Resolved the `ReportOptions` contradiction: range is excluded from the type (resolved via `RANGE_OPTIONS`/`lastNDates` before `buildReportHtml`) and every section now references the same `{ beforeAfterWindowDays; includeNotes }` shape.
- Folded in suggestions: `PeriodBucket`/`BeforeAfter` maps narrowed to `MorningRatingKey`/`EveningRatingKey`; `MetricAverage` made the single canonical absence idiom with `computeTrend` consuming two `MetricAverage`s via `toMetricAverage`; a narrowing note added for `directionForRatingKey`'s `… | undefined` return; `AdherenceSummary.totalDays` dropped as derived.

### Mobile UX / friction & completion — approve

- Preserved the "`checkin.tsx` gets no edits" section verbatim and flagged future edits to it as a scope violation.
- Folded in suggestions: neutral adherence copy ("no entry recorded", never "missed"), counts foregrounded with the per-date list de-emphasized to an appendix; confirmed the range-preset selector lives on the export screen only, never in the Today/checkin loop; week-bucket cap resolved to bound export-tap render time.

### Data-model / migration + privacy + scope — approve-with-changes

- Closed the data-flow/range gap: `buildReportHtml` now takes the full `entries` map plus explicit `rangeStart`/`rangeEnd`, and `bucketByDosePeriod`/`beforeAfterDose` read from `entries` so periods with on-device data outside the display window are never reported as empty. Signature change documented as deliberate.
- Folded in suggestions: added an `includeNotes` toggle rather than silent default-on for previously-unexported free text; corrected the `02`/`03` cross-references; corrected the export inventory (the per-key `MORNING_ACCESSORS`/`EVENING_ACCESSORS` maps have since been removed in favor of the generic `ratingAccessor`); added a one-line confirmation that `Backup`/`parseBackup` need no version bump and old backups stay importable.

All lenses approve-with-changes; must-fixes applied.
