# Decisions since v0

Running log of design decisions made after [`PLANNING-v0.md`](PLANNING-v0.md), which is
frozen. Newest first.

## Before/after dose-change comparison: sample size, adherence, and the in-app view (2026-07-22)

**Problem:** The provider-report overhaul (below) shipped a before/after-dose-change section
showing each side's mean and a change arrow, but dropped the two facts that make a titration
comparison interpretable: how many logged days that mean rests on, and whether adherence
differed between the two windows. A `2.4 → 3.1` reads identically whether it's backed by 12
logged days or one. And the in-app "Around dose changes" Trends view specced alongside it was
never built.

**Decision:** Implemented `docs/pending/16-before-after-dose-comparison.md` as specified (panel
pre-approved 2026-07-22, no changes needed at implementation time).

- `BeforeAfter` (`lib/report-metrics.ts`) grew two derived-only fields —
  `beforeAdherence`/`afterAdherence: AdherenceSummary` — computed via the existing
  `computeAdherence` over each window's rows. No new persisted shape; nothing touches
  `Backup`/`parseBackup`.
- `lib/report-html.ts`'s `beforeAfterHtml` now renders `n=<n>` under each mean (`0` for an
  `empty` side), a muted "few logged days" note when a side's `n` is below the new
  `FEW_LOGGED_DAYS_THRESHOLD` (`lib/metrics.ts`, shared with the in-app view), and one
  `<taken>/<logged> doses` line per table. The change arrow already suppressed itself whenever
  either side was `'empty'` (via `computeTrend`'s existing guard) — confirmed with a dedicated
  test rather than re-implemented.
- New in-app "Around dose changes" section on `app/(tabs)/trends.tsx`, below the existing
  per-day bars: one collapsible `components/DoseChangeCard.tsx` per `DoseChange`
  (most-recent-first, only the most recent expanded by default), compact
  `label · Before · After` rows colored via `ratingColor` through a small local `toRating(mean)`
  ladder (not `Math.round`, which returns a bare `number` rather than the `Rating` literal
  union). Renders nothing — not even the header — when there are no dose changes. Uses the
  selected range as the before/after window, labeled "N-day windows" in each card header.
- Golden report fixture snapshots (`lib/__fixtures__/reports/*.html`) regenerated via
  `vitest -u`; the `.backup.json` fixtures are unchanged, confirming no persisted-shape drift.

## Rolling-average trend smoothing (2026-07-21)

**Problem:** Raw daily 1–5 ratings are noisy enough to hide the weeks-long drift the app
exists to surface — both on `app/(tabs)/trends.tsx`'s daily bars and in the PDF report's
per-period averages. A naive trailing mean would also risk blending two different dosing
regimens into one misleading figure right at the moment a provider most needs a clean
read on the new dose.

**Decision:** Implemented `docs/pending/08-rolling-average-trends.md` as specified (panel
pre-approved, no changes needed at implementation time).

- New RN-free `lib/trends.ts`: `rollingAverage(values, window, boundaries?)` — a trailing
  simple moving average over `Rating | undefined` values, returning `SmoothedValue =
number | null`, that truncates its window at the most recent `true` in an optional
  `boundaries` mask so a smoothed value never spans a dose-change boundary.
  `dosePeriodBoundaries(dates, doses)` derives that mask; `recentWindowDates(dates, doses,
window)` returns the same dose-clamped tail as a date list (used by the report).
  `defaultWindowForRange(rangeDays)` picks 3 for a 7-day range, 7 otherwise.
- `app/(tabs)/trends.tsx`: a "Smooth (Nd avg)" toggle chip in its own row (default on,
  ephemeral `useState` — not persisted to `Profile`), overlaying thin `theme.accent` dots
  on each metric's bar row via an absolutely-positioned sibling layer, column-aligned with
  the existing bars and `markersRow`. The raw bars remain the primary layer; a `null`
  smoothed value (empty window) renders no dot.
- `lib/export.ts`: a new "Recent trend" report section — one row per scale metric with
  data, showing the grand-range average alongside a dose-period-clamped `Recent (7d avg)`
  figure (`ScaleAverage`, `adherenceInWindow`, `REPORT_RECENT_WINDOW = 7`). Printed with
  its concrete date span, a `doses taken X of Y logged mornings` adherence count for that
  identical window, and a plain caveat that these are arithmetic means of self-reported
  ratings, not a validated score — so the figure can never be read out of context. This
  section is new rather than a column grafted onto the existing weekly/dose-period bucket
  tables (`periodTableHtml`), since those already show per-bucket means and have no single
  "grand average" row for a Recent column to sit beside.
  Golden report fixtures (`lib/__fixtures__/reports/*.html`) regenerated via `vitest -u`.
- No new persisted state: smoothing is a pure view-time transform over `entries` already
  loaded; `Profile`, `Backup`, and `parseBackup` are untouched.

Closes `docs/pending/08-rolling-average-trends.md`.

## Trends logging-coverage caption + honest gap rendering (2026-07-19)

**Problem:** `app/(tabs)/trends.tsx` never said how many of the visible days were actually
logged, and rendered an unlogged day as a short `theme.border`-colored bar (`barHeight`
returned `4` for `undefined`) — visually indistinguishable from a genuinely low rating. A
sparse range's trend line silently invented dips that were really just missing data.

**Decision:** Implemented the rescoped `docs/pending/09-trend-data-honesty.md` (rescoped
earlier the same day after the provider-report overhaul obsoleted its PDF-report half — see
that doc's "What changed" section; the report-side denominator now belongs to item 16).

- New pure helpers in `lib/export.ts`: `coverage(rows, pick, since?)` returns
  `{ logged, total }`, with `total` floored to `since` so pre-install days are never counted
  as missing; `loggingStartDate(profile)` derives that floor from `profile.createdAt` via the
  existing `formatIsoDate` guard-and-throw. Both are pure and RN-free.
- `trends.tsx` now loads `Profile` again (via `loadProfile`) to compute the floor — reversing
  the "no longer loads Profile at all" line in the earlier "Trends/reports reflect data, not
  the Settings toggle" decision below. That decision was about not filtering a metric's
  _visibility_ by the Settings enable/disable toggle; it's unrelated to using
  `profile.createdAt` as the coverage denominator's floor, so re-adding the load doesn't
  reopen that decision — flagged here so the two entries don't read as contradictory.
- Each metric block now shows a `logged {n} of {total} days` caption (spelled out, not a bare
  `n/total` fraction, so it doesn't scan like a compliance grade) and renders an unlogged day
  as a hollow dashed `gapPlaceholder` outline instead of a filled bar — unfilled, so it can
  never be confused with a `ratingColor` fill in either color scheme.
- `barHeight` tightened to `barHeight(rating: Rating): number`, dropping its now-unreachable
  `undefined → 4` branch now that the gap case is a separate render path.
- Tests in `lib/__tests__/export.test.ts` pin `coverage`'s edge cases (fully/partially/
  never-logged, empty range, the tenure floor) plus two agreement checks: `coverage(...).logged
=== metricAverage(...).n` (so Trends' "logged" and the report's already-shipped
  `MetricAverage.n` — item 16's territory — can never drift apart) and `coverage(...).logged
=== 0 ⇔ averageOf(...) === null`.

No persisted-shape change; `coverage`/`loggingStartDate` are derived-only and touch neither
`Backup` nor any guard.

Supersedes and closes `docs/pending/09-trend-data-honesty.md`.

## Wider report tables: unbroken sparklines, de-dated + vertical weekly headers (2026-07-19)

**Problem:** Three coupled layout faults in the report tables. (1) The trend sparklines — inline
`<span>` bars — wrapped onto multiple lines in a narrow column (visible in `titration-journey`'s
weekly table). (2) The period-table headers were wide (`Week 1 (Jul 1–7)`) while the data was a
single number, and a long range produced many such columns. (3) Weekly averages were dropped past
a 56-day cap (`MAX_WEEKLY_BUCKET_DAYS`), which discarded the richest view exactly when a long
titration needs it (`long-multimonth`).

**Decision:**

- **Unbroken sparklines.** `sparklineHtml` wraps its bars in a `.spark-line`
  (`display: inline-block; white-space: nowrap`) so they can never break across lines, with more
  compact bars (2px, no gap) so a long-range sparkline doesn't dominate the width.
- **De-dated weekly headers, vertical past 5 weeks.** Weekly bucket labels are now bare `Week N`
  (the date range is dropped to keep the column narrow). `periodTableHtml` takes a `verticalHeaders`
  flag; the weekly table sets it once there are more than 5 weeks, switching those headers to
  `writing-mode: vertical-lr` (`th.vhead`) so a many-week table stays within the page width. Other
  headers (daily log, dose-period, Metric/Trend) stay plain and upright.
- **Weekly always renders.** Removed the 56-day cap and `MAX_WEEKLY_BUCKET_DAYS`, so the weekly view
  is no longer discarded for long ranges.

An earlier attempt drew all these headers on a 45° `transform` angle. It was abandoned: a transform
reserves no layout space, so the diagonal labels either ballooned the columns to the full label
width or spilled outside the table and clipped at the page edge. Bare `Week N` + a vertical fallback
solves the width problem without leaving the table box. Verified by rendering the goldens in a
browser. No persisted-shape change; golden scenario reports were regenerated and tests updated.

## Print-color-adjust for report sparklines (2026-07-19)

**Problem:** When the report was printed / exported to PDF, the trend sparklines disappeared. They
are background-filled `<span>` bars (`background:${hex}`, no content), and print engines drop
background colors by default — so the bars rendered at full size but empty. But forcing _all_
backgrounds to print (a universal `print-color-adjust: exact`) is the wrong fix: it also prints the
warm page background, flooding a PDF export with ink.

**Decision:** Scope the fix. The sparkline bars carry a `.spark` class, and only that class gets
`-webkit-print-color-adjust: exact; print-color-adjust: exact;` — so the bars survive PDF export
while every other background stays in the engine's default (ink-economy) mode. The page background
is additionally dropped under `@media print { body { background: transparent } }`, so a printed copy
is white regardless of the viewer's "background graphics" setting. The warm on-screen look is
unchanged. Golden scenario reports were regenerated; a guard test asserts both the scoped rule and
the dropped page background.

## Schema-driven daily log (2026-07-19)

**Problem:** The report's daily-log table hard-coded six columns (Date, Sleep, Waking mood, Mood,
Focus, Side effects), so captured metrics — impulsivity, anxiety, energy, appetite, libido, sleep
hours, and dose-taken — never appeared. The raw per-day record silently dropped data the user had
entered.

**Decision:** The daily log now builds its columns generically from the schema
(`[...MORNING_METRICS, ...EVENING_METRICS]`) and prunes to the metrics with at least one captured
value in range — show everything captured, nothing that wasn't. New exported pure helpers in
`lib/export.ts`: `dailyLogColumns` (which columns), `dailyLogHasValue` (presence predicate driving
inclusion), and `dailyLogCell` (per-metric cell text, exhaustive `switch` → `assertNever`); the
per-day `sideEffectsCell` moved to module scope to be shared. Column order follows the check-in
schema, so adding a metric in `lib/schema.ts` flows into the report automatically.

Free-text notes are the one deliberate exclusion: they keep their dedicated dated section, which
renders them richly and honors the `includeNotes` toggle — a raw column would duplicate them and
bypass that toggle. Headers use the schema `label` (single source of truth) rather than a parallel
short-label map. No persisted-shape change; the golden scenario reports were regenerated.

## Golden provider-report scenarios (2026-07-19)

**Problem:** The provider report (`buildReportHtml`) is the app's whole reason to exist, but its
growing surface — cover trend arrows, weekly + dose-period averages, before/after tables,
adherence, side-effect severity runs, notes — could only be eyeballed by hand-feeding ad-hoc data
through a test. There was no reproducible, realistic dataset to develop against, review the
rendered output from, or regression-check.

**Decision:** Added `lib/__fixtures__/scenarios.ts` — 10 hand-authored, deterministic
`ReportScenario`s (RN-free, type-only imports plus a local pure `addDays`; branded values via `as`;
one frozen `FIXED_TS` so both the HTML and the exported backup JSON are byte-reproducible). Values
are clinically grounded (FDA-label titration schedules, the slow non-stimulant onset that _lags_
each dose increase, and per-drug side-effect fingerprints for atomoxetine / guanfacine ER /
viloxazine ER) — realistic sample data, not medical advice. The linked open datasets (Kaggle ADHD
diagnosis, ADHD-200, med-adhd.org, an animoller PDF template) held no importable daily self-report
series, so the data stays authored rather than mined.

The set spans responder / partial / non-responder, single- vs multi-dose titration, sparse and
poor-adherence logging, a 7-day export and a >56-day one, notes on/off, and profile / null-header
cases, so every report branch is exercised: up/down/flat/insufficient trend arrows, the 56-day
weekly-bucket cutoff, the multi-dose caveat, single and multiple before/after tables, the
adherence split, side-effect run-length trajectories, and the migrated-default footnote.

`lib/__tests__/scenarios.test.ts` renders each scenario via `buildReportHtml` and pins both the
HTML and a `Backup`-shaped JSON with `toMatchFileSnapshot`, plus a gallery `index.html`; the
committed golden outputs under `lib/__fixtures__/reports/` (prettier-ignored) double as the
human-reviewable sample reports and a drift guard. `npm run reports` regenerates them (`-u` to
accept changes). No change to `export.ts` or any persisted shape — a pure read/derive addition; the
backup JSON also imports straight into the app as realistic seed data. Does not consume a
`docs/pending/` number (test/tooling infrastructure, not a design-doc-track feature).

## Provider report overhaul (2026-07-18)

**Problem:** The PDF report is the app's whole reason to exist — the one artifact that leaves
the phone and lands in front of a clinician — but it emitted a thin summary: one grand-mean
Morning table, one grand-mean Evening table, and a 5-column daily table. A single "mood 3.4"
flattened the titration story (25 mg for two weeks then 40 mg erased the before/after contrast),
free-text `notes` were captured and then silently dropped, adherence was invisible, and there
was no 20-second orientation for a busy provider.

**Decision:** Implemented `docs/pending/06-provider-report-overhaul.md`. `buildReportHtml` now
takes the full `entries` map plus an explicit `rangeStart`/`rangeEnd` (so period and before/after
math reaches outside the display window) and a `ReportOptions` object, and renders, in order:
cover summary → dose timeline → weekly averages → dose-period averages → before/after each dose
change → adherence → side effects → notes → daily log.

- **Cover summary** — per-metric first-half-vs-second-half trend arrows (▲/▼/▬) with a neutral
  deadband (`TREND_DEADBAND = 0.3`) _and_ a minimum-sample floor (`MIN_HALF_SAMPLES = 3`), below
  which the trend is `insufficient` rather than a noise-driven arrow. Every arrow carries an
  inline, value-free scale-anchor caption from the schema (`1 = Calm, 5 = On edge`) so `anxiety ▲`
  can't be pattern-matched against `mood ▲`. A multi-dose caveat renders when the range straddles
  a `DoseChange`.
- **Per-period averages** replace the grand means: weekly buckets (dropped beyond
  `MAX_WEEKLY_BUCKET_DAYS = 56`) and dose-period buckets bounded by `DoseChange.date`, each with an
  inline `<span>`-bar sparkline (same hues/height formula as `trends.tsx`, no charting dependency).
  Dose-period buckets reach back to the change date that began the active dose, reading the full
  `entries` map, so a period that started before the display window still averages its real data.
- **Before/after** each in-range dose change (±`beforeAfterWindowDays`, default 14) via the shared
  pure `beforeAfterDose` helper (the seam `16-before-after-dose-comparison` will import).
- **Adherence** as its own neutral block: taken / not-taken / no-entry counts foregrounded, per-date
  lists de-emphasized to an appendix, "no entry recorded" (never "missed"), and a footnote that
  it's a binary with no timing/intent. `totalDays` is derived so it can't disagree with the counts.
- **Notes** rendered as a dated, escaped list gated by an `includeNotes` Settings toggle (default
  on, export screen only).
- New shared type `TrendDirection`; report-internal `MetricAverage`/`MetricTrend`/`PeriodBucket`/
  `BeforeAfter` modeled as discriminated/narrowed unions (illegal states unrepresentable, no
  sentinel numbers). `REPORT_RATING_ORDER` in `schema.ts` keeps report ordering a single source of
  truth. No persisted-shape change, no migration, no version bump — a pure read/derive feature;
  old backups stay importable.

**Deviations from the frozen doc** (item 10 landed first and changed the baseline):

- **Side effects kept item 10's richer section.** The doc planned a positional half-membership
  design ("present in first half only"); item 10 had already shipped a richer, panel-approved
  section (onset + dose-active-then, in-range span, ongoing?, days-over-logged-evenings, run-length
  severity trajectory). Kept that verbatim; dropped the doc's thinner design and its now-obsolete
  "severity not captured" footnote (severity _is_ captured). The doc's own dependency note
  anticipated this.
- **Adherence moved, not duplicated.** Item 10 had bolted a one-line adherence caption onto the
  side-effects table as a stopgap; that caption moved into the new dedicated block.
- **Filter by data-in-range, not the Settings toggle.** Per the earlier "Trends/reports reflect
  data, not the Settings toggle" decision, cover/period metrics appear when they have data in the
  range, rather than the doc's "filter against `enabledEveningMetricKeys`".

Supersedes and closes `docs/pending/06-provider-report-overhaul.md`.

## Side-effect severity & onset (2026-07-18)

**Problem:** Side effects were a bare `readonly SideEffect[]` — a chip on or off. The
provider's real branch point on a non-stimulant ramp isn't _whether_ an effect exists, it's
how bad it is, whether it's fading, and when it started relative to a dose change. "Severe
nausea, unchanged for three weeks" and "mild nausea gone by day four" were identical data.

**Decision:** Implemented `docs/pending/10-side-effect-severity.md`. Side effects become a
`SideEffect`-keyed record (`SideEffectReports = Readonly<Partial<Record<SideEffect,
SideEffectDetail>>>`) carrying a `severity` (`'mild' | 'moderate' | 'severe'`) per effect.
The keyed record makes duplicate-effect states structurally unrepresentable and turns every
consumer into a key lookup.

- **Migrate-on-read, provenance preserved.** Legacy `string[]` evening days normalize to a
  `moderate` default tagged `origin: 'migrated'`. The marker is persisted, so it survives
  resave and backup round-trips; the report footnotes a migrated default rather than showing
  it as user-entered. `withSideEffectSeverity` drops the marker the moment the user edits.
- **Parse-don't-validate, sole minters.** `parseEveningCheckin` / `parseDayEntry` are the
  only functions that mint the new-shape value; `isEveningCheckin` / `isDayEntry` / `isEntries`
  are demoted to plain `boolean` validity checks (a `value is EveningCheckin` predicate would
  be a lie for legacy `string[]` input).
- **Deviation from the frozen doc:** the doc described an all-or-nothing `parseEntries` /
  `loadEntries` value path, but the tolerant per-day parse (doc 03) had since landed and is
  strictly better. Reconciled by folding migrate-on-read into `parseEntriesTolerant` (via
  `parseDayEntry`) instead of the doc's superseded path, so the "one bad day drops the whole
  log" residual the doc accepted no longer applies. `parseEntries` (the `Parsed<T>` form)
  remains the all-or-nothing normalizer that backup import uses.
- **Zero added friction.** Chip-body tap still toggles select/deselect; severity is a separate
  secondary control (`components/SeveritySelector.tsx`) that appears only once an effect is
  selected. Selecting _N_ effects at default stays _N_ taps; Save is never gated by severity.
- **Report as data, not advice.** New pure helpers `firstOnsetDates` (true first-appearance
  over the FULL log) and `doseActiveOn` sit each effect's onset next to the dose active then.
  The report's "Side effects" table shows onset+dose, in-range span, ongoing?, days-reported
  over logged-evenings, and a run-length severity trajectory, with a range-level adherence
  caption — no correlation drawn, no improving/worsening verdict.
- Severity stays a literal union (no numeric score) so nothing invites averaging or risk-ranking.

Supersedes and closes `docs/pending/10-side-effect-severity.md`.

## Ratings as a record on the check-in types (2026-07-18)

**Problem:** `MorningCheckin`/`EveningCheckin` in `lib/types.ts` hand-declared every
Rating-valued field by name (`sleepQuality`, `wakingMood`, `mood`, `focus`, …). That
duplicated the metric list that already lives — as the single source of truth — in
`lib/schema.ts` / the `*_RATING_KEYS` arrays. Adding a scale metric meant editing the
schema **and** the interface **and** the storage guard.

**Decision:** Collapse only the homogeneous `Rating` fields of each check-in into a
`ratings: Partial<Record<…RatingKey, Rating>>` (the shape `Draft.ratings` already uses).
The heterogeneous one-off fields (`doseTaken`, `sleepHours`, `sideEffects`, `notes`) and
the `completedAt` metadata stay explicit and legible.

- Deliberately **not** full schema-derived (mapped types over the schema). With exactly one
  metric per non-scale kind, the type-level machinery (retype arrays `as const`, per-kind
  value map, `KindForKey` conditional) wasn't worth the density/DX cost, and the _safe_
  version of full-derive is the complex one anyway.
- **Morning ratings are now optional at the type level.** The "sleepQuality/wakingMood
  required" invariant is preserved by the existing runtime completeness gate in
  `app/checkin.tsx` (`isComplete` over required scale keys) — the same way evening ratings
  already worked. Not a compile-time guarantee anymore.
- `lib/checkin.ts`: `eveningRatingsFromDraft` generalized to
  `ratingsFromDraft<K>(keys, ratings)`, used by both sessions' construction.
- `lib/storage.ts`: new `isRatingsRecord(value, keys)` guard; `isMorningCheckin`/
  `isEveningCheckin` validate `ratings` through it. `ratings` must be present (may be `{}`).
- `lib/export.ts`: `ratingAccessor` and the daily-log table read `…?.ratings[key]`.
- **Stored JSON shape changed** (ratings nest under `ratings`). No migration written: still
  in beta. Old-shape on-disk entries fail the new guard and are dropped by
  `parseEntriesTolerant` (non-destructive — the corrupt blob is quarantined, not clobbered).

## Extract a shared `<DoseInput>` component (2026-07-18)

**Problem:** The dose amount field + unit-chip picker was copy-pasted almost verbatim across
`app/onboarding.tsx` and `app/(tabs)/settings.tsx` — two JSX blocks, two identical style blocks
(`doseRow`/`amountInput`/`unitRow`/`unitChip`), and two copies of
`const DOSE_UNITS = ['mg','mcg','mL']` to keep in sync by hand. The only genuine verbatim
cross-screen UI duplication in the app.

**Decision:** Add `components/DoseInput.tsx` — a thin, controlled, presentational primitive (in
the mold of `Toggle`/`Stepper`) that owns the amount `TextInput`, the unit chips, `DOSE_UNITS`,
and the shared styles. Props: `amount` (raw text, parent parses), `unit`, `onAmountChange`,
`onUnitChange`, optional `amountPlaceholder`. Both screens render `<DoseInput …>` and keep only
their own surrounding margin (a `doseField` wrapper: onboarding `space.xl`, settings `space.md`),
so layout is unchanged.

- One intentional standardization: the unit-chip label now uses `typography.body` in both places
  (settings previously used `typography.caption`) — a deliberate, tiny visual change.
- Scope held: no speculative `<SegmentedControl>` abstraction, no UI kit (would collide with the
  `tokens.ts → theme.ts` system), and the correctly co-located single-use helpers (`SessionCard`,
  `HistoryRow`, `RatingRow`, `DetailRow`) were left where they live.

Supersedes and closes `docs/pending/04-dose-input-component.md`.

## Tolerant entry parsing + no destructive overwrite (2026-07-18)

**Problem:** For an app whose value is data that accretes over weeks, the read path could turn
one bad record into total loss. `isEntries`/`loadEntries` were all-or-nothing: a single
malformed day (a bug, a partial write, a hand-edited backup) failed the whole map and
`loadEntries` returned `{}` — indistinguishable from a fresh install. Then `saveCheckin` did
`loadEntries()` → merge one day → `saveEntries({ ...entries, [date]: merged })`, so the next
check-in **overwrote the entire `entries` blob with a single day**, destroying recoverable
history. `loadDoseChanges` had the same all-or-nothing shape.

**Decision:** Parse per-record and never clobber an unreadable store.

- `lib/storage.ts` gains `parseEntriesTolerant(raw): EntriesParse` (`{ entries, droppedKeys,
hardFailure }`) — keeps the days that pass `isDayEntry`, lists the keys it dropped, and flags
  `hardFailure` when the raw value isn't even an object.
- A private `loadEntriesRaw()` reads the raw string and distinguishes three cases: absent
  (`rawString === null`, genuinely empty), unparseable JSON or non-object (`hardFailure`), and
  parseable (tolerant per-day parse). `loadEntries()` keeps its signature and returns the
  survivors, so read-only screens (Today/History/Trends/Entry) are unchanged.
- `saveCheckin` now reads via `loadEntriesRaw()`: on `hardFailure` it **quarantines** the raw
  blob to `entries.corrupt.<isoTimestampNow()>` and **throws** (aborting the write) rather than
  merging onto `{}`; on a partial failure it quarantines the blob, then safely merges today's
  entry onto the survivors. The throw is swallowed by the check-in screen's existing `.catch`,
  so it degrades to "save didn't happen," no crash.
- `loadDoseChanges` filters per element (`raw.filter(isDoseChange)`) so one bad change doesn't
  wipe the dose timeline.
- The test-only async-storage mock gained `getAllKeys` (a real AsyncStorage API) to assert the
  quarantine key. Tests cover tolerant parse, hard-failure abort + quarantine, empty-store
  success, partial-merge survivorship, and dose-list drop.

**Non-goals honored:** no `{v:1, data}` schema-version envelope (the guards already tolerate
additive optional fields; deferred until metrics start changing) and no user-facing error
banner — the quarantine + no-clobber logic is the real protection. Supersedes and closes
`docs/pending/03-tolerant-entry-parsing.md`.

## Schema-drive the check-in write and detail-read paths (2026-07-18)

**Problem:** The check-in _render_ path was schema-driven and exhaustive (`renderMetric` in
`app/checkin.tsx` switches the `Metric` union, `default: assertNever`). But four other sites
hand-enumerated every evening rating key with nothing keeping them in sync: `draftFromEvening`
(re-hydrate on edit), `handleSave`'s evening branch (7 conditional spreads),
`app/entry/[date].tsx`'s 7 `RatingRow`s, and `lib/export.ts`'s `MORNING_ACCESSORS` /
`EVENING_ACCESSORS`. Because every `EveningCheckin` rating is optional and
`exactOptionalPropertyTypes` is on, a forgotten key produced **no compile error** — so the
`CLAUDE.md` / `lib/schema.ts` promise "add or rename a tracked metric in `lib/schema.ts` only"
was false: a new evening scale metric would render and be editable but be **silently dropped on
save**.

**Decision:** Derive all four sites from the schema key lists instead of hand-listing, without
changing the persisted JSON shape (no migration — the panel explicitly deferred a keyed
`ratings` record).

- New RN-free `lib/checkin.ts` owns `Draft`, `EMPTY_DRAFT`, `draftFromMorning`,
  `draftFromEvening`, and `eveningRatingsFromDraft` — the last two loop `EVENING_RATING_KEYS`
  rather than naming each field, assigning only defined values (respects
  `exactOptionalPropertyTypes`). `app/checkin.tsx` imports these; its evening `handleSave`
  collapses 7 spreads to `...eveningRatingsFromDraft(draft.ratings)`. The `assertNever` render
  switch is untouched.
- `lib/export.ts`: replaced the two per-key accessor maps with a single generic
  `ratingAccessor(session, key)` that does a keyed read (`row.morning?.[key]` /
  `row.evening?.[key]`), type-safe under `noUncheckedIndexedAccess`. The `RatingKey`-vs-session
  mismatch is resolved by narrowing through new/existing guards `isMorningRatingKey` /
  `isEveningRatingKey` (no casts). `computeScaleAverages` now takes a `Session`; `ratingAccessor`
  returns a total function (never `undefined`), so `app/(tabs)/trends.tsx` drops its redundant
  undefined checks.
- `lib/types.ts`: added `MORNING_RATING_KEYS` + `MorningRatingKey` (mirroring the evening const
  array) and derived `RatingKey = MorningRatingKey | EveningRatingKey` (same set as before).
- `app/entry/[date].tsx`: renders rating rows by mapping the schema (filtered to `kind: 'scale'`
  via a type-narrowing predicate) and reading through `ratingAccessor`. Evening rows show
  enabled metrics **plus** any disabled metric that still has data for that day — a refinement
  over the plan's "enabled only," so disabling a metric never hides previously-logged history.
- Tests: new `lib/__tests__/checkin.test.ts` round-trips every `EVENING_RATING_KEYS` entry
  (draft → checkin → draft) and asserts `eveningRatingsFromDraft` omits undefined keys; extended
  `export.test.ts` for the generic accessor. `lib/checkin.ts` added to the Vitest coverage set.

**Contract now true:** adding an evening scale metric in `lib/schema.ts` + `EVENING_RATING_KEYS`
makes it render, save, re-hydrate, show in the entry detail, and count in export averages with
no other file edited. Supersedes and closes `docs/pending/02-schema-driven-checkin-write-path.md`.

## Fix dose-restore data loss; extract `restoreBackup` (2026-07-18)

**Problem:** `handleImportJson` in `app/(tabs)/settings.tsx` restored a JSON backup but only
set the imported dose changes into React state (`setDoses`) — it never persisted them
(`saveDoseChanges` wasn't even imported). Profile and entries were written; doses were not. On
the next launch `loadDoseChanges` read the _old_ `doses` key, so all imported dose-change
history was silently lost — exactly the titration data a provider-facing restore exists to
recover — while the UI showed "Backup restored" regardless. Root cause: multi-key
data-integrity orchestration was hand-inlined in a screen, untested, and easy to get subtly
wrong.

**Decision:** Move the "write all three keys together" concern into the RN-free, unit-tested
storage layer and have the screen call it.

- Added `restoreBackup(backup: Backup)` to `lib/storage.ts`: writes profile + doses + entries
  via `Promise.all` (consistency-on-success; AsyncStorage has no real transactions and this is
  a single-user local-only app). A `null` profile is skipped, preserving the existing profile —
  matching the prior import UI's contract.
- `lib/storage.ts` imports `Backup` from `lib/export.ts` as a **type-only** import, so no
  runtime import cycle is introduced (`export.ts` already imports guards from `storage.ts`).
- `app/(tabs)/settings.tsx`'s `handleImportJson` now calls `await restoreBackup(result.value)`
  then `refresh()` (reloads from disk so the UI reflects what was actually persisted, instead
  of hand-setting `setDoses`/`updateProfile`). The "Backup restored" alert only fires on
  success. `saveEntries` is no longer imported here.
- Tests (`lib/__tests__/storage.test.ts`): `restoreBackup` persists all three keys; a `null`
  profile leaves the existing profile untouched; and a `buildBackup → restoreBackup → load*`
  round-trip returns equal data (the exact regression).

**Non-goals:** no schema-version envelope, no transactional/rollback guarantees beyond
`Promise.all`. Supersedes and closes `docs/pending/01-restore-backup.md`.

## Visual refresh + layered design tokens (2026-07-18)

**Problem:** The UI read as sterile/stock — fully flat, hairline borders everywhere, an
ad-hoc per-file type scale, raw `#FFFFFF` text literals on filled controls, and every
size/color hardcoded inline.

**Decision:** A "warm ink on deep paper" refresh built on a layered design-token system;
components consume only tokens, never raw literals.

- **Layer 1 — `lib/tokens.ts`** (pure data, no imports): `palette` (the only place raw
  hexes live — warm neutral ramp, pine accent ramp, rating hues), `space`, `radius`,
  `fontSize`, `fontWeight`, `letterSpacing`, `shadowPrimitive`.
- **Layer 2 — `lib/theme.ts`**: semantic tokens mapping primitives per color scheme
  (`Theme` gained `surfaceMuted`, `accentSoft`, `onAccent`, `controlKnob`); plus
  `typography` roles (incl. an uppercase letter-spaced `sectionLabel`), `shadows.card`,
  and re-exported `space`/`radius`. `useTheme()` resolves light/dark.
- **Layer 3 — component tokens**: encapsulated in shared primitives `components/Card.tsx`
  (soft shadow in light, hairline border in dark) and `components/Button.tsx`
  (primary/secondary/disabled), plus the restyled controls.
- Palette is warm/moody, accent is a deep pine green; selected chips/toggles use a tinted
  `accentSoft` fill rather than full-saturation accent; cards carry depth via soft shadow
  (light) with borders dropped.
- Root Stack header themed (was a jarring white bar on check-in/entry); check-in header
  shows the session's sun/moon icon.
- `lib/export.ts` PDF report derives its colors from the same Layer-1 `palette` so the
  report matches the app.
- Dark-mode contrast: switch thumb uses a light `controlKnob` in both modes; `surfaceMuted`
  was lightened so sunken fills/pills separate from cards.

## Colorize scale values on the day-detail history view (2026-07-18)

**Decision:** The day-detail view (`app/entry/[date].tsx`, opened by tapping a day in
History) now colors each scale value's text the same way Trends colors its sparkline
bars — green/red/neutral via `lib/theme.ts`'s `ratingColor`, based on the metric's
good/bad direction (`higher-better`/`lower-better`/`neutral`).

- Added `lib/schema.ts#directionForRatingKey(key)`: looks up a scale metric's direction
  by key from `MORNING_METRICS`/`EVENING_METRICS`, so the direction data stays declared
  once in the schema rather than duplicated in the view.
- `RatingRow` (local to `entry/[date].tsx`) now takes a `metricKey: RatingKey` prop
  alongside `label`/`value`, computes direction from it, and colors the value text
  accordingly; falls back to plain text color when there's no value or no resolvable
  direction.
- Scoped to this one view — the History tab's day list and the PDF report's tables are
  unaffected.

## Trends/reports reflect data, not the Settings toggle (2026-07-18)

**Problem:** Right after making evening metrics configurable (below), Trends and the PDF
report's "Evening averages" also respected the Settings on/off state — hiding a metric's
sparkline/average whenever it was currently toggled off, even if it had weeks of
historical data. That's backwards for a review page: turning a metric off should only
affect what the check-in _asks about going forward_, not what the history views show.

**Decision:** Trends and the report's "Evening averages" section now filter by whether a
metric has _any data in the currently selected range_, not by the Settings toggle.

- `app/(tabs)/trends.tsx` no longer loads `Profile` at all — it checks
  `rows.some((row) => accessor(row) !== undefined)` per metric instead.
- `lib/export.ts`'s `buildReportHtml` drops evening metrics with a `null` average
  (no data in range) from the table entirely, rather than showing them with a `'—'`.
- Morning metrics and the report's "Daily log" table are unaffected — out of scope.
- `app/checkin.tsx`/`app/(tabs)/settings.tsx` are unaffected — the Settings toggle still
  controls what the daily check-in form asks about.

This supersedes the "Trends hides a metric's sparkline entirely while it's disabled"
bullet in the entry below — that's no longer how Trends decides what to show.

## Configurable evening check-in metrics (2026-07-18)

**Problem:** The evening check-in forced 7 required mood/symptom ratings (mood, focus,
impulsivity, anxiety, energy, appetite, libido) every evening. Too much friction —
heaviest exactly when someone's had a rough day and is least in the mood for a long form.

**Decision:** Which of the 7 evening ratings are _active_ is now a per-profile setting
(`Profile.enabledEveningMetrics?: readonly EveningRatingKey[]`), adjustable anytime in
Settings, defaulting to a small base set out of the box.

- Default base set: **mood, focus, energy, anxiety**. Impulsivity, appetite, libido
  default off.
- Scope: evening only. Morning's 2 ratings (sleepQuality, wakingMood) stay always-required
  — already short, not worth the same treatment.
- `lib/schema.ts`'s `EVENING_METRICS` stays the full universe of all 7 possible
  metrics, unchanged — the profile setting is a filter on top, not a schema change. This
  preserves schema.ts's role as the single source of truth for what's trackable.
- The new `Profile` field is optional so already-onboarded profiles keep working without
  a forced re-onboarding step; absent means "use the default base set."
- `EveningCheckin`'s 7 rating fields became optional (previously all required) — which
  fields get recorded is now runtime-dependent (what was enabled that day), not a
  compile-time invariant.
- Disabling a metric never retroactively deletes historical data for it — the check-in
  screen simply stops rendering/requiring it going forward.
- The PDF export report stays unfiltered: it reflects whatever data actually exists in
  the date range regardless of current on/off state. Trends hides a metric's sparkline
  entirely while it's disabled (no point showing a permanently-empty row).
- The read-only day-detail view (`app/entry/[date].tsx`) was left untouched — it already
  renders `'—'` gracefully for any unanswered/disabled metric.

Full implementation plan (types/guards/UI touch points, file-by-file): see the
session's plan file if still present, or `git log` around this date for the commits
implementing it.
