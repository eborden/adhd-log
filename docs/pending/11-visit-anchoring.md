> **Status:** Proposed — pending implementation · **Priority:** P1 · Ref: analysis #16

# Visit anchoring & "since last visit"

## Problem / Context

The whole point of this app is that a non-stimulant ADHD med accumulates over weeks and the
signal is the _trend_ — but the trend only becomes actionable at a **provider visit**. Right
now the app has no concept of an appointment. The three mission pillars (collect → log →
hand to provider) are anchored to nothing: the report always spans a rolling window
(`RANGE_OPTIONS = [7,14,30]`), which rarely lines up with the real question the provider asks —
_"how have you been since I last saw you?"_

Concretely:

- A user seen 23 days ago can't pull a report scoped to "since that visit" without counting
  days and hoping 30 is close enough.
- The **first** titration follow-up — the single highest-stakes visit, because 4–6 weeks of
  accumulation is exactly what the prescriber needs summarized — has no prior visit to anchor
  to at all, and today falls back to an arbitrary rolling window.
- There's no artifact tying a dose change (`DoseChange`) to the appointment that prompted it,
  so the timeline the provider reads is missing its own inflection points.
- Users forget to export the report before the appointment — the data exists on-device but
  never makes it into the room.

A `Visit` record — just a date and an optional note — is the smallest primitive that fixes all
three. It mirrors the existing `DoseChange` pattern exactly, so it costs almost no new concept
surface, and it unlocks a report range preset, an export-reminder nudge, and optional trend
markers. Where no prior visit exists, the same preset falls back to anchoring on
`profile.startDate` ("since starting the medication") so the first follow-up is never left
without a meaningful scope.

## Goals / Non-goals

**Goals**

- Persist appointment dates as `readonly Visit[]` under a new `"visits"` AsyncStorage key,
  following the `DoseChange` blueprint (guards, `parse`, sorted append, absent-key ⇒ `[]`).
- Settings UI to add, list, and **delete** visits, structurally identical to the dose-change
  log plus a delete affordance the reminder wiring requires.
- Provide `sinceLastVisitRange(visits, today, startDate)` as pure, tested `lib/` logic that
  the report overhaul (doc 01) consumes for a "Since last visit" / "Since starting" preset.
  It **always** returns a range — never `null` — anchoring on `startDate` when there is no
  past visit.
- Provide `adherenceInRange(rows)` as pure, tested `lib/` logic so the scoped provider report
  can surface a descriptive medication-adherence summary (doses taken vs. logged mornings) —
  the largest non-clinical confound for interpreting a titration trend must not go unstated.
- Optional one-off, single-fire "appointment soon — export your report" reminder for a
  future-dated visit, which never surfaces a fresh permission prompt.
- Optional visit markers on Trends, reusing the `markersRow` dot pattern.
- Extend the JSON backup to round-trip visits, wire `importJsonBackup` to persist them, and
  wire `clearAllData` to purge them.

**Non-goals**

- No appointment _scheduling_, calendar integration, or provider directory. A `Visit` is a
  bare date + note; the user types (or picks) it. The pre-visit reminder requests **no**
  additional OS permission beyond the existing local-notifications permission and touches no
  calendar or contacts API — it is a local `expo-notifications` trigger, nothing more.
- No interpretation of what happened "since last visit" — we scope and show data (including
  the adherence _count_); the provider supplies meaning. No "you improved" language, no
  adherence _judgment_ (we report "12 of 14 logged mornings," never "poor adherence").
- No recurring/series visits, reminders configuration UI beyond the existing reminder
  Steppers, or multiple reminders per visit.
- No coupling a dose change to a visit as a foreign key (they stay independent lists; the
  report renders both against the same date axis).

## Mission fit & guardrails

Visits are pure **collect → log → provider** connective tissue. A visit date is a fact the
user asserts; the "since last visit" range is arithmetic on dates; the adherence summary is a
raw count of `doseTaken` days; the nudge is a logistics reminder to _export_, never a clinical
prompt. Nothing scores, ranks, or suggests. The nudge copy is deliberately operational
("export your report"), not evaluative ("your mood is trending down"). The adherence line is
deliberately a bare fraction, not a grade. All data stays on-device; a `Visit` never leaves
the phone except inside the same user-initiated PDF/JSON exports that already gate everything
else.

