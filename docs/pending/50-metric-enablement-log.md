> **Status:** Proposed (2026-07-23) · **Priority:** P2 · Ref: innovation batch, round 6

# Metric-enablement change log

## Problem / Context

`Profile.enabledEveningMetrics` lets a user turn evening scale metrics on or off at any time —
impulsivity, appetite, and libido default off; a user can enable any of them later, or disable
one they'd enabled. This is genuinely good design for reducing check-in friction (fewer required
ratings by default). But it creates a subtle, unaddressed data-honesty gap this app's own trend-
data-honesty doc (09, landed) doesn't cover: **nothing records _when_ a metric's enabled state
changed.** A report or Trends view showing "no data for appetite before March 3rd" cannot today
distinguish two very different situations — "appetite wasn't being tracked before March 3rd" (an
honest absence, no missing data at all) versus "appetite was being tracked the whole time but the
user simply never had a rating to give some days" (a real gap in an actively-tracked metric).
Doc 09 landed exactly this kind of honesty for _logging_ gaps (coverage captions, gap rendering);
this doc closes the analogous gap for _tracking-scope_ changes.

## Goals / Non-goals

**Goals**

1. A small, append-only log of `enabledEveningMetrics` changes — when a metric was turned on or
   off — stored alongside `Profile`, mirroring the `DoseChange`/`Visit` append-only shape this
   repo already uses for every other "a fact changed on this date" record.
2. Use that log wherever a metric's absence-of-data could otherwise be misread: the report's
   evening-averages section (a metric disabled for part of the range shows _why_ it has fewer
   data points, not just fewer) and Trends' coverage caption (extending doc 09's existing
   "logged N of M days" honesty to also state "tracked since {date}" when a metric wasn't always
   enabled).
3. Purely descriptive — a dated record of a setting change, never a judgment about whether
   disabling a metric was a good idea.

**Non-goals**

- **No retroactive backfill or deletion of data when a metric is disabled.** Exactly as today:
  disabling a metric only affects the check-in form going forward; any historical ratings for
  that metric remain in `entries` untouched, exactly as the landed "configurable evening
  check-in metrics" decision already specifies. This doc adds a _log of the setting changes_,
  it does not change what disabling/enabling actually does to existing data.
- **No UI change to how metrics are toggled.** The existing Settings toggle for each evening
  metric works exactly as it does today — this doc only adds a side-effect record of _when_ a
  toggle was flipped, invisible to that interaction itself.
- **No judgment about why a metric was disabled.** No "you stopped tracking impulsivity" framing
  that could read as concern or criticism — the log states a bare fact (metric X, enabled/
  disabled, on date Y), matching every other neutral change-log's tone in this app (`DoseChange`,
  `Visit`).
- **No coupling to morning metrics.** Morning's two ratings (`sleepQuality`, `wakingMood`) are
  always-required and never individually toggleable — this doc's scope matches
  `enabledEveningMetrics`'s own scope exactly, evening-only.

## Data model (`lib/types.ts`)

```ts
export interface MetricEnablementChange {
  readonly date: IsoDate;
  readonly key: EveningRatingKey;
  readonly enabled: boolean;
}
```

A flat, append-only record — no discriminated union needed (`enabled: boolean` already makes the
two states unrepresentable as anything else). Mirrors `DoseChange`'s shape (`date` + what
changed) exactly.

## Storage (`lib/storage.ts`)

Mirrors the `DoseChange` seam:

```ts
export function isMetricEnablementChange(value: unknown): value is MetricEnablementChange {
  return (
    isRecord(value) &&
    isIsoDate(value['date']) &&
    isEveningRatingKey(value['key']) &&
    typeof value['enabled'] === 'boolean'
  );
}

export function isMetricEnablementChangeList(
  value: unknown,
): value is readonly MetricEnablementChange[] {
  return isUnknownArray(value) && value.every(isMetricEnablementChange);
}
```

