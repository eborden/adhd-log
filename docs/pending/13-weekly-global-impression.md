> **Status:** Proposed — pending implementation · **Priority:** P2 · Ref: analysis #4 · Panel-reviewed (4 lenses, approve-with-changes; must-fixes applied)

# Weekly global-impression check-in

## Problem / Context

The whole app is built around a weeks-long signal: a non-stimulant ADHD med accumulates
effect slowly, so the useful readout is the _trend_, not any single day. Yet every input we
collect today is a _daily_ artifact — `MorningCheckin`, `EveningCheckin`, per-day ratings
averaged into one grand mean in the report. Nothing captures the patient's own
_week-over-week_ sense of change, which is exactly the axis a provider titrates against.

Clinicians already have a standard instrument for this: the Patient Global Impression of
Change (PGI-C) / Clinical Global Impression – Improvement (CGI-I) — a single self-rated
"compared to before, overall, are you better / the same / worse?" It is deliberately coarse,
takes five seconds, and is the kind of summary a provider can act on. We have the daily
granular data but no place for the patient to say "last week, on the whole, I was doing better
than the week before." That is a concrete gap for a weeks-long titration story, and it is a
_new cadence_ of periodic update — squarely inside the mission (collect → log → provider).

## Goals / Non-goals

**Goals**

- Add a lightweight, once-per-week self-rating of overall change: better / same / worse, plus
  an optional free-text note.
- Rate **the ISO week that just concluded** (Monday-start), not the week in progress, so every
  logged row summarizes a fully-elapsed, comparable window (see Data model → temporal referent).
- Surface it as a low-friction, non-nagging affordance on Today and (optionally) a weekly
  reminder; never block the daily loop.
- Carry it through storage guards, JSON backup, and the PDF report as a descriptive timeline —
  including the two confounders a provider needs beside a self-rating: that week's **dose-taken
  adherence** and any **dose change** that fell inside the week.

**Non-goals**

- No scoring, no interpretation, no "you're trending up, consider X." The report shows the
  self-ratings the patient entered, the adherence count already collected, and the dose-change
  timeline already collected — and nothing derived from them.
- Not the 7-point CGI-I scale — a 3-way union (better/same/worse) is deliberate: coarser is
  easier to answer honestly week after week and harder to over-read. (See Alternatives.)
- No back-fill UI for missed weeks in v1 (only the most-recently-completed week is offered from
  Today). Historical weeks are never fabricated.
- No domain-specific weekly scale (e.g. "mood better, focus worse"). PGI-C is deliberately
  global; a structured domain tag on the note is a possible follow-on (Alternatives), not v1.
- Does not touch daily check-in data shapes or averaging.

## Mission fit & guardrails

- **Collect → log → provider.** This is a new collection cadence feeding the same log and the
  same provider-facing export. It adds no new _kind_ of surface — it shows what the patient
  said and defers all meaning.
- **Descriptive, not interpretive.** `WeeklyCheckin` is the patient's own word for their own
  week. The report renders it verbatim, sits it next to the adherence and dose-change facts
  already in the data (so the provider — not the app — can weigh confounders), never derives a
  verdict, and the copy stays "log this and discuss with your provider."
- **Local-only preserved.** New data lives under a new AsyncStorage key `"weekly"`; it leaves
  the device only through the same user-initiated PDF/JSON exports as everything else.
- **Never blocks the daily loop.** The Today affordance is a low-weight, self-persisting card
  that never gates the daily flow (see UI touch points → persistence), and the reminder is
  opt-in and off by default.

## Data model

