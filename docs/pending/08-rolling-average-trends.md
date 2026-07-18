> **Status:** Proposed — pending implementation · **Priority:** P1 · Ref: analysis #7 · **Panel:** approve-with-changes (must-fixes applied)

# Rolling-average trend smoothing

## Problem / Context

The app exists to surface a _weeks-long_ trend: non-stimulant ADHD meds accumulate effect over weeks, so the signal that matters to a provider is the slope, not any single day. But the raw data is daily 1–5 `Rating` values, and self-reported mood/focus/energy are noisy — a bad night's sleep or a stressful afternoon swings a rating a point or two. On `app/(tabs)/trends.tsx` today, each metric is a row of raw daily bars (`barHeight = 8 + rating*8`). Over a 14- or 30-day range that jitter is exactly loud enough to hide a gentle upward or downward drift. The user (and the provider reading the exported PDF) is left eyeballing a picket fence.

The fix is standard and non-interpretive: overlay a **trailing rolling mean** on the same bars. Smoothing is a descriptive transform — it re-plots the same logged numbers at lower frequency. It draws no conclusions, scores no risk, and suggests no dose change. It just makes the trend the app already promises actually visible.

One correctness constraint shapes the whole design, and it comes straight from the mission: **a trailing mean must never blend two different dosing regimens into one number.** A dose change is precisely the moment a provider most needs a clean read on "is the new dose doing anything," and a naive 7-day trailing window straddling that boundary produces a coherent-looking figure that quietly averages old-dose and new-dose days. The doc already rejects a _centered_ window for borrowing from the future near a dose change; that same reasoning is carried through to the trailing window here. Both the on-screen overlay and the report **reset the window at the most recent `DoseChange` date**, so a smoothed value only ever draws from the current dosing period. (The Trends screen already draws `doseChangeMarkers` as column-aligned dots, so the boundary is also _visible_ where the reset happens — the reader sees both the marker and the fresh window.)

## Goals / Non-goals

**Goals**

- A pure, RN-free, unit-tested `rollingAverage(values, window, boundaries?)` helper in a new `lib/trends.ts`, added to the Vitest coverage scope.
- Dose-period awareness: the trailing window truncates at the most recent dose-change boundary, so no smoothed value spans two regimens.
- Overlay a smoothed series on each `trends.tsx` metric row as a visually distinct second series (thin `theme.accent` dots), column-aligned with the existing bars and `markersRow`, without letting the overlay visually erase acute single-day spikes.
- A show/hide toggle for smoothing, and a window-size selection sensible for each range.
- Smoothed values typed as `number | null` end to end — never cast back to `Rating`.
- In the PDF report: a `Recent (Nd avg)` column labelled with its **concrete date span**, accompanied by an **adherence count for that same window** and a plain caveat line — so a precise-looking figure can never be read out of context.

**Non-goals**

- No charting library; keep the hand-rolled `<View>` bar layout.
- No new persisted data. Smoothing is a pure view-time transform over data already in `entries`.
- No exponential/weighted/centered variants in v1 (trailing simple mean only — see Alternatives).
- No smoothing in the PDF report daily-log table (report gets the labelled Recent-average column plus context only — see Export).
- No interpretation: no "trending up/down" labels, arrows, slope numbers, or callouts.
- No new instrumentation (PGI-C/CGI-I, structured side-effect severity) — see the forward note under Alternatives; this doc is a view-time transform, not a data-capture change.

## Mission fit & guardrails

- **collect → log → provider, unchanged.** Smoothing reads the same `DayEntry` rows `rowsInRange` already produces. Nothing new is collected; nothing new is stored; nothing leaves the phone.
- **Descriptive, not interpretive.** A trailing mean is a re-rendering of logged numbers. The overlay carries no verdict. Copy stays neutral: the toggle reads "Smooth (n-day average)", never "trend" as a judgment. No arrows, no color-coded "improving/worsening", no thresholds.
- **Dose-period honesty.** Truncating the window at each dose change keeps every smoothed figure attributable to a single dosing regimen — a defer-meaning-to-the-provider safeguard, not an interpretation.
- **Local-only preserved.** Zero I/O, zero network, no new AsyncStorage keys.
- **Type contract honored.** Averaging `Rating`s yields a `number` in `[1,5]`, which is emphatically **not** a `Rating`. The helper's return type is `readonly (number | null)[]` and stays that way through the render path. No `as Rating`.

