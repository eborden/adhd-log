> **Status:** Proposed — pending implementation · **Priority:** P2 · Ref: analysis #5

# Baseline capture at medication start

## Problem / Context

A non-stimulant ADHD medication accumulates effect over weeks, so the useful clinical signal is the _delta_ between how things were before starting and how they are now. Today the app has no "before" — the first `DayEntry` a user logs is already day 1 or later of being on the drug, and there is no record of their pre-medication self. The provider reading a `buildReportHtml` export sees a trend line that starts mid-story: they can see mood averaged 3.4 over the last 14 days, but not whether that is up from a pre-start 2.0 or down from a pre-start 4.5. The whole point of a weeks-long log is to make that comparison legible, and right now the reader has to supply the starting point from memory (theirs or the patient's), which defeats the purpose of a durable record.

We want a single, deliberate **baseline snapshot**: "how were things the week before you started?" captured once, stored on the profile, and surfaced next to current values so the provider can read `current − baseline` per metric. It is a reference point, not a data series — one honest gut-check recorded at (or shortly after) start, using the exact same scales the daily check-ins use so the numbers are directly comparable. Because the app explicitly supports discovering it _after_ starting (a retrospective baseline), the report must also make the recall-bias risk legible to the provider rather than hiding it behind a bare "Baseline" label.

## Goals / Non-goals

**Goals**

- Capture one optional pre-start snapshot of the scale metrics (`RatingKey` values) plus a free-text note.
- Reuse the existing `ScaleSelector` component and `MORNING_METRICS`/`EVENING_METRICS` scale entries so a baseline rating means exactly what the same daily rating means.
- Offer capture in two places: a step in onboarding, and a re-runnable Settings action ("Record baseline") for already-onboarded users, with a confirm step before any overwrite.
- Show baseline vs. current **descriptively** in the report (a baseline column and a plain delta), surface **when** the baseline was recorded relative to `startDate`, and carry a fixed caveat that keeps the provider — not the app — assigning meaning.
- Never force re-onboarding; never mutate historical entries; leave profiles without a baseline fully functional.

**Non-goals**

- No interpretation of the delta (no "improved", no color-coded good/bad on the delta itself, no scoring).
- No per-day baseline series and no editing baseline history — it is a single snapshot, replaced wholesale (with confirmation) if re-recorded.
- No baseline for non-scale fields (`sideEffects`, `notes`, `sleepHours`, `doseTaken`) — a pre-start side-effect list is not meaningful and invites the "flag" framing we avoid.
- No baseline capture reminder / notification.
- **No baseline value, delta, or comparison badge on the Today screen (`app/(tabs)/index.tsx`) or anywhere inside the daily check-in (`app/checkin.tsx`).** This is a decision, not an omission (see UX lens must-fix). Today is the once-a-day tap-tap-save surface; baseline is a provider-facing reference point and lives only in the report and (optionally) Trends. A future PR must not add a baseline chip to Today.

## Mission fit & guardrails

This sits squarely in collect → log → provider. The baseline is _collected_ once, _logged_ verbatim on the profile, and _referenced back_ to the provider in the export where clinical meaning is assigned. The delta shown is arithmetic subtraction of two ratings the user themselves entered — descriptive, not diagnostic. Copy stays in the house frame: the capture screen says "Record how things were the week before you started — you and your provider can compare against it later," and the report labels the column "Baseline" with a neutral delta, never "change for the better." No risk scoring, no dose nudges. Data stays local: the snapshot lives inside `Profile`, which already persists only to AsyncStorage and only leaves the device via the user-initiated PDF/JSON exports that already carry the profile.

Two guardrails were sharpened in review because the delta is the first feature in the app that attaches a clinically-loaded number to the existing averages:

- The report renders **when** the baseline was taken relative to `startDate`, so a same-week pre-start rating and a months-later retrospective guess do not render identically.
- The report carries a fixed, neutral footnote stating that the baseline is a single retrospective self-report (not an averaged trend) and that the current-side average may include early-titration days. This keeps the app descriptive: it shows the number and names its limits, and defers the weighting decision to the provider.

## Data model

Add to `lib/types.ts`. `BaselineSnapshot` is a plain readonly interface; the ratings map reuses `RatingKey` and `Rating` so a baseline value is the same domain object as a check-in value.

```ts
/**
 * A one-time, pre-medication reference point. `ratings` is intentionally
 * partial — the user may skip any metric — and every present value is a real
 * `Rating`, so there is no "recorded but empty" illegal state to represent.
 */
export interface BaselineSnapshot {
  readonly recordedAt: IsoTimestamp;
  readonly ratings: Readonly<Partial<Record<RatingKey, Rating>>>;
  readonly note?: string;
}
```

(`Readonly<Partial<…>>` reads as "a readonly partial map" and matches the codebase's usual modifier ordering; it is functionally identical to `Partial<Readonly<…>>` since `Partial` is homomorphic and preserves the inner `readonly`.)

Extend `Profile` with an optional field. Because it is optional and `exactOptionalPropertyTypes` is on, an absent `baseline` is distinct from `baseline: undefined`, and existing persisted profiles (which have no such key) parse unchanged:

```ts
export interface Profile {
  readonly medName: MedName;
  readonly startDate: IsoDate;
  readonly currentDose: Dose;
  readonly morningReminder: TimeOfDay;
  readonly eveningReminder: TimeOfDay;
  readonly lockEnabled: boolean;
  readonly enabledEveningMetrics?: readonly EveningRatingKey[];
  readonly baseline?: BaselineSnapshot; // <-- new, optional
  readonly createdAt: IsoTimestamp;
}
```

Illegal states unrepresentable: there is no `hasBaseline` boolean paired with nullable fields — presence of the `baseline` key _is_ the flag. A partial ratings map cannot hold a non-`Rating` value. `recordedAt` is branded so a baseline can never be minted without a real timestamp.

## Schema

Mostly **n/a** — baseline capture is fully schema-driven and adds no new `Metric` variant. It reuses the existing `'scale'` entries of `MORNING_METRICS` and `EVENING_METRICS` filtered to their `RatingKey`. That is deliberate: baseline should track whatever scales the daily check-in tracks, with no second source of truth.

One small, pure helper is added to `lib/schema.ts` so both the capture UI and the report iterate the same ordered key list:

```ts
/** Every scale metric key, morning then evening, in display order. */
export function baselineRatingKeys(): readonly RatingKey[] {
  return [...MORNING_METRICS, ...EVENING_METRICS]
    .filter((m): m is Extract<Metric, { kind: 'scale' }> => m.kind === 'scale')
    .map((m) => m.key);
}
```

The evening subset is _not_ filtered by `enabledEveningMetricKeys` here — baseline offers all scales so the reference point is complete regardless of which metrics the user later hides; the report only renders baseline rows for metrics it is already showing, so hidden ones simply do not surface. (The capture _screen_ defaults to a shorter list for friction reasons — see UI touch points — but the stored snapshot and the report key list stay complete.)

## Storage & guards

Add a guard in `lib/storage.ts` returning through the existing `Parsed<T>` discipline, and wire it into `isProfile`. It uses the file's existing `isRecord` type guard (`lib/storage.ts:38-40`) exactly as every other guard in the file does — **no `as Record<string, unknown>` cast**. This is both the "never cast untrusted data" rule and a real correctness point: after a bare `typeof ratings === 'object' && ratings !== null` check, `ratings` is typed `object` and `Object.entries(ratings)` resolves to the `[string, any][]` overload, leaking `any` into the loop (which trips `no-unsafe-assignment`). `isRecord(ratings)` narrows to `Record<string, unknown>` and selects the safe `entries<T>` overload with zero casts.

```ts
export function isBaselineSnapshot(value: unknown): value is BaselineSnapshot {
  if (!isRecord(value)) return false;
  if (!isIsoTimestamp(value['recordedAt'])) return false;
  const ratings = value['ratings'];
  if (!isRecord(ratings)) return false;
  for (const [key, rating] of Object.entries(ratings)) {
    if (!isRatingKey(key)) return false; // reject unknown keys
    if (!isRating(rating)) return false; // present keys must be real Ratings
  }
  const note = value['note'];
  if (!(note === undefined || typeof note === 'string')) return false;
  return true;
}
```

This needs an `isRatingKey` guard plus a combined runtime list of every rating key. As of the
2026-07-18 "Ratings as a record" reshape, `lib/types.ts` already exports the two per-session
runtime lists as as-const arrays (`MORNING_RATING_KEYS`, `EVENING_RATING_KEYS`), and `RatingKey`
is already the **derived** union `MorningRatingKey | EveningRatingKey` (at `lib/types.ts:128`) —
_not_ a hand-written string-literal union. So the only genuinely-missing pieces are the combined
list and its guard. **Compose `RATING_KEYS` from the two existing arrays; do not redefine
`RatingKey`** (redefining it would duplicate or silently diverge from the existing derived
union):

```ts
// lib/types.ts — RatingKey already exists as `MorningRatingKey | EveningRatingKey`; leave it.
// Just add the combined runtime list, composed from the existing per-session as-const arrays.
// (typeof RATING_KEYS)[number] is structurally identical to RatingKey, so the two can't drift.
export const RATING_KEYS = [...MORNING_RATING_KEYS, ...EVENING_RATING_KEYS] as const;
```

```ts
export function isRatingKey(value: unknown): value is RatingKey {
  return typeof value === 'string' && (RATING_KEYS as readonly string[]).includes(value);
}
```

Extend `isProfile` (currently at `lib/storage.ts:99`, narrowing through a `value` parameter — not a `v` alias) with one clause before it returns `true`:

```ts
if (value['baseline'] !== undefined && !isBaselineSnapshot(value['baseline'])) return false;
```

**Known parse-fragility (acknowledged, not fixed here).** Because `isBaselineSnapshot` rejects the whole snapshot on any unknown `ratings` key, and `isProfile` rejects the whole profile on a malformed baseline, a future rename/removal of a `RatingKey` member — or downgrading to an older build after a newer one wrote a key the older build doesn't recognize — fails the entire `parseProfile` (`loadProfile` returns `null`, read as "not onboarded") rather than dropping just the unrecognized entry. This mirrors the existing `enabledEveningMetrics`/`isEveningRatingKey` behavior, so it is not a new risk class, but baseline is high-value data and any future `RatingKey` migration should ship a matching read-migration for stored baselines.

**Backward compatibility / migrate-on-read.** No migration function is required and none should be added: `baseline` is optional, so `parseProfile` accepts a stored profile that predates this field (the new clause only rejects a _malformed_ baseline, never an absent one). Historical `DayEntry` data is untouched — baseline lives on `Profile`, a different AsyncStorage key ("profile"). A round-trip of an old profile through `parseProfile` → `saveProfile` re-serializes without a `baseline` key (absent, not `null`), preserving shape.

**Backup.** `parseBackup` (`lib/backup.ts:29`) already validates its `profile` field through `parseProfile`/`isProfile`, so extending `isProfile` automatically extends backup import/export coverage — a backup taken after this ships carries the baseline, and an older backup without one still parses. No change to the `Backup` interface.

Add a thin writer next to `saveProfile` for the "record baseline" action to keep the merge in one tested place:

```ts
export async function saveBaseline(snapshot: BaselineSnapshot): Promise<Parsed<Profile>> {
  const current = await loadProfile();
  if (current === null) return { ok: false, reason: 'no-profile' };
  const next: Profile = { ...current, baseline: snapshot };
  await saveProfile(next);
  return { ok: true, value: next };
}
```

Overwrite confirmation is enforced at the UI layer (Settings), not here — `saveBaseline` is a pure merge and stays trivially testable; guarding at the call site keeps the writer free of RN dialog concerns.

## UI touch points

- **New screen `app/baseline.tsx`** (expo-router route). Renders scale `Metric`s through the existing `ScaleSelector` component plus one inline `TextInput` for `note`. Draft is `{ ratings: Partial<Record<RatingKey, Rating>>; note: string }`. On save it builds a `BaselineSnapshot` with `recordedAt: isoTimestampNow()` and a conditional spread that omits an empty-or-whitespace-only `note` (mirroring `handleSave` in `checkin.tsx`; trim before deciding presence so the report never renders an empty "Baseline note:" block), then calls `saveBaseline`. This screen reuses check-in rendering patterns but is **not** the `checkin.tsx` seam — no new `Metric` variant, so the `renderMetric` `switch` / `assertNever` is untouched.
  - **Explicit exit affordance (required):** the screen shows a clearly-weighted **"Not now"** / back control at all times, distinct from Save. Baseline is optional at the data-model level, but a user entering from Settings has no onboarding skip-copy to fall back on; they must not have to scroll a long form and tap Save-with-nothing to back out. "Not now" leaves `baseline` untouched (absent, or the prior snapshot if updating) and returns to the caller.
  - **Short default, opt-in "show more":** the default field list is the user's enabled evening metrics (`enabledEveningMetricKeys(profile)`) plus the two morning scales, with a **"Show more metrics"** expander revealing the remaining scales. This keeps the default path close to the user's own daily routine and avoids confronting someone who deliberately hid `libido`/`impulsivity` with those fields in a one-time capture. The full `baselineRatingKeys()` list still backs the expander, the stored snapshot, and the report — only the initial screen ordering/visibility changes, and this is purely presentational (no tested logic).
- **`app/checkin.tsx` — no change.** Explicitly flagged: baseline adds no `Metric` union variant and no new check-in field, so the non-generic seam (Draft field + `renderMetric` arm + `handleSave` spread + `draftFrom*` line) is _not_ touched. This is a reason to prefer the snapshot-on-profile design over per-entry baseline flags.
- **`app/(tabs)/index.tsx` (Today) — no change, by decision.** See the explicit Non-goal above.
- **`app/(tabs)/settings.tsx`** — add a "Record baseline" button in the profile section that routes to `app/baseline.tsx`. When `profile.baseline` is already set, label it "Update baseline" and show `recordedAt` as a caption ("Recorded 2026-07-18"). **Before routing into an update, show a single-tap confirm** — "This replaces your baseline recorded on `<date>`. This can't be undone. Continue?" — because the snapshot is single, non-versioned, and irrecoverable (no history is kept, by non-goal), so an accidental tap on the app's highest-value data point would otherwise silently destroy it. One affirm is enough friction; do not require typing or a double-confirm.
- **Onboarding** — add one optional step that links to the same capture screen ("Record a baseline now, or skip and add it later in Settings"). Skipping simply leaves `baseline` absent; nothing downstream requires it. (No overwrite confirm here — there is nothing to overwrite during first onboarding.)
- **`app/(tabs)/trends.tsx`** — **deferred to a follow-up** (was optional; the report already delivers the core provider value, and keeping this cycle off the daily-facing Trends render path keeps the diff small and touch-risk zero). When it lands: draw a faint horizontal reference line per metric at `baseline.ratings[key]` using the same `barHeight` mapping (`8 + rating * 8`), colored `theme.border` (never `ratingColor`, to keep it descriptive and un-judged); no line where there is no baseline value. Schema-driven, no per-metric edits.
- **`app/entry/[date].tsx`** — **no change.** This file hard-codes each `RatingRow`; baseline is not a per-day value, so the read-only day-detail screen is deliberately left alone.
- **`components/`** — no new component; `ScaleSelector` and inline `TextInput` are reused as-is.

## Export / report

In `lib/report-html.ts`, extend `buildReportHtml(profile, doses, entries, rangeStart, rangeEnd, options)`. Note the real signature: **`profile` is `Profile | null`**, so every baseline read must be null-safe — `profile?.baseline?.ratings[k]` (a bare `profile.baseline?…` is `Object is possibly 'null'` and fails `tsc`).

The averages tables need a typed key at the row level, which `ScaleAverage` does not currently carry. **Add `readonly key: RatingKey` to `ScaleAverage`** (`lib/report-metrics.ts:249-254`) and populate it where the `scaleAverages` array is built inline in `buildReportHtml` (`lib/report-html.ts:453-467`, whose `scaleMetricFor(key)` loop already has both the loop `key` and `metric` in scope but discards the key). Without this there is nothing to index `profile?.baseline?.ratings[k]` with.

```ts
interface ScaleAverage {
  readonly key: RatingKey; // <-- new; populated from the loop key
  readonly label: string;
  readonly direction: ScaleDirection;
  readonly average: number | null;
  readonly recentAverage: number | null;
}
```

Then:

- The Morning and Evening averages tables gain a **Baseline** column and a **Δ** column. For each rendered scale row with key `k`, read `profile?.baseline?.ratings[k]` (yields `Rating | undefined` under `noUncheckedIndexedAccess`). When present and the current average is non-null, compute `average − baseline` and render it as a plain signed number ("+1.4", "−0.6"); when either side is missing, render "—". Reuse the existing `formatAverage` helper for the average cell; add a pure `formatDelta(average: number | null, baseline: Rating | undefined): string` helper. Narrow with explicit `!== undefined` / `!== null` — never assert.
- **Render baseline timing.** Under the header (when `profile?.baseline` is present), render one escaped line expressing `recordedAt` relative to `startDate`, so the provider can weight recall bias. Add a pure `formatBaselineTiming(recordedAt: IsoTimestamp, startDate: IsoDate): string` returning e.g. `"Baseline recorded 3 days before start"`, `"Baseline recorded on start day"`, or `"Baseline recorded 42 days after start (retrospective)"` — the "(retrospective)" tag appears only when `recordedAt`'s calendar date is after `startDate`. This directly answers the clinical must-fix and folds in the "label retrospective baselines" suggestion at the point of reading.
- **Fixed caveat footnote.** When `profile?.baseline` is present, render one neutral, non-interpretive footnote near the Baseline/Δ columns: `"Baseline reflects a single self-report, not an averaged trend, and may carry more day-to-day noise than the current-period average, which may also include early-titration days."` This is descriptive framing, not guidance — it names the measurement asymmetry and leaves the weighting to the provider.
- If `profile?.baseline?.note` is present (and non-empty after the capture-side trim), render a single escaped block under the header: `<p>Baseline note: ${escapeHtml(note)}</p>`. If `baseline` is absent, omit the Baseline column, Δ column, timing line, footnote, and note entirely (report is byte-for-byte unchanged for baseline-less profiles).
- All new strings pass through the existing `escapeHtml`. Delta text stays palette-neutral — do **not** color the delta cell with rating hues; if any color is applied it is `palette` neutral/text.

**On the current-side averaging window (clinical must-fix, resolved with a caveat, not a hidden second window).** The current-side average is a grand mean over whichever range the report was built for (`rowsInRange`/`averageOf`), which for a newly-titrated patient can blend ramp-up days with steady-state days. The reviewer offered two fixes: (a) compute the delta against a fixed recent window (e.g. last 7 days) independent of the report range, or (b) caveat it. **We take (b).** Silently computing a _different_ window for the delta than for the rest of the report would itself be an editorial choice about which days "count" toward the "now" — exactly the interpretive judgment the mission defers to the provider — and would make the Δ column inconsistent with the averages it sits beside. The honest, in-mission move is to show the delta over the same range the provider already sees and name the caveat in the footnote above. (Per-window analysis, if wanted, belongs to a future provider-summary doc that can present multiple explicit windows side by side.)

No change to the `ratingAccessor` machinery — it reads `DayEntry`; baseline is read directly off the profile.

## Notifications

n/a. Baseline is a one-time, user-initiated capture; adding a reminder would push toward nudging behavior we avoid, and `lib/notifications.ts` (fixed morning/evening reminder IDs, `data: { session }`) has no baseline concept to schedule.

## Test plan

All logic under test lives in the coverage-scoped modules (`lib/{types,schema,storage,backup,metrics,report-metrics,report-html,export,checkin,trends}.ts`); the RN screens carry no testable logic. Fixtures use the sanctioned `as IsoDate` / `as IsoTimestamp` / `as MedName` literal idiom (`type-coverage --ignore-as-assertion`).

`lib/__tests__/storage.test.ts`:

- `isBaselineSnapshot` accepts `{ recordedAt: '2026-07-18T09:00:00.000Z' as IsoTimestamp, ratings: { mood: 3, focus: 2 } }`; accepts an empty `ratings` object; accepts a present `note`.
- Rejects a non-`Rating` value (`ratings: { mood: 6 }`), an unknown key (`ratings: { bogus: 3 }` — exercises `isRatingKey`), a missing/blank `recordedAt`, a numeric `note`, and a non-object `ratings` (exercises the `isRecord(ratings)` branch).
- `isRatingKey` returns true for each member of `RATING_KEYS` and false for `'bogus'` / non-strings.
- `parseProfile` accepts a legacy profile object with **no** `baseline` key (backward compat); accepts one with a valid `baseline`; returns `{ ok: false }` for one with a malformed `baseline`. Narrow the `Parsed` union inside the test (`if (result.ok) …`) rather than asserting.
- `saveBaseline` returns `{ ok: false, reason: 'no-profile' }` when no profile is stored, and merges `baseline` onto an existing profile otherwise (assert the round-tripped value via `loadProfile`).

`lib/__tests__/schema.test.ts`:

- `baselineRatingKeys()` returns morning-then-evening scale keys in order and contains no `doseTaken`/`sleepHours`/`sideEffects`/`notes`.

`lib/__tests__/report-html.test.ts` (where `buildReportHtml` and its rendering helpers are now tested — `lib/export.ts` retains only native PDF/JSON I/O):

- `formatDelta` returns `'+1.4'` (ASCII `+`), `'−0.6'` (**U+2212 MINUS SIGN**, not ASCII hyphen — assert the exact glyph so an implementer who reaches for `String(delta)`'s ASCII `-` fails the test), and `'—'` when either side is missing.
- `formatBaselineTiming` returns the "before start" phrasing for a pre-`startDate` timestamp, the "on start day" phrasing for a same-day one, and the "after start (retrospective)" phrasing for a later one (assert the exact `(retrospective)` substring and its absence in the pre-start case).
- `buildReportHtml` with a baseline profile asserts the exact `Baseline` header substring, a computed delta cell, the timing line, the caveat footnote substring, and an escaped `Baseline note:` line; with a baseline-less profile asserts all of those substrings are **absent** (report unchanged). Note is fed a `<script>`-bearing string to confirm `escapeHtml` coverage. Include a case where `profile` is `null` to exercise the null-safe reads.

Coverage stays ≥ thresholds: every new pure function (`isBaselineSnapshot`, `isRatingKey`, `saveBaseline`, `baselineRatingKeys`, `formatDelta`, `formatBaselineTiming`, and the new `buildReportHtml` branches) is directly exercised, keeping lines/statements/functions ≥ 90 and branches ≥ 85.

## Gate compliance

- **No `any` / unsafe-any**: guards take `unknown` and narrow through `isRecord` and existing guards — no `as Record<string, unknown>` cast anywhere (the earlier draft's claim that such a cast matched the file idiom was incorrect; the file uses `isRecord` exclusively). `isRecord`-narrowing also selects the safe `Object.entries<T>` overload, so no `any` leaks into the ratings loop.
- **No `!`**: `noUncheckedIndexedAccess` yields `Rating | undefined` from `baseline.ratings[k]`; `profile` is `Profile | null`. All report reads use `profile?.baseline?.…` and narrow with explicit `!== undefined` / `!== null`, returning `'—'` on the missing branch — never assert.
- **No `@ts-*` / `eslint-disable`**: none introduced.
- **Branded values**: `recordedAt` is minted by `isoTimestampNow()` (guard-and-throw), never `as` outside test fixtures.
- **Exhaustiveness**: no new `Metric` variant, so the `checkin.tsx` `switch (metric.kind)` statement and its `assertNever` default (`app/checkin.tsx:113,206`) remains exhaustive and compiles unchanged (`entry/[date].tsx` and `trends.tsx` filter on `metric.kind === 'scale'` rather than switching, so they are untouched too); `baselineRatingKeys` uses a filtering type-guard predicate rather than a switch.
- **`exactOptionalPropertyTypes`**: `baseline?` and `note?` are written via conditional spreads / omission, never assigned `undefined` explicitly.
- **type-coverage 100%**: the only `as` uses are the `RATING_KEYS as readonly string[]` widening in `isRatingKey` (compatible-type) and test-fixture literals, both exempt under `--ignore-as-assertion`.

## Dependencies & sequencing

- **Depends on nothing** in this doc set — it only extends `Profile`, which already exists. Can ship independently.
- The `RATING_KEYS` / `isRatingKey` addition is a small reusable primitive; any later doc that needs to iterate or validate all rating keys should build on it rather than re-deriving.
- **Enables** richer report/trend deltas: once a baseline exists, a future "trend annotations" or "provider summary" doc can reference `current − baseline` without re-collecting the starting point.
- **Companion doc needed — adherence context (flagged, out of scope here).** A flat or worsened delta is clinically ambiguous without knowing whether doses were actually taken over the compared window ("drug isn't working" vs "patient isn't taking it" produce the same delta but demand opposite provider actions). Surfacing percent-of-`doseTaken`-true days next to the delta belongs to a follow-up report doc, but is called out here because the delta is what makes it matter.
- **Follow-up — sample size (n).** The decimal-precision Δ invites more confidence than sparse logging supports; showing the count of days with a logged rating next to each average/delta is a cheap honesty win, deferred to the same report-format follow-up to keep this diff focused. Acknowledged rather than implemented now.
- Land baseline's report-column changes together with, or before, any export-format overhaul so the averages tables are only restructured once.

## Alternatives considered / open questions

**Alternative: flag pre-`startDate` entries as the baseline.** Rejected. It muddies the daily series (Trends, streaks, averages all iterate `entries` and would have to special-case "before startDate?" everywhere), re-purposes `MorningCheckin`/`EveningCheckin` into a role they were not modeled for, and produces a noisy multi-day baseline when the provider wants one clean reference point. An explicit `BaselineSnapshot` on the profile keeps the daily log pure, makes "do we have a baseline?" a single presence check, and survives the common case where the user only discovers the app _after_ starting — they can record a retrospective "how were things the week before" without fabricating dated entries (which is exactly why the report must render `recordedAt` and the retrospective tag).

**Future (not this doc): a patient-reported global-impression-of-change item** (PGI-C-style: "compared to before you started, how would you rate your overall change?"). Per-metric subtraction is useful but is not the instrument prescribers are trained to read for titration; a patient-reported global impression stays descriptive (not clinician interpretation) and fits the app's non-interpretive framing. Correctly out of scope for baseline capture; noted for a later measurement doc.

**Resolved (was open question #1): re-recording.** Allowed, but gated by a single-tap confirm in Settings before overwrite ("This replaces your baseline recorded on `<date>`. This can't be undone. Continue?"), since the snapshot is irrecoverable and no history is kept. Resolved in-doc rather than left open, per the data-model lens.

**Resolved (was open question #2): Trends reference line.** Deferred to a follow-up; the report delivers the core provider value and this keeps the daily-facing render path untouched this cycle.

**Resolved (was open question #3): baseline on daily surfaces.** No — baseline never appears on Today or in the check-in (now an explicit Non-goal). Report-only (plus the deferred Trends line) keeps daily surfaces focused on logging.

## Panel review

### Clinical / behavioral-health measurement — approve-with-changes

- **Surface `recordedAt` in the report:** added `formatBaselineTiming(recordedAt, startDate)` and a rendered timing line expressing the baseline relative to `startDate`, with a "(retrospective)" tag when recorded after start.
- **Caveat distinguishing baseline from the averaged current value:** added a fixed, neutral footnote near the Baseline/Δ columns naming that the baseline is a single self-report (not an averaged trend) and that the current-side average may include early-titration days.
- **Titration/averaging window:** resolved with a caveat (option b) rather than a hidden second window (option a); documented why — a different window for the delta than for the surrounding averages would itself be an interpretive choice the mission defers to the provider.
- Folded suggestions: adherence-context and sample-size (n) called out in Dependencies as needed follow-ups; retrospective labeling adopted via the timing line; PGI-C noted as a future measurement doc.

### Strict-TypeScript architect — approve-with-changes

- **Null-safety:** all report reads now use `profile?.baseline?.ratings[k]` (`profile` is `Profile | null`).
- **`isRecord` over cast:** `isBaselineSnapshot` uses `isRecord` for both the top-level value and `ratings`; corrected the false "matches the file idiom" claim and documented the `Object.entries` overload consequence.
- **`RATING_KEYS` composes the existing arrays:** since the "Ratings as a record" reshape,
  `RatingKey` is already the derived union `MorningRatingKey | EveningRatingKey` and the
  per-session as-const lists exist, so this doc adds only the combined `RATING_KEYS`
  (`[...MORNING_RATING_KEYS, ...EVENING_RATING_KEYS]`) and `isRatingKey` — `RatingKey` is left
  untouched, not replaced.
- **`ScaleAverage.key`:** added `readonly key: RatingKey`, populated from the loop key where the `scaleAverages` array is built inline in `buildReportHtml`, so the Δ column has a key to index.
- Folded suggestions: `isProfile` snippet uses `value['baseline']`; `Readonly<Partial<…>>` ordering adopted; U+2212 glyph pinned in the `formatDelta` test prose.

### Mobile UX / friction & completion — approve-with-changes

- **Today/check-in lockdown:** added an explicit Non-goal that baseline never surfaces on Today or in `app/checkin.tsx`, and resolved former open question #3 to match.
- **Explicit exit on `app/baseline.tsx`:** added a required, clearly-weighted "Not now"/back affordance distinct from Save.
- Folded suggestions: capture screen defaults to enabled evening metrics + two morning scales with a "Show more metrics" expander (stored snapshot/report list stay complete); Trends line deferred; re-record uses a single-tap confirm, not a double-confirm.

### Data-model / migration + privacy + scope — approve-with-changes

- **Confirm-before-overwrite:** resolved open question #1 with a mandatory single-tap confirm in Settings before any baseline overwrite; guard lives at the UI call site so `saveBaseline` stays a pure, tested merge.
- Folded suggestions: `recordedAt` wired into the report (shared with the clinical must-fix); added an explicit acknowledgment of the whole-profile-parse-fails-on-unknown-`RatingKey` fragility; empty/whitespace-only notes are trimmed to "absent" at capture-side so no empty "Baseline note:" block renders.

All lenses approve-with-changes; must-fixes applied.
