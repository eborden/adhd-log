> **Status:** Proposed — pending implementation · **Priority:** P2 · Ref: analysis #3

# Dose adherence & timing

## Problem / Context

`MorningCheckin.doseTaken: boolean` collapses the single most diagnostic fact about a non-stimulant trial into one bit. When a medication "isn't working" after weeks, the first questions a provider asks are _"are you actually taking it, when, and — if not — why not?"_ A boolean can't distinguish **took it on time**, **took it hours late**, and **skipped it** — yet those three produce very different day-to-day curves, and clusters of late/missed doses are exactly the confound a provider needs to see before reading any mood/focus trend. Timing matters too: a dose taken at 6am vs. 2pm shifts when effects land, which contaminates the evening ratings for that day. And a cluster of missed doses is only actionable if the provider knows whether it was behavioral (forgot) or clinical (intolerability) — those point to opposite interventions.

For a weeks-long trend the useful artifact is a **descriptive adherence record** the provider can lay next to the rating trends — not a score, not a nudge. This doc enriches the morning dose field into a small discriminated union (`DoseRecord`) carrying status, an optional self-reported time, and an optional self-selected reason for non-adherence; migrates all legacy boolean data on read; and adds pure, tested tallies that feed the export report as descriptive figures only.

## Goals / Non-goals

**Goals**

- Replace `doseTaken: boolean` with a `dose: DoseRecord` discriminated union on `MorningCheckin` — `taken`/`late`/`missed`, with `timeTaken?` valid only where a dose was taken and `reason?` valid only where it was not.
- Migrate legacy persisted data on read: `true → { status: 'taken' }`, `false → { status: 'missed' }`, never mutating history on disk.
- Render a 3-way selector (with a low-footprint, tap-bounded time control and an optional reason chip set) in the morning check-in, driven from `lib/schema.ts`.
- Report **two** descriptive adherence rates the provider can read unambiguously — a **dose-exposure rate** `(taken+late)/logged` (relevant to multi-week accumulation) and an **on-time rate** `taken/logged` (relevant to the same-day timing confound) — always shown against the range's total-day denominator, plus a descriptive timing span and reason tally.

**Non-goals**

- No adherence _scoring_, targets, streaks-of-compliance, or "you missed 3 doses, consider…" copy. Counts and bare rates only.
- No per-dose reminders or "did you take it?" push follow-ups (notifications unchanged).
- No plotting adherence on the trend chart bars in this doc (possible follow-up; see open questions).
- No inference of `late`/`missed` or reason from any signal — every category is self-selected.
- No change to `DoseChange`/dose-timeline modeling — that is the _prescription_ history, orthogonal to daily adherence, and needs no migration (verified against the current `isDoseChange`/`isDoseChangeList` guards, which this proposal leaves untouched).

## Mission fit & guardrails

Stays squarely on **collect → log → provider**. `status`, `timeTaken`, and `reason` are self-reported facts, not interpretations; `late` vs. `missed` and the reason are categories the _user_ selects, never inferred (in particular, `late` is **not** derived from `timeTaken` vs. `profile.morningReminder`). The report block shows counts, two clearly-labeled rates, a timing span, and a reason tally — no verdict, no "good/bad adherence" judgment beyond the neutral rating palette already in use, and the two rates are labeled so a fully-adherent-but-late trial can never be misread as poor adherence. Everything remains on-device — no new storage keys, the field rides inside the existing `"entries"` blob and the existing JSON backup. All copy stays "log it and discuss with your provider."

## Data model

Additions to `lib/types.ts`:

```ts
export const DOSE_STATUSES = ['taken', 'late', 'missed'] as const;
export type DoseStatus = (typeof DOSE_STATUSES)[number];

export const DOSE_MISS_REASONS = [
  'forgot',
  'sideEffects',
  'ranOut',
  'choseNotTo',
  'other',
] as const;
export type DoseMissReason = (typeof DOSE_MISS_REASONS)[number];

// timeTaken is representable only where a dose was actually taken;
// reason is representable only where it was not. The illegal combinations
// ('missed' + timeTaken, 'taken' + reason) are unrepresentable at the type level.
export type DoseRecord =
  | { readonly status: 'taken'; readonly timeTaken?: TimeOfDay }
  | { readonly status: 'late'; readonly timeTaken?: TimeOfDay; readonly reason?: DoseMissReason }
  | { readonly status: 'missed'; readonly reason?: DoseMissReason };
```

`MorningCheckin` changes shape — `doseTaken` is removed and a single `dose: DoseRecord` is added.
The `ratings` keyed record (see the 2026-07-18 "Ratings as a record" decision) is untouched:

```ts
export interface MorningCheckin {
  readonly dose: DoseRecord;
  readonly ratings: Partial<Record<MorningRatingKey, Rating>>;
  readonly sleepHours?: number;
  readonly completedAt: IsoTimestamp;
}
```