## Data model

No changes to persisted domain types (`Profile`, `DayEntry`, check-ins). Smoothing is a view transform, so the only new type is the helper's own vocabulary, and it lives in `lib/trends.ts`:

```ts
// lib/trends.ts
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
```

Notes that keep this inside the contract:

- `values[j]` and `boundaries?.[i]` under `noUncheckedIndexedAccess` are `Rating | undefined` and `boolean | undefined`; `if (v !== undefined)` and `=== true` **narrow** them — no non-null assertion, no cast.
- `window < 1` is a programmer error (window comes from an in-repo constant, not persisted data), so a thrown `RangeError` is correct rather than a `Parsed<T>` failure. Untrusted data never reaches this function.
- `boundaries` is an **optional parameter** (`readonly boolean[] | undefined`), so the plain `rollingAverage(values, window)` call still type-checks and the `window < 1` test stays a bare 2-arg call. `rollingAverage` stays an intentionally-generic primitive on `window: number`; `SmoothingWindow` (below) only constrains the UI-facing _selector_. A future implementer should **not** thread `SmoothingWindow` through this helper — doing so makes the out-of-union `window < 1` test inexpressible.
- Illegal states unrepresentable: there is no "smoothed but no data" ambiguity — the absence case is the single `null` variant, mirroring how `averageOf` already returns `number | null`.

Dose-period boundaries are derived from the same `dates`/`doses` the screen and report already hold:

```ts
// lib/trends.ts
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
```

The allowed UI windows are a literal-union const so the selector can't pick a nonsense value:

```ts
// lib/trends.ts
export const SMOOTHING_WINDOWS = [3, 7] as const;
export type SmoothingWindow = (typeof SMOOTHING_WINDOWS)[number];

/** Sensible trailing window for a given range length. */
export function defaultWindowForRange(rangeDays: number): SmoothingWindow {
  return rangeDays <= 7 ? 3 : 7;
}
```

## Schema

**n/a.** No new tracked metric, label, or default. `lib/schema.ts` describes _what is collected_; smoothing changes only _how existing scale metrics are drawn_. Adding a schema entry would be wrong — it would imply a new field to log. The overlay applies uniformly to every `kind: 'scale'` metric already rendered by `trends.tsx`, driven by the same `MORNING_METRICS` / `EVENING_METRICS`.

## Storage & guards

**No new persisted state, so no new guards are strictly required.** Smoothing is recomputed on each render from `entries`, exactly like the raw bars. Historical data is never read differently, never mutated, never migrated. There is no forced re-onboarding because `Profile` is untouched. Adherence in the report is computed from `MorningCheckin.doseTaken`, which is already captured and already parsed by `parseDayEntry`/`parseEntries` — no new field, no new guard.

One **optional** persistence decision: whether the "show smoothing" toggle and window are remembered. Two acceptable paths, in order of preference:

1. **Ephemeral (recommended for v1):** hold `smoothingOn: boolean` and `window: SmoothingWindow` in `trends.tsx` `useState`. Zero storage surface, zero migration, zero backup change. The trade-off — preference resets on app restart — is trivial for a personal single-user tool.

