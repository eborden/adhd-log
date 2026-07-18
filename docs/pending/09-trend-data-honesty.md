I have everything I need. Here is the finalized document.

---

> **Status:** Proposed — pending implementation · **Priority:** P1 · Ref: analysis #8, #9 · Panel-reviewed (4 lenses; must-fixes applied)

# Trend data honesty: coverage + gaps

## Problem / Context

The whole point of this app is the multi-week _trend_ — a single day is noise, the slope is signal. But a slope drawn over sparse data lies twice.

1. **No denominator.** `app/(tabs)/trends.tsx` renders a bar per day in the range and `lib/export.ts`'s averages tables reduce every logged value to one grand mean via `averageOf`. Neither says _how many_ of the days in the window were actually logged. A "focus" average of `2.1` computed from 4 of 30 days reads identically to one computed from 28 of 30. For a provider trying to judge whether the medication is working, "the average is 2.1" and "the average is 2.1, from 4 days" are completely different claims — and today we only surface the first.

2. **Gaps look like lows.** In `trends.tsx`, `barHeight(rating)` returns `4` for an unlogged day and colors it `theme.border`; a logged rating of `1` returns `8 + 1*8 = 16` colored `ratingColor(...)`. A short muted bar sitting in a row of taller colored bars reads as "a bad day," not "no data." Over a two-week ramp with a few missed evenings, the chart invents a dip that never happened.

Both are honesty bugs, not feature gaps. The fix is presentational plus one small pure helper — **no data-model change, nothing persisted, no interpretation added.** We show the denominator and we make "no data" unmistakably _not a value_.

