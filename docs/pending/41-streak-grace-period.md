> **Status:** Proposed (2026-07-23) · **Priority:** P2 · Ref: innovation batch, round 4 ·
> **Directly motivated by this batch's own doc 34 clinical must-fix
> ([`34-home-screen-widget.md`](34-home-screen-widget.md))**

# Streak grace period

## Problem / Context

This same batch's doc 34 (home-screen widget) surfaced a clinical concern worth taking seriously
on its own, independent of whether that widget is ever built: `computeStreak`
(`lib/storage.ts:464-479`) resets to zero the instant any single day has no logged session,
counting only a fully unbroken run. For this app's target user — someone whose executive-
function tax is the stated reason the app exists — a strict, always-visible "unbroken chain"
metric risks two **distinct** measurement harms doc 34's clinical lens named: (1) guilt/
abandonment when the streak breaks, and (2) logging to preserve the streak rather than logging
honestly, which would bias the very data the provider relies on. Doc 34 resolved both risks for
its own new surface (the widget) by dropping the streak from the ambient home-screen view by
default. This doc addresses the same source — the streak computation itself, already shown
today on the in-app Today tab, not hypothetically on a not-yet-built widget — but, per clinical
review (see Panel review), **only fully resolves the first of the two harms**, not both; see the
narrowed claim below.

**Narrowed claim, corrected after review (panel — clinical lens must-fix):** an earlier draft of
this doc claimed the grace variant "directly reduces... the exact honesty-biasing behavior doc
34 flagged." That overstates what the mechanism actually does. Tolerating a miss softens the
**reset-to-zero cliff** — the guilt/abandonment harm — genuinely and unambiguously: a person who
misses one day no longer loses their entire accumulated count. But it does not resolve, and may
partially cut against, the **honesty-bias** harm: the streak stays a prominently-displayed
logging-behavior metric, and because it resets far less often, it accumulates to **larger**
numbers over months than the strict version ever would for the same person — and a larger
accumulated number carries _more_ loss-aversion weight ("don't break the chain"), not less. This
doc is worth shipping for the harm it does resolve (fewer demoralizing resets, delivered to
exactly the people who opt in because they feel that pressure) — it is not, on its own, a
complete fix for the second harm doc 34 named, and should not be described as one.

## Goals / Non-goals

**Goals**

1. A new, additive pure function — `computeGraceStreak` — computing a streak that tolerates up
   to a small number of missed days per fixed 7-day block, never modifying `computeStreak`'s existing
   behavior or its callers.
2. An opt-in Settings toggle: "Let my streak forgive occasional missed days." Off by default —
   this doc changes what's _available_, never what existing users see without choosing it.
3. When enabled, the Today tab shows the grace-adjusted count in place of the strict one — one
   number shown at a time, not both simultaneously competing for attention.

**Non-goals**

- **Not a silent behavior change.** `computeStreak` itself is untouched — existing tests, the
  existing widget doc's (34) design, and anyone who doesn't opt in see the exact same number
  they see today. This is an additive alternative, never a redefinition of what "streak" already
  means for everyone.
- **No configurable grace amount in v1.** One fixed, reviewed tolerance (see Core logic), not a
  slider — avoids turning a simple motivational tweak into a small settings surface of its own.
- **No retroactive recalculation messaging.** Turning the toggle on doesn't animate or announce
  "your streak just changed from N to M" — it simply computes the number the new way from then
  on; no drama around the switch.
- **No interaction with the daily reminders or any other feature.** This is purely a different
  arithmetic over the same `entries` data already used for the strict streak — no new
  notification, no new persisted check-in data, no change to `computeStreak`'s callers elsewhere
  (report/Trends use it nowhere; it is Today-tab-only today and stays that way).

## Core logic (`lib/storage.ts`, additive, alongside `computeStreak`)

```ts
// Tolerance: at most this many missed days forgiven per fixed 7-day block, counted back from
// today — chosen to soften the all-or-nothing reset without making "streak" mean "logged most
// days eventually."
export const GRACE_MISSES_PER_WEEK = 1;

/**
 * Like computeStreak, but tolerates up to GRACE_MISSES_PER_WEEK missed days per fixed 7-day
 * block counted back from today (days 1-7, 8-14, …) before breaking — a tumbling block, not a
 * sliding/rolling window (see the corrected claim below; panel — TS lens must-fix). Additive —
 * computeStreak itself is unchanged, and every existing caller/test of it is unaffected.
 * Motivated by doc 34's clinical finding that an always-visible, strict streak can cause
 * demoralizing resets on a single miss; this is the opt-in softer alternative for the surface
 * that already exists today (Today tab), independent of whether the widget it was originally
 * flagged for ever ships. See doc 41's Panel review for the narrower, corrected claim about
 * exactly which of doc 34's two named harms this actually addresses.
 */
export function computeGraceStreak(
  entries: Readonly<Record<IsoDate, DayEntry>>,
  today: IsoDate,
): number {
  let streak = 0;
  let missesInBlock = 0;
  let cursor = today;
  let daysWalked = 0;
  for (;;) {
    const entry = entries[cursor];
    const hasCheckin =
      entry !== undefined && (entry.morning !== undefined || entry.evening !== undefined);
    if (hasCheckin) {
      streak += 1;
    } else {
      missesInBlock += 1;
      if (missesInBlock > GRACE_MISSES_PER_WEEK) break;
    }
    daysWalked += 1;
    if (daysWalked % 7 === 0) missesInBlock = 0; // start a fresh 7-day block, tolerance resets
    cursor = addDays(cursor, -1);
  }
  return streak;
}
```