2. **Persisted (only if the user asks to remember it):** add optional fields to `Profile`. To pre-empt a future implementer inventing a differently-shaped mechanism, **both** the flag and the window are specified up front as additive/optional:

   ```ts
   // lib/types.ts — Profile
   readonly trendSmoothing?: boolean;
   readonly trendSmoothingWindow?: SmoothingWindow;
   ```

   This is **additive and optional**, so it is fully backward compatible:
   - `isProfile` in `lib/storage.ts` gains guard clauses matching the **existing house convention** already used for `enabledEveningMetrics` — `raw['trendSmoothing'] === undefined || typeof raw['trendSmoothing'] === 'boolean'` (not an `in`-operator check; `JSON.stringify` drops `undefined` keys, so `=== undefined` is equivalent and consistent with the codebase). A failing clause returns `{ ok: false, reason: 'trendSmoothing must be a boolean' }`, matching the `Parsed<Profile>` reason-string style; it does not return a bare boolean fragment.
   - **Migrate-on-read is implicit:** an old persisted `Profile` with neither field parses cleanly; consumers treat absence as "off"/default via `profile.trendSmoothing ?? false` and `profile.trendSmoothingWindow ?? defaultWindowForRange(range)`. No shape rewrite, no version bump.
   - **False-vs-undefined on toggle-off must be decided in that follow-up**: under `exactOptionalPropertyTypes`, writing `undefined` to `trendSmoothing` is rejected unless the field type is widened to `boolean | undefined`. The sanctioned choice is to write `false` (not delete the key) when the user turns smoothing off, keeping the field type a clean `boolean`.
   - `parseBackup` / `Backup` need no change — `parseBackup` already delegates to `parseProfile(profileRaw)` and round-trips whatever it accepts; the new optional fields flow through untouched (verified against `lib/export.ts`).

   Given the mission bias toward the smallest surface, **v1 ships path 1** and this doc records path 2 as the sanctioned extension if a preference-persistence need is confirmed.

## UI touch points

The one substantive edit is `app/(tabs)/trends.tsx`. The critical point: smoothing rides the **existing, fully schema-driven** trends seam — it does **not** touch any of the non-generic seams.

**`app/(tabs)/trends.tsx` (the only required edit):**

- Import `rollingAverage`, `dosePeriodBoundaries`, `defaultWindowForRange`, and the `SmoothingWindow` type from `../../lib/trends`.
- Add `const [smoothingOn, setSmoothingOn] = useState<boolean>(true)` and derive `window` from `range` via `defaultWindowForRange(range)` (or a second `useState<SmoothingWindow>`).
- Add a "Smooth" toggle control. **Give it its own row (or a clearly separated segment) rather than crowding it into `rangeRow` alongside the three `RANGE_OPTIONS` chips** — on a narrow device (iPhone SE width) a fourth control in that row risks wrapping or shrinking existing tap targets below the app's comfortable size. Reuse the existing `Pressable` chip pattern or `components/Toggle`. Copy: `Smooth (${window}d avg)`. Neutral, non-interpretive. Do a quick small-screen layout check before merge.
- Build the boundary mask once from the same `dates`/`doses` the screen already loads for `doseChangeMarkers`:

  ```tsx
  const boundaries = dosePeriodBoundaries(dates, doses);
  ```

- Inside `visibleScaleMetrics.map(...)`, for each metric build the daily values array and pass it plus the boundaries to `rollingAverage`:

  ```tsx
  const accessor = ratingAccessor(session, metric.key);
  const values = rows.map((row) => accessor?.(row)); // (Rating | undefined)[]
  const smoothed = smoothingOn ? rollingAverage(values, window, boundaries) : null;
  ```

- Render the overlay as a sibling absolute-positioned layer inside `barsRow`, one dot per column, positioned by the same `barHeight` mapping:

  ```tsx
  // smoothed dot height: reuse the raw mapping, but on a number (not Rating)
  function smoothedHeight(value: number | null): number | null {
    return value === null ? null : 8 + value * 8;
  }
  ```

  The overlay row maps `dates` column-for-column exactly like `markersRow`, so alignment is automatic. A `null` smoothed value renders no dot (mirrors how an `undefined` rating shows only the 4px stub). Because the window resets at each dose-change column, the first few dots after a marker are means over the new period only — never a blend across the marker.