Add to `lib/types.ts`. `WeeklyImpression` is a literal union; `WeeklyCheckin` is a small
record of branded/union values so illegal states (a rating that isn't one of the three, a
`weekOf` that isn't a canonical Monday) are unrepresentable.

```ts
/** Patient Global Impression of Change, coarse 3-way. Order is worse→better for rendering. */
export const WEEKLY_IMPRESSIONS = ['worse', 'same', 'better'] as const;
export type WeeklyImpression = (typeof WEEKLY_IMPRESSIONS)[number];

/**
 * A once-per-week self-rating of overall change vs. the immediately preceding week.
 * `weekOf` is the Monday (ISO week-start) of the week being rated and is the map key in
 * storage — one entry per week. The rated week is always fully elapsed at capture time.
 */
export interface WeeklyCheckin {
  readonly weekOf: IsoDate;
  readonly overall: WeeklyImpression;
  readonly note?: string;
  readonly completedAt: IsoTimestamp;
}
```

`note` is optional with `exactOptionalPropertyTypes` on, so the field is either absent or a
`string` — never `undefined`. Constructing a `WeeklyCheckin` uses the same conditional-spread
idiom the check-in screen already uses for evening ratings, so we never assign
`note: undefined`:

```ts
const draftNote = note.trim();
const checkin: WeeklyCheckin = {
  weekOf,
  overall,
  completedAt: isoTimestampNow(),
  ...(draftNote.length > 0 ? { note: draftNote } : {}),
};
```

The three-way answer is a literal union rather than a `Rating`, because it is a categorical
judgment, not a 1–5 scale, and reusing `Rating` would let it flow into `ratingColor` /
averaging machinery where it has no meaning.

**Temporal referent (the week rated is the one that just ended).** `weekOf` is _not_
`weekStart(today)` — that would file a rating under the week _containing_ today, which on a
Monday or Tuesday is a barely-started window. A provider reading a sequence of weekly rows
assumes each summarizes a _completed_ week, and the whole feature exists to produce a clean
week-over-week trend. So the Today card and the reminder both key to the **most recently
completed ISO week** via `lastCompletedWeekStart(today)` (Storage). On any day of the current
week that value is stable, so the rating always describes a fully-elapsed Monday–Sunday
window, and rows are comparable to one another.

**Anchor is relative, and the copy says so.** This variant deliberately anchors each rating to
the _immediately preceding week_, not to pre-treatment baseline or the last dose change. A
sequence of relative deltas (worse, better, better, same…) cannot by itself reconstruct net
position vs. baseline. `app/weekly.tsx` copy and the report caption both state this in one
line ("compared with the week before — not your starting point") so the descriptive contract
stays honest about what the sequence can and can't tell a clinician.

**Last-write-wins, current cycle only (intended).** `saveWeeklyCheckin` upserts by `weekOf`,
so editing an answer before it scrolls out of reach overwrites that week's `overall` /
`note` / `completedAt`. This is intended and mirrors editing today's daily check-in: the card
only ever offers the single most-recently-completed week, so a save never mutates a
_historical_ (already-superseded) week. No edit-audit-trail is in scope.

## Schema

**n/a for the `Metric` union.** The weekly check-in is a separate cadence with a single field
(`overall`) plus a note; it does not render through the daily `MORNING_METRICS` /
`EVENING_METRICS` engine and must not be added to it (doing so would drag a `WeeklyImpression`
into `RatingKey`/`ratingAccessor` paths that assume `Rating`). It gets its own tiny
presentation.

We add one label map to `lib/schema.ts`, mirroring `SIDE_EFFECT_LABELS`, as the single source
of truth for user-facing strings (consumed by the card, the picker, and the report). Note the
**type-only** import — `WEEKLY_IMPRESSION_LABELS` never references the `WEEKLY_IMPRESSIONS`
value, and importing the value here would trip `noUnusedLocals` / `no-unused-vars` under
`--max-warnings 0`. The runtime iteration of the impressions lives in the picker /
`app/weekly.tsx`, which imports the value there:

```ts
import type { WeeklyImpression } from './types';

export const WEEKLY_IMPRESSION_LABELS: Readonly<Record<WeeklyImpression, string>> = {
  worse: 'Worse than the week before',
  same: 'About the same',
  better: 'Better than the week before',
};
```

## Storage & guards

Add a new key and helpers to `lib/storage.ts`. Nothing here mutates existing keys.

**`weekStart` helper (pure, tested).** Monday-start ISO week, derived from an `IsoDate` via the
existing `parseIsoDate` / `addDays` guard-and-throw pair (no `as`, no `!`):

```ts
/** Monday-start ISO week containing `date`, as an IsoDate. Pure. */
export function weekStart(date: IsoDate): IsoDate {
  const d = parseIsoDate(date); // Date at local midnight of `date`
  const dow = d.getDay(); // 0=Sun..6=Sat
  const deltaToMonday = dow === 0 ? -6 : 1 - dow; // Sun→prev Mon, else back to Mon
  return addDays(date, deltaToMonday);
}

/** Monday of the most recently *completed* ISO week (the week before the one containing `today`). */
export function lastCompletedWeekStart(today: IsoDate): IsoDate {
  return addDays(weekStart(today), -7);
}
```

`addDays` already returns a branded `IsoDate` by guarding, so neither helper mints a brand
itself.

**Guards returning through the `Parsed<T>` boundary.** `isWeeklyCheckin` closes the
architect's loophole: a structurally valid record whose `weekOf` is _not_ a canonical Monday
(e.g. from a hand-edited backup) would otherwise pass every guard yet be an illegal state, so
we reject it at the same boundary using `weekStart`:

```ts
export function isWeeklyImpression(value: unknown): value is WeeklyImpression {
  return typeof value === 'string' && (WEEKLY_IMPRESSIONS as readonly string[]).includes(value);
}

export function isWeeklyCheckin(value: unknown): value is WeeklyCheckin {
  if (!isRecord(value)) return false;
  const weekOf = value['weekOf'];
  if (!isIsoDate(weekOf)) return false;
  if (weekStart(weekOf) !== weekOf) return false; // must be a Monday week-start
  if (!isWeeklyImpression(value['overall'])) return false;
  if (!isIsoTimestamp(value['completedAt'])) return false;
  const note = value['note'];
  return note === undefined || typeof note === 'string';
}

/** Guard for the "weekly" store: Readonly<Record<IsoDate, WeeklyCheckin>>. */
export function isWeeklyRecord(value: unknown): value is Readonly<Record<IsoDate, WeeklyCheckin>> {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([key, entry]) => isIsoDate(key) && isWeeklyCheckin(entry) && entry.weekOf === key,
  );
}
```

Named `isWeeklyRecord` (not `isWeekly`) for consistency with the codebase's collection guards
`isEntries` / `isDoseChangeList`. `isWeeklyRecord` enforces the invariant that the map key
equals `entry.weekOf`, so a corrupted export can't produce a mis-filed week.
`parseWeekly(raw): Parsed<Readonly<Record<IsoDate, WeeklyCheckin>>>` wraps `isWeeklyRecord`
exactly like the existing `parseEntries`.

**Load/save + upsert**, mirroring `saveCheckin`:

```ts
export async function loadWeekly(): Promise<Readonly<Record<IsoDate, WeeklyCheckin>>> { … }
export async function saveWeekly(weekly: Readonly<Record<IsoDate, WeeklyCheckin>>): Promise<void> { … }

/** Insert or replace the entry for its own week; other weeks untouched. */
export async function saveWeeklyCheckin(checkin: WeeklyCheckin): Promise<void> {
  const weekly = await loadWeekly();
  await saveWeekly({ ...weekly, [checkin.weekOf]: checkin });
}
```

`clearAllData` gains `"weekly"` in its `AsyncStorage.multiRemove` list — the same explicit,
user-initiated full-wipe already applied to every other key, not silent data loss.

**Backward compatibility (mandatory).**

- The key is brand-new. Any device upgrading from a version without it: `loadWeekly` sees
  `null` from AsyncStorage and returns `{}` — no migration, no re-onboarding.
- **`Profile` gains exactly one optional field** (`weeklyReminder?: TimeOfDay`, see
  Notifications), so no forced re-onboarding — the `enabledEveningMetrics` precedent shows
  `isProfile` already tolerates optional additions. (Stated precisely here to correct any
  reading of "Profile is unchanged"; it changes, but additively and back-compatibly.)
- Historical `"entries"`, `"doses"`, `"profile"` are never read-modified by this feature.
- No shape _changes_ to an existing key, so no migrate-on-read is required. If a future version
  changes `WeeklyCheckin`, the `parseWeekly` guard is the migrate-on-read seam (return
  `{ ok: false }` → caller treats as empty rather than crashing), consistent with the rest of
  storage.

## UI touch points

The weekly check-in is intentionally **not** wired through the generic daily seams, so the
fragile non-generic edits are avoided.

- **`app/checkin.tsx` — untouched.** The daily `renderMetric` switch, `Draft` shape,
  `handleSave` spreads, and `draftFrom*` hydration are _not_ modified. We do **not** add a
  `Metric` variant, so the `default: assertNever(metric)` arm stays intact and no new Draft
  field / switch arm / spread / hydration line is needed. (This is the seam the spec warns is
  non-generic; we sidestep it entirely by keeping weekly a separate cadence.)
- **New route `app/weekly.tsx`** (peer of `app/checkin.tsx`): a small screen with three large
  choice buttons driven by `WEEKLY_IMPRESSIONS` + `WEEKLY_IMPRESSION_LABELS`, an optional notes
  `TextInput`, and a single **Save** button — tap a choice, then Save, matching the existing
  tap-then-save pattern; **no** confirmatory dialog is added for a values-only change.
  Computes `weekOf = lastCompletedWeekStart(todayIsoDate())`. Header/subhead copy names the
  concrete window ("How was last week (Mon DD–Mon DD)?") and states the relative anchor.
  Hydrates from any existing entry for that week (edit-in-place). Fully local component state;
  no shared Draft machinery.
- **`app/(tabs)/index.tsx` (Today)** — the one required edit. Add a `WeeklyCard` **below** the
  two `SessionCard`s so it never precedes or crowds the primary daily action. Load `weekly`
  alongside the existing entries load and key on `lastCompletedWeekStart(todayIsoDate())`.
  - **Persistence (must-specify).** The card is **not** a dismiss-button affordance whose state
    lives only in memory (that would re-nag on every cold start — Today opens ≥ twice a day —
    stacking a dismiss-tap onto the screen that gates the daily loop). Instead it is a
    **low-weight, self-resolving** card: while the completed week is unlogged it shows as a
    single quiet prompt row (no dismiss chrome) that simply sits there until answered; once
    logged it collapses to a minimal single-line "Last week: {label}" summary with a small edit
    affordance, receding to near-invisible so the daily SessionCards stay the star. There is
    nothing to "dismiss," so nothing can nag.
- **New `components/WeeklyImpressionPicker.tsx`** (thin, presentational): three segmented
  buttons, value `WeeklyImpression | null`, `onChange`. Consumes `theme` tokens (`accent`,
  `surface`, `border`, `text`), never raw hex.
- **`app/(tabs)/trends.tsx` — untouched in v1.** Trends renders `Rating` bars; weekly
  impressions are categorical and would need a distinct row treatment. Deferred (open question).
- **`app/entry/[date].tsx` — untouched.** This screen is per-day; weekly data is per-week and
  has no per-day detail row. No hard-coded `RatingRow` edits.
- **`app/(tabs)/history.tsx` — untouched** in v1 (optional future: interleave weekly markers).

Net: exactly one existing screen (`Today`) is edited; everything else is additive files. The
known non-generic seams (`checkin.tsx` five-point edit, `entry/[date].tsx` hard-coded rows) are
explicitly _not_ touched.

## Export / report

`lib/export.ts` gains a descriptive **Weekly impression timeline** section and the `Backup`
shape grows one field. `lib/export.ts` stays RN-free — it imports `palette` from `./tokens`
directly and never `useTheme()` (a React hook that cannot run outside a component and would
break the RN-free Vitest specs).

- **Backup:** extend `Backup` to `{ exportedAt; profile; doses; entries; weekly }`.
  `buildBackup` now also serializes `loadWeekly()` output; `parseBackup` parses `weekly` through
  `parseWeekly` and, for backward compatibility with pre-feature backups, treats a **missing**
  `weekly` key as `{}` (present-but-malformed still fails the parse). `importJsonBackup` writes
  it via `saveWeekly`. Any future doc adding a top-level `Backup` field should reuse this same
  missing-key-tolerant pattern.
- **Two pure, tested confounder helpers** (RN-free, in coverage scope), so the provider sees
  adherence and titration context _beside_ each self-rating without cross-referencing lists:

  ```ts
  /** Dose-taken adherence over the 7 dates of the ISO week starting `weekOf`. */
  export function weeklyAdherence(
    entries: Readonly<Record<IsoDate, DayEntry>>,
    weekOf: IsoDate,
  ): { readonly taken: number; readonly logged: number } {
    let taken = 0;
    let logged = 0;
    for (let i = 0; i < 7; i += 1) {
      const entry = entries[addDays(weekOf, i)]; // DayEntry | undefined (narrowed below)
      const morning = entry?.morning; // MorningCheckin | undefined
      if (morning !== undefined) {
        logged += 1;
        if (morning.doseTaken) taken += 1;
      }
    }
    return { taken, logged };
  }

  /** The first dose change (if any) whose date falls within the ISO week starting `weekOf`. */
  export function doseChangeInWeek(
    doses: readonly DoseChange[],
    weekOf: IsoDate,
  ): DoseChange | undefined {
    const weekEnd = addDays(weekOf, 6);
    return doses.find((change) => change.date >= weekOf && change.date <= weekEnd);
  }
  ```

  `doseTaken` is already collected on `MorningCheckin` but is _not_ in the daily-log table
  today, so without this it would be invisible next to the exact row meant to summarize the
  week — the single biggest confounder for a titration read. `weeklyAdherence` surfaces it as
  "N/7 logged, M taken." (IsoDate string comparison in `doseChangeInWeek` is safe — ISO dates
  sort lexicographically.)

- **Report HTML:** add `buildWeeklyTimelineHtml(weekly, entries, doses)` producing a table
  sorted by `weekOf` ascending, columns:
  - **Week of** — the `weekOf` IsoDate.
  - **Overall** — the `WEEKLY_IMPRESSION_LABELS[overall]` string plus a **neutral** glyph chip
    (below).
  - **Adherence** — `weeklyAdherence` rendered "M/N doses" (or "—" when nothing logged).
  - **Dose change** — the new dose from `doseChangeInWeek` when one fell in that week, else
    blank — aligning the impression with the titration event that may explain it.
  - **Note** — the free text.

  Every dynamic value passes through the existing `escapeHtml`. The section is dropped entirely
  when `weekly` is empty (same pattern as null-average metric rows).
  `buildReportHtml(profile, doses, rows, weekly, entries)` gains the `weekly` and `entries`
  arguments and inserts this section after the dose-change list and before the daily-log table.
  (If another doc in this set also extends `buildReportHtml`, land the signature change in one
  pass.)

- **Neutral encoding, not the rating hues.** The chip does **not** reuse the app's
  good/bad/neutral rating palette (green/clay/ochre) — that would quietly stamp a value
  judgment on the patient's own subjective report, in tension with the descriptive contract.
  Instead all three impressions share a single neutral accent (`palette.pineStrong` on
  `palette.warm100`, text `palette.warm900`) and are distinguished only by a directional glyph
  (`worse ▼ / same ▬ / better ▲`) chosen by an exhaustive switch:

  ```ts
  function impressionGlyph(overall: WeeklyImpression): string {
    switch (overall) {
      case 'worse':
        return '▼';
      case 'same':
        return '▬';
      case 'better':
        return '▲';
      default:
        return assertNever(overall);
    }
  }
  ```

  Colors are read from `palette` in `./tokens` directly (mirroring `buildReportHtml`'s existing
  `palette.warm900` / `palette.pineStrong` style block), never via `theme.*`. No numeric score
  is printed. The section caption reads: "Self-rated, each week compared with the week before —
  not your starting point. Discuss trends with your provider."

- **Why weekly notes are in the report while daily `EveningCheckin.notes` still aren't.** This
  is deliberate, not an oversight to "fix": the weekly note is the _only_ free text attached to
  this coarse global rating and is the thing a provider most needs to read alongside it, whereas
  daily notes are high-volume and out of scope for the current report design. Both are escaped
  identically; a future change to daily-note export must apply the same `escapeHtml` care —
  don't reconcile the two by stripping escaping.

- Averaging machinery (`averageOf`, `ratingAccessor`, `MORNING/EVENING_ACCESSORS`) is
  untouched — weekly data is categorical and never averaged.

## Notifications

Optional, opt-in weekly reminder in `lib/notifications.ts`.

- Add one optional profile field so scheduling is driven by stored state (optional → no forced
  re-onboarding, `isProfile` extended exactly like `enabledEveningMetrics`):
  `readonly weeklyReminder?: TimeOfDay` plus an implicit "enabled = field present." Absent field
  = no weekly reminder (default off). Guard line:
  `weeklyReminder === undefined || isTimeOfDay(weeklyReminder)`.
- `scheduleReminders(profile)` gains a third `WEEKLY` trigger only when `weeklyReminder` is set:
  a weekly `Calendar` trigger on **Monday morning**, with a **fixed** ID (`'adhd-log-weekly'`)
  on the existing `'adhd-log-reminders'` Android channel, `data: { kind: 'weekly' }`. Monday
  morning is chosen deliberately over "any day": the card and reminder both rate the week that
  _just concluded_ (Sunday), so Monday is "how was last week?" asked when that week is complete
  — the opposite of the original design's flaw (asking to characterize a barely-started week).
  The reminder copy is explicitly "How was last week overall?"
- **Scheduling nit:** the weekly trigger must not fire at the same time as either daily reminder
  — the implementer should offset it (or validate against `morningReminder` / `eveningReminder`)
  so two notifications don't compete in one moment.
- `cancelReminders()` cancels the weekly ID too.
- **Tap routing** — spell out the guard shape so a future implementer doesn't reach for
  `data?.kind as 'weekly'` (banned under `noPropertyAccessFromIndexSignature` + no-`as`). Add,
  mirroring `sessionFromResponse` / `isSession`:

  ```ts
  function isWeeklyNotificationKind(value: unknown): value is 'weekly' {
    return value === 'weekly';
  }

  export function notificationKindFromResponse(
    response: Notifications.NotificationResponse,
  ): 'weekly' | null {
    const data = response.notification.request.content.data;
    if (!isRecord(data)) return null;
    return isWeeklyNotificationKind(data['kind']) ? 'weekly' : null;
  }
  ```

  The tap listener routes `'weekly'` → `app/weekly.tsx` and otherwise falls back to
  `sessionFromResponse` for the daily path (unchanged), without overloading `Session`.

## Test plan

All logic under test lives in RN-free `lib/` modules already in the coverage scope
(`lib/{types,schema,storage,export}.ts`). Tests import `{ describe, it, expect }` from
`'vitest'`, narrow unions instead of asserting, and use the sanctioned `as IsoDate` /
`as IsoTimestamp` literal idiom for fixtures only.

`lib/__tests__/weekly.test.ts` (new):

- **`weekStart`**: Monday maps to itself; Tuesday–Sunday map back to that week's Monday; Sunday
  maps to the _previous_ Monday (the `dow === 0` branch); a month/year boundary
  (`'2026-01-01' as IsoDate`, a Thursday → `'2025-12-29'`) confirms `addDays` crosses correctly.
  Idempotent: `weekStart(weekStart(d)) === weekStart(d)`.
- **`lastCompletedWeekStart`**: returns the Monday exactly 7 days before `weekStart(today)`;
  stable across every day of the current week (Mon–Sun all yield the same prior Monday); crosses
  a year boundary correctly.
- **`isWeeklyImpression`**: accepts `'worse'|'same'|'better'`; rejects `'improved'`, `3`,
  `null`, `undefined`.
- **`isWeeklyCheckin`**: accepts full and note-less fixtures; rejects wrong `overall`, missing
  `weekOf`, non-string `note`, bad `completedAt`, **and a structurally valid but non-Monday
  `weekOf`** (the canonical-week-start check).
- **`isWeeklyRecord`**: accepts `{}` and a valid map; **rejects a map whose key ≠ `entry.weekOf`**
  (the invariant), rejects a non-record, rejects a map with one bad entry.
- **`parseWeekly`**: `{ ok: true }` on valid JSON; `{ ok: false, reason }` on malformed — assert
  by narrowing on `result.ok`, never by asserting `.value`.
- **`saveWeeklyCheckin`** (against the AsyncStorage mock in `lib/__mocks__/`): upsert replaces the
  same week and leaves other weeks untouched.

`lib/__tests__/export.test.ts` (extend):

- **`weeklyAdherence`**: counts `taken`/`logged` over the 7 in-week dates; ignores days with no
  morning check-in; `taken === 0` when doses were logged but not taken; `{ taken: 0, logged: 0 }`
  for an empty week (exercises the `morning === undefined` branch).
- **`doseChangeInWeek`**: returns a change on the week's Monday, on its Sunday (inclusive
  boundaries), and `undefined` for a change one day outside either edge.