`STORAGE_KEYS` gains `metricEnablementLog: 'metricEnablementLog'` (bare key, matching every other
entry). `loadMetricEnablementLog`/`saveMetricEnablementLog`/`appendMetricEnablementChange` mirror
`loadDoseChanges`/`saveDoseChanges`/`appendDoseChange` exactly — tolerant per-element load,
append-only (no dedup-by-date needed here, since toggling the same metric on then off then on
again on different dates are all genuinely distinct, meaningful events, unlike a `Visit`'s
single-identity-per-date model).

**Write site.** `app/(tabs)/settings.tsx`'s existing evening-metric toggle handler
(`withEveningMetricToggled`, `lib/schema.ts:168-175`) gains one additional call —
`appendMetricEnablementChange({ date: todayIsoDate(), key, enabled })` — alongside its existing
`updateProfile` write. Two writes for one user action (the profile flag, and the log entry).

**(panel — data-model/scope lens, must-fix.) Write ordering and failure mode, stated
explicitly.** The `updateProfile` write (the toggle actually taking effect) goes **first**; the
`appendMetricEnablementChange` log write goes **second**. If the log write fails after the
profile write succeeds, the toggle still worked — the user's check-in form correctly reflects the
new setting — and only the historical "when did this change" record is missing for that one
event; the failure degrades to a slightly less-complete log, never to a toggle that silently
didn't take effect. The reverse ordering (log first) would risk the opposite and worse failure:
a logged change that never actually happened to the profile. This is intentionally **not** a
`Promise.all` (unlike `restoreBackup`'s multi-key restore, where every key is independent and
equally load-bearing) — here the two writes have a real dependency order worth stating rather
than firing concurrently and leaving the failure mode to chance.

## Deriving "tracked since" (`lib/metrics.ts`)

**(panel — strict-TypeScript lens, must-fix: single home.)** These are pure, RN-free derivations
over the log, not storage guards — they belong in `lib/metrics.ts` (alongside this repo's other
pure metric-derivation helpers, tested in `lib/__tests__/metrics.test.ts`), not in `lib/storage.ts`
which is reserved for guards and load/save persistence functions. An earlier draft of this doc
split them across a `## Storage` heading and a `metrics.test.ts` test target inconsistently —
both now live under one home.

```ts
/**
 * The date a given evening metric became continuously enabled, looking backward from `asOf` —
 * or `undefined` if it was enabled the whole time (no log entries at all for that key, which is
 * the common case: most metrics are never toggled after onboarding). Pure, RN-free.
 */
export function trackedSince(
  log: readonly MetricEnablementChange[],
  key: EveningRatingKey,
  asOf: IsoDate,
): IsoDate | undefined {
  const relevant = log
    .filter((change) => change.key === key && change.date <= asOf)
    .sort((a, b) => b.date.localeCompare(a.date));
  const mostRecent = relevant[0];
  if (mostRecent === undefined) return undefined; // never toggled — tracked since always
  return mostRecent.enabled ? mostRecent.date : undefined;
  // Simplification, stated honestly: this returns a meaningful date only for the single most
  // recent disable-then-enable transition; a metric toggled off-then-on-then-off-then-on
  // multiple times has a genuinely discontinuous tracking history the report/Trends render as
  // multiple gaps (see Report/Trends below), not collapsed into one "since" date — trackedSince
  // is a convenience for the common single-transition case, not a full history flattener.
}

/**
 * (panel — clinical lens, must-fix.) The disable-direction counterpart to `trackedSince`: the
 * date a metric currently enabled `asOf` was most recently *disabled and later re-enabled* has no
 * bearing here — this instead answers "is this metric currently disabled, and since when," so a
 * partial-range mean is never rendered with no caption at all just because the metric happens to
 * be off as of today. Returns `undefined` when the metric is enabled as of `asOf` (nothing to
 * caption) or was never toggled.
 */
export function trackingStoppedSince(
  log: readonly MetricEnablementChange[],
  key: EveningRatingKey,
  asOf: IsoDate,
): IsoDate | undefined {
  const relevant = log
    .filter((change) => change.key === key && change.date <= asOf)
    .sort((a, b) => b.date.localeCompare(a.date));
  const mostRecent = relevant[0];
  if (mostRecent === undefined) return undefined;
  return mostRecent.enabled ? undefined : mostRecent.date;
}
```

