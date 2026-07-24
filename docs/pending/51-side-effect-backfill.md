> **Status:** Proposed (2026-07-23) · **Priority:** P2 · Ref: innovation batch, round 6

# Multi-day side-effect backfill

## Problem / Context

Side effects rarely arrive as a single, cleanly-remembered day — a headache that lingers for
three days, nausea across a whole rough week — but today the only way to log one is one evening
check-in at a time. If a patient remembers on Thursday that they'd had a mild headache since
Monday, correctly recording that means opening `entry/[date].tsx` for Monday, Tuesday, and
Wednesday individually and toggling the same chip three separate times — real friction for a
genuinely common pattern, and exactly the kind of retroactive, multi-day correction doc 46's own
"same-day" edit affordance doesn't reach (that doc is explicitly about the moment right after a
save, not a multi-day span noticed later). This doc adds a single action that applies one side
effect + severity across a **date range** in one step, landing into whichever days in that range
already have an evening check-in — never fabricating a new one.

## Goals / Non-goals

**Goals**

1. A single action, reachable from **History** (panel — UX lens; see UI below), that applies
   one `SideEffect` + `SideEffectSeverity` to every day in a selected date range that **already
   has** an `EveningCheckin` — via a dedicated "ensure present at severity" merge (panel —
   strict-TS lens; see Core logic below), not the single-day toggle sequence.
2. Days in the range with **no** existing evening check-in are silently skipped — never
   fabricated. A gap in the log stays a gap; this doc corrects existing records, it does not
   invent new ones to attach a side effect to.
3. A brief, honest confirmation before applying (how many days will actually be affected, since
   the count of "days in range" and "days that will actually change" can differ once gaps are
   accounted for) — this is a bulk-write action across potentially many days, and deserves a
   clearer confirmation than a single day's toggle already gets.
4. Every day this action touches is marked with a provenance fact that it was bulk-backfilled
   rather than entered contemporaneously (panel — clinical lens; see Data model below), so a
   provider or a future read of the record can tell the difference.

**Non-goals**

- **No creation of new `DayEntry`/`EveningCheckin` records.** See Goals #2 — this is strictly a
  merge into existing records, never a backfill of check-ins that were never done. A patient who
  wants to also retroactively fill in a missing day's full check-in still uses the existing
  `entry/[date].tsx` editor for that, unrelated to this doc.
- **No change to any other field on the days it touches.** This action touches exactly one
  side effect's presence/severity on each affected day's `EveningCheckin.sideEffects` — ratings,
  notes, context tags (if doc 07 lands), and every other field on those days are completely
  untouched. A bulk action that could accidentally overwrite a mood rating while "just" backfilling
  a side effect would be a serious regression this doc's design explicitly avoids.
- **No removal via the same range action in v1.** This doc adds a side effect across a range; it
  does not also offer bulk-_removal_ of a mistakenly-applied one — see Alternatives for why a
  simple per-day undo (already available via the existing day editor) is judged sufficient for
  correcting a bulk-add mistake, rather than building a symmetric bulk-remove action immediately.
- **No inference of severity from anything.** The user picks one severity, applied uniformly
  across every affected day in the range — this doc does not attempt to model "probably worse in
  the middle of the range" or any other shape; a uniform severity across the range is the honest
  limit of what a retrospective bulk action can claim to know.

## Data model (`lib/types.ts`)

`SideEffectDetail.origin` (currently `'migrated'`, added for the migrate-on-read case) gains a
second literal:

```ts
export interface SideEffectDetail {
  readonly severity: SideEffectSeverity;
  readonly origin?: 'migrated' | 'backfilled';
}
```

**(panel — clinical lens, must-fix.)** A record this action writes is never indistinguishable
from one entered on the day itself. `origin: 'backfilled'` is set on every day this action
touches; the report's side-effect summary (`lib/report-html.ts`) renders a small "(backfilled)"
qualifier next to any such entry, matching the existing precedent of surfacing provenance
honestly rather than presenting a bulk-entered fact as if it were logged in the moment.

## Core logic (`lib/schema.ts` + `lib/side-effect-backfill.ts`, new, RN-free)