- **`buildWeeklyTimelineHtml`**: emits exact substrings — the `WEEKLY_IMPRESSION_LABELS` text,
  the `weekOf` date, the "M/N" adherence figure, the in-week dose value, and an escaped note
  containing `<script>` rendered inert (assert the escaped form appears and the raw tag does
  not). Empty `weekly` → section omitted (assert the heading substring is absent).
- **`impressionGlyph`** exhaustiveness is enforced by the compiler (`assertNever`); a test
  asserts each arm returns its glyph.
- **`buildBackup`/`parseBackup`**: round-trips `weekly`; a legacy backup object **without** a
  `weekly` key parses to `weekly: {}` (backward-compat branch).

Coverage: every new branch (the `dow === 0` path, `lastCompletedWeekStart`, the note
present/absent spread, the canonical-week-start rejection, each guard false-branch, the
adherence `undefined`/taken branches, the dose-in-week boundaries, empty-vs-nonempty report
section) is exercised, keeping lines/statements/functions ≥ 90 and branches ≥ 85.

## Gate compliance

- **No `any` / unsafe-any:** guards take `unknown` and narrow via `isRecord` + bracket-notation
  index access (`value['weekOf']`), the established pattern; the `as readonly string[]` on
  `WEEKLY_IMPRESSIONS` inside `isWeeklyImpression` is the same `.includes` idiom already used for
  `SIDE_EFFECTS` — an assertion of a compatible type, exempt under `--ignore-as-assertion`, not
  an `any`.
