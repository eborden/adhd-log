> **Status:** Proposed (2026-07-23) · **Priority:** P2 · Ref: innovation batch, round 3

# Medication supply / refill countdown

## Problem / Context

Doc 12 (dose adherence & timing, pending) enriches a missed dose with a self-selected reason;
doc 31 (this batch, planned medication pause) distinguishes a deliberate pause from unexplained
non-adherence. Neither covers a third, common cause of a run of missed days: **running out**
(pharmacy delays, insurance prior-authorization holds, a forgotten refill) — a personal
logistics problem every patient on a chronic medication runs into eventually, and one this app
currently gives no way to even privately track.

**Scope correction, stated up front (panel — clinical lens must-fix).** An earlier draft framed
this as closing a provider-facing adherence-_attribution_ gap — the idea that a "ran out" cause
would help a prescriber distinguish it from unexplained non-adherence the way doc 31's pause
does. That overstated the feature's actual reach: this doc's own Report section (below)
deliberately keeps supply off every provider-facing surface, so it does **not** in fact
distinguish anything in the data a prescriber ever sees. What it actually is — and the honest
frame for the rest of this doc — is a **personal logistics aid**: a private countdown the
patient can check, with no clinical claim attached. If a genuinely provider-facing "ran out"
signal is ever wanted, it would have to be a **patient-reported reason** entered at the time
(mirroring doc 12's per-day reason field or doc 31's pause range), never inferred from a
countdown hitting zero — an app-inferred "you ran out" is exactly the kind of adherence
attribution doc 31 was written to keep this app out of, and this doc must not quietly reintroduce
it through a different door.

This doc adds the smallest thing that serves that narrower, honest goal: a simple, self-reported
supply count the patient updates on refill, and a plain countdown derived from it — purely
descriptive, no pharmacy integration, no ordering, no reminders about _which_ pharmacy or _when_
insurance renews.

## Goals / Non-goals

**Goals**

1. A `MedicationSupply` record — a dose count on hand, recorded on a date — stored as its own
   append-only list, entered whenever the user refills (mirroring the `DoseChange`/`Visit`
   append-only shape this repo already uses for every other episodic fact).
2. A pure countdown: doses remaining = the most recent supply snapshot's count, minus taken
   doses logged since that snapshot's date.
3. A quiet Settings/Today indicator ("~12 doses left, based on your logged pace") — descriptive
   only, never a purchase link, pharmacy contact, or refill-ordering flow.
4. Full storage-boundary guard, `Backup` round-trip, `restoreBackup` write, Vitest coverage.

**Non-goals**

- **No pharmacy/ordering integration of any kind.** No API, no "order refill" button, no
  pharmacy contact info stored. This is a count and a countdown, nothing more — a much narrower
  scope than a full medication-supply-chain feature.