**Tumbling block, not a sliding window — the prose corrected to match the code (panel — TS lens
must-fix).** An earlier draft described this as tolerating misses "within any trailing 7-day
window," which claims sliding-window semantics the `daysWalked % 7 === 0` reset does not
actually implement: the reset creates **fixed, non-overlapping blocks anchored at today**
(offsets 1–7, 8–14, …), not a window that slides day by day. Concretely, two misses on adjacent
days that happen to straddle a block boundary (offset 7 and offset 8) are **both forgiven** under
this code, where a genuine "≤1 miss in any trailing 7-day span" rule would break on that pair.
The simpler tumbling-block behavior is kept (a real sliding window needs to retain the offsets of
recent misses and check every possible 7-day span, meaningfully more code for a low-stakes
motivational feature) — only the description was wrong, now corrected to say "per fixed 7-day
block counted back from today," matching exactly what the loop computes and what this doc's own
test plan already exercises.

**A missed day still doesn't count toward the streak length itself** — `streak` only increments
on an actual logged day, so a grace streak of "12" still means 12 genuinely logged days, not 12
calendar days including gaps. What changes is only whether a single gap **breaks** the count
early; the count itself never inflates a miss into a logged day. `addDays` is the existing,
landed helper (`lib/storage.ts:401-405`) — no new date arithmetic invented, and (like doc 40)
this involves no calendar-day-counting DST hazard since it's a simple backward walk one day at a
time, the same pattern `computeStreak` itself already uses safely today. **Bounded, not
infinite, worst case (TS lens note):** unlike `computeStreak` (which stops at the first gap),
this loop can walk back as far as the data extends in a sparse-logging history before
accumulating two misses in one block — O(days since install) worst case, not O(streak length);
bounded by the data's own extent, never unbounded.

## Data model (`lib/types.ts`)

One additive, optional `Profile` field:

```ts
// Profile gains:
readonly graceStreakEnabled?: boolean;
```

**Guard placement, made concrete (panel — TS lens must-fix).** `isProfile`'s current tail
(`lib/storage.ts:~122-123`) is a single terminal `return weeklyReminder === undefined ||
isTimeOfDay(weeklyReminder);` — a new check can't simply be appended after a `return`. Insert the
new check before that terminal return, using bracket-notation index access (required under
`noPropertyAccessFromIndexSignature`, same as every other guard in this file):

```ts
const weeklyReminder = value['weeklyReminder'];
if (!(weeklyReminder === undefined || isTimeOfDay(weeklyReminder))) return false;
const graceStreakEnabled = value['graceStreakEnabled'];
return graceStreakEnabled === undefined || typeof graceStreakEnabled === 'boolean';
```

This would be the first **optional boolean** flag on `Profile` (every prior optional field is an
array, a nested object, or a `TimeOfDay`) — the pattern still holds identically; `typeof value
=== 'boolean'` is exactly as narrow a check as `isTimeOfDay`/`isIsoTimestamp` are for their types.

## UI (`app/(tabs)/settings.tsx`, `app/(tabs)/index.tsx`)

**Settings**: one `Toggle`, off by default: "Let my streak forgive occasional missed days" with
a one-line explanation ("A single missed day won't reset your count to zero"). No further
configuration.

**Today tab**: the existing streak display (`app/(tabs)/index.tsx`) reads `graceStreakEnabled`
from the loaded profile and calls `computeGraceStreak` instead of `computeStreak` when true —
one code path swap, no new visual treatment, no second number shown alongside it. The label text
stays the same ("N-day streak") rather than adding a qualifier like "(with grace)" that would
itself start to feel like a caveat undermining the motivational point of showing a number at all.

## Test plan (`lib/__tests__/storage.test.ts`)

