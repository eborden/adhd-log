> **Status:** Proposed (2026-07-23) · **Priority:** P2 · Ref: innovation batch (5 new plans),
> follows the episodic-store pattern doc 17 established

# Intraday "moment" micro check-in

## Problem / Context

The twice-daily check-in captures how someone feels at two fixed points, but a non-stimulant
titration's rough edges often show up **between** those points and fade before evening: a 2pm
crash, a wave of irritability right after a dose, a sharp but brief headache mid-afternoon. By
the time the evening check-in's free-text `notes` field is reached, these are subject to recall
fade — exactly the kind of noise doc 07 (confounder tags) was built to flag, except doc 07
describes the day's _circumstances_, not a symptom spike that happened and passed. Today there
is no capture surface for "something happened just now" at all; the only options are wait for
evening and hope it's remembered, or type a `notes` sentence that never carries a timestamp more
precise than the day.

Docs 17 (objective measurements) already established, and this app's `DoseChange` list
originated, the right shape for exactly this kind of data: **episodic, append-only, entered on
demand**, never forced into the daily schema. This doc applies that same shape to the patient's
own felt-state in the moment, reusing scales the app already has (the 1–5 `Rating`, the
`SideEffect` union) rather than inventing a new one — a single-tap "log a moment" capture
intended to take well under 5 seconds.

## Goals / Non-goals

**Goals**

1. A `MomentLog` record — timestamp, one 1–5 feeling rating, an optional single `SideEffect`,
   an optional short note — stored as its own append-only list, mirroring the `DoseChange` /
   doc-17 `Measurement` blueprint one-for-one.
2. A fast entry point: a small "+ Log a moment" affordance on the Today tab
   (`app/(tabs)/index.tsx`), opening an inline picker in place (not a new route) so Save returns
   immediately to Today.
3. Read-only surfacing: a compact "Moments" report section (after Measurements, per doc 17's
   ordering) and a lightweight per-day marker on `app/(tabs)/trends.tsx`'s bars.
4. Full storage-boundary guard, `Backup` round-trip, `restoreBackup` write, Vitest coverage.

**Non-goals**

- **Not a replacement for the twice-daily structure.** Moments are explicitly optional/occasional
  connective tissue; `lib/schema.ts`, `app/checkin.tsx`, and the `Metric` union are completely
  untouched — no new check-in seam, no new `renderMetric` arm.
- **No new rating scale or severity model.** Reuses the existing `Rating` (1–5) and the plain
  `SideEffect` union — deliberately **not** the evening check-in's keyed `SideEffectReports`
  with per-effect severity (`lib/types.ts:50-64`); a moment picks at most one effect, no
  severity, keeping the capture genuinely fast. A moment is a lighter-weight signal than an
  evening check-in's side-effect record, not a duplicate of it.
- **No correlation or aggregation logic.** No auto-comparison of moment timing against
  `MorningCheckin.doseTaken`/time, no "moments cluster N hours after your dose" analysis — a
  natural, tempting next step, explicitly deferred as a named follow-on so this doc stays a pure
  capture-and-display feature.
- **No push notification tied to moments.** Entry is always user-initiated from the Today tab;
  no new reminder, no new permission surface.

## Data model (`lib/types.ts`)

```ts
export interface MomentLog {
  readonly timestamp: IsoTimestamp;
  readonly feeling: Rating;
  readonly sideEffect?: SideEffect;
  readonly note?: string;
}
```

`timestamp` (not `date`) is deliberate and is the one real difference from the `DoseChange` /
`Measurement` shape: intraday timing is the entire point of this feature, so the record needs
`IsoTimestamp` precision, not `IsoDate`. `feeling` reuses `Rating` — no new literal union.
`sideEffect` is a single optional value (not the keyed `SideEffectReports` record used
elsewhere), and `note` follows the existing `exactOptionalPropertyTypes` conditional-spread
discipline.

**Scale anchor, added (panel — clinical lens must-fix).** Because a moment is deliberately not a
schema `Metric` (see Non-goals), `feeling` had no anchor definition the way every daily scale
metric does — a bare "feeling: 3" in the report is an un-anchored number a prescriber has no way
to read, breaking this app's own scale-anchor discipline (every daily metric carries a
`scaleAnchorCaption`; doc 09's landed coverage work leans on the same principle). Add one small
constant in `lib/schema.ts`, alongside `SIDE_EFFECT_LABELS`:

```ts
export const MOMENT_FEELING_ANCHOR = { low: 'Struggling', high: 'Great' } as const;
```

Reuses the same low/high shape every `Metric` of `kind: 'scale'` already carries — deliberately
generic ("struggling"/"great," not "focused"/"scattered") since a moment has no fixed dimension
the way `mood`/`focus`/`anxiety` do; it is simply "how are you right now." The anchor is rendered
alongside every displayed `feeling` value (see Report, below), never left bare.

## Storage boundary (`lib/storage.ts`)

Mirrors `isDoseChange`/`isDoseChangeList`/`appendDoseChange` and doc 17's `Measurement` seam
exactly:

```ts
export function isMomentLog(value: unknown): value is MomentLog {
  if (!isRecord(value) || !isIsoTimestamp(value['timestamp']) || !isRating(value['feeling'])) {
    return false;
  }
  const sideEffect = value['sideEffect'];
  if (!(sideEffect === undefined || isSideEffect(sideEffect))) return false;
  const note = value['note'];
  return note === undefined || typeof note === 'string';
}

export function isMomentLogList(value: unknown): value is readonly MomentLog[] {
  return isUnknownArray(value) && value.every(isMomentLog);
}

export async function loadMoments(): Promise<readonly MomentLog[]> {
  const raw = await readJson(STORAGE_KEYS.moments);
  // Tolerant per-element parse, matching loadDoseChanges: one bad record drops that record only.
  if (!isUnknownArray(raw)) return [];
  return raw.filter(isMomentLog);
}

export async function saveMoments(moments: readonly MomentLog[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.moments, JSON.stringify(moments));
}

export async function appendMomentLog(moment: MomentLog): Promise<readonly MomentLog[]> {
  const existing = await loadMoments();
  const next = [...existing, moment].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  await saveMoments(next);
  return next;
}
```

**`STORAGE_KEYS` is the single source of truth for this key (panel — TS lens must-fix).** An
earlier draft declared a parallel standalone `const MOMENTS_KEY = 'moments'` alongside the note
"`STORAGE_KEYS` gains `moments: 'moments'`" — two names for one key is exactly the kind of drift
`STORAGE_KEYS` exists to prevent (every other loader, e.g. `loadDoseChanges`, routes through
`STORAGE_KEYS.doses`, never a parallel constant). `STORAGE_KEYS` (`lib/storage.ts:494-499`) gains
`moments: 'moments'`, and every read/write above uses `STORAGE_KEYS.moments` — no second constant.

## Backup (`lib/backup.ts`)

Additive field, same "present-but-malformed fails, absent-key defaults to `[]`" pattern doc 17
specifies and the landed `weekly` field (`lib/backup.ts:60-69`) already demonstrates in this
codebase:

```ts
export interface Backup {
  // …existing fields…
  readonly moments: readonly MomentLog[]; // NEW
}
```

`buildBackup` gains a `moments` parameter; `parseBackup` defaults a missing key to `[]` and
still hard-fails a present-but-invalid one; `restoreBackup` (`lib/storage.ts:633-640`) adds
`saveMoments(backup.moments)` to its `Promise.all` — the same "fourth/fifth write" discipline
doc 17 flagged as a must-fix for its own field, applied here from the start rather than found
later.

## Entry UI (`app/(tabs)/index.tsx`, new `components/MomentQuickLog.tsx`)

**Placement, tightened (panel — UX lens must-fix).** Today's minimalism is load-bearing for
completion: the screen today is streak + two `SessionCard`s + one slim, self-resolving
`WeeklyCard` that (per its own landed design intent — see `docs/DECISIONS.md`'s weekly
check-in entry) stays "visually secondary to the daily loop." The moment affordance must render
**last**, below the `WeeklyCard`, and **lighter** than the `SessionCard`s — no status pill, no
"done/not done" chrome, just a slim single-line link matching the `WeeklyCard`'s restrained
visual weight — so the two daily check-ins stay the unmistakable primary actions and Today never
becomes a four-way choice between morning, evening, weekly, and moment.

A small "+ Log a moment" `Card` affordance, in that position. Tapping it expands an inline
picker in place:

- **Feeling** — reuses `ScaleSelector`'s five labeled tap buttons (the same primitive the daily
  check-in uses), not a new control.