- **No unused imports:** `lib/schema.ts` imports `type WeeklyImpression` only; the value
  `WEEKLY_IMPRESSIONS` is imported where it's iterated (picker / `app/weekly.tsx`) — no
  `noUnusedLocals` / `no-unused-vars` failure.
- **No non-null `!`:** `weekStart` / `lastCompletedWeekStart` use guarded `parseIsoDate` /
  `addDays`; map lookups (`weekly[lastCompletedWeekStart(...)]`, `entries[…]`) yield
  `… | undefined` under `noUncheckedIndexedAccess` and are narrowed with explicit `undefined`
  checks (`entry?.morning`, `if (morning !== undefined)`), never asserted.
- **No `@ts-ignore` / `eslint-disable`:** none needed; every value is modeled.
- **RN-free `lib/export.ts`:** chip colors come from `palette` in `./tokens` directly, never
  `useTheme()` — no rules-of-hooks violation, and the Test Plan's plain-Vitest specs run.
- **Branded values** minted only by existing guard-and-throw helpers (`addDays`, `formatIsoDate`,
  `isoTimestampNow`); no `as IsoDate` outside test fixtures.
- **Exhaustive switches:** `impressionGlyph` ends in `default: return assertNever(overall)`, so
  widening `WEEKLY_IMPRESSIONS` fails to compile until handled. We add **no** `Metric` variant,
  so `checkin.tsx`'s existing `assertNever(metric)` stays green.