**(panel — strict-TypeScript lens, must-fix; corroborated by the scope lens.)** The original
version of this doc proposed looping the single-day `withSideEffectToggled` followed by
`withSideEffectSeverity`. That sequence is broken for exactly the case this doc exists to serve:
if a day in the range **already has** the effect selected (e.g. the patient toggled it on
manually for one day in the middle of the range, then wants to backfill the rest),
`withSideEffectToggled` sees it present and **removes** it — `withSideEffectToggled`
(`lib/schema.ts:130-144`) is a genuine toggle, not a "select" — and the subsequent
`withSideEffectSeverity` call is then a no-op against an effect that toggling just deleted
(`lib/schema.ts:147-154`'s own doc comment: "No-op if not selected"). The net result is data
loss on exactly the days that were already correctly recorded, the opposite of this doc's stated
purpose.

The fix is a new `lib/schema.ts` export that **sets** an effect to a severity unconditionally —
present or not, on or off — rather than composing a toggle with a conditional setter:

```ts
/**
 * Ensures `effect` is present at exactly `severity`, creating it if absent. Unlike
 * `withSideEffectToggled`, calling this on an already-present effect never removes it — there is
 * no toggle semantic here, only "make it true that this effect is recorded at this severity."
 * `origin` defaults to unset (a manual single-day entry); backfill call sites pass `'backfilled'`
 * explicitly.
 */
export function withSideEffectAtSeverity(
  reports: SideEffectReports,
  effect: SideEffect,
  severity: SideEffectSeverity,
  origin?: SideEffectDetail['origin'],
): SideEffectReports {
  return { ...reports, [effect]: origin === undefined ? { severity } : { severity, origin } };
}
```

This is additive to `lib/schema.ts` — `withSideEffectToggled`/`withSideEffectSeverity` are
unchanged and keep serving the single-day check-in flow exactly as today; `backfillSideEffect`
below is the only caller of the new function for now.

```ts
export interface BackfillResult {
  readonly updatedDates: readonly IsoDate[]; // days that actually had an EveningCheckin to merge into
  readonly skippedDates: readonly IsoDate[]; // days in range with no evening check-in — untouched
}

/**
 * Computes which days in [start, end] would be updated vs. skipped by applying `effect` at
 * `severity` — a pure preview function, used both to build the confirmation count and to drive
 * the actual writes, so the number shown in the confirmation is guaranteed to match what
 * actually happens (no separate "preview count" logic that could drift from the real merge).
 */
export function previewSideEffectBackfill(
  entries: Readonly<Record<IsoDate, DayEntry>>,
  start: IsoDate,
  end: IsoDate,
): BackfillResult {
  const updatedDates: IsoDate[] = [];
  const skippedDates: IsoDate[] = [];
  for (const date of datesInRange(start, end)) {
    (entries[date]?.evening !== undefined ? updatedDates : skippedDates).push(date);
  }
  return { updatedDates, skippedDates };
}
```

The actual write (in `lib/storage.ts`, alongside `saveCheckin`) loops `updatedDates`, and for
each, loads that day's existing `EveningCheckin` and applies the new `withSideEffectAtSeverity`
above with `origin: 'backfilled'`, then writes the result back via the existing `saveCheckin`
path.

```ts
export interface BackfillWriteResult extends BackfillResult {
  readonly failedDates: readonly IsoDate[]; // updatedDates that threw during write — partial run
}

/**
 * (panel — scope lens, must-fix.) Per-day writes are independent `saveCheckin` calls, not one
 * atomic transaction — a throw partway through leaves the days written before it changed and the
 * rest untouched. `failedDates` reports exactly which ones did not complete so the caller can show
 * an honest partial-success result and let the user re-run the same range (idempotent — re-running
 * `withSideEffectAtSeverity` against an already-backfilled day just re-asserts the same value)
 * rather than silently claiming full success or throwing past a partial write with no record of
 * where it stopped. `saveCheckin`'s own quarantine safety net (doc 03) is unaffected: if the
 * `entries` store were ever corrupt, the *first* iteration's `saveCheckin` call surfaces and
 * quarantines it exactly as a single-day save would, and every subsequent iteration in the same
 * run then sees the already-cleaned store — the loop never races its own quarantine handling.
 */
export async function backfillSideEffect(
  start: IsoDate,
  end: IsoDate,
  effect: SideEffect,
  severity: SideEffectSeverity,
): Promise<BackfillWriteResult> {
  const entries = await loadEntries();
  const result = previewSideEffectBackfill(entries, start, end);
  const failedDates: IsoDate[] = [];
  for (const date of result.updatedDates) {
    const evening = entries[date]?.evening;
    if (evening === undefined) continue; // narrows what previewSideEffectBackfill already guarantees
    try {
      const sideEffects = withSideEffectAtSeverity(
        evening.sideEffects,
        effect,
        severity,
        'backfilled',
      );
      await saveCheckin(date, { session: 'evening', checkin: { ...evening, sideEffects } });
    } catch {
      failedDates.push(date);
    }
  }
  return { ...result, failedDates };
}
```

`datesInRange`, `loadEntries`, `saveCheckin` are existing, landed, unmodified exports;
`withSideEffectAtSeverity` is the one new `lib/schema.ts` export described above — this file's
only real contribution is the range-iteration wrapper and partial-failure bookkeeping around it.

## UI (`app/(tabs)/history.tsx`)

**(panel — UX lens, must-fix.)** **History only** — not "History or Settings." This is a
day-range data-correction action, not a preference, so it belongs on the day-browsing surface
where the days themselves are visible, matching where a user would actually notice the gap
they're trying to fix. It is a **secondary, overflow-menu action** ("Backfill a side effect
across several days…" behind a "…" / overflow control on the History screen), never a
permanently-visible primary button — this is a rare, deliberate correction action, not a
frequent one, and it must not add standing chrome to a screen most visits never need it on
(matching this batch's repeated discipline against permanent UI for a rare case, e.g. doc 48's
Settings section).

Flow: pick a start/end date (reusing the same native date-picker pattern doc 11's Visit entry and
doc 17's Measurement entry already establish), pick one side effect + severity (reusing the
existing `Chips`-adjacent severity-picker UI from the check-in flow), then a confirmation showing
the real, computed count: **"Will add {effect label} ({severity}) to {n} days that have an
evening check-in. {m} days in this range have no evening check-in and won't be affected."** —
both numbers computed by the same `previewSideEffectBackfill` the actual write uses, so the
confirmation can never overstate or understate what's about to happen. If `backfillSideEffect`
returns any `failedDates`, the result screen states that count plainly ("{k} days could not be
updated — you can re-run the same range to retry") rather than reporting a flat success.

## Test plan (`lib/__tests__/side-effect-backfill.test.ts`, `lib/__tests__/schema.test.ts`)

1. `previewSideEffectBackfill` — a range with a mix of days-with-evening-checkins and
   days-without splits correctly into `updatedDates`/`skippedDates`; an all-gap range returns an
   empty `updatedDates`; agreement-checked against a hand-constructed fixture.
2. `withSideEffectAtSeverity` (`schema.test.ts`, alongside the existing
   `withSideEffectToggled`/`withSideEffectSeverity` cases) — the load-bearing unit test for this
   doc's core fix: given a
   `SideEffectReports` where `effect` is **already present** at some severity, calling it with a
   different severity **updates** the severity and keeps the effect present (does not remove it)
   — the exact case the original toggle-then-set sequence got wrong; given an absent effect, it
   creates it; the `origin` argument round-trips onto the stored detail.
3. `backfillSideEffect` — applied across a range, every day in `updatedDates` gains the effect at
   the given severity with `origin: 'backfilled'`; every other field on each touched day's
   `EveningCheckin` (ratings, notes) is byte-identical before and after — the load-bearing test
   for this doc's own "no other field changes" Non-goal; days in `skippedDates` are completely
   untouched, confirmed by an explicit equality check on the whole `entries` map restricted to
   those dates. A day that **already has the effect selected** (set up as fixture state before
   the backfill call) still has it present, at the newly-applied severity, afterward — the direct
   regression test for the bug this doc's rework fixes.
4. **Idempotence** — running the same backfill twice produces the same result the second time; a
   day already carrying the effect at the target severity before either run keeps carrying it,
   at the same severity, after both.
5. **Partial failure** — a fixture where one date's `saveCheckin` call is forced to throw (mocked)
   confirms that date lands in `failedDates`, every other date in `updatedDates` still completes,
   and the function does not throw past the loop.

## Gate compliance

No `any`/`!`/`@ts-*`/eslint-disable. `SideEffectDetail.origin` gains one additional string
literal (`'backfilled'`) — additive to an already-optional field, no migration, existing backups
and existing `'migrated'` values remain valid as-is. No new `Backup`/`STORAGE_KEYS` surface; this
doc writes into the existing `EveningCheckin.sideEffects` shape. `npm run check` must pass before
commit.

## Dependencies & sequencing

Independent of every other doc in this batch and prior rounds. Builds on landed code
(`saveCheckin`, `loadEntries`, `datesInRange`) plus the one new `lib/schema.ts` export this doc
itself introduces (`withSideEffectAtSeverity`); `withSideEffectToggled`/`withSideEffectSeverity`
remain exactly as landed, serving the single-day check-in flow unchanged.

## Alternatives considered

- **A symmetric bulk-remove action in the same v1:** rejected — see Non-goals; a mistaken bulk
  application is correctable one day at a time via the existing `entry/[date].tsx` editor (which
  already lets a user untoggle a chip on any specific day), and building a second bulk action
  immediately, before confirming the add-side is actually used and useful, is premature scope.
- **Allowing the range action to also create missing evening check-ins (with only the side
  effect filled in, everything else blank):** rejected — a `DayEntry` with a fabricated,
  otherwise-empty `EveningCheckin` would be a stranger, less honest record than a clean gap; this
  app's tolerant-parsing/data-integrity discipline (doc 03) is built around never inventing data
  that wasn't actually entered, and this doc holds that line for the same reason.
- **Varying severity across the range (e.g. a simple ramp) instead of one uniform value:**
  rejected — see Non-goals; a retrospective bulk action has no real basis to claim it knows how
  severity varied day to day within the range, and a uniform value is the honest limit of what
  it can assert.

## Panel review

Run through the 4-lens panel (2026-07-23): **reject** (strict-TypeScript), corroborated by
**approve-with-changes, scope-critical** (data-model/scope); **approve-with-changes** (clinical,
mobile UX). The original design's core merge logic was broken and has been fully reworked above,
not patched.

- **Clinical — approve-with-changes.** Required a provenance marker distinguishing
  bulk-backfilled entries from contemporaneous ones — added `origin: 'backfilled'` on
  `SideEffectDetail` (extending the existing `'migrated'` precedent) and a report-side
  "(backfilled)" qualifier, so a provider reading the record can tell a bulk correction from a
  day-of entry.
- **Strict-TypeScript architect — reject, fix applied.** Caught the load-bearing bug: looping
  `withSideEffectToggled` (a genuine toggle) followed by `withSideEffectSeverity` (a no-op on
  absent effects) **deletes** an already-present effect instead of confirming it — the exact
  opposite of this doc's purpose on any day that was already correctly recorded. Replaced with a
  new, additive `withSideEffectAtSeverity` export that unconditionally sets presence + severity,
  with a direct regression test and a corrected Idempotence test.
- **Mobile UX / friction — approve-with-changes.** Required committing to a single entry point
  (History, not "History or Settings") and specifying this as a secondary/overflow action rather
  than a permanently-visible button, matching this batch's discipline against standing chrome for
  a rare action.
- **Data-model / migration + privacy + scope — approve-with-changes, corroborating the TS
  reject.** Independently flagged the same toggle-then-set bug from the data-integrity angle
  (silent data loss on a bulk write is a scope-of-harm concern, not just a type error) and
  required explicit partial-failure semantics for the multi-day write loop (`failedDates`) plus a
  stated, verified answer on how the loop interacts with doc 03's quarantine mechanism (safe: the
  first `saveCheckin` call in a run handles any pre-existing corruption; later iterations see the
  cleaned store).