1. `computeGraceStreak` — an unbroken run matches `computeStreak` exactly (same answer when
   there's nothing to forgive); a single missed day within a 7-day block doesn't break the
   count, continuing to accumulate on the other side of the gap; two missed days within the same
   7-day block **does** break it (exceeding `GRACE_MISSES_PER_WEEK`); the tolerance resets every
   7 days walked, so a miss late in one block and another early in the next block are each
   individually forgiven rather than compounding across the block boundary (the tumbling-block
   behavior confirmed correct, not the sliding-window claim an earlier draft made); a `today`
   with no entry at all returns `0`, matching `computeStreak`'s own boundary behavior.
2. **Non-regression** — `computeStreak` itself is called with the exact fixtures already covering
   it today and asserted unchanged, proving this doc's additive function introduces no shared-
   code risk to the existing strict streak.
3. `isProfile` — accepts a profile with/without `graceStreakEnabled`; rejects a non-boolean value.

## Gate compliance

No `any`/`!`/`@ts-*`/eslint-disable. `computeGraceStreak` reuses the exact loop shape
`computeStreak` already uses (guard-and-continue, no assertions), just with an added tolerance
counter — no new date-parsing logic, no new helper beyond the existing `addDays`. One additive,
optional `Profile` field → no migration, no forced re-onboarding. `npm run check` must pass
before commit.

## Dependencies & sequencing

Independent of every other doc in this batch and prior rounds for its own mechanics — motivated
by, but not code-dependent on, doc 34 (this doc's value stands regardless of whether the widget
is ever built, since the strict streak is already visible on Today today). Could land before,
after, or entirely independent of doc 34's own go/no-go decision.

## Alternatives considered

- **Changing `computeStreak`'s own default behavior to include grace, rather than adding a new
  function + opt-in toggle:** rejected — this would be exactly the "silent behavior change" this
  doc's Non-goals rule out, retroactively changing what every existing user's streak number means
  without their choosing it, and risks surprising anyone who has come to rely on the strict
  definition (e.g. as a personal discipline tool, which some users may genuinely prefer).
- **A configurable grace amount (e.g. a Stepper for "misses forgiven per week"):** rejected for
  v1 — see Non-goals; one fixed, reviewed tolerance is simpler to reason about and explain in one
  sentence of Settings copy than a tunable parameter would be.
- **Showing both the strict and grace streaks side by side:** rejected — two competing numbers
  for the same underlying concept adds confusion for a modest, low-stakes feature; one number,
  chosen by a Settings toggle, is simpler and matches how every other opt-in display choice in
  this app already works (e.g. the smoothing toggle on Trends replaces the raw bars' emphasis
  rather than duplicating the view).

## Panel review

Run through the 4-lens panel (2026-07-23): approve-with-changes (clinical, strict-TS), approve
(scope). Must-fixes applied above.

- **Clinical — approve-with-changes, with a definitive verdict on the doc's central question.**
  Does this achieve what it claims? **No, not fully** — it relocates and softens one of doc 34's
  two named harms (guilt/abandonment on a break) rather than resolving both; the honesty-bias
  harm remains, and a grace streak's larger accumulated numbers could plausibly amplify loss-
  aversion pressure rather than reduce it. _Must-fix (applied):_ narrowed the doc's claim to the
  harm it actually addresses, with an explicit acknowledgment that the second harm is only
  partially mitigated at best. Mechanically confirmed sound and worth shipping regardless: a
  missed day still yields no `+1`, so the per-day logging incentive is unchanged — only the
  reset cliff is softened, not the daily reward — and this is opt-in, reaching exactly the users
  who already feel the pressure it addresses.
- **Strict-TypeScript architect — approve-with-changes.** _Must-fixes (applied):_ the
  `daysWalked % 7 === 0` reset produces fixed, non-overlapping tumbling blocks anchored at
  today, not the sliding "any trailing 7-day window" the prose claimed — two misses straddling a
  block boundary are both forgiven under the actual code, which a genuine sliding window would
  not do; reworded the claim to match the code (the doc's own test plan already tested the
  correct tumbling-block behavior, so only the prose was wrong) rather than rewriting the
  simpler, cheaper implementation. Also restructured the `isProfile` guard snippet to insert
  before the existing terminal `return` using bracket-notation access, since the field can't
  simply be appended after a `return` statement. Confirmed `computeGraceStreak` otherwise mirrors
  `computeStreak`'s real loop shape and reuses the real `addDays` helper correctly.
- **Mobile UX / friction — no verdict received.** The UX lens agent did not deliver findings for
  this round despite three explicit re-requests (a recurring pattern already noted in this
  project's memory). Not treated as blocking: the design is a single Settings toggle plus an
  unchanged-label call-site swap, materially smaller than any surface the other lenses flagged
  UX-adjacent concerns against in this batch.
- **Data-model / migration + privacy + scope — approve.** Confirmed the "additive, never modifies
  `computeStreak`" claim is true as designed — `computeStreak` has no report/Trends callers (Today
  -tab-only), so the grace variant never touches a provider-facing surface. One additive, optional
  `Profile` boolean field, following the exact pattern every other late-added flag uses; old
  backups lacking the field restore cleanly. No must-fix.