## Data model

Add to `lib/types.ts`. `Visit` deliberately mirrors `DoseChange` (`readonly date`, optional
`note`) so guards and helpers transfer one-to-one.

```ts
export interface Visit {
  readonly date: IsoDate;
  readonly note?: string;
}
```

`note` is optional and, under `exactOptionalPropertyTypes`, must be **omitted** when absent —
never set to `undefined`. Construction uses a conditional spread, the same idiom
`app/checkin.tsx`'s `handleSave` already uses for evening ratings:

```ts
const visit: Visit = { date, ...(note !== undefined ? { note } : {}) };
```

No new branded type is needed — `date` reuses `IsoDate`, minted only by the existing
guard-and-throw `formatIsoDate` / `parseIsoDate`. `date` is the visit's stable identity:
`appendVisit` dedupes on it (see Storage), so `visit-reminder-<date>` notification IDs and
delete-by-date are both unambiguous.

The report range is modeled as an explicit **discriminated union** rather than a nullable
`DateRange`, so callers cannot confuse "anchored on a real visit" with "anchored on the start
date," and so the report can label the preset honestly without re-deriving which case it is:

```ts
export interface DateRange {
  readonly start: IsoDate;
  readonly end: IsoDate;
}

export type ReportRange =
  | { readonly anchor: 'since-visit'; readonly range: DateRange }
  | { readonly anchor: 'since-start'; readonly range: DateRange };
```

`sinceLastVisitRange` (defined in `lib/storage.ts`, see below) returns `ReportRange` — always
a range, never `null`. `anchor` drives the preset label in doc 01
(`'since-visit'` → "Since last visit", `'since-start'` → "Since starting the medication"),
consumed through an exhaustive `switch` ending in `assertNever`.

> **Note on the panel's "remove the null case" instruction.** We do remove the `null` return,
> but not by making `startDate` optional: a `Visit` can only be logged from Settings, which is
> unreachable without a completed onboarding, so a `Profile` (hence `startDate`) is always
> present by the time any visit exists. `startDate` is therefore a required parameter, and the
> function is total.

## Schema

**n/a.** A `Visit` is not a per-day check-in metric — it is not rendered by `renderMetric` in
the check-in flow, and it does not belong in `MORNING_METRICS` / `EVENING_METRICS`. The
`Metric` discriminated union and `lib/schema.ts` are untouched, so the check-in screen, its
`assertNever(metric)` exhaustiveness guard, and Trends' schema-driven bar rendering all keep
compiling unchanged. Visits are logged from Settings, exactly like `DoseChange`, which is also
(correctly) absent from the metric schema.

## Storage & guards

Add to `lib/storage.ts`, mirroring `isDoseChange` / `parseDoseChangeList` / `appendDoseChange`
**exactly** — reusing the file's existing `isRecord`, `isUnknownArray`, and `readJson` helpers
rather than re-deriving narrowing inline.

```ts
const VISITS_KEY = 'visits';

export function isVisit(value: unknown): value is Visit {
  if (!isRecord(value) || !isIsoDate(value['date'])) return false;
  const note = value['note'];
  return note === undefined || typeof note === 'string';
}

export function isVisitList(value: unknown): value is readonly Visit[] {
  return isUnknownArray(value) && value.every(isVisit);
}

export function parseVisitList(raw: unknown): Parsed<readonly Visit[]> {
  if (raw === null) return { ok: true, value: [] }; // absent key ⇒ []
  if (!isVisitList(raw)) return { ok: false, reason: 'visits: shape mismatch' };
  return { ok: true, value: raw };
}
```

Three deliberate corrections over the first draft, all to match the codebase's real shape:

- **`isVisit` uses `isRecord`, not a hand-narrowed `Record<string, unknown>`.** The draft's
  `const record: Record<string, unknown> = value;` after only a `typeof`/`null` check does
  **not** compile under this repo's strict tsconfig (`TS2322`: narrowed `object` has no index
  signature). `isRecord(value): value is Record<string, unknown>` is the existing type
  predicate `isDoseChange`/`isProfile` already use; reusing it is the one-line fix and also
  drops the novel `'note' in record` variant in favor of the same absent-or-string check
  those guards use. `value['note'] === undefined` is exactly right under
  `exactOptionalPropertyTypes`: JSON never materializes a `note: undefined` key, so an absent
  note reads as `undefined` (accepted) and a present non-string fails.