- **Legibility / attention safeguards (flagged by the UX and clinical lenses):**
  - The raw rating-hued bars remain the primary layer; the smoothed dots are a thin, secondary `theme.accent` overlay (~4px, `borderRadius: radius.pill`), deliberately _not_ sized or colored to dominate. An acute single day — a severe side-effect day, an anxiety spike — must still read clearly in its raw bar and must not appear "smoothed away" at a glance. This is a visual-design pass item, not a data question (the data always survives in the raw bar).
  - At the 30-day range, columns are narrowest and unconnected 4px dots can read as faint/sparse — undercutting the "make the trend visible" goal. Since the no-charting-library constraint rules out a drawn path, the visual pass should confirm the dots are perceptible at that density (dot size/contrast), or accept that 30-day smoothing is inherently sparse. Flag for design; not a blocker for this doc.
- **No exhaustiveness impact:** `metric.kind !== 'scale'` early-returns as it does today; smoothing only augments the `'scale'` branch.

**Seams that are explicitly NOT touched (flagged so no one edits them by mistake):**

- `app/checkin.tsx` — **untouched.** No new Draft field, no `renderMetric` switch arm, no `handleSave` spread, no `draftFrom*` line. Smoothing adds no collected metric, so the non-generic check-in seam stays put and its `default: assertNever(metric)` is undisturbed.
- `app/entry/[date].tsx` — **untouched.** The hard-coded `RatingRow` detail view shows a single day; a rolling mean is meaningless there.
- `app/(tabs)/index.tsx`, `app/(tabs)/history.tsx` — untouched.
- `components/` — reuse `Toggle` if a switch is preferred over a chip; no new component required.

## Export / report