- **Side effect (optional)** — a row of single-select choice chips over `SIDE_EFFECTS`. The
  existing `Chips` component (`components/Chips.tsx`) is **not** reused as-is: it is
  multi-select and drives the keyed `SideEffectReports`/severity model, both wrong for this
  feature's single-pick, no-severity shape. `MomentQuickLog` renders its own minimal
  single-select row (plain `Pressable`s over `SIDE_EFFECT_LABELS`, no severity section) —
  small enough that extracting a shared primitive isn't justified by one caller, matching this
  repo's existing bar for when to extract a component (doc 04's `<DoseInput>` extraction was
  justified by two verbatim call sites; this has one).
- **Note (optional)** — a short single-line text field, not the multi-line evening `notes`.

Save calls `appendMomentLog({ timestamp: isoTimestampNow(), feeling, ...optional fields })` and
collapses the picker back to the affordance — no navigation, no new route.

## Report (`lib/report-html.ts`)

A new "Moments" section, ordered after the Measurements section (doc 17), rendering nothing when
`moments` is empty (same guard style as every other optional report section). The section leads
with the `MOMENT_FEELING_ANCHOR` labels once (e.g. "Feeling: 1 = Struggling, 5 = Great"), then
each row shows the **local time of day** (not just the date — the entire point of a moment is
intraday timing; reuses the same `Date`-based local-time derivation doc 22's `localTimeOfDay`
establishes, so this doc either imports that helper if doc 22 has landed or defines the same
two-line conversion locally if it hasn't — trivial either way), the feeling value, the side
effect label if present, and the escaped note. Rendered via a small pure
`momentTimeLabel(ts: IsoTimestamp): string` helper, tested the same way doc 22's timezone-hazard
tests are — computing the expected value through `new Date(ts)` rather than a hand-derived
literal.

## In-app Trends (`app/(tabs)/trends.tsx`)

**Marker, disambiguated (panel — UX lens must-fix).** The existing `markersRow`
(`app/(tabs)/trends.tsx:300-308, 410-419`) is a 4px-tall row of 4px `neutral` dose-change dots —
too small for a second dot distinguished by color alone to stay legible, and a day carrying both
a dose-change marker and a moment marker would read as dot-soup. Moments get their **own row**
directly below `markersRow` (not a second dot squeezed into the same one), using a distinct
shape (e.g. a small tick/caret rather than a filled circle) so the two marker types stay
readable individually and together. Presence only — one marker per day with ≥1 logged moment,
not each moment's individual value (plotting every moment's own rating would need a new chart
dimension, out of scope for v1). Purely derived from already-loaded data once `loadMoments()` is
added to the screen's `useFocusLoad` call; no schema/check-in seam touched.

## Test plan (`lib/__tests__/`)

1. **Guards** — `isMomentLog` accepts a minimal record (timestamp + feeling only) and a full one
   (+ sideEffect + note); rejects a bad `Rating`, a bad `SideEffect`, a non-string note, and a
   malformed/missing `timestamp`.
2. **List tolerance** — `loadMoments` drops a malformed element from a mixed array, matching
   `loadDoseChanges`'s posture (one bad record costs one record, not the whole list).
3. **Backup round-trip** — `buildBackup` includes `moments`; `parseBackup` on a pre-feature
   backup (no `moments` key) yields `[]`; a present-but-invalid `moments` value fails the parse;
   `restoreBackup` persists moments (asserted via a `saveMoments` write, not just the pure
   parser — matching doc 17's own must-fix on this exact point).
4. **Report render** — a note containing `<`/`&` renders escaped; empty `moments` renders no
   section at all; `momentTimeLabel` is tested the timezone-safe way (expected value computed
   via `new Date`, never a hand-typed literal).
5. **Trends marker** — presence matches "has ≥1 moment that day" exactly, absent on a day with
   zero.

## Gate compliance

No `any`/`!`/`@ts-*`/eslint-disable. `MomentLog` has no discriminated union of its own (a flat
interface, like `DoseChange`), so no new `assertNever` obligation is introduced. Optional fields
(`sideEffect`, `note`) follow `exactOptionalPropertyTypes` via conditional spread. New
`STORAGE_KEYS` entry is bare (`'moments'`), consistent with the existing keys. Additive `Backup`
field → no migration, no forced re-onboarding; pre-feature backups import cleanly with
`moments: []`. `npm run check` must pass before commit.

## Dependencies & sequencing

Independent of docs 23, 24, and 26 — reuses only `Rating`/`SideEffect`, which already exist.
Naturally pairs with doc 17's `Measurement` (same shape family: append-only, episodic, optional
report section) and doc 22's `localTimeOfDay` (shared local-time-from-timestamp need) — if both
land, extracting one shared "local time of day from an `IsoTimestamp`" helper is a small,
optional follow-on refactor, not required for either doc to stand alone.