- **exactOptionalPropertyTypes:** `note` and `weeklyReminder` are set via conditional spread /
  optional field, never assigned `undefined`.
- **type-coverage 100%:** all new symbols are fully typed; no implicit `any`.

## Dependencies & sequencing

- **Independent core.** The data model, `weekStart` / `lastCompletedWeekStart`, guards, storage,
  and the Today card depend on nothing beyond current `lib/`.
- **Report section** depends on the `buildReportHtml(profile, doses, rows, weekly, entries)`
  signature; if another doc also extends that signature (e.g. adding notes/side-effect severity),
  coordinate the argument list and land the export changes in one pass to avoid churn.
- **Backup format** bump: any doc adding a new top-level `Backup` field should share the single
  `parseBackup` missing-key-tolerant pattern established here.
- **Enables**: a future "weekly trends row" in `trends.tsx` and a provider-facing "impression vs.
  dose change" overlay (both out of scope here) build directly on the `"weekly"` store and the
  `doseChangeInWeek` helper.
- No dependency on the notifications piece — the reminder is an optional follow-on and can ship
  after the card.

## Alternatives considered / open questions

- **7-point CGI-I instead of 3-way.** Rejected for v1: the finer scale invites over-reading a
  single week and is harder to answer consistently. The 3-way union keeps it honest and the
  report descriptive. Revisitable by widening `WEEKLY_IMPRESSIONS` (the exhaustive switch will
  force every consumer to update).