Keep the PDF conservative. The daily-log table stays raw (a smoothed number in a per-day row would misrepresent that day's actual entry). The addition is a `Recent (Nd avg)` column on the existing averages tables — but, per the clinical lens, a decimal-precision, decision-adjacent figure cannot ship without three pieces of context printed **in the generated HTML** (not just this doc), all `escapeHtml`'d:

1. **A concrete date span for the Recent column** (not just "7d avg"), so a provider can read it against the dated dose-change `<ul>` without doing arithmetic against the range length.
2. **An adherence count for that identical window**, computed from the already-stored `MorningCheckin.doseTaken`. A dip in Recent could be a week of missed doses rather than the dose not working — exactly the confound that could lead a provider to raise a dose that was never taken consistently. The report must surface it.
3. **A plain caveat sentence** stating these are arithmetic means of self-reported 1–5 ratings, not a validated instrument score, and that the Recent figure does not account for adherence beyond the printed count.

The Recent window is dose-period-clamped via `recentWindowDates`, so — matching the on-screen overlay — the printed figure never straddles two regimens. The window/span and the adherence count are computed **once** from the same `recentWindowDates` result, guaranteeing they describe the same calendar days.

Pin down `ScaleAverage` as a concrete interface rather than a loose parallel structure (architect suggestion):

```ts
// lib/export.ts
import type { ScaleDirection } from './types';

export interface ScaleAverage {
  readonly label: string;
  readonly direction: ScaleDirection;
  readonly average: number | null; // grand mean over the whole range
  readonly recentAverage: number | null; // mean over recentWindowDates (dose-clamped)
}

/** Doses taken vs. mornings logged in the recent window. `logged` excludes unlogged days,
 *  so a day with no morning check-in is never counted as a missed dose. */
export function adherenceInWindow(rows: readonly DayEntry[]): {
  readonly taken: number;
  readonly logged: number;
} {
  let taken = 0;
  let logged = 0;
  for (const row of rows) {
    if (row.morning !== undefined) {
      logged += 1;
      if (row.morning.doseTaken) {
        taken += 1;
      }
    }
  }
  return { taken, logged };
}
```

`recentAverage` is just `averageOf(recentRows, pick)` over the `recentWindowDates` slice — equivalent to the dose-clamped trailing tail, and it reuses the shipped, tested `averageOf`/`ratingAccessor` primitives rather than re-deriving a tail from `rollingAverage`. (A `trailingSmoothedAverage` wrapper is therefore unnecessary; `averageOf` over the clamped slice is the simpler, already-covered path.)

`buildReportHtml(profile, doses, rows)` wiring:

- `const window = REPORT_RECENT_WINDOW;` — a module const of type `SmoothingWindow` (default `7`).
- `const dates = rows.map((r) => r.date);`
- `const recentDates = recentWindowDates(dates, doses, window);`
- `const recentSet = new Set<IsoDate>(recentDates); const recentRows = rows.filter((r) => recentSet.has(r.date));`
- Per metric: `recentAverage: averageOf(recentRows, pick)`.
- `const { taken, logged } = adherenceInWindow(recentRows);`
- Span for the header/caveat: `const fromDate = recentDates[0]; const toDate = recentDates[recentDates.length - 1];` — both `IsoDate | undefined` under `noUncheckedIndexedAccess`; render `formatIsoDate`-style only inside a `if (fromDate !== undefined && toDate !== undefined)` narrow, else omit the Recent column entirely (empty range).
- Every value still runs through `formatAverage` (`— ` for null, `toFixed(1)` otherwise); every string through `escapeHtml`. Colors continue to come from `palette` — no raw hex, no new colors.
- Generated caveat/adherence line (escaped), e.g.:
  `Recent (${window}-day avg) covers ${from}–${to} (current dose period). Doses taken ${taken} of ${logged} logged mornings in this window. Average and Recent are arithmetic means of self-reported 1–5 ratings, not a validated clinical score, and do not otherwise account for adherence. Log this and discuss with your provider.`
- **Short-range note:** on a 7-day export, `defaultWindowForRange` and `REPORT_RECENT_WINDOW` both give 7 and `recentWindowDates` returns the whole range, so `Average` and `Recent` render identical numbers. The printed date span makes this self-evident (Recent's span == the report range), which is acceptable; no separate explanatory branch is required.
- `Backup` / `parseBackup` unchanged.

## Notifications

**n/a.** `lib/notifications.ts` is untouched — smoothing is a purely visual/report concern with no scheduling, permission, or channel implications.

## Test plan

New spec `lib/__tests__/trends.test.ts` (and additions to `export.test.ts`), importing `{ describe, it, expect }` from `'vitest'`. `lib/trends.ts` and `lib/export.ts` are both in the coverage scope; the pure functions are trivially exercised, keeping lines/statements/functions ≥ 90 and branches ≥ 85. Ratings and dates in fixtures use the sanctioned `as Rating` / `as IsoDate` literal idiom.

`rollingAverage` (no boundaries):

- **All present, window 3:** `[3,4,5]` → `[3, 3.5, 4]`.
- **Window larger than data:** window 7 over 3 values behaves as a growing prefix mean.
- **Gaps ignored:** `[5, undefined, 3]`, window 3 → `[5, 5, 4]`.
- **All undefined in window → null:** `[undefined, undefined]`, window 2 → `[null, null]`.
- **Leading nulls then data:** `[undefined, 4]`, window 2 → `[null, 4]`.
- **Length invariant:** output length always equals input length (property-style over a few inputs).
- **Window < 1 throws:** `expect(() => rollingAverage([], 0)).toThrow(RangeError)` (bare 2-arg call).
- **Type discipline (compile-time):** assign the result to `readonly (number | null)[]`; a `Rating[]` annotation must fail to compile (documented, not executed).

`rollingAverage` (with boundaries — the dose-period reset):

- **Boundary mid-series truncates the window:** values `[2,2,2,5,5]`, window 5, `boundaries = [false,false,false,true,false]` → indices 0–2 are means of the pre-boundary run; index 3 resets to `5` (period start, window can't reach index 2); index 4 is `(5+5)/2 = 5`. Assert the post-boundary values never include a pre-boundary term.
- **Boundary at index 0** behaves identically to no boundaries (periodStart already 0).
- **Undefined interacting with a boundary:** `[undefined, 4]`, window 2, `boundaries=[false,true]` → `[null, 4]`.

`dosePeriodBoundaries`: dates with one interior dose-change date → exactly one `true` at that column; no doses → all `false`; length equals `dates.length`.

`recentWindowDates`: no doses → last `window` dates; a dose change inside the last `window` days → slice starts at that dose date (never earlier); dose change outside the window → plain last `window` dates; `window < 1` throws.

`defaultWindowForRange`: `7 → 3`, `14 → 7`, `30 → 7`.

`adherenceInWindow` (in `export.test.ts`): counts `doseTaken === true` only over rows with a morning entry; a row with no morning is excluded from both `taken` and `logged`; all-taken → `taken === logged`.

Report HTML (extend existing exact-substring assertions):

- The Recent column renders `formatAverage` output; a null tail renders `—`.
- The generated caveat line renders the concrete `from–to` date span, the `X of Y logged mornings` adherence count, and the "not a validated clinical score" sentence — each `escapeHtml`'d.
- A dose change inside the recent window shifts the printed span start to the dose date.

## Gate compliance

- **No `any` / unsafe-any:** inputs are `readonly (Rating | undefined)[]` / `readonly boolean[]`; internals are `number`. No `unknown` enters `lib/trends.ts` (untrusted data is already parsed upstream by `lib/storage.ts`).
- **No `!`:** every optional/index access is narrowed — `if (v !== undefined)`, `boundaries?.[i] === true`, `recentSet.has`, `fromDate !== undefined`, `accessor?.(row)`.
- **No `@ts-*` / no `eslint-disable`:** none needed; the code type-checks cleanly under strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`.
- **100% type-coverage (`--ignore-as-assertion`):** production code contains no `as` on values; `SmoothedValue = number | null` is a plain alias. Test fixtures use the exempted `as IsoDate` / `as Rating` literal idiom only.
- **Exhaustive switch + `assertNever`:** smoothing introduces no new discriminant and adds no `switch`; the `trends.tsx` `metric.kind !== 'scale'` guard and `checkin.tsx`'s `default: assertNever(metric)` are both undisturbed. No `Metric` variant is added, so no existing exhaustive switch is put out of date.
- **RN-free logic:** all math and date/dose logic lives in `lib/trends.ts` / `lib/export.ts`; `trends.tsx` stays thin and presentational.

## Dependencies & sequencing

- **Depends on:** nothing new — builds on shipped `rowsInRange`, `ratingAccessor`, `averageOf` (`lib/export.ts`), `lastNDates` / `doseChangeMarkers` (`lib/storage.ts`), and the `Metric`/`Rating`/`DoseChange` types.
- **Enables / relates to:** future trends-visualization docs (per-metric zoom, side-effect frequency plots) can reuse `lib/trends.ts` as the smoothing + dose-period primitive. If a "remember my trends preferences" doc lands, it slots into the optional `Profile.trendSmoothing` / `trendSmoothingWindow` path recorded under Storage & guards.
- **Sequencing:** independent of the check-in and export-content docs in this set; can ship in isolation. No migration blocks it (v1 persists nothing new).

## Alternatives considered / open questions

- **Centered vs. trailing mean.** A centered window reads smoother mid-series but "borrows from the future," misrepresenting the most recent days — exactly the days a user checks after a dose change. Trailing is honest about what was known as of each day. **Chosen: trailing, with a per-dose-period reset** so the trailing window is also honest across regimen boundaries.
- **Reset window at dose change vs. flag the crossing.** The clinical lens accepted either. Chosen: **reset/truncate** (cleaner read — a smoothed figure is always attributable to one regimen), which also gets a _visible_ boundary for free from the existing `doseChangeMarkers` dots on the Trends screen and from the printed date span in the report. A pure footnote/flag would leave the reader holding an averaged number that straddles two doses.
- **EWMA / weighted mean.** More responsive, but adds a decay parameter to explain and edges toward a predictive/interpretive signal. Out of scope for v1; `SmoothedValue` and the accessor shape leave room to add it later without a type change.
- **Charting library (Victory, react-native-svg).** Rejected — contradicts the deliberate no-dependency, hand-rolled `<View>` bar approach and bloats the local-only app.
- **Interpolating across gaps before smoothing.** Rejected — inventing values for unlogged days fabricates data the user never entered. Skipping `undefined` (as `averageOf` already does) is the honest choice.
- **Forward note — instrumentation gap (out of scope here).** Nothing in this app captures a global-impression scale (PGI-C/CGI-I) or structured side-effect severity/frequency — the instrumentation a prescriber actually titrates against. Rolling averages of ad hoc 1–5 ratings do **not** substitute for it. This is out of scope for a view-time smoothing doc, but is named here as a real gap for a future _data-capture_ design doc, so no one mistakes smoothed daily ratings for validated measurement.
- **Open — default window per range.** `3` for 7-day, `7` for 14/30-day. A 7-day window on a 7-day range degenerates to the grand mean at the tail; recommend shipping `defaultWindowForRange` as specified and revisiting after real use.
- **Open — smoothing default on or off.** Proposed default **on**, since making the trend visible is the feature's whole point; the toggle exists for users who want raw jitter. Correctly still open — confirm with the user before deciding.
- **Open — persist the toggle?** v1 keeps it ephemeral (`useState`). Flip to the `Profile.trendSmoothing` / `trendSmoothingWindow` path only if reset-on-restart proves annoying.

## Panel review

### Clinical / behavioral-health measurement — approve-with-changes

- **Dose-change boundary blending (must-fix):** applied. `rollingAverage` now takes an optional `boundaries` mask and resets the trailing window at each dose-change column; `dosePeriodBoundaries`/`recentWindowDates` derive it, and both the overlay and the report Recent column are dose-period-clamped. The reasoning the doc used to reject a centered window is now carried through to the trailing window.
- **Recent column with no adherence context (must-fix):** applied. `adherenceInWindow` (computed from already-stored `doseTaken`) prints a "doses taken X of Y logged mornings in this window" line in the generated HTML, over the identical dose-clamped window as Recent.
- **Recent column has no date range (must-fix):** applied. The report labels Recent with a concrete `from–to` span (from `recentWindowDates`), readable against the dated dose-change list without arithmetic.
- **Precision/authority caveat (suggestion):** folded in — a printed, escaped caveat states the figures are arithmetic means of self-reported 1–5 ratings, not a validated score.
- **Overlay dominating acute days (suggestion):** folded in as an explicit legibility/attention safeguard in UI touch points.
- **Instrumentation gap (forward note):** recorded as an explicit out-of-scope forward note under Alternatives.

### Strict-TypeScript architect — approve

- **`rollingAverage` generic vs `SmoothingWindow` (suggestion):** folded in — the doc now states `rollingAverage` is an intentionally-generic `window: number` primitive, `SmoothingWindow` constrains only the UI selector, and warns against threading it through (would break the `window < 1` test). The new `boundaries` param is optional, preserving the 2-arg test call.
- **`ScaleAverage` left as prose (suggestion):** folded in as a concrete interface with `average`/`recentAverage: number | null`.
- **Deferred `Profile.trendSmoothing` guard sketch (suggestion):** folded in — the deferred path now specifies the full `Parsed<Profile>` reason-string guard, house-style `=== undefined` clause, the window field, and the write-`false`-not-`undefined` decision under `exactOptionalPropertyTypes`.

### Mobile UX / friction & completion — approve

- **rangeRow tap-target crowding (suggestion):** folded in — the Smooth control moves to its own row/segment with a small-screen layout check called out.
- **Dot legibility at 30-day (suggestion):** folded in as a design-pass note in UI touch points.
- **"default on/off" still open (suggestion):** kept explicitly open in Alternatives; not marked decided.

### Data-model / migration + privacy + scope — approve

- **Persist window too (suggestion):** folded in — path 2 now pre-commits `trendSmoothingWindow?: SmoothingWindow` with the same additive/optional pattern.
- **Guard-style inconsistency (suggestion):** folded in — the deferred guard uses the established `=== undefined` convention, not the `in` operator.
- **7-day range Average == Recent (suggestion):** addressed — the printed date span makes the equality self-evident; no extra branch needed.

Overall: all four lenses approve or approve-with-changes; all clinical must-fixes and every accepted suggestion applied, with no expansion of persisted data or scope.