## Alternatives considered

- **Voice/speech-to-text capture** instead of a tap-based picker, so a fading in-the-moment
  feeling could be spoken rather than tapped: considered as the more ambitious version of this
  feature, but rejected for v1 — it requires a new native on-device speech-recognition
  dependency (two platform APIs, no single cross-platform Expo module) purely to save a few taps
  on an already-3-tap flow (feeling → optional chip → save), and this app's own build docs
  (`docs/BUILD.md`) already flag every new native dependency as a real cost (a forced prebuild
  regeneration, a new permission surface). Recorded as a possible stretch follow-on if tap
  entry turns out to still be too slow in practice — not built here.
- **Folding moments into the evening check-in's `notes` with a timestamp prefix:** rejected —
  that's exactly today's status quo and the reason moments fade unrecorded; a dedicated
  low-friction entry point is the actual fix.
- **A persisted "was this moment near a dose?" flag:** rejected as premature interpretation — see
  Non-goals; the raw timestamp is enough for a reader (patient or provider) to make that
  comparison themselves against the existing dose-taken time, without the app asserting it.

## Panel review

Run through the 4-lens panel (2026-07-23): approve (scope), approve-with-changes (clinical,
strict-TS, UX). Must-fixes applied above.

- **Clinical — approve-with-changes.** Reusing the existing `Rating`/`SideEffect` unions rather
  than inventing a new severity model is the right call — no new instrument for a provider to
  learn. _Must-fix (applied):_ the `feeling` value had no scale anchor (unlike every daily
  metric, which carries one), so a bare number in the report was an un-anchored figure a reader
  would have to fill with their own meaning — added `MOMENT_FEELING_ANCHOR` and rendered it
  alongside the value in the report. The explicit deferral of dose-timing correlation logic
  (Non-goals) keeps this a pure capture-and-display feature.
- **Strict-TypeScript architect — approve-with-changes.** `isMomentLog`/`isMomentLogList`/
  `loadMoments`/`appendMomentLog` correctly mirror the real `isDoseChange` seam using the actual
  exported `isIsoTimestamp`/`isRating`/`isSideEffect`; the `Backup` change correctly targets
  `lib/backup.ts` (not `lib/export.ts`); the flat-interface / no-`assertNever`-obligation claim
  is accurate. _Must-fix (applied):_ a parallel standalone `MOMENTS_KEY` const alongside a
  `STORAGE_KEYS.moments` entry was a drift risk — every reference now routes through
  `STORAGE_KEYS.moments` only, matching how every other key in this file is used.
- **Mobile UX / friction — approve-with-changes.** Reusing `ScaleSelector` for feeling and a
  minimal own single-select side-effect row (correctly not the multi-select/severity `Chips`) is
  the right read of the real components; the inline in-place picker with no navigation is the
  right shape for sub-5-second capture. _Must-fixes (applied):_ the affordance must render last
  (below the `WeeklyCard`) and lighter than the `SessionCard`s so Today's daily-loop primacy is
  preserved; the Trends moment marker moved to its own row with a distinct shape rather than a
  same-size dot beside the existing dose-change markers, which risked illegibility when both
  are present on the same day.
- **Data-model / migration + privacy + scope — approve.** New-store threading confirmed correct:
  `moments` added to `STORAGE_KEYS` as a bare key, `buildBackup` gains a parameter, and —
  checked specifically because this is exactly where doc 17 needed a fix — `restoreBackup` gets
  `saveMoments(backup.moments)` in its `Promise.all`, not just build/parse. No must-fix. _Noted:_
  `parseBackup`'s all-or-nothing posture on a present-but-invalid `moments` value is asymmetric
  with `loadMoments`'s tolerant per-element filtering, but this exactly matches the existing
  `doses` precedent in this codebase (`isDoseChangeList` strict vs. `loadDoseChanges` tolerant),
  so it's consistent rather than a new inconsistency. Scope held only because the Non-goals are
  respected — no aggregation, no dose-timing correlation, no notification; this is the doc
  closest to the general-tracker line in this batch, and staying in-mission depends on holding
  those non-goals in implementation, not just in the doc.