- **No unit-amount tracking (mg/mL).** Supply is counted in **doses** (however many times the
  current regimen can be taken), not milligrams or milliliters — avoids any dose-amount-unit
  conversion complexity entirely, and matches how people actually think about a refill ("30
  tablets left," not "600mg left"). If `DoseChange` changes the dose amount mid-supply, the
  countdown still counts in doses, unaffected — a "dose" here means "one day's regimen," whatever
  it currently is.
- **No automatic reminder to refill "before you run out."** The countdown is a passive number to
  check, not a proactive nudge — see Alternatives for why a low-supply push notification is
  deferred, not built here.
- **No retroactive adjustment for skipped/paused days.** The countdown counts every logged
  `doseTaken: true` day against supply, and every `doseTaken: false`/no-entry day does **not**
  consume supply — including days inside a doc 31 `MedicationPause`, which already means no dose
  was taken and therefore already correctly doesn't decrement the count. No special-case
  interaction code is needed between the two doc — the countdown's "only taken doses consume
  supply" rule already produces the right answer for a paused day.

## Data model (`lib/types.ts`)

```ts
export interface MedicationSupply {
  readonly dosesOnHand: number; // a non-negative count, e.g. "30 tablets" — 0 is a valid ("empty") snapshot
  readonly recordedDate: IsoDate; // the day this count was true (typically "today" when refilled)
}
```

`dosesOnHand` is a plain `number`, not branded — a physical count validated at the parse
boundary (finite, positive), the same category as `Dose.amount`/`sleepHours` rather than a
domain identifier warranting a brand.

## Storage (`lib/storage.ts`)

Mirrors the `DoseChange` seam exactly:

```ts
export function isMedicationSupply(value: unknown): value is MedicationSupply {
  if (!isRecord(value) || !isIsoDate(value['recordedDate'])) return false;
  const dosesOnHand = value['dosesOnHand'];
  return typeof dosesOnHand === 'number' && Number.isFinite(dosesOnHand) && dosesOnHand >= 0;
}

export function isMedicationSupplyList(value: unknown): value is readonly MedicationSupply[] {
  return isUnknownArray(value) && value.every(isMedicationSupply);
}
```

`STORAGE_KEYS` gains `medicationSupply: 'medicationSupply'` (bare key, matching every other
entry). `loadMedicationSupply`/`saveMedicationSupply`/`appendMedicationSupply` mirror
`loadDoseChanges`/`saveDoseChanges`/`appendDoseChange` exactly — tolerant per-element load,
sorted-by-`recordedDate` append (a later refill entry naturally supersedes an earlier one as
"most recent" without needing to delete the older record, which stays as historical context).

## Core logic (`lib/supply.ts`, new, RN-free)

```ts
export type SupplyCountdown =
  | { readonly kind: 'unknown' } // no supply ever recorded
  | { readonly kind: 'known'; readonly dosesRemaining: number; readonly asOf: IsoDate };

/**
 * Doses remaining, counted from the most recent supply snapshot minus every taken dose logged
 * since. Never goes negative in the returned value — a countdown that would go below zero
 * floors at 0. **This is a hedged estimate, never asserted as fact (panel — clinical lens
 * must-fix):** the app cannot verify a physical pill count, so a `0` result must render as
 * "~0 doses left, based on your logged pace" — the same hedge every other value carries — never
 * a bare "You're out of medication," which would assert something the app has no way to confirm
 * (the user may have refilled without logging it, or the original count may have been off).
 */
export function computeSupplyCountdown(
  supplies: readonly MedicationSupply[],
  entries: Readonly<Record<IsoDate, DayEntry>>,
  today: IsoDate,
): SupplyCountdown {
  if (supplies.length === 0) return { kind: 'unknown' };
  const latest = supplies.reduce((a, b) =>
    a.recordedDate.localeCompare(b.recordedDate) >= 0 ? a : b,
  );
  const takenSince = datesInRange(latest.recordedDate, today).filter(
    (date) => entries[date]?.morning?.doseTaken === true && date !== latest.recordedDate,
  ).length;
  return {
    kind: 'known',
    dosesRemaining: Math.max(0, latest.dosesOnHand - takenSince),
    asOf: today,
  };
}
```

`datesInRange` is the existing, landed pure helper (`lib/storage.ts:434-442`). The snapshot date
itself is excluded from "taken since" (`date !== latest.recordedDate`) so recording a refill on
the same day a dose was already taken doesn't double-count that day's dose against the fresh
count — the snapshot is read as "as of the start of this day."

## UI (`app/(tabs)/settings.tsx`, and `app/(tabs)/index.tsx`)

**Settings — "Medication supply" section**, structurally identical to the Visits/Measurements
entry pattern already established: a numeric-keypad "doses on hand" field + "Record refill"
button appending a new `MedicationSupply` dated today. A reverse-chronological list of past
snapshots below, for context (no delete — matches `DoseChange`'s append-only posture). The
indicator reads "~{dosesRemaining} doses left, based on your logged pace" — the hedge is part of
the copy, not an afterthought (see Core logic).

**Today tab — a quiet, optional line**, only rendered when `computeSupplyCountdown` returns
`kind: 'known'`: "~{dosesRemaining} doses left, based on your logged pace" — **the same hedged
wording as the Settings indicator (panel — clinical lens must-fix: an earlier draft dropped the
qualifier on this surface, leaving a bare number that could read as an authoritative pharmacy
count)**. Absent entirely when no supply has ever been recorded — a feature that requires
opting in by using it once, never a blank/zero state nagging someone who's never engaged with
it. Placed in doc 35's established Today-tab secondary-card ordering/cap convention (this doc's
line sits last in that priority order — see `35-backup-reminder.md`'s "Today-tab card ordering
and cap" section — rather than this doc independently deciding its own position).

**No low-supply alert in v1** — see Alternatives.

## Report and portal digest

**None, deliberately, on both surfaces.** Supply is a forward-looking personal logistics number
("how many are left"), not a provider-facing historical fact the way `DoseChange`/`Visit`/vitals
are — it says nothing about how the patient has been doing, only how much medication remains on
hand. Omitted from the PDF report (doc 06) and the portal digest (doc 30) for that reason. This
is the scope boundary the Problem section's correction, above, depends on: keeping supply off
every provider-facing surface is precisely what keeps this a logistics aid rather than a
disguised adherence-attribution claim.

## Backup (`lib/backup.ts`, `lib/storage.ts`)

**Spelled out explicitly, not left to the test plan to imply (panel — scope lens must-fix).**
Following the exact template `Backup.weekly` already establishes (`lib/backup.ts:60-69`:
present-but-malformed fails the parse, an absent key defaults to empty):

- `Backup` gains `readonly medicationSupply: readonly MedicationSupply[];`.
- `buildBackup` gains a `medicationSupply` parameter, threaded from its call site.
- `parseBackup` defaults a **missing** `medicationSupply` key to `[]` (a pre-feature backup) but
  still hard-fails a **present-but-malformed** value, via `isMedicationSupplyList`.
- `restoreBackup`'s `Promise.all` (`lib/storage.ts:633-640`) gains
  `saveMedicationSupply(backup.medicationSupply)`, alongside every other store it already writes
  — a restore that parses but doesn't persist this field would silently drop it, the exact
  must-fix this batch's docs 17/24/25/31 already established and this doc now states in its own
  design body rather than only asserting it via test coverage.

## Test plan (`lib/__tests__/supply.test.ts`)

1. **Guards** — `isMedicationSupply` accepts a valid record; rejects a negative/NaN/non-finite
   `dosesOnHand`; rejects a malformed `recordedDate`.
2. `computeSupplyCountdown` — no supplies ⇒ `{ kind: 'unknown' }`; a snapshot with no taken doses
   since ⇒ `dosesRemaining` equals the snapshot's count exactly; each taken-dose day since
   decrements by exactly one; the snapshot's own date is excluded from the "since" count even
   when that day's dose was taken; the count floors at `0`, never negative, once taken doses
   exceed the snapshot; multiple supply snapshots ⇒ only the most recent one anchors the
   countdown (an earlier one is superseded, not summed).
3. **Backup round-trip** — `buildBackup` includes `medicationSupply`; `parseBackup` on a
   pre-feature backup defaults it to `[]`; `restoreBackup` persists it via
   `saveMedicationSupply` in its `Promise.all`.

## Gate compliance

No `any`/`!`/`@ts-*`/eslint-disable. `SupplyCountdown` is a discriminated union; any render site
switches on `.kind` to an `assertNever` default. `Math.max(0, …)` is a plain numeric floor, not a
cast or assertion. Additive `Backup` field, additive `STORAGE_KEYS` entry → no migration, no
forced re-onboarding. `npm run check` must pass before commit.

## Dependencies & sequencing

Independent of every other doc in this batch and prior rounds. Interacts cleanly, with zero
special-case code, with doc 31's `MedicationPause` (see Non-goals) — the two land in either order
with no coordination required.

## Alternatives considered

- **A push notification when supply runs low (e.g. "5 doses left — time to refill?"):** deferred,
  not rejected outright — this is the single most tempting next step and arguably the highest-
  value one, but it introduces a genuinely new class of reminder (proactive, threshold-triggered,
  urgency-implying) that doc 22's reminder-timing work and every existing notification in this
  app deliberately avoid (nothing today fires based on a computed threshold rather than a fixed
  time-of-day). Left as a named follow-on once the passive countdown itself has been used and
  the right threshold/urgency framing can be designed deliberately, rather than bundled in here.
- **Tracking supply in dose-amount units (mg/mL) instead of a plain dose count:** rejected — see
  Non-goals; a plain count matches how refills are actually thought about and sidesteps unit
  conversion entirely, including across a `DoseChange` that alters the amount mid-supply.
- **Auto-decrementing supply from `DoseChange`'s own dose amount rather than a separate taken-dose
  count:** rejected — supply is consumed by doses actually **taken**, not by the regimen's
  nominal schedule; a missed day (for any reason) correctly doesn't consume a unit of supply,
  which the chosen `doseTaken === true` count already gets right without extra logic.

## Panel review

Run through the 4-lens panel (2026-07-23): approve (strict-TS), approve-with-changes (clinical,
scope), approve (UX, folded into doc 35's ordering convention). Must-fixes applied above.

- **Clinical — approve-with-changes.** _Must-fixes (applied):_ the Problem section oversold the
  feature as a provider-facing adherence-attribution fix, but the doc's own Report section keeps
  supply off every provider-facing surface — reframed as an honest personal-logistics aid, with
  an explicit statement that a genuinely provider-facing "ran out" signal would have to be
  patient-reported (mirroring doc 12/31's discipline), never inferred from a countdown hitting
  zero. The zero-state and the Today-tab line both now carry the same "~N doses left, based on
  your logged pace" hedge the Settings indicator already had, rather than a bare number/"out"
  that would assert a physical fact the app can't verify. _Confirmed sound, not changed:_ the
  countdown decrementing only on `doseTaken === true` (never on a missed/paused day) means the
  number can never read as "you should have taken these," and the deferred low-supply push
  notification is the right line to hold, not overly cautious — it would be a genuinely new class
  of threshold-triggered reminder this app deliberately avoids elsewhere.
- **Strict-TypeScript architect — approve.** `isMedicationSupply`/`isMedicationSupplyList` mirror
  the real `isDoseChange`/`isDoseChangeList` seam faithfully; `computeSupplyCountdown`'s
  `.reduce` (guarded by the preceding length check), `entries[date]?.morning?.doseTaken` chain
  under `noUncheckedIndexedAccess`, and `Math.max(0, …)` floor are all sound with no `!`/cast.
  `SupplyCountdown` is a proper `assertNever`-able discriminated union. No must-fix.
- **Mobile UX / friction — approve.** The Settings refill-entry flow correctly reuses the
  established Visits/Measurements episodic-entry pattern rather than feeling like an odd
  addition, and the Today line is properly opt-in (rendered only once supply has ever been
  recorded). No must-fix. _Resolved via doc 35:_ this doc's Today-tab line now sits in doc 35's
  owned ordering/cap convention rather than independently choosing its own position.
- **Data-model / migration + privacy + scope — approve-with-changes.** The "no pharmacy/ordering
  integration" boundary was confirmed held consistently across every section. _Must-fix
  (applied):_ the actual `lib/backup.ts` edits (the `Backup` field, `buildBackup` parameter, and
  `parseBackup`'s tolerant-default-to-`[]` behavior) were only implied by the test plan rather
  than specified in the design body — added an explicit Backup section pointing at `weekly`'s
  exact precedent, the seam this batch has repeatedly needed to call out concretely. _Also
  applied:_ the `dosesOnHand` comment said "a positive count" while the guard accepts `0` (a
  legitimate "empty" snapshot) — relaxed the comment to match the guard, not the other way
  around.