- **Reuse `Rating` (1–5) for the weekly answer.** Rejected: it would let weekly values flow into
  `ratingColor`/averaging where "compared to last week" has no meaning; a dedicated literal union
  keeps the two cadences type-separated.
- **Store under `"entries"` as a third session.** Rejected: `DayEntry` is per-calendar-day and
  keyed by day; a week key would violate its invariants and force edits to the fragile daily
  seams. A separate `"weekly"` map keeps `checkin.tsx`/`entry/[date].tsx` untouched.
- **Rate the week _in progress_ (original design).** Rejected on the clinical panel's must-fix:
  it let a patient rate a barely-started week and produced non-comparable rows. We rate the most
  recently completed week (`lastCompletedWeekStart`) with a Monday-morning "how was last week?"
  reminder. This also obviates the UX suggestion to hide the card early in the week — the rated
  window is fully elapsed from day one, so there's no "no basis yet" period to suppress.
- **Color-coded chips (green/clay/ochre).** Rejected: reusing the rating hues stamps a value
  judgment on the patient's own self-report. We use a neutral accent + directional glyph instead.
- **Domain-tagged note** (which domain drove the change: mood/focus/…). Deferred as a possible
  light follow-on; it must not reopen the explicit non-goal of a domain-specific weekly scale.
