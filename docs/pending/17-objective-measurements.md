> **Status:** Proposed (2026-07-21) · **Priority:** P1 · Ref: titration-log research
> (`docs/research/titration-log-examples.md`), design finding #1

# Objective measurements (blood pressure · heart rate · weight)

## Problem — the strongest gap the titration-log research surfaced

Across 100 real titration logs, the entries pin dose steps to an **objective anchor** far more
often than to anything else: TSH for thyroid, fasting glucose for insulin, Total T for TRT — and,
most relevant here, **blood pressure and heart rate for the exact non-stimulants this app is built
for**. The alpha-agonists guanfacine and clonidine have _defining_ titration signals of sedation,
**hypotension**, and **bradycardia/HR change** (research examples 14–21, 90); atomoxetine logs track
**BP** at each step (example 17: "BP ~140/100" driving a switch). Weight/appetite shows up
everywhere a dose climbs.

The app models none of it. A user titrating guanfacine can log how _focused_ they felt but has
nowhere to record the 96/58 reading that is the single most likely reason their provider adjusts the
dose. The provider report — the deliverable — therefore omits the one number a prescriber of these
drugs reaches for first.

This is **descriptive capture**, not interpretation: we store the reading the user measured and show
it back on the timeline. No thresholds, no "your BP is low" warning, no advice. That keeps it inside
the mission (**collect → log → provider**).

## Why a separate occasional-measurement store, not a daily check-in field

`sleepHours` lives in the daily `MorningCheckin` because it happens every day. Vitals in the research
do **not**: they are episodic — taken at a dose change, before an appointment, when something feels
off. Forcing BP into the daily check-in would (a) slow the check-in every day for data that is mostly
absent (UX-hostile) and (b) litter the store with empty fields.

So this follows the **`DoseChange` precedent exactly**: a separate, append-only list under its own
storage key, each record stamped with a date, entered on demand (from Settings/Trends, and offered as
an optional add-on when logging a dose change). Additive → no migration, no forced re-onboarding.

## Goals / Non-goals

**Goals**

