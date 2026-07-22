> **Status:** Proposed (2026-07-21) · **Priority:** P2 · Ref: titration-log research
> (`docs/research/titration-log-examples.md`), design finding #4

# Titration onset context ("time on current dose" + honest expectation framing)

## Problem

The single most recurring _human_ beat in the patient titration logs is the anxious "am I giving this
enough time?" — "3 weeks on Vyvanse and mood still worse, is there hope?" (example 11); "took 6 weeks
to start feeling a lift, another 6 to be sure" (27); atomoxetine "needed ~6–8 weeks" (22, 25); SSRIs
"4–6 weeks to kick in" (35). The research makes the app's founding thesis concrete: for these drug
classes the signal accrues over **weeks**, so an early flat trend is _expected_, not failure.

The app never tells the user _how long they've been on the current dose_. Today, Trends, and the
report all show ratings, but nothing anchors those ratings to elapsed titration time. Without that,
an early flat line silently reads as "not working" — the exact misread the logs are full of.

## The fix — a purely factual, elapsed-time anchor (no clinical claim)

Show two derived, descriptive facts and nothing more:

- **Day/Week N on the current dose** — days since the most recent `DoseChange.date` (or `startDate`
  if none), e.g. "Day 12 on 40 mg" / "Week 3 on current dose".
- **Week N since starting** — days since `Profile.startDate`.

And one piece of standing, non-directive copy on the Trends surface: _"Effects of many medications
build over weeks — keep logging and review the trend with your provider."_ That is framing, not
advice: it names a general property, gives no threshold ("should work by 6 weeks"), makes no
prediction about _this_ user, and defers meaning to the provider — consistent with every other copy
string in the app.

This is deliberately the lightest of the four research-derived plans: **no new persisted shape**,
entirely derived from data already stored (`startDate` + `doses[]`).

## Goals / Non-goals

**Goals**

1. A pure `timeOnCurrentDose(profile, doses, today)` / `daysSinceStart(profile, today)` helper set
   returning structured elapsed-time values (not pre-formatted strings — formatting stays in the view
   layer / a dedicated formatter).
2. A neutral "Day/Week N on current dose" chip on **Today** and **Trends**.
3. Standing expectation copy on **Trends** (and optionally the report cover), value-free.
4. The report cover already prints "Current dose … started {startDate}"; add "on this dose N weeks",
   descriptively.

**Non-goals**

- **No prediction, threshold, or "should be working by now".** No countdown to an expected-effect
  date. No "it's been long enough, consider…". The moment copy implies a clinical timeline it leaves
  the mission — forbidden.
- No new metric, no new storage, no `Backup` change, no migration.
- No notification/reminder change (that's doc-15's territory).

## Data model

**None persisted.** Two RN-free pure helpers in `lib/` (co-located with `doseActiveOn`, which already
resolves the active dose for a date):

```ts
export interface DoseTenure {
  readonly since: IsoDate; // most recent DoseChange.date ≤ today, else profile.startDate
  readonly dose: Dose; // the currently active dose
  readonly days: number; // today − since (≥ 0)
  readonly basis: 'dose-change' | 'start'; // which anchor `since` came from
}
export function timeOnCurrentDose(
  profile: Profile | null,
  doses: readonly DoseChange[],
  today: IsoDate,
): DoseTenure | undefined; // undefined when profile is null (no med context yet)
```

**Signature (panel — TS lens must-fix):** `profile` is widened to `Profile | null` so the
`| undefined` return is actually reachable — the helper owns the "no profile yet" guard rather than
declaring an impossible case behind a non-null param. (`loadProfile` already returns `Profile | null`,
so callers pass it straight through.)

**`basis` is a literal-union field, not a true discriminant (panel — TS lens):** both values share
one shape, so it's a labeled flag the view reads to say "on current dose" vs. "since starting" — a
`switch` on it with `assertNever` still works, but the doc no longer oversells it as a discriminated
union.

**Future-date clamp (panel — TS lens must-fix):** `since` is the most recent `DoseChange.date`
**filtered to ≤ today**, so a future-dated change (clock skew, manual entry) can't drive `days`
negative. `doseActiveOn` already clamps the _dose_ lookup, but `since`/`days` are computed separately
and must clamp too.

