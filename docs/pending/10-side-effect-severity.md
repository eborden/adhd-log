> **Status:** Proposed — pending implementation · **Priority:** P1 · Ref: analysis #2

# Side-effect severity & onset

## Problem / Context

Side effects are logged today as a bare `readonly SideEffect[]` — a chip is either on or off. But the provider's real branch point when starting a non-stimulant med is not _whether_ a side effect exists, it's **how bad** it is, **whether it's fading** as tolerance builds, and **when it started relative to a dose change**. "Nausea every day for three weeks, severe, unchanged since the last dose bump" and "mild nausea that stopped after day four" are the same data under the current model, yet they point to opposite conversations. Over a weeks-long ramp the useful signal is the _severity trajectory in its dosing context_, and we throw all of it away.

This is a **breaking persisted-shape change** to `EveningCheckin.sideEffects`. Every day already logged holds the legacy `SideEffect[]` form, so the migration is the heart of this doc: legacy entries must be normalized _on read_ to a default severity, never mutated in place, with zero forced re-onboarding — and the fact that a severity was _synthesized_ rather than typed by the user must survive the whole pipeline so the report can flag it.

## Goals / Non-goals

**Goals**

- Capture a `SideEffectSeverity` (`'mild' | 'moderate' | 'severe'`) per selected effect, with the effect→severity pairing _and cardinality_ modeled so illegal states are unrepresentable.
- Migrate legacy `SideEffect[]` days transparently on read (parse-don't-validate), tagging synthesized severities with a persisted `origin: 'migrated'` marker so the provider is never shown an imputed value as if it were entered.
- Add a pure, tested **onset** helper: each effect's first-appearance date across the _full_ log (not the export range), surfaced alongside the dose active on that date.
- Surface severity, onset, dosing context, ongoing/resolved status, and a severity trajectory in the PDF report as _data_, framed for the provider.

**Non-goals**

- No numeric severity (0–10), no "trend" verdict, no "your nausea is improving" copy, no dosing nudges. We show the severity sequence, first-seen date, and the dose active then; the provider reads meaning into it.
- **No per-day adherence cross-reference in v1.** `MorningCheckin.doseTaken` sits on the same `DayEntry`, and severity on a skipped-dose day is a different signal from severity on a taken-dose day — but correlating them per-effect-per-day edges toward interpretation and is out of scope. We compensate descriptively: the report caption states range-level adherence (`X of Y logged mornings`) so the provider has the context without us drawing the line. Called out as an explicit limitation here rather than left silent.
- Not charting severity on Trends (scale-only sparklines stay as-is) — out of scope, noted below.
- Not backfilling/rewriting historical disk data in bulk.

## Mission fit & guardrails

Stays inside collect → log → provider. Severity is a **literal union**, not a score, so nothing invites arithmetic or risk-ranking. The report gains a descriptive "Side effects" table (onset date + dose then, first/last reported in range, ongoing?, days reported over logged-evenings, severity run-length) and defers all interpretation. No network, no new I/O surface — local-only is untouched.

**Zero-friction invariant (called out so no implementer erodes it):** this doc touches neither the morning check-in nor the no-side-effects evening path. Selecting _N_ effects at their default severity stays exactly _N_ taps — one per effect, same as today. Setting a non-default severity is always optional and **never gates Save**. The migrated `'moderate'` default is flagged in the report (via the `origin` marker below) so the provider isn't misled by a value the user never typed.

## Data model

`lib/types.ts` additions. The pairing is atomic _and_ the cardinality is constrained: side effects become a **`SideEffect`-keyed record**, not an array, so "the same effect twice with two severities" is structurally impossible — the earlier `readonly SideEffectReport[]` draft left that legal, which the type contract's "illegal states unrepresentable" forbids.

```ts
export const SIDE_EFFECT_SEVERITIES = ['mild', 'moderate', 'severe'] as const;
export type SideEffectSeverity = (typeof SIDE_EFFECT_SEVERITIES)[number];

export interface SideEffectDetail {
  readonly severity: SideEffectSeverity;
  /**
   * Present only on a severity synthesized by migrate-on-read (never user-typed).
   * Dropped the moment the user edits that effect's severity. Threaded into the
   * report so a migrated default can be footnoted, never shown as real input.
   */
  readonly origin?: 'migrated';
}

/** At most one detail per effect: duplicate-effect states are unrepresentable. */
export type SideEffectReports = Readonly<Partial<Record<SideEffect, SideEffectDetail>>>;
```

`EveningCheckin.sideEffects` changes type (the breaking line); an empty record `{}` replaces the old empty array:

```ts
export interface EveningCheckin {
  readonly ratings: Partial<Record<EveningRatingKey, Rating>>; // unchanged (keyed record)
  readonly sideEffects: SideEffectReports; // was: readonly SideEffect[]
  readonly notes?: string;
  readonly completedAt: IsoTimestamp;
}
```

Choosing the record over an array (per the strict-TS review) also simplifies every consumer: `withSideEffect*`, `firstOnsetDates`, and `sideEffectSummary` become key lookups instead of `.some`/`.filter` scans, and the parser rejects duplicates for free (object keys are unique).

## Schema

`lib/schema.ts` — the `Metric` **union is unchanged**: the `chips` variant still carries `options: readonly SideEffect[]`. Severity is a per-selection affordance inside the component, not a new metric kind, so `renderMetric`'s `assertNever` does **not** trip. Add labels + pure, tested, record-keyed state helpers (RN-free, alongside `withEveningMetricToggled`):

```ts
export const SIDE_EFFECT_SEVERITY_LABELS: Readonly<Record<SideEffectSeverity, string>> = {
  mild: 'Mild',
  moderate: 'Moderate',
  severe: 'Severe',
};

/** Bound to the secondary severity control only, never the chip body. Exhaustive → assertNever. */
export function cycleSeverity(current: SideEffectSeverity): SideEffectSeverity {
  switch (current) {
    case 'mild':
      return 'moderate';
    case 'moderate':
      return 'severe';
    case 'severe':
      return 'mild';
    default:
      return assertNever(current);
  }
}

export function isSideEffectSelected(reports: SideEffectReports, effect: SideEffect): boolean {
  return reports[effect] !== undefined;
}

/** Toggle select/deselect. New selections start at 'mild' (freshly-captured, least-assuming). */
export function withSideEffectToggled(
  reports: SideEffectReports,
  effect: SideEffect,
): SideEffectReports {
  if (reports[effect] === undefined) {
    return { ...reports, [effect]: { severity: 'mild' } };
  }
  const next: { [K in SideEffect]?: SideEffectDetail } = {};
  for (const key of SIDE_EFFECTS) {
    if (key === effect) continue;
    const detail = reports[key];
    if (detail !== undefined) next[key] = detail; // rebuild without the removed key (no dynamic delete)
  }
  return next;
}

/** Set severity for an already-selected effect. No-op if not selected. */
export function withSideEffectSeverity(
  reports: SideEffectReports,
  effect: SideEffect,
  severity: SideEffectSeverity,
): SideEffectReports {
  if (reports[effect] === undefined) return reports;
  return { ...reports, [effect]: { severity } }; // omits `origin`: now user-entered, not migrated
}
```

The migrated legacy default is `'moderate'` (see Storage) — deliberately distinct from a new selection's `'mild'`. `withSideEffectSeverity` drops any `origin` marker, because once the user picks a severity it _is_ user input.

## Storage & guards

`lib/storage.ts`. **Backward compat is mandatory**, and normalization changes the _shape_ (legacy array → keyed record), so the boolean-guard-then-return-raw pattern no longer suffices for evening — the value path must **rebuild** a normalized object.

A precision point the strict-TS review flagged, applied here: `isEveningCheckin` is **demoted to a plain `boolean` validity check, not a `value is EveningCheckin` type predicate**. A legacy `string[]`-shaped value validates as "an evening check-in we can parse," but it is _not_ structurally an `EveningCheckin` (its `sideEffects` is still bare strings at runtime). A predicate would license a caller to narrow-then-return the raw legacy value as the new shape — reintroducing exactly the unsound passthrough this doc exists to kill. **Only `parseEveningCheckin`/`parseDayEntry`/`parseEntries` may mint a value typed `EveningCheckin`/`DayEntry`.** `isDayEntry`/`isEntries` are likewise left as boolean validity checks and removed from the value path — the earlier draft's claim that they are "re-expressed against the parsers" was misleading: they never passed through a raw value and don't need rewriting; they simply stop being the value path. `isMorningCheckin` stays a genuine predicate — the morning shape doesn't move and is passthrough-safe.

```ts
export function isSideEffectSeverity(value: unknown): value is SideEffectSeverity {
  return value === 'mild' || value === 'moderate' || value === 'severe';
}

function isSideEffectDetail(value: unknown): value is SideEffectDetail {
  if (!isRecord(value)) return false;
  if (!isSideEffectSeverity(value['severity'])) return false;
  const origin = value['origin'];
  return origin === undefined || origin === 'migrated';
}

/** Legacy chips stored a bare SideEffect[]; migrate-on-read to a labeled, marked default. */
const LEGACY_SIDE_EFFECT_SEVERITY: SideEffectSeverity = 'moderate';

/** Accepts legacy SideEffect[] AND new keyed record; always returns the new shape. */
function parseSideEffectReports(value: unknown): SideEffectReports | undefined {
  const out: { [K in SideEffect]?: SideEffectDetail } = {};
  if (isUnknownArray(value)) {
    for (const item of value) {
      if (!isSideEffect(item)) return undefined; // reject genuinely malformed items
      if (out[item] !== undefined) continue; // dedupe any legacy repeats, first wins
      out[item] = { severity: LEGACY_SIDE_EFFECT_SEVERITY, origin: 'migrated' };
    }
    return out;
  }
  if (isRecord(value)) {
    for (const [key, detail] of Object.entries(value)) {
      if (!isSideEffect(key)) return undefined;
      if (!isSideEffectDetail(detail)) return undefined;
      out[key] = detail; // object keys are unique → duplicate-effect impossible
    }
    return out;
  }
  return undefined;
}

/** Validates AND normalizes — the returned object is always the new shape. */
export function parseEveningCheckin(value: unknown): EveningCheckin | undefined {
  if (!isRecord(value)) return undefined;
  // Ratings live under the nested `ratings` record (2026-07-18 "Ratings as a record" decision).
  const ratingsRaw = value['ratings'];
  if (!isRecord(ratingsRaw)) return undefined;
  const ratings: { [K in EveningRatingKey]?: Rating } = {};
  for (const key of EVENING_RATING_KEYS) {
    const rating = ratingsRaw[key];
    if (rating === undefined) continue;
    if (!isRating(rating)) return undefined;
    ratings[key] = rating;
  }
  const sideEffects = parseSideEffectReports(value['sideEffects']);
  if (sideEffects === undefined) return undefined;
  const completedAt = value['completedAt'];
  if (!isIsoTimestamp(completedAt)) return undefined;
  const notes = value['notes'];
  if (!(notes === undefined || typeof notes === 'string')) return undefined;
  return {
    ratings,
    sideEffects,
    completedAt,
    ...(notes !== undefined ? { notes } : {}),
  };
}

/** Validity check ONLY. A `true` result does NOT mean `value` already has the new
 *  shape (legacy string[] side effects also validate). Never narrow-and-return the
 *  raw value; only parseEveningCheckin mints an EveningCheckin. Returns boolean by
 *  design — a `value is EveningCheckin` predicate would be a lie for legacy input. */
export function isEveningCheckin(value: unknown): boolean {
  return parseEveningCheckin(value) !== undefined;
}
```

`parseDayEntry` / `parseEntries` are the **value path** (`parseEntries` is the rewrite `loadEntries` consumes):

```ts
export function parseDayEntry(value: unknown): DayEntry | undefined {
  if (!isRecord(value) || !isIsoDate(value['date'])) return undefined;
  const date = value['date'];
  const morningRaw = value['morning'];
  let morning: MorningCheckin | undefined;
  if (morningRaw !== undefined) {
    if (!isMorningCheckin(morningRaw)) return undefined;
    morning = morningRaw; // isMorningCheckin is a genuine, passthrough-safe predicate
  }
  const eveningRaw = value['evening'];
  let evening: EveningCheckin | undefined;
  if (eveningRaw !== undefined) {
    evening = parseEveningCheckin(eveningRaw);
    if (evening === undefined) return undefined;
  }
  return {
    date,
    ...(morning !== undefined ? { morning } : {}),
    ...(evening !== undefined ? { evening } : {}),
  };
}

export function parseEntries(raw: unknown): Parsed<Readonly<Record<IsoDate, DayEntry>>> {
  if (!isRecord(raw)) return { ok: false, reason: 'Malformed entries JSON' };
  const out: Record<IsoDate, DayEntry> = {};
  for (const [key, entryRaw] of Object.entries(raw)) {
    if (!isIsoDate(key)) return { ok: false, reason: 'Malformed entries JSON' };
    const entry = parseDayEntry(entryRaw);
    if (entry === undefined) return { ok: false, reason: 'Malformed entries JSON' };
    out[key] = entry;
  }
  return { ok: true, value: out };
}
```

`loadEntries` consumes the `Parsed<T>` result — showing the call site so no implementer leaves the old raw-return wiring in place:

```ts
export async function loadEntries(): Promise<Readonly<Record<IsoDate, DayEntry>>> {
  const raw = await AsyncStorage.getItem('entries');
  if (raw === null) return {};
  const parsedJson: unknown = JSON.parse(raw);
  const result = parseEntries(parsedJson);
  return result.ok ? result.value : {}; // never narrow-and-return raw; parse mints the type
}
```

**Onset helper** (pure, tested; over the **full** log, so onset is true first-appearance, not range-clipped — YYYY-MM-DD sorts chronologically):

```ts
export function firstOnsetDates(
  entries: Readonly<Record<IsoDate, DayEntry>>,
): ReadonlyMap<SideEffect, IsoDate> {
  const onset = new Map<SideEffect, IsoDate>();
  const dates = Object.keys(entries)
    .filter(isIsoDate)
    .sort((a, b) => a.localeCompare(b));
  for (const date of dates) {
    const evening = entries[date]?.evening;
    if (evening === undefined) continue;
    for (const effect of SIDE_EFFECTS) {
      if (evening.sideEffects[effect] === undefined) continue;
      if (!onset.has(effect)) onset.set(effect, date);
    }
  }
  return onset;
}
```

**Dose-at-onset helper** (pure, tested) — lets the report sit each effect's onset next to the dose active then, instead of making the provider eyeball two disconnected lists:

```ts
export function doseActiveOn(doses: readonly DoseChange[], date: IsoDate): Dose | undefined {
  let active: Dose | undefined;
  for (const change of doses) {
    // appendDoseChange keeps `doses` sorted ascending by date
    if (change.date.localeCompare(date) <= 0) active = change.dose;
    else break;
  }
  return active;
}
```

**Compat guarantees:** `Profile` is untouched → no re-onboarding. Untouched legacy days stay legacy (bare `string[]`) on disk; every `loadEntries` normalizes them in memory. `saveCheckin` preserves the _other_ session by copying the already-normalized value out of `loadEntries`, so touching a day writes it in the new keyed-record shape — a user-initiated, semantics-preserving upgrade, never a silent bulk rewrite. Because migrated details carry `origin: 'migrated'` and that marker is persisted, provenance **survives** resave and backup export/reimport, so the report's migrated-default flag stays truthful indefinitely (this is what makes the Mission-fit claim actually implementable — the earlier draft asserted the label but carried no field for it). `clearAllData` unchanged.

_Residual failure mode (accepted, unchanged from today):_ `parseSideEffectReports` returning `undefined` fails that day's `parseDayEntry`, which fails the whole `parseEntries` call — one corrupted day makes the log fall back to `{}`. This is identical to the pre-existing `isEntries` all-or-nothing behavior; per-day quarantine is a larger cross-cutting change and is explicitly out of scope here. Flagged so it's a conscious carry-over, not an oversight.

## UI touch points

This doc touches the most files of any in the set. Each seam below is required; the non-generic ones are flagged.

- **`components/Chips.tsx`** _(non-generic; largest change)_ — `ChipsProps.selected`/`onChange` retype from `readonly SideEffect[]` to `SideEffectReports`. The **gesture model is fixed here, not deferred** (the mobile-UX review's central objection):
  - **Primary chip-body tap always toggles select/deselect**, exactly as today, via `withSideEffectToggled`. Zero new friction and zero dual meaning: an accidental tap is undone by one more tap on the same chip, never by cycling through severities first.
  - **Severity is a visually separate secondary control that appears only once a chip is selected** — a compact 3-segment control (Mild / Moderate / Severe) driving `withSideEffectSeverity` directly. `cycleSeverity` remains available if a tap-to-cycle micro-affordance is preferred, but it is bound to that secondary control, **never to the chip body**.
  - The severity control must meet the **same minimum tap-target as the rest of the app** and **must not shrink or reflow the effect chips** to fit it (it lays out below/beside the selected chip, not inside it). Fill intensity / `accentSoft` still reflects severity as an at-a-glance, zero-extra-space cue — the preferred surfacing over a bulky segmented row.
  - **Completion bar (hard constraint):** selecting _N_ effects at default severity stays _N_ taps; setting a non-default severity is optional; **Save is reachable with zero severity taps.** No implementer may add a required severity-confirmation step.
  - One sentence of UI-copy guidance (descriptive, not clinical scoring) anchors the labels at the point of rating so a user's "moderate" means the same on day 5 and day 20: _"Mild — noticeable but doesn't interfere · Moderate — interferes but manageable · Severe — hard to get through the day."_
    All transform logic lives in the tested `schema.ts` helpers — the component stays thin.
- **`app/checkin.tsx`** _(non-generic seams, all four)_ — (1) `Draft.sideEffects: SideEffectReports`; drop the now-unused `SideEffect` import where it typed the draft, keep `SideEffectReports`. (2) `renderMetric` `case 'chips'`: `selected={draft.sideEffects}`, `onChange` yields reports. (3) `handleSave` evening: `sideEffects: draft.sideEffects` (types line up, no spread change). (4) `draftFromEvening`: `sideEffects: checkin.sideEffects` matches; `draftFromMorning` stays `{}`; `EMPTY_DRAFT.sideEffects: {}` (was `[]`).
- **`app/entry/[date].tsx`** _(non-generic hard-coded row)_ — the side-effect `DetailRow` iterates `SIDE_EFFECTS`, rendering each selected effect as `SIDE_EFFECT_LABELS[effect]` + `SIDE_EFFECT_SEVERITY_LABELS[detail.severity]` (e.g. `"Nausea — Moderate"`), appending a `*` when `detail.origin === 'migrated'` with a one-line "migrated default" footnote; import `SIDE_EFFECT_SEVERITY_LABELS`.
- **`app/(tabs)/settings.tsx`** — export call site threads the full log to the report: `buildReportHtml(profile, doses, rows, firstOnsetDates(entries))`. No data-model logic here.
- **`app/(tabs)/trends.tsx`** — n/a; side effects were never charted (scale-only). Out of scope.

## Export / report

`lib/export.ts`. `parseBackup` normalizes entries via `parseEntries` (import `parseEntries`, drop `isEntries`) so legacy backups import into the new shape. `buildBackup`/`Backup` unchanged — it serializes the already-normalized data, `origin` markers included, so provenance round-trips through backup. The daily-log side-effects cell renders `SIDE_EFFECT_LABELS[effect] (SIDE_EFFECT_SEVERITY_LABELS[detail.severity])`.

`buildReportHtml` gains an `onset` parameter so the "First reported" column is the **true global onset**, not a range-clipped date. The earlier draft sourced onset from `rows` (already clipped by `rowsInRange`), which would show a within-window date as "first reported" for an effect that actually began before the window — precisely the misleading-a-provider risk the mission forbids.

```ts
export interface SideEffectSummaryRow {
  readonly effect: SideEffect;
  readonly label: string;
  readonly onsetDate: IsoDate; // true first-appearance (firstOnsetDates, FULL log)
  readonly onsetDose: Dose | undefined; // dose active on onsetDate (doseActiveOn)
  readonly onsetBeforeRange: boolean; // onset predates this export's window
  readonly firstInRange: IsoDate; // first reported within the export range
  readonly lastInRange: IsoDate; // last reported within the export range
  readonly ongoingAtRangeEnd: boolean; // reported on the latest logged evening in range
  readonly daysReported: number;
  readonly loggedEveningsInRange: number; // denominator: "X of Y logged evenings"
  readonly severityRun: string; // run-length trajectory, e.g. "Mild×3, Moderate×2"
  readonly latestSeverity: SideEffectSeverity;
  readonly hasMigratedDays: boolean; // any reported day sourced from a migrated default
}

/** Compact run-length trajectory so the first shipped report shows the shape of the
 *  sequence, not just its endpoints — cheap interim before a future sparkline doc. */
export function severityRunLength(severities: readonly SideEffectSeverity[]): string {
  const parts: string[] = [];
  let run: SideEffectSeverity | undefined;
  let count = 0;
  for (const s of severities) {
    if (s === run) {
      count += 1;
      continue;
    }
    if (run !== undefined) parts.push(`${SIDE_EFFECT_SEVERITY_LABELS[run]}×${String(count)}`);
    run = s;
    count = 1;
  }
  if (run !== undefined) parts.push(`${SIDE_EFFECT_SEVERITY_LABELS[run]}×${String(count)}`);
  return parts.join(', ');
}

export interface AdherenceSummary {
  readonly dosesTaken: number;
  readonly loggedMornings: number;
}
export function adherenceInRange(rows: readonly DayEntry[]): AdherenceSummary {
  let taken = 0;
  let logged = 0;
  for (const row of rows) {
    const morning = row.morning;
    if (morning === undefined) continue;
    logged += 1;
    if (morning.doseTaken) taken += 1;
  }
  return { dosesTaken: taken, loggedMornings: logged };
}

export function sideEffectSummary(
  rows: readonly DayEntry[], // rowsInRange output: oldest-first, gap-filled
  onset: ReadonlyMap<SideEffect, IsoDate>, // firstOnsetDates over the FULL log
  doses: readonly DoseChange[],
): readonly SideEffectSummaryRow[] {
  const rangeStart = rows[0]?.date;
  let loggedEvenings = 0;
  let latestEveningDate: IsoDate | undefined;
  for (const row of rows) {
    if (row.evening !== undefined) {
      loggedEvenings += 1;
      latestEveningDate = row.date; // oldest-first, so last assignment wins
    }
  }
  const acc = new Map<
    SideEffect,
    {
      firstInRange: IsoDate;
      lastInRange: IsoDate;
      days: number;
      sev: SideEffectSeverity[];
      migrated: boolean;
    }
  >();
  for (const row of rows) {
    const evening = row.evening;
    if (evening === undefined) continue;
    for (const effect of SIDE_EFFECTS) {
      const detail = evening.sideEffects[effect];
      if (detail === undefined) continue;
      const migrated = detail.origin === 'migrated';
      const cur = acc.get(effect);
      if (cur === undefined) {
        acc.set(effect, {
          firstInRange: row.date,
          lastInRange: row.date,
          days: 1,
          sev: [detail.severity],
          migrated,
        });
      } else {
        cur.lastInRange = row.date;
        cur.days += 1;
        cur.sev.push(detail.severity);
        if (migrated) cur.migrated = true;
      }
    }
  }
  const out: SideEffectSummaryRow[] = [];
  for (const [effect, d] of acc) {
    const latest = d.sev[d.sev.length - 1];
    if (latest === undefined) continue; // unreachable: seeded with one
    const onsetDate = onset.get(effect) ?? d.firstInRange;
    out.push({
      effect,
      label: SIDE_EFFECT_LABELS[effect],
      onsetDate,
      onsetDose: doseActiveOn(doses, onsetDate),
      onsetBeforeRange: rangeStart !== undefined && onsetDate.localeCompare(rangeStart) < 0,
      firstInRange: d.firstInRange,
      lastInRange: d.lastInRange,
      ongoingAtRangeEnd: latestEveningDate !== undefined && d.lastInRange === latestEveningDate,
      daysReported: d.days,
      loggedEveningsInRange: loggedEvenings,
      severityRun: severityRunLength(d.sev),
      latestSeverity: latest,
      hasMigratedDays: d.migrated,
    });
  }
  return out;
}
```

The HTML "Side effects" table (all strings through `escapeHtml`; severity badge colors reuse the existing `palette` rating hues — no new hex) renders columns:

**Side effect · Onset (date — dose active then; "before this range" note if `onsetBeforeRange`) · In range (first → last) · Ongoing? (Yes if `ongoingAtRangeEnd`) · Days reported (`daysReported` of `loggedEveningsInRange` logged evenings) · Severity trajectory (`severityRun`)**.

A `*` on any row where `hasMigratedDays` links to a footnote: _"Some or all severities for this effect were defaulted when migrating older entries and were not entered by hand."_ A single caption above the table states range adherence from `adherenceInRange`: _"Dose taken on X of Y logged mornings in this range."_ The table states facts and stops there — no "improving"/"worsening" label, no correlation drawn between adherence and severity.

## Notifications

n/a — reminder scheduling and payloads are unaffected.

## Test plan

Vitest specs in the coverage-scoped modules (thresholds: lines/statements/functions 90, branches 85; `as IsoDate`/`as IsoTimestamp` literal fixtures are the sanctioned idiom):

- **`storage.test.ts`** — `parseEveningCheckin` migrates legacy `sideEffects: ['nausea']` → `{ nausea: { severity: 'moderate', origin: 'migrated' } }`; accepts the new keyed-record form verbatim (preserving/omitting `origin`); rejects `{ nausea: {} }` (missing severity), a bad severity string, and a non-array/non-record; **dedupes a legacy `['nausea','nausea']` to a single key** (the cardinality invariant); preserves rating optionals + notes; `parseEntries` round-trips a mixed legacy/new record and falls back to `{}` on one malformed day. `firstOnsetDates`: earliest date wins across the full log, ignores evening-less days, empty map for empty log. `doseActiveOn`: returns the last change on/before the date, `undefined` before the first change. Narrow the returned `evening` inside tests rather than asserting.
- **`schema.test.ts`** — `cycleSeverity` full cycle `mild→moderate→severe→mild`; `withSideEffectToggled` adds at `'mild'` and removes (and rebuilds without the key); `withSideEffectSeverity` updates only the matching effect, drops `origin`, and no-ops on an unselected effect.
- **`export.test.ts`** — `sideEffectSummary`: global `onsetDate` from the passed map (distinct from `firstInRange` when onset predates the range, asserting `onsetBeforeRange`), `onsetDose`, `ongoingAtRangeEnd` true only when reported on the latest logged evening, `daysReported`/`loggedEveningsInRange`, `hasMigratedDays`, chronological `severityRun`. `severityRunLength` collapses runs (`"Mild×3, Moderate×2"`). `adherenceInRange` counts taken over logged mornings. `buildReportHtml` contains the "Side effects" section, the adherence caption, exact severity-label + run-length substrings, the migrated footnote/asterisk for a migrated fixture, escapes an `other`-with-weird-notes fixture; daily-log cell shows severity; `parseBackup` normalizes a legacy-entries backup and preserves `origin`.
- **`types.test.ts`** — `SIDE_EFFECT_SEVERITIES` covers the union (compile-time exhaustiveness fixture).

## Gate compliance

No `any`/unsafe-any (untrusted JSON only via `isRecord`/`isUnknownArray`/guards), no `!`, no `@ts-*`, no `eslint-disable`, no dynamic `delete` (removal rebuilds the record). No casts of untrusted data — every `SideEffectDetail` is minted by a guard, never `as`. `noUncheckedIndexedAccess` respected (`reports[effect]`, `evening.sideEffects[effect]`, `entries[date]?.evening`, `rows[0]?.date`, `d.sev[len-1]` all narrowed before use); `exactOptionalPropertyTypes` respected via conditional spreads, the omit-on-user-entry of `origin`, and the `continue`-on-`undefined` ratings loop. The build-by-loop `ratings` object and the cross-statement bracket-narrowing in `parseDayEntry` compile under this tsconfig — same pattern the currently-shipping `parseBackup` already relies on (cited so a reviewer needn't re-derive it). 100% type-coverage: the only `as` uses are `as const` and test fixtures (`--ignore-as-assertion`). `cycleSeverity`'s `switch` ends in `default: return assertNever(current)`, so adding a severity fails to compile until handled.

## Dependencies & sequencing

- **Independent of** other docs; can land first. The entries-parser rewrite (`parseDayEntry`/`parseEntries` as the sole value path, boolean-only `is*` shape predicates) is a foundation any later shape-changing doc reuses.
- **Enables** a future richer report/analysis doc (severity-over-time sparkline, per-day adherence↔severity view) and any Trends severity view (explicitly out of scope here).
- Choosing the keyed-record model shrinks the UI/export work: consumers do key lookups, not effect scans — factor that into the estimate.
- Sequence: land types + storage (with migration + dedupe tests) → schema helpers → `Chips` + `checkin.tsx` + `entry/[date].tsx` → export report (onset wiring, adherence caption, migrated footnote) + backup.

## Alternatives considered / open questions

- **Array of `{effect, severity}` (the pre-review draft)** — rejected: leaves duplicate-effect states legal, violating "illegal states unrepresentable." The `SideEffect`-keyed record makes cardinality structurally impossible and simplifies consumers.
- **Numeric severity (1–5 `Rating`)** — rejected: invites averaging/risk-scoring, against mission. Literal union keeps it descriptive.
- **Legacy default `'mild'`** — rejected for `'moderate'`: minimizing a historically-flagged effect could mislead the provider more than a neutral middle; and it is flagged as migrated via `origin` regardless.
- **No `origin` marker (severity alone)** — rejected: resave-on-touch and backup round-trips would permanently erase the migrated-vs-typed distinction, making the promised report label unimplementable. A persisted, backup-surviving marker is the minimum that keeps the guarantee honest.
- **Per-day adherence↔severity correlation in the report** — deferred (see Non-goals): drawing that line edges into interpretation. Range-level adherence context is shown instead.
- **Pre-fill new selections from the previous day's severity** (so a chronic severe symptom doesn't cost cycle-taps every evening) — deferred: it's a real ergonomics win over a multi-week ramp, but it would make the `schema.ts` helper context-dependent. The lookup belongs in `checkin.tsx` (which has adjacent-day access), layered on top of the pure `'mild'` default later — kept out of v1 to keep the tested helpers context-free.
- **Open:** should the report show a per-effect daily severity strip (sparkline-style) rather than the run-length string? Deferred to the future report doc; `severityRun` is the cheap interim.

---

## Panel review

### Clinical / behavioral-health measurement — approve-with-changes

- **Onset↔dose cross-reference (must-fix):** added `doseActiveOn` and an `onsetDose`/`onsetBeforeRange` field on `SideEffectSummaryRow`; the table now renders onset date beside the dose active then, so the two facts sit together.
- **Ongoing vs. resolved (must-fix):** added `lastInRange` and `ongoingAtRangeEnd` (reported on the latest logged evening in range) plus an "Ongoing?" column — the provider can now tell a resolved effect from a persisting one.
- **Migrated-default provenance in the report (must-fix):** now backed by a real, persisted `origin: 'migrated'` field threaded through parse → `hasMigratedDays` → footnote/asterisk, so the guarantee is implementable rather than prose-only.
- **Adherence (must-fix):** engaged explicitly — listed as a scoped non-goal with rationale, and the report caption surfaces range-level `adherenceInRange` context.
- **Suggestions folded:** severity behavioral anchors added as UI-copy guidance; run-length `severityRun` renders the trajectory (not just endpoints); `loggedEveningsInRange` gives `daysReported` a denominator.

### Strict-TypeScript architect — approve-with-changes

- **Cardinality illegal-state (must-fix):** `sideEffects` remodeled as `Readonly<Partial<Record<SideEffect, SideEffectDetail>>>`; duplicate-effect is now structurally impossible and the parser dedupes legacy repeats.
- **Predicate ambiguity (must-fix):** `isEveningCheckin` demoted to a plain `boolean` validity check (a `value is EveningCheckin` predicate would be a lie for legacy input); the doc now states the sole value path is `parseEveningCheckin`/`parseDayEntry`/`parseEntries` and corrects the false claim that `isDayEntry`/`isEntries` are "re-expressed."
- **Suggestions folded:** noted the record model simplifies `Chips`/helpers/summary into key lookups; added the cross-statement-narrowing precedent footnote; added the duplicate-effect/dedupe test-plan line.

### Mobile UX / friction & completion — approve-with-changes

- **Gesture model (must-fix):** pinned down — chip-body tap always toggles select/deselect; severity lives in a separate secondary control appearing only when selected; `cycleSeverity` bound to that control, never the chip body.
- **Tap-target/layout (must-fix):** added the constraint that the severity control meets the app's tap-target minimum and never shrinks or reflows the chips.
- **Completion bar (must-fix):** stated as a hard constraint — _N_ effects = _N_ taps at default, severity optional, Save reachable with zero severity taps.
- **Suggestions folded:** recommended the segmented/secondary control over dual-meaning tap-to-cycle; fill-intensity called out as the zero-space preferred cue; zero-friction invariant stated in Mission fit; previous-day-severity pre-fill acknowledged and deferred with rationale.

### Data-model / migration + privacy + scope — approve-with-changes

- **Provenance lost on resave (must-fix):** persisted `origin: 'migrated'` marker now survives resave and backup round-trips, making the report flag durable.
- **Onset range-clip mismatch (must-fix):** `firstOnsetDates` (full log) is wired into `buildReportHtml` as the onset source; `firstInRange` is kept separate and labeled, so the provider never sees a within-window date mislabeled as true onset.
- **Suggestions folded:** the all-or-nothing parse failure is explicitly documented as an accepted, unchanged residual risk; the `loadEntries` call site is shown consuming `parseEntries`'s `Parsed<T>`.

All lenses approve-with-changes; must-fixes applied.