**Why a nested discriminated union, not flat `doseStatus` + `timeTaken?` fields.** The panel's strict-TypeScript review correctly showed that the original flat proposal did _not_ make illegal states unrepresentable: `{ doseStatus: 'missed', timeTaken: {...} }` was a legal value and passed the storage guard unchecked, contradicting its own "omitted when missed" comment and reducing the invariant to an unenforced convention in one call site — exactly the optional-flag soup CLAUDE.md forbids. Modeling `DoseRecord` as a union keyed on `status` makes `timeTaken` inhabit only the `taken`/`late` arms and `reason` only the `late`/`missed` arms, so both illegal correlations are ruled out at the type level rather than by convention. This also gives the clinically-required non-adherence reason a home without introducing a fourth loose optional. `timeTaken` reuses the existing branded `TimeOfDay` (`{ hour: Hour; minute: Minute }`) — `Hour`/`Minute` literal unions keep out-of-range times unrepresentable; no new primitives. All three optionals are omittable under `exactOptionalPropertyTypes`, set via conditional spread — never `= undefined`.

The `Metric` union's `toggle` variant (`key: 'doseTaken'`) is **replaced** by a dedicated variant keyed to the new field:

```ts
export type Metric =
  | {
      readonly kind: 'scale';
      readonly key: RatingKey;
      readonly label: string;
      readonly low: string;
      readonly high: string;
      readonly direction: ScaleDirection;
    }
  | {
      readonly kind: 'doseStatus';
      readonly key: 'dose';
      readonly label: string;
      readonly options: readonly DoseStatus[];
    }
  | {
      readonly kind: 'stepper';
      readonly key: 'sleepHours';
      readonly label: string;
      readonly min: number;
      readonly max: number;
      readonly step: number;
    }
  | {
      readonly kind: 'chips';
      readonly key: 'sideEffects';
      readonly label: string;
      readonly options: readonly SideEffect[];
    }
  | { readonly kind: 'text'; readonly key: 'notes'; readonly label: string };
```

Removing `toggle` and adding `doseStatus` **deliberately trips the exhaustive `switch (metric.kind)` in `app/checkin.tsx`** (and every other consumer) at compile time — the intended forcing function. The `timeTaken` and `reason` sub-controls are _not_ their own `Metric`s; the `doseStatus` renderMetric arm owns the status selector plus the conditional time control (shown only where a dose was taken) and reason chips (shown only where it was not), since those correlate with the discriminant.

## Schema

`lib/schema.ts` — the first `MORNING_METRICS` entry changes from the toggle to the new kind, plus label maps:

```ts
export const MORNING_METRICS: readonly Metric[] = [
  { kind: 'doseStatus', key: 'dose', label: "Today's dose", options: DOSE_STATUSES },
  {
    kind: 'scale',
    key: 'sleepQuality',
    label: 'Sleep quality',
    low: 'Poor',
    high: 'Great',
    direction: 'higher-better',
  },
  { kind: 'stepper', key: 'sleepHours', label: 'Hours slept', min: 0, max: 14, step: 1 },
  {
    kind: 'scale',
    key: 'wakingMood',
    label: 'How you feel waking up',
    low: 'Rough',
    high: 'Great',
    direction: 'higher-better',
  },
] as const;

export const DOSE_STATUS_LABELS: Readonly<Record<DoseStatus, string>> = {
  taken: 'Taken',
  late: 'Late',
  missed: 'Missed',
};

export const DOSE_MISS_REASON_LABELS: Readonly<Record<DoseMissReason, string>> = {
  forgot: 'Forgot',
  sideEffects: 'Side effects',
  ranOut: 'Ran out',
  choseNotTo: 'Chose not to',
  other: 'Other',
};

// Copy hint rendered under the selector to reduce self-categorization drift.
// A user-facing description, NOT an inference rule — the user still chooses.
export const LATE_HINT = 'More than a couple hours off your usual time';
```

The dose field remains a **core, always-shown morning metric** — not part of the toggleable `enabledEveningMetrics` set, consistent with the decision that dose tracking defaults on. `DEFAULT_ENABLED_EVENING_METRICS` (evening-only) and `EVENING_METRICS` are unchanged.

## Storage & guards

Migration must **transform**, not merely narrow, so it cannot live in a `value is T` guard. Guards derive from the const arrays (one source of truth per the panel suggestion, matching the `isSideEffect` idiom):

```ts
export function isDoseStatus(value: unknown): value is DoseStatus {
  return typeof value === 'string' && (DOSE_STATUSES as readonly string[]).includes(value);
}

export function isDoseMissReason(value: unknown): value is DoseMissReason {
  return typeof value === 'string' && (DOSE_MISS_REASONS as readonly string[]).includes(value);
}
```