`today` is passed in (never read from the clock inside the helper) to keep it pure and testable —
matching `todayIsoDate(clock)`.

Week/label formatting (`Day 6` vs `Week 3`, singular/plural) lives in one small formatter beside the
existing date formatters, returning a plain string the RN views render — no formatting logic in
components.

## UI

- **Today (`app/(tabs)/index.tsx`)** — a compact, **muted, single-line** chip near the dose/streak
  area: "Day 12 on 40 mg". It must stay **visually subordinate to the two check-in cards** and read
  as pure elapsed time — never a countdown/deadline (panel — UX + clinical). "Day 12 on 40 mg" is
  factual; anything trending toward "12 days and still nothing" pressure is forbidden and would
  undercut completion. Renders nothing until a profile exists.
- **Trends (`app/(tabs)/trends.tsx`)** — the same chip in the header. The standing expectation line
  sits beneath the coverage caption (doc-09). **Decoupled from the chip (panel — clinical + UX
  must-fix):** the chip (a specific week count) and the standing copy must **not** be laid out as a
  labeled pair or progress row, and the user's specific week count is **never interpolated into** the
  standing copy — co-located and coupled, "Week 3" + "builds over weeks" reads as
  progress-toward-expected-effect ("should be kicking in soon"), the exact implied clinical timeline
  the Non-goals forbid. The chip states elapsed time; the copy stays generic; they are visually
  separated.
- **Report cover (`lib/report-html.ts`)** — append "· on this dose {N} weeks" to the existing
  current-dose/started line. `escapeHtml` the interpolated count (integer).

No check-in, schema, or storage seam is touched.

## Test plan (`lib/__tests__/`)

1. **Tenure from dose change** — with doses, `since` = latest change date, `days` correct, `basis =
'dose-change'`, `dose` = active dose.
2. **Tenure from start** — no doses → `since = startDate`, `basis = 'start'`.
3. **Boundary** — a dose change dated today → `days = 0`; a future-dated change is ignored (guards
   against clock skew), the prior active dose wins.
4. **Formatter** — `days < 7` → "Day N"; `≥ 7` → "Week N"; singular/plural; `undefined` tenure → no
   string.
5. Copy strings asserted to contain no threshold/prediction language is not unit-testable, but the
   value-free helper output (numbers + basis only, never a verdict) structurally prevents it.

## Gate compliance

No `any`/`!`/`@ts-*`/eslint-disable. `DoseTenure.basis` is a closed literal-union flag → exhaustive
`switch` + `assertNever` in the formatter. Pure, clock-injected helpers. No persisted shape → no migration, no
`Backup` change. 100% type-coverage. `npm run check` green before commit.

## Panel review

Run through the 4-lens panel (2026-07-21): scope **approve**; clinical, TS-architect, and UX
**approve-with-changes**. Must-fixes applied above. Flagged as the highest _interpretation_ risk of
the four (elapsed time + "builds over weeks"), fenced accordingly.

- **Clinical — approve-with-changes.** The chips ("Day 12 on 40 mg", `basis` = dose-change vs start)
  are purely factual and "many medications" is a sound hedge. _Must-fix (applied):_ decoupled the
  elapsed-time chip from the standing copy — never interpolate the user's week count into it and don't
  lay them out as a progress pair, or the combination implies "you're at week 3, it should be kicking
  in."
- **Strict-TypeScript architect — approve-with-changes.** No persisted shape, clock injected for
  purity. _Must-fixes (applied):_ reconciled the `Profile | null` param with the `| undefined` return;
  clamped `since` to ≤ today so `days` can't go negative; stopped calling `basis` a discriminated
  union (it's a literal-union flag).
- **Mobile UX / friction — approve-with-changes.** Zero taps added; passive read-only chip; renders
  nothing until a profile exists; standing copy is static Trends context, not a popup/nag. _Must-fix
  (applied):_ the Today chip stays muted, single-line, subordinate to the check-in cards, and never
  reads as a countdown/deadline. Directly supports completion by reframing an early flat trend as
  expected.
- **Data-model / migration + privacy + scope — approve.** Cleanest of the four: nothing persisted, no
  `Backup` change, no migration, derived from data already stored; restates the app's founding thesis
  rather than adding a clinical claim. Held to numbers + `basis` only, never a verdict.