- **Crisis-safety copy on free text.** The `note` field (like `EveningCheckin.notes`) could hold
  concerning content that won't reach a provider until the next export. We add a single quiet,
  non-alarming footer line near the note input pointing to appropriate non-emergency/crisis
  resources. This is an app-wide gap, not introduced here; the same line should be applied to the
  existing daily notes field rather than being solved only for this entry point.
- **Open — week boundary:** Monday-start ISO week is assumed. A Sunday-start or "weeks since
  `startDate`" framing would change only `weekStart` (single point of change).
- **Open — trends visualization:** rendering categorical better/same/worse over time (colored
  dots on a week axis vs. a stepped line) is deferred; v1 ships table-only in the report.
- **Open — missed-week back-fill:** v1 offers only the most-recently-completed week from Today.
  Letting the patient log an earlier skipped week is deferred; the storage/guard layer already
  supports any valid `weekOf`, so it's a UI-only follow-on.

## Panel review

### Clinical / behavioral-health measurement — approve-with-changes

- **Adherence context (must-fix):** applied. Added the pure, tested `weeklyAdherence(entries, weekOf)` helper and an **Adherence (M/N doses)** column to `buildWeeklyTimelineHtml`, surfacing the already-collected `doseTaken` field beside each self-rating so a "worse week" can be read against missed doses.
- **Temporal referent + reminder timing (must-fix):** applied via option (a). The card and reminder now rate **the week that just concluded** (`lastCompletedWeekStart`), the reminder fires **Monday morning** framed "how was last week?", and `weekOf` is stable across the current week so every row summarizes a completed, comparable window.
- **Relative-anchor caveat (suggestion):** applied. `app/weekly.tsx` copy and the report caption state ratings are vs. the immediately preceding week, not baseline.
- **Dose-change/impression linkage (suggestion):** applied. Added `doseChangeInWeek` and a **Dose change** column so titration events sit beside the impression they may explain.
- **Neutral color encoding (suggestion):** applied. Chips drop the good/bad rating hues for a single neutral accent plus a directional glyph.
- **Crisis safety-net (suggestion):** applied at the doc level — a quiet non-emergency/crisis footer line by the note field, flagged as an app-wide fix for `EveningCheckin.notes` too.
- **Domain-tagged note (suggestion):** noted as an explicit deferred follow-on; not built in v1.