`parseDoseRecord` builds the current-shape union, **dropping** any field that the chosen arm cannot carry (so a hand-edited or buggy-future `{ status: 'missed', timeTaken }` is normalized to a valid `missed` record rather than smuggling an illegal combination past the boundary — this is the storage-layer half of the illegal-states fix, complementing the type-level union):

```ts
function parseDoseRecord(value: Record<string, unknown>): DoseRecord | null {
  const status = value['status'];
  if (!isDoseStatus(status)) return null;

  const rawTime = value['timeTaken'];
  const timeTaken = rawTime === undefined ? undefined : isTimeOfDay(rawTime) ? rawTime : null;
  if (timeTaken === null) return null; // present but malformed → reject

  const rawReason = value['reason'];
  const reason =
    rawReason === undefined ? undefined : isDoseMissReason(rawReason) ? rawReason : null;
  if (reason === null) return null; // present but malformed → reject

  switch (status) {
    case 'taken':
      return { status, ...(timeTaken !== undefined ? { timeTaken } : {}) };
    case 'late':
      return {
        status,
        ...(timeTaken !== undefined ? { timeTaken } : {}),
        ...(reason !== undefined ? { reason } : {}),
      };
    case 'missed':
      return { status, ...(reason !== undefined ? { reason } : {}) };
    default:
      return assertNever(status);
  }
}

function readDoseRecord(value: Record<string, unknown>): DoseRecord | null {
  const dose = value['dose'];
  if (isRecord(dose)) return parseDoseRecord(dose); // new shape
  const legacy = value['doseTaken'];
  if (typeof legacy === 'boolean') {
    // legacy migrate-on-read
    return legacy ? { status: 'taken' } : { status: 'missed' };
  }
  return null;
}

export function migrateMorningCheckin(value: unknown): MorningCheckin | null {
  if (!isRecord(value)) return null;
  const ratingsRaw = value['ratings'];
  if (!isRecord(ratingsRaw)) return null;
  const ratings: Partial<Record<MorningRatingKey, Rating>> = {};
  for (const key of MORNING_RATING_KEYS) {
    const rating = ratingsRaw[key];
    if (rating === undefined) continue; // sparse ratings are legal
    if (!isRating(rating)) return null;
    ratings[key] = rating;
  }
  if (!isIsoTimestamp(value['completedAt'])) return null;
  const sleepHours = value['sleepHours'];
  if (!(sleepHours === undefined || typeof sleepHours === 'number')) return null;

  const dose = readDoseRecord(value);
  if (dose === null) return null;

  return {
    dose,
    ratings,
    ...(sleepHours !== undefined ? { sleepHours } : {}),
    completedAt: value['completedAt'],
  };
}
```

_(The `ratings` record is read from the nested `value['ratings']` — the current on-disk shape — exactly as the live `isMorningCheckin`/`isRatingsRecord` path does; only the dose field is transformed. `readDoseRecord` still handles the legacy `doseTaken` boolean → `DoseRecord` migration. Building `ratings` by iterating `MORNING_RATING_KEYS` and narrowing each with `isRating` type-checks without assertion.)_