## Report (`lib/report-html.ts`) / Trends (`app/(tabs)/trends.tsx`)

**(panel — clinical lens, must-fix: symmetric disable-direction caption.)** A metric disabled
partway through the report/Trends range must never render a bare, unlabeled partial mean — that
silently presents a truncated average as if it covered the whole range. For any metric where
`trackingStoppedSince` returns a date (currently disabled as of the range's end), the caption
states "tracking stopped {date}" alongside the mean, exactly mirroring how the enable-direction
case is captioned — the two functions are deliberately symmetric so neither direction of a
setting change can render silently.

**(panel — mobile UX lens, must-fix: one caption line, not two.)** Where doc 09's "logged N of M
days" caption and this doc's "tracked since"/"tracking stopped" clause both apply to the same
metric, they compose into **one** caption line ("Tracked since {date} · logged {n} of {m} days"),
never two stacked caption lines under the same metric — this app's reports and Trends cards are
already caption-dense, and a metric that needs both facts stated should read as one denser line,
not visually double the caption real estate for that one metric relative to every other row.

**Report.** The evening-averages section, for any metric with at least one enablement-log entry
in range, gains this composed caption alongside its existing mean — descriptive context for why
that metric's sample size is smaller than the range would otherwise suggest, and worded as a
settings-change event ("tracked since," "tracking stopped"), never as a clinical milestone or
judgment about the change itself.

**Trends.** Doc 09's existing coverage caption gains the same composed, optional clause when
relevant, using the identical `trackedSince`/`trackingStoppedSince` helpers — one source of truth
for "was this metric always on" consumed by both surfaces, never two independently-computed
answers that could drift apart.

Both render nothing extra for the overwhelming common case (a metric that was never toggled after
onboarding, or has been continuously enabled for the whole selected range) — this is additive
context only when it's actually informative, never a new caption cluttering every metric.

## Test plan (`lib/__tests__/storage.test.ts`, `lib/__tests__/metrics.test.ts`)

1. **Guards** — `isMetricEnablementChange` accepts a valid record; rejects a non-`EveningRatingKey`
   `key`, a malformed `date`, a non-boolean `enabled`.
2. `trackedSince` — no log entries for a key ⇒ `undefined` (tracked the whole time); a single
   disable-then-enable transition ⇒ the enable date; a metric currently disabled as of `asOf`
   (most recent entry is a disable) ⇒ `undefined` per this doc's stated simplification (a
   currently-disabled metric has no meaningful "tracked since" for the requested date, since it
   isn't tracked at all as of `asOf` — a case worth confirming explicit, not accidental).
3. `trackingStoppedSince` — the disable-direction counterpart: a metric currently disabled as of
   `asOf` (most recent entry a disable) ⇒ that disable date; a metric currently enabled ⇒
   `undefined`; no log entries ⇒ `undefined` — deliberately the inverse conditions of
   `trackedSince`, tested side by side against the same fixtures to confirm the symmetry.
4. **Backup round-trip** — `buildBackup` includes `metricEnablementLog`; `parseBackup` on a
   pre-feature backup defaults it to `[]`; `restoreBackup` persists it via
   `saveMetricEnablementLog` in its `Promise.all` — the same must-fix pattern this batch's docs
   17/24/25/31/36 already established, applied here from the start.
5. **Report/Trends render** — a metric with a logged enable-after-disable transition in range
   renders the "tracked since" caption; a metric disabled as of the range's end renders "tracking
   stopped" instead; a metric with both a "tracked since" fact and a doc-09 logged-N-of-M-days
   fact renders exactly one composed caption line, not two; a metric never toggled renders nothing
   extra; both surfaces agree (a single shared pair of helpers, not two independent computations).

## Gate compliance

No `any`/`!`/`@ts-*`/eslint-disable. `MetricEnablementChange` is a flat interface — no
`assertNever` obligation. Additive `Backup` field, additive `STORAGE_KEYS` entry → no migration,
no forced re-onboarding; pre-feature backups import cleanly with `metricEnablementLog: []`.
`npm run check` must pass before commit.

## Dependencies & sequencing

Independent of every other doc in this batch and prior rounds. Builds only on landed code
(`Profile.enabledEveningMetrics`, `withEveningMetricToggled`, doc 09's coverage-caption
mechanism, which this doc extends rather than duplicates).

## Alternatives considered

- **Inferring "tracked since" retroactively from the data itself (the first day a rating for
  that key appears) instead of an explicit log:** rejected — a metric's first-ever rating date
  is not the same fact as when it was _enabled_; a user could enable a metric and then not get
  around to rating it for several days, or (per doc 09's own "the read-only day-detail view...
  renders any unanswered/disabled metric" precedent) a metric could show historical data from
  before it was last disabled. An explicit log of the setting change itself is the only honest
  source for this fact — inference would sometimes be wrong in exactly the way this doc exists
  to prevent.
- **Storing the enablement log as part of `Profile` itself (an array field) instead of a
  separate append-only store:** rejected — `Profile` represents current state; every other
  "dated history of changes" fact in this app (`DoseChange`, `Visit`) already lives in its own
  append-only list rather than growing inside the single current-state object, and this doc
  follows that established precedent rather than introducing a new pattern.
- **Collapsing multiple toggle transitions into one "tracked since" date rather than rendering
  each gap separately:** rejected as dishonest simplification for the (rare) multi-transition
  case — see `trackedSince`'s own documented limitation; the helper is a convenience for the
  common single-transition case, and a metric with a genuinely discontinuous history should
  read as having multiple gaps, not one misleadingly-collapsed date.

## Panel review

Run through the 4-lens panel (2026-07-23): approve-with-changes (clinical, mobile UX,
data-model/scope), approve-with-changes (strict-TypeScript). Must-fixes applied above; the panel
process also surfaced and fixed an inverted return condition in `trackedSince` itself while
implementing the clinical must-fix (see below).

- **Clinical — approve-with-changes.** Flagged the disable-direction gap: a metric disabled
  mid-range rendered no caption at all, silently presenting a truncated mean as a full-range one.
  Added the symmetric `trackingStoppedSince` helper and a "tracking stopped {date}" caption;
  reworded both captions to read explicitly as settings-change events, never a clinical milestone.
  While wiring this fix in, also caught that the original `trackedSince` implementation had its
  enabled/disabled branches inverted relative to its own stated behavior and test plan — fixed as
  part of the same change (see Deriving "tracked since" above).
- **Strict-TypeScript architect — approve-with-changes.** Required `trackedSince`/
  `trackingStoppedSince` to have one consistent home; moved both from a split
  `## Storage (lib/storage.ts)` / `metrics.test.ts` inconsistency into a single `lib/metrics.ts`
  section, matching this repo's existing pure-derivation-helpers file.
- **Mobile UX / friction — approve-with-changes.** Required "tracked since"/"tracking stopped"
  to compose with doc 09's "logged N of M days" caption into one line per metric rather than
  stacking two captions, keeping report/Trends caption density consistent across metrics.
- **Data-model / migration + privacy + scope — approve-with-changes.** Required the two-write
  sequence (profile flag, then log append) to have a stated ordering and failure mode rather than
  an unspecified `Promise.all` — profile write first, since a failed log append degrades to a less
  complete history rather than a toggle that silently didn't take effect.
