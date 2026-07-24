> **Status:** Proposed (2026-07-23) · **Priority:** P1 · Ref: innovation batch, round 2 ·
> **Touches landed code: `computeAdherence` (`lib/report-metrics.ts`), not just pending docs**

# Planned medication pause log

## Problem / Context

The app models continuous, daily dosing: `DoseChange` records a new dose taking effect, and the
morning check-in's `doseTaken: boolean` records whether that day's dose happened. Nothing today
lets a patient say "I'm intentionally not taking this for a stretch" — before a surgery, during
a medically-supervised washout, or a deliberate short medication holiday. That gap matters for
exactly this app's target drug class: alpha-agonists (guanfacine, clonidine) carry real,
well-documented discontinuation considerations, and even where that isn't a factor, a planned
pause and unplanned non-adherence are clinically opposite facts that today render **identically**
— a run of `doseTaken: false` days. A provider reading the landed adherence block sees "5 missed
doses" whether that was forgetfulness or a pre-arranged surgical hold, and the report has no way
to tell them apart.

This doc adds a small, explicit record for exactly that distinction — descriptive only, no
advice about whether or how to pause a medication (that decision and its safety are the
provider's territory, consistent with every other doc's "log this and discuss with your
provider" framing already required by `CLAUDE.md`). It is the highest-priority doc in this round
precisely because it corrects a real, existing honesty gap in adherence reporting, not because it
adds a new capability from nothing.

## Goals / Non-goals

**Goals**

1. A `MedicationPause` record — a date range (open-ended if ongoing) plus an optional reason —
   stored as its own list, mirroring the `Visit`/`DoseChange` shape.
2. **Reclassify days inside a pause out of the adherence "not taken" bucket into their own
   "paused" bucket**, so a planned pause never reads as unexplained non-adherence. This requires
   a coordinated, additive change to the landed `AdherenceSummary`/`computeAdherence`
   (`lib/report-metrics.ts:219-252`) — the one place in this whole batch that edits already-
   shipped code rather than only adding to pending docs.
3. Render pauses as a distinct, neutral band on the in-app Trends timeline and as a plain dated
   list in the report — never as a run of red "missed" markers.
4. Full storage-boundary guard, `Backup` round-trip, `restoreBackup` write, Vitest coverage.

**Non-goals**

- **No advice about pausing.** No warnings, no "talk to your doctor before stopping" push copy
  beyond the same generic, already-house-style framing this app uses everywhere (see UI, below,
  for the exact wording proposed — flagged explicitly for the clinical lens to confirm it reads
  as the existing disclaimer style and not as new personalized advice).
- **No automatic detection of a pause from a run of missed doses.** Always a deliberate, explicit
  record the user creates before or during a pause — the app never infers "this looks like a
  pause" from adherence data on its own.
- **No interaction with dosing schedule/reminders.** A pause does not silently cancel the daily
  reminders (doc 15's snooze/quick-actions already handle in-the-moment dismissal); reminders keep
  firing during a pause exactly as before; muting them is a separate, not-built-here decision the
  user makes through the existing reminder toggle if they want it.
- **No retroactive reclassification beyond the adherence bucket.** A pause changes how a day's
  `doseTaken: false` is _counted_ (not-taken → paused); it does not rewrite, delete, or hide the
  underlying `MorningCheckin` record itself.

## Data model (`lib/types.ts`)

```ts
export interface MedicationPause {
  readonly startDate: IsoDate;
  readonly endDate?: IsoDate; // absent = ongoing / not yet ended
  readonly reason?: string;
}
```

`endDate`, when present, is validated at the parse boundary to be `>= startDate` (never
asserted) — a pause with an end before its start is a malformed record, rejected the same way
any other invariant-violating shape is. `reason` follows the existing
`exactOptionalPropertyTypes` conditional-spread discipline used throughout (`Visit.note`,
`DoseChange.note`).

## Storage (`lib/storage.ts`)

Mirrors the `Visit`/`DoseChange` seam:

```ts
export function isMedicationPause(value: unknown): value is MedicationPause {
  if (!isRecord(value)) return false;
  // Bind startDate to a local, narrowed const before comparing against it (panel — TS lens
  // must-fix): re-indexing `value['startDate']` a second time below would compare `IsoDate`
  // against `unknown` (the index-signature type of a re-read), which does not compile — this
  // codebase's existing guards (e.g. isDoseChange) never re-index a key they've already checked,
  // for exactly this reason.
  const startDate = value['startDate'];
  if (!isIsoDate(startDate)) return false;
  const endDate = value['endDate'];
  if (!(endDate === undefined || (isIsoDate(endDate) && endDate >= startDate))) {
    return false;
  }
  const reason = value['reason'];
  return reason === undefined || typeof reason === 'string';
}

export function isMedicationPauseList(value: unknown): value is readonly MedicationPause[] {
  return isUnknownArray(value) && value.every(isMedicationPause);
}
```

`STORAGE_KEYS` gains `medicationPauses: 'medicationPauses'` (bare key, matching every other
entry). `loadMedicationPauses`/`saveMedicationPauses`/`appendMedicationPause` mirror
`loadDoseChanges`/`saveDoseChanges`/`appendDoseChange` exactly (tolerant per-element load,
sorted-by-`startDate` append). One more operation, since a pause is opened and later closed as
two separate user actions:

```ts
export async function endMedicationPause(
  startDate: IsoDate,
  endDate: IsoDate,
): Promise<readonly MedicationPause[]> {
  const existing = await loadMedicationPauses();
  const next = existing.map((p) => (p.startDate === startDate ? { ...p, endDate } : p));
  await saveMedicationPauses(next);
  return next;
}
```

`isDateInPause(date: IsoDate, pause: MedicationPause): boolean` — a small pure predicate
(`date >= pause.startDate && (pause.endDate === undefined || date <= pause.endDate)`) — is the
one new primitive every render/adherence site below is built on, so "is this day inside a pause"
is computed one way everywhere.

## Adherence reclassification (`lib/report-metrics.ts`, landed code — the coordinated edit)

`AdherenceSummary` gains one field, additive to the existing shape:

```ts
export interface AdherenceSummary {
  readonly takenCount: number;
  readonly notTakenCount: number; // NOW excludes paused days — see below
  readonly noEntryCount: number;
  readonly pausedCount: number; // NEW — days inside a MedicationPause with doseTaken === false
  readonly notTakenDates: readonly IsoDate[]; // NOW excludes paused dates
  readonly noEntryDates: readonly IsoDate[];
  readonly pausedDates: readonly IsoDate[]; // NEW
}
```

`computeAdherence` gains a second parameter, `pauses: readonly MedicationPause[] = []`
(defaulted so every existing call site — the before/after comparison, the Recent-window
adherence, doc 27's digest — keeps compiling with zero edits unless it wants to opt in):

```ts
export function computeAdherence(
  rows: readonly DayEntry[],
  pauses: readonly MedicationPause[] = [],
): AdherenceSummary {
  // … existing loop, with one added branch: when morning.doseTaken === false AND the date
  // falls inside some pause (via isDateInPause), increment pausedCount / push to pausedDates
  // INSTEAD of notTakenCount / notTakenDates. A day with no morning check-in at all still
  // counts as noEntry regardless of a pause — the pause explains a `false`, not an absence.
}
```

**Why a default parameter, not a new function name (panel — TS/scope lens should confirm this
call):** every existing caller of `computeAdherence` (the before/after section, the Recent-window
line, and this batch's own doc 27/30, both of which call the sibling `adherenceInWindow`
untouched) continues to compile and behave identically with zero pauses ever logged — the
reclassification is a no-op until the user actually creates a `MedicationPause`. This keeps the
"touches landed code" footprint to the smallest possible diff: one new optional parameter, one
new branch in an existing loop, two new fields on an existing interface.

`adherenceInWindow` (the simpler `{taken, logged}` shape used by Trends/doc 30) is **deliberately
left untouched** — it already excludes no-entry days from `logged` and has no "not taken" bucket
to correct in the first place, so a pause changes nothing about what it counts.

## UI (`app/(tabs)/settings.tsx`)

A "Medication pauses" section, structurally identical to the Visits section (doc 11): a
start-date picker + optional reason field + "Start a pause" button; an active (no `endDate`)
pause shows an "End pause" action taking today's date. **Proposed copy, flagged for clinical
lens review rather than asserted as settled:** below the "Start a pause" button, a small,
generic line — _"As with any change to your medication, this is worth discussing with your
provider."_ — mirroring the exact register of this app's existing blanket disclaimer (`CLAUDE.md`:
"log this and discuss with your provider") rather than inventing new personalized guidance. If
the clinical lens judges even this generic line as crossing into advice-adjacent territory, drop
it — the feature works identically without it; the copy is a judgment call, not load-bearing to
the recorded data.

## In-app Trends (`app/(tabs)/trends.tsx`)

A pause renders as a shaded band across its date range on the per-metric bars (a new absolutely-
positioned overlay layer, matching the existing `smoothedLineLayer` technique — no new chart
library), so the gap in dosing reads visually as "intentional and explained," not as a run of
individually-flagged missed-dose markers. Days inside a pause still show their actual logged
mood/focus/etc. bars if the user checked in anyway (a pause affects dosing, not check-in
completion) — only the adherence _counting_ changes, never the rating bars themselves.

**Legibility in the combined worst case, and a required screenshot (panel — UX lens must-fixes).**
This is the one **always-on**, non-collapsible new Trends layer in this round, and it stacks on
top of the existing per-metric bars, the smoothed-line overlay (doc 08, landed — bars dim toward
a lower opacity when smoothing is on), and `markersRow`. Two concrete requirements, not just a
general "make it legible" aspiration:

1. The band must render **behind** the bars (lowest z-order of the three layers), at an opacity
   that stays distinguishable from the normal background without ever obscuring a bar or the
   smoothed-line segments drawn over it — verify specifically with smoothing **on** (the hardest
   case, since dimmed bars + a band behind them risks reading as one muddy block).
2. The band must align to the **same date axis across every metric block**, so a pause reads as
   one continuous vertical region scrolling down the screen, not offset stripes per block.

Per `CLAUDE.md`'s "UI changes aren't done until screenshotted" rule, capture this exact combined
state (a pause + smoothing on + an existing dose-change marker, if one falls nearby) before
calling this feature done — not a generic Trends screenshot, but this specific worst-case
overlap.

## Report (`lib/report-html.ts`)

A "Medication pauses" section near the existing dose timeline: one line per pause,
`{startDate}–{endDate or "ongoing"}, reason: {reason or "not specified"}`, every string
`escapeHtml`'d. The adherence block's rendered counts switch from the two-bucket
(taken/not-taken, no-entry) framing to the three-bucket one only when `pausedCount > 0` for the
range shown — so a user who never logs a pause sees the identical taken/not-taken/no-entry
figures they see today, and the new bucket only appears once it has something real to say.

**Bucket label, corrected (panel — clinical lens must-fix).** The three-bucket rendering must
label the new bucket **"Paused (patient-reported)"**, not a bare "Paused." The reclassification
itself is clinically sound — it moves a day the patient explicitly marked as paused, never one
the app inferred — but a bare "Paused: 5" in a provider-facing report could be misread as the
app itself adjudicating which missed doses were excused. The explicit "(patient-reported)"
qualifier keeps that distinction legible at a glance, matching the "no entry recorded" (never
"missed") neutral-language precedent this same adherence block already established.

## Test plan (`lib/__tests__/`)

1. **Guards** — `isMedicationPause` accepts an open pause (no `endDate`) and a closed one;
   rejects `endDate < startDate`; rejects a non-string `reason`.
2. **`isDateInPause`** — inclusive at both boundaries; an ongoing pause (`endDate` absent)
   matches every date on/after `startDate`.
3. **`computeAdherence` regression + new behavior (claim corrected — panel — TS lens must-fix).**
   An earlier draft claimed `pauses: []` (or the omitted default) produces **byte-identical
   output**, including in the existing suite unchanged. That's not quite right: `AdherenceSummary`
   gains two **always-present** fields (`pausedCount`, `pausedDates`), so the returned object
   literal always carries them — the existing assertion in
   `lib/__tests__/report-metrics.test.ts` that does
   `expect(computeAdherence(rows)).toEqual({ takenCount, notTakenCount, noEntryCount,
notTakenDates, noEntryDates })` (five keys, no paused fields) **will fail** once the fields are
   added, and must be updated to include `pausedCount: 0, pausedDates: []`. This is a deliberate,
   required test-file edit, not an unintended regression — call it out as such rather than
   asserting the suite needs no changes. The actual regression guarantee, restated correctly: with
   no pauses logged, `takenCount`/`notTakenCount`/`noEntryCount` and their date lists hold the
   exact same **values** as before, and the two new fields are `0`/`[]`. Separately: a pause
   covering some `doseTaken: false` days moves exactly those dates from `notTakenCount`/
   `notTakenDates` into `pausedCount`/`pausedDates`, and leaves `noEntryCount`/`takenCount`
   untouched; a day with no morning check-in inside a pause window still counts as `noEntry`, not
   `paused`.
4. **Backup round-trip** — `buildBackup` includes `medicationPauses`; `parseBackup` on a
   pre-feature backup defaults it to `[]`; `restoreBackup` persists it via
   `saveMedicationPauses` in its `Promise.all` (the same must-fix pattern this batch's docs 17/24/
   25 already established — applied here from the start).
5. **Report/Trends render** — a pause renders its dated range + reason, escaped; the adherence
   section stays two-bucket when no pause overlaps the shown range, three-bucket when one does.

## Gate compliance

No `any`/`!`/`@ts-*`/eslint-disable. `AdherenceSummary`'s new fields are additive, not
restructured — every existing consumer that destructures the old fields keeps compiling.
`computeAdherence`'s new parameter is optional with a default, so no call site is forced to
change. `isMedicationPause` binds `startDate` to a local narrowed variable before reusing it,
rather than re-indexing the checked key (see Storage). No new `assertNever` obligation
(`MedicationPause` is a flat interface, not a union). Additive `Backup` field, additive
`STORAGE_KEYS` entry → no migration, no forced re-onboarding. `npm run check` must pass before
commit — which includes **updating**, not merely re-running unchanged, the existing
`report-metrics.test.ts` assertion that pins `computeAdherence`'s exact return shape (see Test
plan item 3's corrected claim).

## Dependencies & sequencing

**The full landed-code footprint, enumerated (panel — scope lens must-fix: an earlier draft
understated this to "just `report-metrics.ts`").** This is the one doc in this round that edits
already-shipped code, and the honest list is larger than one file, even though every change is
additive:

- `lib/report-metrics.ts` — `AdherenceSummary`/`computeAdherence` (the reclassification logic
  itself). Doc 16's `beforeAfterDose` already consumes `computeAdherence`
  (`report-metrics.ts:171-172`); confirmed its `beforeAdherence`/`afterAdherence` call sites
  compile unchanged since the new parameter is optional.
- `lib/backup.ts` — `Backup` gains `medicationPauses`; `buildBackup`/`parseBackup` gain the
  corresponding parameter/parse branch (the same additive pattern docs 17/24/25 already
  established in this batch).
- `lib/storage.ts` — `restoreBackup`'s `Promise.all` gains `saveMedicationPauses(...)`, alongside
  the new `loadMedicationPauses`/`saveMedicationPauses`/`appendMedicationPause`/
  `endMedicationPause` functions and the new `STORAGE_KEYS` entry.
- `app/(tabs)/settings.tsx` — the sole `buildBackup` call site (export flow) must load and pass
  `medicationPauses`, or the JSON export silently omits pauses despite the type supporting them.

**Sequencing flag:** doc 11 also adds a parameter to `buildBackup` (`visits`). If both land
around the same time, the single call site in `app/(tabs)/settings.tsx` needs both parameters
added together — additive and non-conflicting, but worth naming so whoever implements either doc
doesn't silently clobber the other's parameter addition. Otherwise independent of every other doc
in this batch and the prior round.

## Alternatives considered

- **A new discriminated union on `DoseChange` (`{ kind: 'dose' } | { kind: 'pause' }`) instead of
  a separate `MedicationPause` list:** rejected — `DoseChange` represents a point-in-time dose
  change with no natural "end," while a pause is inherently a range; forcing both into one union
  would need every existing `DoseChange` consumer to add a new `switch` arm for a concept that
  doesn't affect dose amount/unit at all.
- **Auto-inferring a pause from N consecutive missed doses:** rejected — see Non-goals; an
  inferred pause could easily be wrong (a genuinely concerning stretch of missed doses
  masquerading as "planned"), which is exactly the honesty problem this doc exists to prevent in
  the other direction.
- **Hiding daily reminders automatically during a pause:** rejected — a pause is about dosing,
  not about whether the user still wants to log check-ins or be reminded to; conflating the two
  would add a surprising side effect to a data-entry action.

## Panel review

Run through the 4-lens panel (2026-07-23): approve-with-changes on all four lenses (the highest
must-fix count in this round, matched by this doc being the highest-priority and most
landed-code-touching one). Must-fixes applied above.

- **Clinical — approve-with-changes.** _Must-fix (applied):_ label the new adherence bucket
  "Paused (patient-reported)" rather than a bare "Paused," so a provider can't misread it as the
  app adjudicating which missed doses were excused — the reclassification itself is sound
  precisely because it only ever reflects a fact the patient explicitly asserted, never an
  inference, but the report copy needs to say so. _Definitive verdict on the flagged copy
  question:_ the proposed line — "As with any change to your medication, this is worth discussing
  with your provider" — is **approved as-is**. It reads as this app's existing house-style
  deferral (`CLAUDE.md`: "log this and discuss with your provider"), gives no dose guidance or
  taper instruction, and correctly omits the Problem section's rebound-discontinuation rationale
  from user-facing copy (naming that would be advice; the doc rightly keeps it out).
- **Strict-TypeScript architect — approve-with-changes.** _Must-fixes (applied):_ `isMedicationPause`
  re-indexed `value['startDate']` a second time to compare against `endDate`, which does not
  compile under this codebase's guard conventions (a re-read of a checked index-signature key
  loses its narrowing) — fixed by binding `startDate` to a local `const` once and reusing it.
  Corrected the false "byte-identical / existing suite unchanged" regression claim: the new
  always-present `pausedCount`/`pausedDates` fields mean the existing exact-shape `toEqual`
  assertion in `report-metrics.test.ts` must be **updated** (not left alone) to include them as
  `0`/`[]` — restated the real guarantee as "the taken/notTaken/noEntry values are unchanged," not
  "the object is byte-identical." Confirmed the default-parameter backward-compat approach is
  otherwise sound against every real call site.
- **Mobile UX / friction — approve-with-changes.** Start/end-pause in Settings mirrors the Visits
  section — low-friction, no daily-flow impact, correctly justified as the one always-on
  (non-collapsible) new Trends layer in this round given what it's fixing (a real honesty gap).
  _Must-fixes (applied):_ specified that the shaded band must render behind the bars and stay
  distinguishable even with smoothing on (the hardest combined-layer case), must align to the
  same date axis across every metric block, and requires a dedicated screenshot of exactly that
  combined worst-case state per `CLAUDE.md`'s screenshot rule — not a generic Trends screenshot.
- **Data-model / migration + privacy + scope — approve-with-changes.** The strongest data-model
  and scope case in this round — corrects a real honesty gap, fully descriptive, no auto-inference,
  `restoreBackup` threading present from the start. _Must-fix (applied):_ the "one place that
  edits landed code" framing understated the real footprint — enumerated the full list
  (`lib/report-metrics.ts`, `lib/backup.ts`, `lib/storage.ts`'s `restoreBackup`, and the
  `buildBackup` call site in `app/(tabs)/settings.tsx`) and flagged the co-landing consideration
  with doc 11's own `buildBackup` parameter addition.