- **`isVisitList` uses `isUnknownArray`,** the wrapper `isDoseChangeList` uses, so the "why"
  comment on `isUnknownArray` (avoid leaking `any[]` narrowing to callers) keeps applying here
  too.
- **`parseVisitList` takes `raw: unknown`,** not a string, and lets the shared `readJson`
  helper own `JSON.parse` and its failure path — one parse-failure path in the codebase, not
  two. `loadVisits` routes through `readJson`, making the "mirrors `DoseChange` exactly" claim
  literally true.

Load / save / append / remove:

```ts
export async function loadVisits(): Promise<readonly Visit[]> {
  const parsed = parseVisitList(await readJson(VISITS_KEY));
  return parsed.ok ? parsed.value : [];
}

export async function saveVisits(visits: readonly Visit[]): Promise<void> {
  await AsyncStorage.setItem(VISITS_KEY, JSON.stringify(visits));
}

export async function appendVisit(visit: Visit): Promise<readonly Visit[]> {
  const existing = await loadVisits();
  const deduped = existing.filter((v) => v.date !== visit.date); // date is identity
  const next = [...deduped, visit].sort((a, b) => a.date.localeCompare(b.date));
  await saveVisits(next);
  return next;
}

export async function removeVisit(date: IsoDate): Promise<readonly Visit[]> {
  const existing = await loadVisits();
  const next = existing.filter((v) => v.date !== date);
  await saveVisits(next);
  return next;
}
```

Range helper (pure, testable, RN-free) — total, with the `startDate` fallback:

```ts
export function sinceLastVisitRange(
  visits: readonly Visit[],
  today: IsoDate,
  startDate: IsoDate,
): ReportRange {
  const past = visits.filter((v) => v.date.localeCompare(today) < 0);
  if (past.length === 0) {
    return { anchor: 'since-start', range: { start: startDate, end: today } };
  }
  const last = past.reduce((a, b) => (a.date.localeCompare(b.date) >= 0 ? a : b));
  return {
    anchor: 'since-visit',
    range: { start: addDays(last.date, 1), end: today }, // day AFTER last past visit
  };
}
```

`addDays` already exists and returns an `IsoDate`. `.localeCompare` on `IsoDate` strings is
safe because ISO-8601 dates sort lexicographically. Future-dated and same-day visits are
excluded from the anchor by design — the range is "since the last appointment that has
happened," and when none has, "since starting the medication." `start <= end` holds in both
arms: a past visit is `< today` so `addDays(+1) <= today`, and `startDate <= today` for any
real med start.

**Full-wipe path.** `clearAllData` **must** add `VISITS_KEY` to the keys it removes (it does
not today), and the Settings "clear all data" handler must call
`cancelAllVisitReminders(await loadVisits())` (see Notifications) _before_ the wipe, so a user
expecting a full on-device clear is not left with surviving `Visit` records or a stale
scheduled local notification pointing at a deleted visit date.

**Backward compatibility.** Purely additive:

- The `"visits"` key never existed, so `parseVisitList(null)` returning
  `{ ok: true, value: [] }` **is** the migration — no migrate-on-read shim, no version bump.
- No existing key's shape changes; `Profile`, `entries`, `doses` are untouched. Historical
  `DayEntry` data is never read or mutated by this feature.
- No forced re-onboarding: `loadProfile` is unaffected; a user with a profile and no visits
  simply sees an empty visit list in Settings.

## UI touch points