1. A `Measurement` record — blood pressure, heart rate, or weight — with a date and a
   type-safe value, stored in its own append-only list mirroring `DoseChange`. (Heart rate is
   labeled plainly "heart rate", not "resting HR": we store the number the user typed and never
   assert a measurement condition we didn't capture — see panel clinical must-fix.)
2. Entry UI in Settings (where `DoseChange` is already logged) and an optional "add a reading" step
   beside logging a dose change.
3. Read-only surfacing: a compact measurements table in the provider report and an optional overlay
   on the in-app Trends timeline, both aligned to the same dose-change markers already drawn.
4. Full storage-boundary parsing (`Parsed<T>` guards), inclusion in `Backup`/`buildBackup`/
   **`restoreBackup` (a fourth persisted write — see below)**, and Vitest coverage of the RN-free
   logic.

**Non-goals**

- **No interpretation.** No normal/abnormal ranges, no color-coded "high/low", no alerts, no
  "discuss if below X". A reading renders as the number the user typed. (The existing `ratingColor`
  good/bad bucketing is for subjective 1–5 scales and is **not** applied to vitals.)
- No new _daily_ check-in field; the daily flow is untouched.
- No device/health-kit integration (Apple Health, BLE cuffs) — manual entry only; data stays
  on-device. A sync integration would breach the local-only contract and is explicitly out of scope.
- No new dependency.

## Data model (`lib/types.ts`)

A discriminated union keyed by `kind` so illegal states (a BP with one number, a weight with a bpm)
are unrepresentable, and every consumer `switch`es exhaustively to an `assertNever` default:

```ts
export const WEIGHT_UNITS = ['kg', 'lb'] as const;
export type WeightUnit = (typeof WEIGHT_UNITS)[number];

/** A single objective reading the user measured. Value shape is per-kind. */
export type Measurement =
  | {
      readonly kind: 'bloodPressure';
      readonly date: IsoDate;
      readonly systolic: number;
      readonly diastolic: number;
    }
  | { readonly kind: 'heartRate'; readonly date: IsoDate; readonly bpm: number }
  | {
      readonly kind: 'weight';
      readonly date: IsoDate;
      readonly amount: number;
      readonly unit: WeightUnit;
    };

export type MeasurementKind = Measurement['kind'];
```

`date` (not a full timestamp) matches `DoseChange` and the timeline's day resolution. Numbers are
plain `number` here for the same reason `Dose.amount` and `sleepHours` are: they are physical
quantities validated at the parse boundary (finite, positive, and — for `bloodPressure` —
`systolic`/`diastolic` both present), not domain identifiers that warrant branding. Values are stored
exactly as entered; unit conversion is never performed.

## Storage boundary (`lib/storage.ts`)

Mirror the `DoseChange` seam one-for-one:

```ts
export function isMeasurement(value: unknown): value is Measurement {
  if (!isRecord(value) || !isIsoDate(value['date'])) return false;
  switch (value['kind']) {
    case 'bloodPressure':
      return isPositiveFinite(value['systolic']) && isPositiveFinite(value['diastolic']);
    case 'heartRate':
      return isPositiveFinite(value['bpm']);
    case 'weight':
      return isPositiveFinite(value['amount']) && isWeightUnit(value['unit']);
    default:
      return false; // unknown kind → not a Measurement (tolerant: dropped, never throws)
  }
}
export function isMeasurementList(value: unknown): value is readonly Measurement[] {
  /* every() */
}
export function parseMeasurementList(raw: unknown): Parsed<readonly Measurement[]> {
  /* … */
}

export async function loadMeasurements(): Promise<readonly Measurement[]> {
  /* like loadDoseChanges */
}
export async function saveMeasurements(m: readonly Measurement[]): Promise<void> {
  /* … */
}
export async function appendMeasurement(m: Measurement): Promise<readonly Measurement[]> {
  /* … */
}
```

`isPositiveFinite` is a small local helper (`typeof === 'number' && Number.isFinite(v) && v > 0`),
extracted once and reused. **Divergence flag (panel — TS lens):** this is _stricter_ than the
existing `isDose`, which only checks `typeof value['amount'] === 'number'` and currently admits
`NaN`/`0`/negative. Measurements being stricter is intended (a 0 or NaN vital is meaningless), but the
asymmetry is deliberate and noted so a future reader doesn't "fix" one to match the other. The
`default` branch keeping tolerant behavior means a future `kind` written by a newer build is dropped
on read, never crashes — consistent with `parseEntriesTolerant`'s posture.

**Storage key (panel — TS + scope lenses):** the real `STORAGE_KEYS` entries are bare/unprefixed
(`'profile'`, `'doses'`, `'entries'`). Add `measurements: 'measurements'` to that object — do **not**
introduce a `@adhd-log/…` prefix scheme for one key.

## Backup (`lib/export.ts`)

Extend the `Backup` interface additively and thread through the three call sites:

```ts
export interface Backup {
  readonly exportedAt: IsoTimestamp;
  readonly profile: Profile | null;
  readonly doses: readonly DoseChange[];
  readonly measurements: readonly Measurement[]; // NEW
  readonly entries: Readonly<Record<IsoDate, DayEntry>>;
}
```

`buildBackup` gains a `measurements` parameter → update its single call site (`saveCheckin`-adjacent
backup build in Settings) to pass `loadMeasurements()`'s result.

`parseBackup` must default a missing `measurements` **explicitly** (panel — TS lens): keep
`isMeasurementList` honest by having it _reject_ `undefined`, and put the default in `parseBackup`,
not in the guard:

```ts
const rawM = raw['measurements'];
if (rawM !== undefined && !isMeasurementList(rawM))
  return { ok: false, reason: 'invalid measurements' };
const measurements = rawM === undefined ? [] : rawM; // pre-feature backups → []
```

**`restoreBackup` is a fourth persisted write (panel — scope lens must-fix).** It currently writes
exactly three keys via `Promise.all([saveProfile, saveDoseChanges, saveEntries])`. Add
`saveMeasurements(backup.measurements)` to that `Promise.all`, or a restore silently drops every
vital. Because the field defaults to `[]`, old backups import cleanly and new backups remain readable
data.

## Entry UI (`app/(tabs)/settings.tsx`)

Settings already owns dose-change logging (`handleLogDoseChange`). Add a sibling "Log a measurement"
control: a `MeasurementKind` selector, then the kind-appropriate input(s) rendered from an exhaustive
`switch` on the selected kind. **Inputs are numeric-keypad text fields, not `<Stepper>`s (panel — UX
lens must-fix):** stepping from 0 to a systolic of ~120 (then diastolic, then HR, then weight) is
tap-hostile even in an occasional flow, so use direct `keyboardType="numeric"` entry (BP → two fields;
HR → one; weight → one + a `WeightUnit` toggle reusing the `DoseUnit` toggle pattern). Reuse the
extracted `<DoseInput>` numeric-field component (doc-04) where the shape matches; a thin
presentational `<MeasurementInput>` may wrap the per-kind layout. Parsing uses the same
`parseDoseAmount`-style positive-finite guard so the button disables on invalid input. The kind
selector defaults to the last kind used, to cut taps.

Additionally, when the user logs a **dose change**, offer an optional "add a reading now?" affordance
— this is where the research shows vitals are actually captured (at the step), and it costs one tap
to skip.

## Report (`lib/export.ts`)

A new descriptive section, ordered after the before/after-dose section (vitals contextualize the same
changes). One small table per measurement kind present, rows sorted by date, columns `Date · Value`,
with a dose-change annotation when a reading shares a date with a `DoseChange` (reusing the existing
markers, not a new join). BP renders `systolic/diastolic`, HR `<bpm> bpm`, weight `<amount> <unit>`.
Rendered via an exhaustive `switch (m.kind)` → `assertNever`. `escapeHtml` every interpolated string.
The section renders nothing when `measurements` is empty (same guard style as before/after).

## In-app Trends (`app/(tabs)/trends.tsx`)

Below the per-day bars and the "Around dose changes" block (doc-16), an optional "Measurements" strip:
one mini-row per kind present, plotting readings on the same x-range and `doseChangeMarkers` as the
bars so a reading visibly lines up with a step. Renders nothing when empty. **Collapsed-by-default /
visually lightweight (panel — UX lens):** for the majority who never log a vital it must not lengthen
the Trends scroll — the block is absent when `measurements` is empty and, when present, starts
collapsed behind a single header row. Read-only derived view; no schema/check-in seam touched. Kept
presentational; collapse state is component `useState`.

## Test plan (`lib/__tests__/`)

RN-free logic is fully covered:

1. **Guards** — each `kind` round-trips; a BP missing `diastolic`, a weight with a bad `unit`, a
   negative/NaN/zero number, and an unknown `kind` are each rejected by `isMeasurement`.
2. **List parse tolerance** — `parseMeasurementList` on a mixed array keeps valid records and the
   whole-list guard behaves like `isDoseChangeList`.
3. **Backup round-trip** — `buildBackup` includes `measurements`; `parseBackup` on a pre-feature
   backup (no `measurements` key) yields `[]`; `parseBackup` on a backup with an _invalid_
   `measurements` value fails cleanly; `restoreBackup` writes measurements (guards the fourth
   `Promise.all` write — a restore of a backup with vitals leaves them loadable afterward).
4. **Report render** — exhaustive per-kind rendering; empty → section absent; a reading dated on a
   dose-change date gets the annotation.
5. **assertNever** — a compile-time test (or a cast-guarded runtime one) proving the render switch is
   exhaustive, matching the `cycleSeverity` pattern.

Coverage stays ≥ thresholds; the Settings/Trends RN views are not unit-tested (per `CLAUDE.md`).

## Gate compliance

No `any`/`!`/`@ts-*`/eslint-disable. New union is fully discriminated; every `switch` ends in
`assertNever`. Numbers validated at the boundary, never cast from `unknown`. `type-coverage` stays
100% (the branded-constructor exemption is unaffected; no new `as`). Additive `Backup` field → no
destructive migration. `npm run check` must pass before commit.

## Panel review

Run through the 4-lens panel (2026-07-21); all four returned **approve-with-changes**, must-fixes
applied above.

- **Clinical / behavioral-health measurement — approve-with-changes.** BP/HR are the correct
  titration anchors for the exact non-stimulants this app targets, and the non-goals already forbid
  ranges/normal-abnormal/high-low coloring/alerts (report caption "readings you recorded", no
  `ratingColor` on vitals). _Must-fix (applied):_ dropped the "resting" qualifier from the heart-rate
  surface — a bare bpm shown under a "resting HR" label implies a measurement condition we never
  captured; it's now plainly "heart rate", storing what was typed.
- **Strict-TypeScript architect — approve-with-changes.** Discriminated union + `Measurement['kind']`
  - exhaustive `switch`/`assertNever` makes malformed readings unrepresentable; `isMeasurement`
    switching on `value['kind']` (unknown under `noUncheckedIndexedAccess`) with a `default: false`
    compiles and stays tolerant. _Must-fixes (applied):_ bare `measurements` storage key added to
    `STORAGE_KEYS` (no `@adhd-log/…` prefix); `parseBackup` defaults `undefined ⇒ []` explicitly while
    `isMeasurementList` rejects `undefined`; `buildBackup` call site updated. _Noted:_ `isPositiveFinite`
    is intentionally stricter than `isDose`.
- **Mobile UX / friction & completion — approve-with-changes.** Vitals stay entirely off the daily
  check-in (episodic), entry in Settings + a one-tap-skip at dose-change, selector defaults to last
  kind. _Must-fixes (applied):_ numeric-keypad text fields instead of steppers (stepping to a
  systolic of 120 is tap-hostile); Trends strip collapsed-by-default so it never lengthens the scroll
  for users who log no vitals.
- **Data-model / migration + privacy + scope — approve-with-changes.** Separate append-only store +
  additive `Backup` field = zero forced migration; 100% on-device (manual entry only, health-kit/BLE
  sync correctly ruled out). _Must-fixes (applied):_ the `restoreBackup` fourth-write and bare-key
  fixes above. _Boundary held:_ the three fixed kinds ARE the scope — the union stays closed;
  `assertNever` structurally blocks drift into arbitrary user-defined metrics.