The two current-shape narrowers the design retains are updated in step so they never diverge from the migrator on what counts as valid (they reject legacy `doseTaken` — that is the migrator's job):

```ts
export function isDoseRecord(value: unknown): value is DoseRecord {
  if (!isRecord(value)) return false;
  const status = value['status'];
  if (!isDoseStatus(status)) return false;
  const time = value['timeTaken'];
  if (!(time === undefined || isTimeOfDay(time))) return false;
  const reason = value['reason'];
  if (!(reason === undefined || isDoseMissReason(reason))) return false;
  if (status === 'missed' && time !== undefined) return false; // enforce discriminant correlation
  if (status === 'taken' && reason !== undefined) return false;
  return true;
}

export function isMorningCheckin(value: unknown): value is MorningCheckin {
  if (!isRecord(value)) return false;
  if (!isDoseRecord(value['dose'])) return false;
  if (!isRatingsRecord(value['ratings'], MORNING_RATING_KEYS)) return false;
  if (!isIsoTimestamp(value['completedAt'])) return false;
  const sleepHours = value['sleepHours'];
  return sleepHours === undefined || typeof sleepHours === 'number';
}
```

The read path routes morning through the migrator via `migrateDayEntry`:

```ts
export function migrateDayEntry(value: unknown): DayEntry | null {
  if (!isRecord(value) || !isIsoDate(value['date'])) return null;
  const morningRaw = value['morning'];
  const morning = morningRaw === undefined ? undefined : migrateMorningCheckin(morningRaw);
  if (morning === null) return null;
  const eveningRaw = value['evening'];
  const evening =
    eveningRaw === undefined ? undefined : isEveningCheckin(eveningRaw) ? eveningRaw : null;
  if (evening === null) return null;
  return {
    date: value['date'],
    ...(morning !== undefined ? { morning } : {}),
    ...(evening !== undefined ? { evening } : {}),
  };
}
```

### Failure granularity — resolved, not left implicit

The panel's data-model lens flagged that a single un-migratable day must not silently destroy history, and that behavior was under-specified. Grounding against the **actual** current code: `loadEntries` does `return parsed.ok ? parsed.value : {}` (`lib/storage.ts:308`) — so _any_ `ok:false` from the parser makes the entire in-memory history vanish (the on-disk blob is untouched, but the app shows nothing). Blob-level rejection is therefore far more destructive here than the review assumed. Two callers with opposite needs resolve this cleanly:

- **Strict, all-or-nothing (`parseEntries`)** — used by **import** (`parseBackup`), where a corrupt file should fail loudly with the offending date named, not partially apply:

  ```ts
  export function parseEntries(raw: unknown): Parsed<Readonly<Record<IsoDate, DayEntry>>> {
    if (!isRecord(raw)) return { ok: false, reason: 'Malformed entries JSON' };
    const out: Record<IsoDate, DayEntry> = {};
    for (const [key, entry] of Object.entries(raw)) {
      if (!isIsoDate(key)) return { ok: false, reason: `Malformed entries JSON: bad key ${key}` };
      const migrated = migrateDayEntry(entry);
      if (migrated === null) return { ok: false, reason: `Malformed entry for ${key}` };
      out[key] = migrated;
    }
    return { ok: true, value: out };
  }
  ```

- **Resilient, day-level salvage (`salvageEntries`)** — used by the on-device **read path** so one corrupt day never hides the rest of a provider-facing record:

  ```ts
  export function salvageEntries(raw: unknown): {
    readonly value: Readonly<Record<IsoDate, DayEntry>>;
    readonly dropped: readonly IsoDate[];
  } {
    if (!isRecord(raw)) return { value: {}, dropped: [] };
    const out: Record<IsoDate, DayEntry> = {};
    const dropped: IsoDate[] = [];
    for (const [key, entry] of Object.entries(raw)) {
      if (!isIsoDate(key)) continue;
      const migrated = migrateDayEntry(entry);
      if (migrated === null) dropped.push(key);
      else out[key] = migrated;
    }
    return { value: out, dropped };
  }
  ```

  `loadEntries` switches to `salvageEntries` and keeps every day that migrates. Because the boolean→`DoseRecord` transform is **total over well-formed legacy data**, the only day that can drop is one already corrupt by other means — so in practice nothing is lost, and the worst case degrades from "lose all history" to "lose one bad day." Dropping is deliberately silent to the user (no scary UI), but `dropped` is available for a future diagnostic surface. Losing one unrecoverable day beats both hiding all history and silently importing a bad backup — hence the two-caller split rather than a single behavior.

### Backward compatibility

No forced re-onboarding: `Profile` is untouched. Historical `entries` are never rewritten on disk — a legacy `doseTaken: false` day is migrated to `{ status: 'missed' }` **in memory** and only persisted in the new shape when that day is next saved via `saveCheckin` (migrate-on-read). **Import path fix (corrects a factual error in the earlier draft):** `parseBackup` in `lib/export.ts` currently calls `isEntries(entries)` directly (`lib/export.ts:229`, imported at `:8`) — _not_ `parseEntries`. Since `isEntries → isDayEntry → isMorningCheckin` now require the new `dose` shape, leaving `parseBackup` as-is would make **every historical JSON backup fail to import wholesale** (`'Malformed backup: invalid entries'`). Fix: `parseBackup` must call `parseEntries(entries)` and use its `.ok`/`.value`/`.reason`, dropping the `isEntries` import. This is a required code change, not something that "already works." The **export/write** side is confirmed safe: `buildBackup` sources `entries` from an already-migrated in-memory `Record<IsoDate, DayEntry>` via `loadEntries()`, so freshly-written backups never contain legacy `doseTaken` shapes — the round-trip is covered in both directions.

## UI touch points

- **`app/checkin.tsx` (every non-generic seam must be edited):**
  - _Draft fields:_ remove `doseTaken: boolean`; add three flat draft fields following the file's **`sleepHours: number | undefined`** convention (required key, `| undefined`) — **not** optional `?:` syntax, which fails under `exactOptionalPropertyTypes` (TS2375) the moment a spread needs to write `undefined`, as the panel reproduced:
    ```ts
    readonly doseStatus: DoseStatus | undefined;   // undefined = not yet chosen (see below)
    readonly timeTaken: TimeOfDay | undefined;
    readonly doseReason: DoseMissReason | undefined;
    ```
  - _No pre-selected default._ Per the clinical review, the fresh morning draft starts `doseStatus: undefined` (no segment pre-lit) and `timeTaken: undefined` — Save is disabled until the user actively taps a status. A pre-selected `'taken'` with a silently-seeded `timeTaken` is exactly the default-acceptance bias that inflates self-reported adherence and would undermine the deliverable; the small friction of one required tap is the accepted, deliberate tradeoff for an accurate record. (This also happens to defuse the "extra control always on screen" concern below, since the time control does not appear until a taken/late status is chosen.)
  - _`renderMetric` switch:_ the removed `toggle` arm and the new `case 'doseStatus'` both trip the exhaustive `switch (metric.kind)` — add the arm rendering `components/DoseStatusSelector` (3 segments) with the `LATE_HINT` subtitle; when the chosen status is `taken`/`late`, render the time control; when `late`/`missed`, render the optional reason chips. Keep `default: return assertNever(metric)`.
  - _Time control — low-footprint + tap-bounded (per UX review):_ do **not** reuse the Settings reminder Stepper (hour-granularity, many taps). Default presentation is static text — `"Taken at 8:00am · tap to change"` prefilled from `profile.morningReminder` **for display only** — that expands to an editable control on tap; the editor is a native platform time picker (scroll/drag) or quick-adjust preset chips (`+15m`/`+30m`/`+1h`) layered on the reminder-time baseline, so correcting a genuinely late dose is a bounded number of taps, not the slowest path in the app. Because status starts unset, `timeTaken` is only committed to the draft once the user opens the control and confirms — the prefilled reminder time is a suggestion, never a silently-saved value.
  - _`handleSave` (morning branch):_ assemble the union from the draft, exhaustively; block save if status is unset:
    ```ts
    function buildDoseRecord(d: Draft): DoseRecord | null {
      const status = d.doseStatus;
      if (status === undefined) return null; // Save disabled upstream
      switch (status) {
        case 'taken':
          return { status, ...(d.timeTaken !== undefined ? { timeTaken: d.timeTaken } : {}) };
        case 'late':
          return {
            status,
            ...(d.timeTaken !== undefined ? { timeTaken: d.timeTaken } : {}),
            ...(d.doseReason !== undefined ? { reason: d.doseReason } : {}),
          };
        case 'missed':
          return { status, ...(d.doseReason !== undefined ? { reason: d.doseReason } : {}) };
        default:
          return assertNever(status);
      }
    }
    ```
  - _`draftFromMorning`:_ hydrate `doseStatus`, `timeTaken`, `doseReason` from `checkin.dose` by narrowing on `.status`. When editing a past `missed` day and switching it to `taken`/`late`, prefill `timeTaken` from `profile.morningReminder` so the correction doesn't demand a decision the original flow didn't — but leave it a suggestion the user confirms, consistent with the no-silent-seed rule.
  - _Transition polish (UX suggestion):_ animate the height change when the time control / reason chips appear or disappear on segment switch, rather than an abrupt reflow on this daily surface.
- **`components/DoseStatusSelector.tsx`:** thin, presentational segmented control over `DoseStatus`, consuming `theme` tokens (`theme.good`/`theme.neutral`/`theme.bad` for taken/late/missed, never raw hex). **Tap targets must match the existing large-target standard** (ScaleSelector/Toggle) — three segments must not shrink hit area below the 2-option Toggle it replaces, given this is now the _first_ control on the most-tapped screen in the app.
- **`app/entry/[date].tsx` (hard-coded, non-generic):** add a Dose row showing `DOSE_STATUS_LABELS[dose.status]`, the formatted `timeTaken` where present, and `DOSE_MISS_REASON_LABELS[dose.reason]` where present. This file renders by hand, so it is edited directly; narrow on `dose.status` to reach the arm-specific fields.
- **`app/(tabs)/settings.tsx`:** no change — dose is core, not a toggleable evening metric.
- **`app/(tabs)/trends.tsx`:** no change — the chart is schema-driven over `scale` metrics via `ratingAccessor`; `dose` is not a `Rating` and is ignored. (An adherence strip is out of scope; see open questions.)
- **`app/(tabs)/index.tsx` / `history.tsx`:** render `DayEntry` generically for completion state; no dose-specific edit required.

## Export / report

`lib/export.ts` (pure assembly + native I/O). The tally answers "how much drug, on schedule how often, out of how many days, and why not" — all descriptive, all self-reported:

```ts
export interface DoseAdherence {
  readonly totalDays: number; // days in the selected range (denominator)
  readonly logged: number; // mornings with a dose logged
  readonly taken: number;
  readonly late: number;
  readonly missed: number;
  readonly exposureRate: number | null; // (taken + late) / logged — drug actually received
  readonly onTimeRate: number | null; // taken / logged — on-schedule
}

export function doseAdherence(rows: readonly DayEntry[]): DoseAdherence {
  const totalDays = rows.length;
  let logged = 0,
    taken = 0,
    late = 0,
    missed = 0;
  for (const row of rows) {
    const morning = row.morning;
    if (morning === undefined) continue;
    logged += 1;
    switch (morning.dose.status) {
      case 'taken':
        taken += 1;
        break;
      case 'late':
        late += 1;
        break;
      case 'missed':
        missed += 1;
        break;
      default:
        return assertNever(morning.dose.status);
    }
  }
  return {
    totalDays,
    logged,
    taken,
    late,
    missed,
    exposureRate: logged === 0 ? null : (taken + late) / logged,
    onTimeRate: logged === 0 ? null : taken / logged,
  };
}

export type DoseReasonTally = Readonly<Record<DoseMissReason, number>>;

export function doseMissReasons(rows: readonly DayEntry[]): DoseReasonTally {
  const tally: Record<DoseMissReason, number> = {
    forgot: 0,
    sideEffects: 0,
    ranOut: 0,
    choseNotTo: 0,
    other: 0,
  };
  for (const row of rows) {
    const dose = row.morning?.dose;
    if (dose === undefined || dose.status === 'taken') continue;
    if (dose.reason !== undefined) tally[dose.reason] += 1;
  }
  return tally;
}

export interface DoseTimingSpan {
  readonly earliest: TimeOfDay;
  readonly latest: TimeOfDay;
}

// Descriptive spread of recorded dose times — earliest/latest only, no variance
// scoring or interpretation. null when no timeTaken was ever recorded in range.
export function doseTimingSpan(rows: readonly DayEntry[]): DoseTimingSpan | null {
  let earliest: TimeOfDay | undefined;
  let latest: TimeOfDay | undefined;
  for (const row of rows) {
    const dose = row.morning?.dose;
    if (dose === undefined || dose.status === 'missed' || dose.timeTaken === undefined) continue;
    const t = dose.timeTaken;
    const mins = t.hour * 60 + t.minute;
    if (earliest === undefined || mins < earliest.hour * 60 + earliest.minute) earliest = t;
    if (latest === undefined || mins > latest.hour * 60 + latest.minute) latest = t;
  }
  return earliest === undefined || latest === undefined ? null : { earliest, latest };
}
```

**Resolving the rate ambiguity (clinical must-fix).** The earlier single `takenRate = taken/logged` conflated "received the drug" with "took it on schedule." For a slowly-accumulating non-stimulant, a consistently-late-but-never-missed trial has _complete_ weekly exposure yet would have read as low adherence. The report now shows **both** figures, explicitly labeled — **Dose exposure `(taken+late)/logged`** (relevant to the multi-week efficacy signal) and **On-time `taken/logged`** (relevant only to the same-day evening-rating confound) — so neither can be misread as the other. This is resolved here, not deferred.

`buildReportHtml(profile, doses, rows)` gains a **"Dose adherence"** block after the header containing, all descriptive:

- **Days logged: N of M** (`logged` of `totalDays`) so a sparse-but-perfect record (e.g. 5 of 30 days, all `taken`) can't read as excellent adherence — the denominator is always visible (clinical suggestion).
- A `Taken / Late / Missed` count line.
- **Dose exposure** and **On-time** rates as whole-number percents (or "—" when `null`), each with its plain-language label.
- **Dose times: earliest–latest** from `doseTimingSpan` (or "—") — a one-line timing-variability signal so the provider can judge at a glance whether timing has been a confound, without reading every daily row (clinical suggestion; a cheap interim for the deferred adherence strip).
- **Reasons given** from `doseMissReasons`, listing only non-zero reasons via `DOSE_MISS_REASON_LABELS`, so a cluster of missed doses carries the behavioral-vs-clinical lead the provider needs (clinical must-fix).

The Daily-log table gains a **Dose** column showing `DOSE_STATUS_LABELS[status]`, the formatted `timeTaken` where present, and the reason label where present. Every value passes through `escapeHtml`; status cells use the existing rating palette (`good`/`neutral`/`bad`) via the same inline-style approach as other colored cells — the palette is presentation, not a judgment. Coordinate placement with **doc 01** so the adherence block sits above the averages tables it introduces.

## Notifications

n/a. `lib/notifications.ts` is unchanged — reminders still fire two daily triggers with `data: { session }`. The reminder time is used only as the _display suggestion_ for the time control inside the check-in draft; it is never written to `timeTaken` without user confirmation, and nothing in the notification layer infers adherence.

## Test plan

New/extended Vitest specs in the covered `lib/` modules, using the sanctioned `as IsoDate` / `as IsoTimestamp` literal-fixture idiom and narrowing unions inside assertions:

- **`lib/__tests__/storage.test.ts`**
  - `isDoseStatus` / `isDoseMissReason` accept every member, reject `'skipped'`/`'meh'`, `true`, `undefined`, non-strings.
  - `parseDoseRecord`: `taken`/`late`/`missed` round-trip; `{ status: 'missed', timeTaken }` normalizes to `{ status: 'missed' }` (illegal field dropped); `{ status: 'taken', reason }` drops the reason; malformed `timeTaken`/`reason` → `null`.
  - `migrateMorningCheckin`: legacy `{ doseTaken: true, … }` → `dose.status === 'taken'`; `{ doseTaken: false }` → `'missed'`; a new-shape record round-trips unchanged; missing both `dose` and `doseTaken` → `null`.
  - `parseEntries` (strict) migrates a record mixing one legacy-boolean day and one new-shape day, and returns `ok:false` naming the date on a genuinely malformed day.
  - `salvageEntries` (resilient) keeps good days and reports the bad one in `dropped` rather than discarding all; a lone corrupt day does **not** empty the result.
  - Round-trip: a legacy blob loaded via `loadEntries` yields `dose.status`, and is _not_ written back on read — assert `AsyncStorage.setItem` is not called on load via the `lib/__mocks__` mock.
- **`lib/__tests__/export.test.ts`**
  - `doseAdherence` counts across a range with gaps; `exposureRate`/`onTimeRate === null` when nothing logged; a hand-built fixture where all doses are `late` yields `exposureRate === 1` but `onTimeRate === 0` (the exact case the two-rate split exists to disambiguate); `totalDays` reflects range length, not just logged days.
  - `doseMissReasons` tallies only `late`/`missed` reasons; `doseTimingSpan` returns earliest/latest and `null` when no time recorded.
  - `buildReportHtml` asserts exact substrings for the adherence block (`Days logged`, `Taken`, `Late`, `Missed`, both rate labels and percents, the timing span, a reason label) and a Dose column cell with a formatted time; assert `escapeHtml` holds on a reason/notes-adjacent field.
  - `parseBackup` imports a backup whose `entries` contain legacy `doseTaken: boolean` days and yields migrated `dose` records — locking in the `isEntries → parseEntries` fix so it can't silently regress to whole-file rejection.

Coverage stays ≥ thresholds (lines/statements/functions 90, branches 85): the new pure functions live in already-covered modules, and the migration plus the two adherence `switch`es add branch coverage.

## Gate compliance

- No `any`, no `!`, no `@ts-*` comment, no `eslint-disable`. Untrusted JSON is parsed, never cast; branded values (`IsoDate`, `IsoTimestamp`, `TimeOfDay`) arrive only through existing guards.
- Every new `switch` (`renderMetric`, `parseDoseRecord`, `buildDoseRecord`, `doseAdherence`) is exhaustive and ends in `default: return assertNever(x)`; adding a future `DoseStatus` member fails compilation until handled everywhere.
- `exactOptionalPropertyTypes` respected — `timeTaken`, `reason`, `sleepHours` are set via conditional spread, never assigned `undefined`; **Draft** fields are `T | undefined` required keys (matching the `sleepHours` sibling), never `?:`, so `{ ...draft, timeTaken: undefined }` type-checks.
- Illegal states unrepresentable — the `DoseRecord` union rules out `missed + timeTaken` and `taken + reason` at the type level, and `parseDoseRecord` normalizes any such combination out at the storage boundary. The invariant is enforced by the type and the guard, not by a lone call site.
- `noUncheckedIndexedAccess` / `noPropertyAccessFromIndexSignature` respected — all reads use bracket notation on `unknown` and narrow before use.
- 100% type-coverage holds: no new `as` outside test fixtures; migrators return `T | null` by construction, not assertion.

## Dependencies & sequencing

- **Coordinates with doc 01** (report/averages): both add blocks to `buildReportHtml`; agree on ordering (adherence block above the averages tables) and share the `rowsInRange` row type. Land the type/storage migration here first, then 01 consumes `doseAdherence` output.
- **Independent of** evening-metric docs — this touches only `MorningCheckin` and the morning schema entry.
- **Enables** a future provider-facing "adherence vs. trend" overlay; that overlay is explicitly deferred.
- **Flagged upward (not this doc):** the clinical panel notes the adherence record is most useful read next to a validated global-impression anchor (PGI-C/CGI-I-style "compared to before starting, how are things overall this week?"). The schema today has only itemized scales. This belongs at the doc-01 / roadmap level and is out of scope here.

## Alternatives considered / open questions

- **Keep `doseTaken` boolean, add a separate `doseStatus`.** Rejected — optional-flag soup and contradictory states; replacing outright is a bounded one-time migration.
- **Flat `doseStatus` + `timeTaken?` + `reason?` on `MorningCheckin`.** Rejected — as the panel proved, it leaves `missed + timeTaken` and `taken + reason` representable and unenforced except by convention, violating "illegal states unrepresentable." The nested `DoseRecord` union fixes this at the type level.
- **Generic `segmented` Metric kind instead of dedicated `doseStatus`.** Rejected for now — the time/reason sub-controls are specific to the dose field; a bespoke arm keeps that logic in one place. Revisit if a second segmented field appears.
- **Infer `late` from `timeTaken` vs. `profile.morningReminder`.** Rejected — that is an interpretation; the user categorizes their own dose. The `LATE_HINT` subtitle is a _description_ to reduce cross-user drift, not a rule.
- **Single `takenRate`.** Rejected/resolved — replaced by the labeled exposure + on-time pair so a late-but-complete trial isn't misread as non-adherent.
- **Resolved:** should `late` count toward exposure? Yes for the exposure rate (real drug received), no for the on-time rate — both are shown, so the provider reads whichever the clinical question calls for.
- **Open:** an adherence strip under the trend chart (dot per day colored by status) — deferred to a follow-up so `trends.tsx` stays schema-driven here. The `doseTimingSpan` line is the cheap interim.
- **Open:** whether the resilient read path should ever surface `dropped` days to the user (currently silent) — deferred until there's evidence a legacy day can drop in practice.

## Panel review

### Clinical / behavioral-health measurement — approve-with-changes

- **No pre-selected status (must-fix, self-report inflation):** applied — the morning draft starts with no status lit and no silently-seeded `timeTaken`; the reminder time is display-only until the user confirms. Save is disabled until an explicit tap.
- **Two rates, not one (must-fix, exposure vs. on-time):** applied — `doseAdherence` now returns labeled `exposureRate` `(taken+late)/logged` and `onTimeRate` `taken/logged`; resolved in-doc, not left open.
- **Capture non-adherence reason (must-fix):** applied — added `DoseMissReason` chips (forgot / side effects / ran out / chose not to / other), self-selected, living in the `late`/`missed` arms of `DoseRecord`, surfaced as a "Reasons given" tally.
- **Denominator visible (suggestion):** applied — "Days logged: N of M" using `totalDays`.
- **`late` copy hint (suggestion):** applied — `LATE_HINT` subtitle under the selector, a description not a rule.
- **Aggregate timing signal (suggestion):** applied — `doseTimingSpan` earliest–latest line pulled out of the deferred strip.
- **Global-impression anchor (suggestion):** flagged to doc-01 / roadmap; out of scope here as the panel intended.

### Strict-TypeScript architect — approve-with-changes

- **Draft field convention (must-fix, TS2375):** applied — `doseStatus`/`timeTaken`/`doseReason` are `T | undefined` required keys matching `sleepHours`, never `?:`.
- **Illegal states actually unrepresentable (must-fix):** applied via the stronger of the two offered options — `DoseRecord` is a discriminated union so `missed + timeTaken` / `taken + reason` are unrepresentable, _and_ `parseDoseRecord` normalizes any such combination out at the boundary.
- **Show updated `isMorningCheckin`/`isDayEntry` (suggestion):** applied — updated `isDoseRecord` + `isMorningCheckin` bodies included so guards and migrator don't diverge.
- **Derive `isDoseStatus` from `DOSE_STATUSES` (suggestion):** applied — both guards derive from their const arrays, matching `isSideEffect`.
- **Narrowing-survives-call confirmation (no action):** noted; the migrator shape is kept as verified.

### Mobile UX / friction & completion — approve-with-changes

- **Time control not always on screen (must-fix):** applied — with no default status the control appears only after a taken/late choice, and then as tap-to-expand static text, not a live widget.
- **Tap-bounded time correction (must-fix):** applied — reminder Stepper reuse dropped in favor of a native time picker or `+15m/+30m/+1h` preset chips.
- **Selector tap-target sizing (must-fix):** applied — `DoseStatusSelector` must meet the existing large-target minimum; three segments must not shrink hit area below the Toggle.
- **Default-'taken' risk (suggestion):** resolved by the no-default decision (also a clinical must-fix).
- **Transition animation + edit-back prefill (suggestions):** applied — height-animated show/hide, and `draftFromMorning` prefills a sensible time when a `missed` day is edited back to taken.

### Data-model / migration + privacy + scope — approve-with-changes

- **`parseBackup` routes through `parseEntries` (must-fix):** applied — corrected the earlier false claim; `parseBackup` calls `parseEntries` (dropping the direct `isEntries` call at export.ts:229), with a legacy-backup import test to lock it in.
- **Single-day failure behavior (must-fix):** applied with a decision grounded in the real `loadEntries` fallback (`return … : {}`, i.e. total in-memory history loss): strict `parseEntries` for import (loud, names the date) and a resilient `salvageEntries` for the read path (keeps good days, drops only the corrupt one). Chosen over blanket blob rejection precisely because the current fallback is more destructive than the review assumed.
- **`buildBackup` sources migrated entries (suggestion):** applied — one-line confirmation added.
- **`DoseChange` needs no migration (suggestion):** applied — stated explicitly in Non-goals.

All lenses approve-with-changes; must-fixes applied.