**One correction from panel review (Clinical, must-fix #1):** the _denominator itself_ must be honest, or the fix recreates the same lie one level up. The population this app targets is someone in their first 1–4 weeks of titration. If `total` is the raw range length, selecting the 14- or 30-day range pulls in days _before the app was installed_ and counts them as "missing," producing captions like `logged 6 of 30 days` that a provider reads as poor engagement when the real story is "the user only has 6 days of history." So `total` is **floored to the day logging first became possible** (the profile's creation date). This is still a purely descriptive count — it just counts against the correct universe of days-that-could-have-been-logged rather than against calendar days that predate the app.

## Goals / Non-goals

**Goals**

- A pure, tested `coverage(rows, accessor, since?)` helper returning `{ logged, total }` for any metric/session over a date range, with `total` **floored to the logging-tenure start** (`since`) so pre-install days are never counted as missing.
- A pure, tested `loggingStartDate(profile)` helper deriving that floor from `profile.createdAt`.
- Surface coverage as "logged 22 of 30 days" on each `trends.tsx` metric block and in the PDF report.
- Render unlogged days in `trends.tsx` as a visually unambiguous placeholder — distinct from a logged `1` — that survives both light and dark themes.
- Confirm (with a test) that `averageOf` already ignores missing days, so coverage and averages agree.

**Non-goals**

- No new tracked metric, no `lib/types.ts` shape change, no `lib/schema.ts` entry.
- No "your data is too sparse to interpret" warnings, no minimum-coverage gating, no percentage framing, no interpretation of what the number means. We show `22 of 30`; the provider decides whether that is enough.
- No change to how gaps affect averages (they are already excluded — we only prove it).
- No streak/adherence scoring (that lives in `computeStreak`, out of scope here).
- **No dose-adherence view.** Coverage counts _whether a rating was recorded_, deliberately independent of `MorningCheckin.doseTaken`. Conflating "logged" with "took the medication" is exactly the kind of implicit claim this doc exists to prevent — see _Open questions_ for why this stays a documented boundary here rather than a feature.

## Mission fit & guardrails

Squarely inside **collect → log → provider**. Coverage is a _descriptive_ count of what was collected, the most literal possible "show the data." It defers meaning entirely: no threshold, no color-coded "good/bad coverage," no nudge. It is local-only by construction — a derived view over `rows` (and `profile`) already in memory, touching no I/O and no new storage. The gap-rendering change is pure pixels. Neither surface says anything a provider hasn't asked for; both make the existing data _more_ honest, which is the opposite of over-reading.

The tenure floor is itself a mission-fit move: `we show the denominator, the provider decides` only holds if the denominator is honest about what _could_ have been logged. Flooring at `createdAt` removes a false-negative signal (absence read as non-adherence) without adding any positive interpretation.

## Data model

**`lib/types.ts`: n/a — no additions.** Coverage is a computed view over existing `DayEntry` rows, not a persisted or branded domain value, so it does not belong in the domain-type module. The one new type is the helper's return shape, which lives beside the helper in `lib/export.ts`:

```ts
/** Logged-vs-total day count for one metric over a date range. Purely descriptive. */
export interface Coverage {
  readonly logged: number;
  readonly total: number;
}
```

`logged` and `total` are genuinely dimensionless counts, not "meaningful values" masquerading as raw `number`, so no brand is warranted (mirrors `averageOf`'s `number | null` return and `computeStreak`'s `number`). **The `logged <= total` invariant is structural, not asserted:** `coverage` filters `rows` to a single `inWindow` array once, then derives _both_ fields from that same array. There is no constructor that lets a caller set them independently, and because both counts come from the identical (floored) window, no logged day can ever fall outside `total`.

## Schema

**n/a.** `coverage` is generic over an accessor `(row: DayEntry) => Rating | undefined`, exactly like `averageOf` and `ratingAccessor`. Any metric added later in `lib/schema.ts` — morning or evening scale — gets coverage for free the moment `trends.tsx` iterates it; there is no per-metric schema entry, label, or default to add. This is the schema-driven seam working as designed.

## Storage & guards

**No new guards, no `Parsed<T>` additions.** `coverage` consumes already-parsed, in-memory `readonly DayEntry[]` (the output of `rowsInRange`), never untrusted JSON, so it sits on the trusted side of the `lib/storage.ts` boundary alongside `averageOf`.

`loggingStartDate` mints its `IsoDate` through the existing `formatIsoDate` **guard-and-throw** (never `as`), reading `profile.createdAt`. It derives the local calendar date via the same `formatIsoDate(new Date(...))` path that `todayIsoDate`/`lastNDates` already use, so the floor is in the same calendar frame as the row dates it is compared against.

**Backward compatibility: trivially preserved.** Nothing is written, no field is added to `Profile`/`DayEntry`/`DoseChange`, so:

- No forced re-onboarding — `isProfile` and friends are untouched.
- Historical `entries` are never read differently or mutated — `coverage` is read-only over whatever `rowsInRange` produces (including its gap-filled `{ date }` rows).
- No migrate-on-read needed — there is no shape change to migrate.
- `parseBackup` / `buildBackup` (`Backup = { exportedAt; profile; doses; entries }`) are **unchanged**; coverage is recomputed from the restored `entries` on demand, never serialized. A backup produced by _any_ prior version of the app round-trips through `parseBackup`/`buildBackup` byte-for-byte the same as before — the functions are literally untouched — and coverage over the restored `entries` (floored by the restored `profile.createdAt`) computes correctly. This is exercised by a test (see Test plan).

## UI touch points

**`app/(tabs)/trends.tsx` — the primary surface. Three edits.**

1. _Load the profile for the tenure floor._ Extend the existing `Promise.all` in `refresh` to also `loadProfile()`, store it in a `profile` state, and derive the floor once per render:

```tsx
const since = profile ? loggingStartDate(profile) : undefined;
```

New imports: `coverage`, `loggingStartDate` from `../../lib/export`; `loadProfile` from `../../lib/storage`; `Profile` from `../../lib/types`. (`profile` is `null` only in the pre-load frame, when `rows` is empty too, so the fallback is harmless.)

2. _Coverage caption._ Inside the `visibleScaleMetrics.map`, after resolving `accessor`, compute coverage and render a caption under the existing `metric.label` section label:

```tsx
const cov = accessor ? coverage(rows, accessor, since) : { logged: 0, total: 0 };
```

```tsx
<Text style={[typography.caption, { color: theme.textMuted }]}>
  logged {cov.logged} of {cov.total} days
</Text>
```

The `logged X of Y days` phrasing (rather than a bare `X/Y` fraction) is deliberate — see the Mobile-UX panel note below. A fraction rendered in muted text next to every metric, twice a day, reads like a compliance grade even with no threshold or color attached; the spelled-out form reads as a plain count.

3. _Gap rendering._ Replace the single-bar body of the `rows.map` with a branch on `rating === undefined`, so a logged value stays a solid colored bar and an unlogged day becomes a hollow baseline placeholder rather than a short muted bar:

```tsx
{
  rows.map((row, index) => {
    const rating = accessor?.(row);
    return (
      <View key={dates[index] ?? index} style={styles.barColumn}>
        {rating === undefined ? (
          <View style={[styles.gapPlaceholder, { borderColor: theme.border }]} />
        ) : (
          <View
            style={[
              styles.bar,
              {
                height: barHeight(rating),
                backgroundColor: ratingColor(theme, rating, metric.direction),
              },
            ]}
          />
        )}
      </View>
    );
  });
}
```

With a new `styles` key — named `gapPlaceholder`, **not** `gap`, to avoid colliding visually with the RN `gap` layout property already used in `barsRow`/`markersRow` in the same `StyleSheet.create` block:

```ts
gapPlaceholder: {
  width: '100%',
  height: 8,
  borderRadius: radius.pill,
  borderWidth: 1,
  borderStyle: 'dashed',
  backgroundColor: 'transparent',
},
```

A hollow, dashed, transparent-filled pill at the baseline is categorically unlike any _filled_ bar: it reads as "nothing here," not "a low value." Because it is an **outline in `theme.border` with no fill**, it works in both schemes — `theme.border` is defined for light and dark, and an unfilled shape can never be confused with a `ratingColor` fill.

Now that the `rating === undefined` case is owned by the gap branch, the only remaining call site passes a `Rating`-narrowed value, so **tighten `barHeight`'s signature to `barHeight(rating: Rating): number`** and drop its now-permanently-unreachable `rating === undefined → 4` branch. This matches the repo's "model the data better, don't leave escape hatches" ethos; ESLint's presets won't flag the dead branch either way, so this is quality, not a gate fix.

**Explicitly NOT touched (flagged non-generic seams):**

- `app/checkin.tsx` — `renderMetric` switch, `Draft`, `handleSave` spreads, `draftFrom*`: **no edit.** No new metric, so the `assertNever(metric)` default is not perturbed. The daily tap-tap-save loop gains zero fields, taps, or required steps.
- `app/entry/[date].tsx` — the hard-coded `RatingRow` list: **no edit.** It is a single-day read-only view; coverage over one day is meaningless.
- `app/(tabs)/settings.tsx`, `app/(tabs)/index.tsx`, `app/(tabs)/history.tsx`: **no edit.**
- `components/`: **no new component.** The gap placeholder is a styled `<View>` local to `trends.tsx`, consistent with the existing inline bars.

## Export / report

Add the two pure helpers to `lib/export.ts`, next to `averageOf`. `formatIsoDate` joins the existing `./storage` import:

```ts
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
```

`row.date >= since` compares two `IsoDate` branded strings; the `YYYY-MM-DD` format sorts lexically exactly as it sorts chronologically, so this needs no parsing and no assertion. `since` is optional so the coverage⇄average agreement test can call the two-arg (unbounded) form; both _production_ callers (trends caption, report) always pass a floor.

Thread coverage into the averages tables in `buildReportHtml`. Extend `ScaleAverage` with a coverage field and populate it in `computeScaleAverages`, which takes the floor through from `buildReportHtml` (`const since = profile ? loggingStartDate(profile) : undefined;`):

```ts
export interface ScaleAverage {
  readonly label: string;
  readonly direction: ScaleDirection;
  readonly average: number | null;
  readonly coverage: Coverage;
}
```

```ts
result.push({
  label: metric.label,
  direction: metric.direction,
  average: averageOf(rows, accessor),
  coverage: coverage(rows, accessor, since),
});
```

In the HTML, render a "Logged" column next to "Average", e.g. `<td>${escapeHtml(`${row.coverage.logged} of ${row.coverage.total} days`)}</td>`, with a matching `<th>Logged</th>`. Continue dropping metrics whose `average` is `null` (zero logged days). All interpolated text stays wrapped in the existing `escapeHtml`; counts are `number`s stringified via template literal, still escaped for uniformity. Colors continue to come from `palette` (`lib/tokens.ts`) — coverage cells use the report's existing muted text color; **no new color and no conditional coloring of the count** (coloring it would smuggle in interpretation).

Add one static, non-interpretive footnote beneath the averages tables (Clinical suggestion, forecloses over-reading the count as adherence):

```ts
const coverageNote =
  '<p class="footnote">Logged counts days a rating was recorded; it does not indicate whether the dose was taken that day.</p>';
```

The daily-log table (Date, Sleep, Waking mood, Mood, Focus, Side effects) is unchanged.

## Notifications

**n/a.** No scheduling, permission, channel, or tap-routing behavior changes.

## Test plan

All new logic lands in `lib/export.ts` (coverage-scoped: lines/statements/functions 90, branches 85). New cases in `lib/__tests__/export.test.ts`, importing `{ describe, it, expect }` from `vitest`, using the sanctioned `as IsoDate` literal-fixture idiom and narrowing discriminated unions in-test rather than asserting:

- `coverage` (unbounded) on a fully logged range → `{ logged: n, total: n }`.
- `coverage` on a partially logged range (e.g. 3 of 5 rows have an evening `focus`, others are gap-filled `{ date }` rows from `rowsInRange`) → `{ logged: 3, total: 5 }`.
- `coverage` on an all-unlogged range → `{ logged: 0, total: n }`.
- `coverage` on an empty range → `{ logged: 0, total: 0 }`.
- In each of the above, also assert `total === rows.length` (unbounded) — cheap to pin down given `total` has no other guard.
- **Tenure floor:** `coverage(rows, pick, since)` where `since` falls partway through the range drops the pre-`since` gap rows from `total` (e.g. a 30-row range floored to 6 days of tenure → `total: 6`), while `logged` is unchanged because no logged entry predates `since`. Assert both.
- `loggingStartDate` returns the calendar date of `profile.createdAt`.
- **Coverage ⇄ average agreement:** for the same rows and accessor, `coverage(rows, pick).logged === 0` iff `averageOf(rows, pick) === null`; and the count of values feeding a non-null `averageOf` equals `coverage(rows, pick).logged` — proving averages already ignore missing days. (Uses the unbounded form; the floor only ever removes empty rows, so it cannot change this equality for any real dataset.)
- **Restored-backup coverage (Data-model suggestion):** round-trip a fixture through `buildBackup` → `parseBackup`, then compute `coverage` over the restored `entries` floored by the restored `profile.createdAt`; assert it equals coverage over the original in-memory rows. Not required by a schema change (there isn't one) but makes the "coverage on restored data" claim empirically checked.
- `buildReportHtml` asserts the exact substrings for a coverage cell (e.g. `'3 of 5 days'`), for the footnote text, and that a zero-coverage metric is still dropped from the averages table.

New branches (`rating === undefined` split, the `since` filter, the coverage filter) are all exercised, so branch coverage stays ≥ 85.

## Gate compliance

- **No `any` / unsafe-any:** `coverage`'s `pick` is the same `(row: DayEntry) => Rating | undefined` type already used by `averageOf`/`ratingAccessor`; `Coverage` fields and `loggingStartDate`'s `IsoDate` return are concrete.
- **No `!`:** `dates[index] ?? index` (existing), `?.` on the optional accessor, and `profile ? … : undefined` cover every `noUncheckedIndexedAccess`/null site; the gap branch is chosen by `rating === undefined`, never by assertion.
- **No `@ts-*` / `eslint-disable`:** nothing suppressed.
- **`exactOptionalPropertyTypes`:** `since?: IsoDate` is a positional optional param (omitted or an `IsoDate`), never assigned `undefined` into an object property; the caption fallback literal `{ logged: 0, total: 0 }` is a complete `Coverage`.
- **100% type-coverage (`--ignore-as-assertion`):** the only `as` usages are `as IsoDate` on known-valid literals in test fixtures (sanctioned); production code adds none — `loggingStartDate` mints via `formatIsoDate` guard-and-throw.
- **Exhaustive switch / `assertNever`:** no new discriminated-union variant, so `checkin.tsx`'s `assertNever(metric)` and `computeScaleAverages`'s `metric.kind !== 'scale'` skip are untouched and still correct.
- **RN-free lib:** `coverage`/`loggingStartDate` are pure; `formatIsoDate` already imports from `./storage` (native modules mocked under `lib/__mocks__`), consistent with export.ts's existing `./storage` imports — Vitest runs them directly.

## Dependencies & sequencing

- **Independent and safe to land first.** No dependency on other docs in this set.
- **Breaking change to an exported type — sequence accordingly.** This doc adds a required `coverage` field to the exported `ScaleAverage` interface and changes `computeScaleAverages`'s inputs. Any other in-flight doc that also touches `ScaleAverage` / `computeScaleAverages` should sequence _after_ this one to avoid a merge collision (beyond the general "safe to land first" note).
- **Enables honesty for later metric docs:** because `coverage` is accessor-generic, any doc that adds a scale metric (via `lib/schema.ts`) inherits coverage on Trends and in the report with zero extra work — worth cross-referencing from those docs.
- **Adjacent, not coupled:** a future "per-window / per-phase averages," "coverage in the daily-log table," or dose-adherence view can build on `coverage`, but none is required here.

## Alternatives considered / open questions

- **Raw range length as the denominator (no tenure floor).** Rejected on Clinical review: for an early-titration user, a 14/30-day window counts pre-install days as missing, so the new caption/report cell recreates the very "absence reads as a negative signal" failure this doc set out to kill. Flooring `total` at `loggingStartDate(profile)` is the fix and is now the specified behavior.
- **Floor at `startDate` instead of `createdAt`.** Rejected: the medication start date can precede or follow app install; the honest "could-have-logged" floor is when the app existed to record in, i.e. `createdAt`.
- **Gap as zero-height / omitted column.** Rejected: dropping the column misaligns the `markersRow` dose-change dots, which are positioned column-for-column against `dates`. A placeholder keeps the grid intact.
- **Gap as low-opacity fill instead of a dashed outline.** Rejected: a translucent _fill_ still reads as a (faint) value and its contrast is scheme-dependent; an unfilled outline can never be mistaken for a `ratingColor` bar and needs only `theme.border`, tuned for both schemes.
- **Coverage as a percentage ("73%").** Rejected in favor of `logged of total`: the fraction is the honest, uninterpreted datum; a percentage invites an implicit "good enough" threshold, which strays toward interpretation.
- **Put `Coverage` in `lib/types.ts`.** Rejected: it is a derived view type with a single consumer module, not a domain or persisted shape; colocating it with `coverage`/`averageOf` in `export.ts` keeps `types.ts` about the domain.
- **Open question — `logged` vs. `dose-taken` (Clinical must-fix #2).** Coverage counts a day as logged purely from the accessor returning a `Rating`, with no relationship to `MorningCheckin.doseTaken`. A rating recorded on a skipped-dose day is indistinguishable from one on a dosed day. This doc **deliberately keeps them orthogonal and names the boundary** rather than fusing them: fusing "logged" with "adherent" would make the count assert something about the medication it can't support — the opposite of this doc's purpose. The report footnote states the boundary in plain language for the provider. Whether a _separate_ dose-adherence view (distinct from `computeStreak`'s logging streak) should exist is deferred to a future doc; it is out of scope here.
- **Open question — daily-log coverage.** Should the report show coverage for the _daily-log_ metrics too, or only the averages tables? Scoped to the averages tables (where the denominator most changes the reading); extending to the daily-log header is a cheap follow-up if the provider wants it.
- **Cross-reference — global clinical impression.** A PGI-C-style single-item retrospective ("compared to before starting the medication, overall…") is standard in non-stimulant ADHD titration follow-up and more directly actionable for a prescriber than per-item averages. It is legitimately out of scope for a presentational coverage/gaps doc, but is flagged here so whichever doc owns new _captured_ metrics can pick it up — "defer meaning to the provider" still requires handing the provider the right descriptive primitives.
- **Performance note.** `coverage(rows, accessor, since)` runs per metric block (~11 rating keys over ≤30 rows) on every Trends render. Trivial CPU-wise today; if a future doc adds many more scale metrics, consider memoizing per block so the trend view stays snappy immediately after a check-in save (a laggy post-save trend view is one of the few ways a non-checkin screen could erode the logging habit).

## Panel review

### Clinical / behavioral-health measurement — approve-with-changes

- **Must-fix #1 (dishonest denominator for early-tenure users):** applied. Added `loggingStartDate(profile)` and a `since` floor to `coverage`, so `total` counts only days on/after `profile.createdAt` in both the Trends caption and the report table. Moved into Goals; documented in Problem, Data model, Export, Alternatives.
- **Must-fix #2 (`logged` silently implies dose-taken):** applied as an explicit boundary, no code change (correctly so — fusing the two would over-claim). Named in Non-goals and as an Open question; added the static report footnote spelling out that logged ≠ dose-taken.
- Folded suggestions: the non-interpretive report footnote; the dose-adherence-view open question; the PGI-C cross-reference. Preserved as-is (per reviewer): raw `logged of total` over a percentage, the hollow/dashed unfilled placeholder, no color-coding of the count, and the coverage⇄average agreement test.

### Strict-TypeScript architect — approve

- No must-fixes. Folded all suggestions: added the `coverage`/`loggingStartDate`/`loadProfile`/`Profile` import lines to the Trends touch points; renamed `styles.gap` → `styles.gapPlaceholder` to avoid the `gap` layout-prop readability trap; tightened `barHeight` to `barHeight(rating: Rating)` and dropped its dead `undefined` branch; added the explicit `total === rows.length` assertion to each unbounded fixture case.

### Mobile UX / friction & completion — approve

- No must-fixes; `app/checkin.tsx` and the tap-tap-save loop remain untouched, and gating/warnings stay ruled out by name. Folded the copy gut-check: caption now reads `logged X of Y days` (plain count) rather than an `X/Y` fraction that scans like a compliance grade. Folded the memoization watch-point into the Performance note.

### Data-model / migration + privacy + scope — approve

- No must-fixes. Folded: an explicit line that a pre-existing backup round-trips through the untouched `parseBackup`/`buildBackup` unchanged; a sequencing flag that adding a required `coverage` field to the exported `ScaleAverage` is a breaking change other in-flight docs must sequence behind; and a new test that computes coverage over `entries` restored from an old-format backup.

**Overall status:** All lenses approve or approve-with-changes; must-fixes applied.
