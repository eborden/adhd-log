# Decisions since v0

Running log of design decisions made after [`PLANNING-v0.md`](PLANNING-v0.md), which is
frozen. Newest first.

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