### Strict-TypeScript architect — approve-with-changes

- **Unused `WEEKLY_IMPRESSIONS` import (must-fix):** applied. `lib/schema.ts` now imports `type WeeklyImpression` only; the value is imported where it's iterated.
- **`theme.*` colors in RN-free `lib/export.ts` (must-fix):** applied. Chip colors read from `palette` in `./tokens` directly (mirroring `buildReportHtml`); no `useTheme()`.
- **Canonical-`weekOf` guard (suggestion):** applied. `isWeeklyCheckin` rejects a `weekOf` where `weekStart(weekOf) !== weekOf`.
- **Guard naming (suggestion):** applied. `isWeekly` → `isWeeklyRecord`, consistent with `isEntries`/`isDoseChangeList`.
- **`notificationKindFromResponse` guard shape (suggestion):** applied. Spelled out `isWeeklyNotificationKind` + bracket-notation access, no `as`.

### Mobile UX / friction & completion — approve-with-changes

- **WeeklyCard persistence (must-fix):** applied. The card is a low-weight self-resolving affordance with no dismiss chrome — it sits quietly until answered, then collapses to a minimal one-line summary; it cannot nag on cold start.
- **Hide card early in week (suggestion):** not applied, with reason noted — the temporal redesign means the card always rates a fully-elapsed week, so there is no "no basis yet" period to suppress.
- **Minimal post-completion summary (suggestion):** applied (single-line, near-invisible).
- **No confirmatory dialog (suggestion):** applied — explicit tap-then-Save, no dialog.
- **Reminder time collision (suggestion):** applied — noted the weekly trigger must be offset from the daily reminders.

### Data-model / migration + privacy + scope — approve

- **Weekly-notes-vs-daily-notes rationale (suggestion):** applied — added a sentence on why weekly notes are exported while daily notes stay out, with a caution to preserve escaping.
- **Last-write-wins scoping (suggestion):** applied — Data model states last-write-wins for the current cycle only, never a historical week, no audit trail.
- **"Profile unchanged" phrasing (suggestion):** applied — corrected to "Profile gains one optional field," back-compat via the `enabledEveningMetrics` precedent.

All lenses approve-with-changes; must-fixes applied.