**`app/(tabs)/settings.tsx` — primary seam.** Add a "Visits" section modeled on the existing
dose-change log: a date entry + optional note field + "Add visit" button calling `appendVisit`,
then a reverse-chronological list of logged visits **each with a delete affordance** calling
`removeVisit`. State mirrors the dose list —
`const [visits, setVisits] = useState<readonly Visit[]>([])`, hydrated from `loadVisits()` in
the same effect that loads doses. This is a non-generic seam — hand-written, exactly as the
dose-change log is. Use a **native date picker**, not free-text ISO entry: Settings otherwise
uses Steppers/Toggles for structured input, and hand-typing `2026-07-18` is slow and
error-prone even on this occasional surface. (The dose-change log is append-only today; visits
add delete because the reminder wiring's "cancel on delete" needs a UI trigger.)

**`app/checkin.tsx` — untouched.** A `Visit` is not a check-in metric, so **none** of the four
non-generic check-in seams are touched: no `Draft` field, no `renderMetric` switch arm, no
`handleSave` conditional spread, no `draftFrom*` hydration line. `assertNever(metric)` is not
tripped because the `Metric` union is unchanged.

**`app/(tabs)/trends.tsx` — optional, additive.** To show visit markers, add a second markers
row beside the existing `doseChangeMarkers` row, reusing the `markersRow` dot pattern with a
distinct token color (e.g. `theme.accent` vs. the dose markers' hue). Optional for v1;
self-contained and does not alter the schema-driven bar rendering.

**`app/entry/[date].tsx` — untouched.** A `Visit` adds no rating and no per-day field, so the
hard-coded `RatingRow`s, `directionForRatingKey`, `ratingColor`, and `SIDE_EFFECT_LABELS`
usage are all unaffected.

**`components/` — none required.** The Settings visit list reuses existing primitives; if a
`VisitLog` component is extracted it must consume theme tokens, never raw hex.

## Export / report

`lib/export.ts` changes, coordinated with **doc 01 (provider-report-overhaul)**, which owns
the range-preset selector and the report layout.

- **`Backup` gains a `visits` field; `buildBackup` stays synchronous.** To settle the draft's
  ambiguity: `buildBackup` does **not** become `async` and does **not** self-load — it keeps
  its "pure assembly" contract and gains a `visits: readonly Visit[]` **parameter**. The call
  site `await`s `loadVisits()` and passes the result in.

  ```ts
  interface Backup {
    exportedAt: IsoTimestamp;
    profile: Profile;
    doses: readonly DoseChange[];
    entries: Readonly<Record<IsoDate, DayEntry>>;
    visits: readonly Visit[];
  }
  ```

- **`parseBackup` tolerates a `visits`-less (older) backup:**

  ```ts
  const visits = isVisitList(raw['visits']) ? raw['visits'] : [];
  ```

  `raw['visits']` is `unknown`; `isVisitList` narrows it — no cast of untrusted data.

- **`importJsonBackup` must persist the parsed visits.** Parsing alone is not enough: on a
  successful parse the import path must call `saveVisits(parsed.value.visits)` alongside the
  existing `saveProfile`/`saveDoseChanges`/`saveEntries` writes, or restoring a backup (old
  _or_ new) silently drops the user's visit history. It should also reschedule reminders for
  any future-dated imported visits (same gated path as the add flow), so a restore behaves
  like the adds that produced it.

- **The report gains a "Since last visit" / "Since starting" range option.**
  `sinceLastVisitRange(visits, today, profile.startDate)` yields a `ReportRange`; its `.range`
  feeds `lastNDates` / `rowsInRange` exactly as the numeric presets do (range-agnostic once
  given `{ start, end }`). Because the helper is total, **doc 01's preset is always enabled** —
  there is no disabled state to design — and its label follows `.anchor`.

- **Adherence summary within the scoped range (required).** This doc adds a pure, tested
  helper and requires doc 01 to render its output as a descriptive line in the scoped report,
  so a provider reading a "since last visit" trend can distinguish "medication isn't working"
  from "doses were frequently skipped":

  ```ts
  export function adherenceInRange(rows: readonly DayEntry[]): {
    readonly takenDays: number;
    readonly loggedMornings: number;
  } {
    let takenDays = 0;
    let loggedMornings = 0;
    for (const row of rows) {
      if (row.morning !== undefined) {
        loggedMornings += 1;
        if (row.morning.doseTaken) takenDays += 1;
      }
    }
    return { takenDays, loggedMornings };
  }
  ```

  Rendered as e.g. "Doses taken: 12 of 14 logged mornings." We report against _logged_
  mornings, not calendar days, so an unlogged day is never silently misrepresented as a
  skipped dose — the count stays a fact, not an inference.

- **`buildReportHtml` renders a "Visits in range" `<ul>`** as the dose-change section's
  sibling, listing each visit date and, if present, its note. **Every field runs through
  `escapeHtml`** — dates and free-text notes alike. Colors come only from the shared `palette`.
  Visit rows are descriptive lines, never annotated with any computed delta or judgment.

- **Pre-existing report gaps to hand to doc 01 (flag, not fix here):** side-effect
  severity/adherence context and free-text `notes` are still absent from the exported report,
  and averages are one grand mean over the range. Severity is most useful exactly in the
  window since the last dose adjustment, so doc 01 should close these when it owns the report
  body. Out of scope for 06 beyond the adherence helper above.

## Notifications

`lib/notifications.ts` gains a one-off, single-fire pre-visit export nudge, kept structurally
separate from the two daily reminders:

```ts
export async function scheduleVisitReminder(visit: Visit): Promise<void>;
export async function cancelVisitReminder(date: IsoDate): Promise<void>;
export async function cancelAllVisitReminders(visits: readonly Visit[]): Promise<void>;
```

- **Single fire, terse copy.** Fires once, a few days before a **future-dated** visit
  (`addDays(visit.date, -2)` at a fixed local hour) — never a repeating lead-up. Body:
  `"Appointment soon — export your report to bring."` Notification spam is a documented cause
  of users disabling notifications entirely, which would silently kill the daily reminders
  too, so this stays a one-shot.
- **Never re-asks for permission.** Scheduling proceeds only when notification permission is
  **already granted** (checked without prompting). The visit-add path must not surface a fresh
  permission popup mid-flow if permission was previously denied — the initial request stays
  owned by the daily-reminder setup.
- **Distinct, date-keyed IDs.** Per-visit ID `visit-reminder-<date>`, namespaced from the
  daily reminder IDs, so cancelling/rescheduling visit nudges never disturbs the morning/
  evening `DAILY` triggers. Because `appendVisit` dedupes on date, the ID is a stable unique
  key — the two-visits-same-date collision the data-model lens flagged cannot occur.
- **Guards the past-time case** with an `if` before calling the scheduler (no `!`), and skips
  scheduling when the computed fire time is already past.
- `cancelAllVisitReminders(visits)` cancels every per-visit ID and is called by the Settings
  "clear all data" handler before `clearAllData` wipes the key.
- `expo-notifications` stays **lazily imported** exactly as the existing functions do; the
  Expo-Go caveat (notifications unavailable there) applies unchanged, and the Android channel
  `'adhd-log-reminders'` is reused (no new channel, no new permission).

Wiring lives in Settings' add/remove-visit handlers (schedule on add of a future visit, cancel
on delete).

## Test plan

All logic lives in covered `lib/` modules (`storage`, `export`), keeping coverage at or above
thresholds (lines/statements/functions 90, branches 85). Specs go in
`lib/__tests__/storage.test.ts` and `lib/__tests__/export.test.ts`, importing
`{ describe, it, expect }` from `vitest`, narrowing `Parsed<T>` / `ReportRange` inside the test
rather than asserting. Fixtures use the sanctioned `as IsoDate` literal idiom.

`storage.test.ts`:

- `isVisit`: accepts `{ date }`; accepts `{ date, note }`; rejects missing/malformed `date`;
  rejects non-string `note`; rejects non-object / `null`.
- `parseVisitList`: `null` raw ⇒ `{ ok: true, value: [] }` (absent-key back-compat); shape
  mismatch (array with a bad element) ⇒ `{ ok: false }`; valid list ⇒ narrowed value.
  (JSON-parse failure is now `readJson`'s path, covered with the other `parseX` guards — not
  re-tested here.)
- `appendVisit`: sorts by date; an earlier date lands first; **re-adding an existing date
  replaces (dedupes) rather than duplicating.**
- `removeVisit`: drops the matching date, leaves others.
- `sinceLastVisitRange`:
  - no past visit, `startDate` present ⇒ `{ anchor: 'since-start', range: { start: startDate, end: today } }`;
  - only future visits ⇒ same `since-start` fallback;
  - one past visit ⇒ `{ anchor: 'since-visit', range: { start: addDays(v.date, 1), end: today } }`;
  - multiple past visits ⇒ anchors on the **latest** past one;
  - a same-day visit is excluded from the anchor (still yields `since-visit` only if an
    _earlier_ past visit exists, else `since-start`).

  ```ts
  const today = '2026-07-18' as IsoDate;
  const start = '2026-05-01' as IsoDate;
  const visits = [{ date: '2026-06-30' as IsoDate }, { date: '2026-07-10' as IsoDate }];
  const r = sinceLastVisitRange(visits, today, start);
  expect(r).toEqual({
    anchor: 'since-visit',
    range: { start: '2026-07-11', end: '2026-07-18' },
  });
  expect(sinceLastVisitRange([], today, start)).toEqual({
    anchor: 'since-start',
    range: { start: '2026-05-01', end: '2026-07-18' },
  });
  ```

`export.test.ts`:

- `buildBackup(profile, doses, entries, visits)` includes `visits`; `parseBackup` round-trips
  them.
- `parseBackup` on a backup **without** a `visits` field ⇒ `visits: []`.
- `importJsonBackup` **persists** visits: assert it produces a `saveVisits` write of the parsed
  value (mock the storage write), proving the import flow — not just the pure parser — carries
  the field to disk.
- `adherenceInRange`: counts only logged mornings; `{ takenDays, loggedMornings }` ignores
  days with no morning check-in; all-taken and all-skipped edges.
- `buildReportHtml` with a visit note containing `<`/`&` asserts the exact **escaped**
  substring appears.
- `buildReportHtml` over a `since-visit` range produces the expected daily-log rows and the
  adherence line for that window.

## Gate compliance

- **No `any` / unsafe-any**: guards take `unknown` and narrow via `isRecord`, `isUnknownArray`,
  `isIsoDate`, `typeof`; `parseBackup` reads `raw['visits']` as `unknown` and narrows via
  `isVisitList` — no cast of untrusted data.
- **No non-null `!`**: `sinceLastVisitRange` uses `.filter` + guarded `.reduce`; the reminder
  scheduler guards the past-time case with an `if`.
- **No `@ts-*` / `eslint-disable`**: none needed; verified that the `isVisit` snippet now
  compiles under `tsc --strict` (the draft's manual `Record` narrowing did not — fixed by
  reusing `isRecord`).
- **100% type-coverage**: the only `as` usages are `as IsoDate` on known-valid literals in
  test fixtures, exempt under `--ignore-as-assertion`; production `IsoDate` values come from
  `formatIsoDate` / `addDays`.
- **`exactOptionalPropertyTypes`**: `note` is set by conditional spread, never assigned
  `undefined`; the guard's `note === undefined || typeof note === 'string'` enforces the same
  discipline on parse.
- **Exhaustive switch / `assertNever`**: the `Metric` union is unchanged, so no check-in
  `switch` arm is added. This feature **does** introduce one new exhaustiveness obligation —
  doc 01's `ReportRange` label mapper `switch`es on `anchor` and ends in `assertNever(range)`,
  so adding a future anchor variant fails to compile until the label is handled.
- **`noPropertyAccessFromIndexSignature`**: index access (`value['date']`, `value['note']`,
  `raw['visits']`) used throughout.

## Dependencies & sequencing

- **Enables doc 01 (provider-report-overhaul):** the "Since last visit" / "Since starting"
  preset is the headline consumer of `sinceLastVisitRange`, and the **adherence summary line**
  (`adherenceInRange`) is a firm requirement doc 01 must render inside the scoped report — this
  doc ships both primitives so the confound cannot slide silently into doc 01 unstated. Doc 01
  owns the preset selector, the label mapping (`anchor` → text), the "Visits in range" HTML
  block, and the adherence line placement. **Doc 01 must keep the default landing preset
  unchanged** so the fast path (open Settings → export) gains no extra required selection step
  just because a new option exists. Land the `Visit` type + storage first, then the report
  preset.
- **Independent of the check-in/schema docs:** because `Visit` is not a `Metric`, this feature
  never touches the check-in seam and can land in any order relative to metric-adding docs.
- **Trends markers** are an optional follow-on depending only on `loadVisits` existing.

## Alternatives considered / open questions

- **Fold visits into `DoseChange`** (a visit as a no-op dose change): rejected — conflates two
  distinct facts, pollutes the dose timeline, and the report needs them rendered separately.
- **Return `DateRange | null` and disable the preset when null:** rejected in favor of the
  total `ReportRange` with a `startDate` fallback. The `null` path stranded the first, highest-
  stakes titration follow-up on an arbitrary rolling window; anchoring on `profile.startDate`
  ("since starting the medication") gives that visit a meaningful scope, and the discriminated
  union keeps the two anchors honestly labeled instead of mislabeling a start-anchored range as
  "since last visit."
- **Version field on the `Visit` list:** deferred — absent-key ⇒ `[]` (as `doses` uses) is
  sufficient; add versioning when a real shape change arrives.
- **Dedupe policy for two visits on the same date:** **resolved** — `appendVisit` dedupes by
  date (a re-add replaces the note). The draft deferred this, but date is the reminder ID and
  delete key, so uniqueness on date is load-bearing, not cosmetic.
- **Anchor on the visit date vs. the day after:** chose day-after (`addDays(last.date, 1)`) so
  the range means "everything since I was last seen," excluding the visit day the provider
  already witnessed. One consequence to note for transparency: an evening check-in logged on
  the appointment day itself falls into neither the previous window (ends day-before) nor a
  future one — it is **not lost**, it remains visible in the raw History / daily-log view, it
  is simply not summarized into a since-visit delta. Open to flipping to include the visit day
  if provider feedback wants it — a one-line change with its own test.
- **PGI-C-style "compared to your last visit, how are you doing?" global impression:** logged
  as a named follow-on, not built here. It would be patient self-report (no different in kind
  from the existing mood/focus Ratings, still not app interpretation) and is arguably the
  single highest-value data point for a titration decision, but it belongs in `lib/schema.ts`
  as a new metric captured around visit time, not in this plumbing doc. Recorded so the gap
  isn't lost.
- **Open question:** pre-visit nudge lead time — fixed at 2 days for v1 to keep the Settings
  surface small; a Stepper could follow the existing reminder-time pattern later.

## Panel review

### Clinical / behavioral-health measurement — approve-with-changes

- **Must-fix (first-visit anchoring):** applied. `sinceLastVisitRange` now takes `startDate`
  and returns a total `ReportRange`, falling back to a `since-start` anchor when no past visit
  exists; the `null` return is removed (justified: a `Profile` always exists by the time a
  visit can be logged). Test plan replaces "empty ⇒ null" with "no past visit ⇒ start-anchored
  range."
- **Must-fix (adherence confound):** applied. Added the pure, tested `adherenceInRange` helper
  and an explicit requirement (Goals, Export/report, Dependencies) that the scoped report
  surface a descriptive doses-taken line — counted against logged mornings so unlogged days
  aren't misread as skipped doses.
- **Suggestions:** PGI-C global impression logged as a named follow-on; same-day-as-appointment
  check-in edge documented (visible in raw History, not summarized into a delta); severity/notes
  report gap flagged as a doc 01 dependency.

### Strict-TypeScript architect — approve-with-changes

- **Must-fix (`isVisit` does not compile):** applied. Guard now reuses the existing `isRecord`
  predicate and the `note === undefined || typeof note === 'string'` check, matching
  `isDoseChange` and dropping the non-compiling manual `Record` narrowing and the novel
  `'note' in record` variant.
- **Suggestions:** applied — `parseVisitList(raw: unknown)` routes through the shared `readJson`
  helper (one parse-failure path); `isVisitList` uses the `isUnknownArray` wrapper; pinned down
  that `buildBackup` stays synchronous and gains a `visits` parameter rather than becoming
  `async`.

### Mobile UX / friction & completion — approve

- **Must-fix:** none.
- **Suggestions:** applied — nudge is single-fire with terse copy and must never trigger a
  fresh permission prompt mid-flow; Settings uses a native date picker over free-text ISO
  entry; added a doc 01 dependency note that the default landing preset must not change (no new
  required selection step on the fast export path). No changes touch the daily check-in loop.

### Data-model / migration + privacy + scope — approve-with-changes

- **Must-fix (`clearAllData`):** applied. `clearAllData` now purges `VISITS_KEY`, and the
  Settings clear handler calls `cancelAllVisitReminders` before the wipe so no stale local
  notification survives.
- **Must-fix (`importJsonBackup` write-back):** applied. Import now persists parsed visits via
  `saveVisits`, with a test asserting the write (not just the pure parser).
- **Suggestions:** ID-collision risk resolved by making `appendVisit` dedupe on date (date is
  the reminder ID key); delete affordance explicitly added to the Settings Visits section to
  back "cancel on delete"; Non-goals now state the reminder requests no extra OS permission and
  touches no calendar/contacts API.

**Overall:** all four lenses approve (three approve-with-changes, one approve); every must-fix
applied and folded-in suggestions incorporated.
