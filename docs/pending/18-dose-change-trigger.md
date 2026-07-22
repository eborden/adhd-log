> **Status:** Proposed (2026-07-21) · **Priority:** P1 · Ref: titration-log research
> (`docs/research/titration-log-examples.md`), design finding #2

# Structured dose-change trigger (the "why" behind each step)

## Problem

In the titration-log research, a dose change is almost never a bare number — it is a _reaction_ with
a reason attached: "back to 30 mg since I was jittery" (Vyvanse, example 8), "held at 5 mg — flared on
the drop" (prednisolone, 83), "T4 normal but TSH overshot, lowered to 10 mg" (methimazole, 38),
"doubled to 10 mg and added a second agent because BP kept climbing" (76). The _why_ is what makes the
timeline legible to a provider: an increase because the last dose did nothing reads completely
differently from a decrease forced by side effects.

Today `DoseChange` carries only an optional free-text `note`. The provider report and Trends draw the
_when_ and _what_ of each step but nothing structured about _why_, so the report can't say "3 of 4
changes were side-effect–driven" and the user can't filter or the report can't group by trigger.

## Design decision: store the trigger, derive the direction

There are two facts about a step: its **direction** (up / down / hold relative to the previous dose)
and its **trigger** (the reason). Direction is **fully derivable** from the dose sequence — comparing
each `DoseChange.dose` to the one `doseActiveOn` the prior day. Storing it would create a desync risk
(a persisted `'increase'` contradicting the numbers). So:

- **Direction: derived, never stored.** A pure helper computes it from the sorted `doses[]`.
- **Trigger: stored, optional.** It is the one thing that cannot be recovered from the numbers.

This keeps the new persisted surface to a single optional field and preserves "illegal states
unrepresentable" — direction can never disagree with the doses because it _is_ the doses.

## Goals / Non-goals

**Goals**

1. Add an optional `trigger` to `DoseChange`; capture it (skippable) when logging a change.
2. A pure `doseChangeDirection(doses, change)` helper deriving up/down/hold/start.
3. Surface both in the report (a "why" column + a one-line trigger tally) and on the Trends
   dose-change markers, descriptively.
4. Optional back-compat: every existing `DoseChange` (no `trigger`) stays valid, unchanged.

**Non-goals**

- No interpretation of whether a change was "right", no outcome scoring, no suggestion to change a
  dose. The report states the user-recorded reason and stops.
- No free-text replacement — `note` stays for detail; `trigger` is the structured facet beside it.
- No required field — a change with no trigger is legitimate and common (e.g. planned schedule step).

## Data model (`lib/types.ts`)

```ts
export const DOSE_CHANGE_TRIGGERS = [
  'provider-directed', // prescriber told me to
  'insufficient-effect', // wasn't doing enough
  'side-effects', // adverse effects pushed the change
  'planned-titration', // pre-set escalation schedule step
  'other',
] as const;
export type DoseChangeTrigger = (typeof DOSE_CHANGE_TRIGGERS)[number];

export interface DoseChange {
  readonly date: IsoDate;
  readonly dose: Dose;
  readonly note?: string;
  readonly trigger?: DoseChangeTrigger; // NEW — optional; absent on legacy + planned-no-answer
}

/** Derived, never persisted: which way this step moved vs. the previously active dose. */
export type DoseDirection = 'start' | 'increase' | 'decrease' | 'hold';
```

The trigger set is a **closed literal union**, sourced (like `SIDE_EFFECTS`) from one `as const`
array so a `switch` over it stays exhaustive and label maps can't drift. The five values come
straight from the recurring reasons in the research and are deliberately few — this is a facet, not a
taxonomy.

## Storage boundary (`lib/storage.ts`)

Extend `isDoseChange` to accept an absent-or-valid trigger, exactly like it already treats `note`:

```ts
export function isDoseChange(value: unknown): value is DoseChange {
  if (!isRecord(value) || !isIsoDate(value['date']) || !isDose(value['dose'])) return false;
  const note = value['note'];
  if (!(note === undefined || typeof note === 'string')) return false;
  const trigger = value['trigger'];
  return trigger === undefined || isDoseChangeTrigger(trigger); // NEW
}
export function isDoseChangeTrigger(v: unknown): v is DoseChangeTrigger {
  return typeof v === 'string' && (DOSE_CHANGE_TRIGGERS as readonly string[]).includes(v);
}
```

No new storage key, no forced migration: the field is additive and optional, and old records simply
have `trigger === undefined`.

**Unknown-trigger back-compat — the load-bearing decision (panel — TS + scope lenses, both flagged
data-loss).** A newer build could write a `trigger` value this build doesn't recognize. Two current
paths are all-or-nothing about it: `loadDoseChanges` does `raw.filter(isDoseChange)` (a strict guard
silently **drops the whole dose row** — date + dose, the objective backbone — over one soft optional
facet), and `parseBackup` runs `isDoseChangeList` (`value.every(isDoseChange)`), so a single unknown
trigger **fails the entire backup import** → total data loss on a cross-version restore. Both are
unacceptable.

Resolution: **keep the record, drop the unknown trigger — but NOT inside `isDoseChange`.** A
`value is DoseChange` predicate that returned `true` while leaving an unrecognized string in a
`DoseChangeTrigger?` slot would be a lie (the exact trap the codebase avoids by pairing a strict
`is*` predicate with a tolerant `parse*` normalizer). So mirror that split — the strict predicate
(`isMorningCheckin`) beside the tolerant normalizer (`parseEveningCheckin`, `parseSideEffectReports`):

- `isDoseChange` stays **strict** — an unknown trigger makes it return `false` (the predicate stays
  honest; no `DoseChange` ever holds an invalid trigger → illegal states unrepresentable).
- Add a tolerant **normalizer** `parseDoseChange(value): DoseChange | undefined` that, for an
  otherwise-valid record carrying an unrecognized trigger, **reconstructs** the record with `trigger`
  omitted (rebuilt, never mutated), matching `parseSideEffectReports`' normalize-on-read posture.
- Route both lossy paths through it: `loadDoseChanges` maps `parseDoseChange` and filters `undefined`
  (keeps the row, drops only the bad facet); backup parsing gains a tolerant list parse built on
  `parseDoseChange` so one unknown trigger never rejects the whole import.

**Cost, sized honestly (panel — scope lens):** this is larger than "extend `isDoseChange` like
`note`." It adds a normalizing parse function and threads it through `loadDoseChanges`, the
`parseDoseChangeList` callers, and `parseBackup`. It is nonetheless required — the alternative
(reject-record) can lose months of objective dose history over a cosmetic field, which the panel
rejected.

## Derivation helper (`lib/storage.ts` or `lib/report-metrics.ts`, RN-free)

```ts
export function doseChangeDirection(
  sorted: readonly DoseChange[], // ascending by date
  change: DoseChange,
): DoseDirection {
  const prior = /* the dose active the day before change.date, via doseActiveOn(addDays(date,-1)) */;
  if (prior === undefined) return 'start';
  if (change.dose.amount > prior.amount) return 'increase';
  if (change.dose.amount < prior.amount) return 'decrease';
  return 'hold';
}
```

Compares within a single `DoseUnit` (a unit switch mid-titration is out of scope — `Dose` already
pins one unit per change; a mismatched unit falls back to `'hold'` rather than comparing incomparable
numbers, and is noted). Pure and unit-tested.

## Report (`lib/report-html.ts`)

- The existing dose-change / before-after tables gain a **"why" line** per change: the direction
  arrow (derived) + the trigger label (or "reason not recorded"), value-free. E.g. `↑ increase ·
insufficient effect`.
- A one-line **trigger tally** in the report's dose section: "Changes: 4 (2 insufficient effect, 1
  side effects, 1 provider-directed)". Pure counting, no judgement.
- Rendered via exhaustive `switch` over `DoseDirection` and `DoseChangeTrigger` → `assertNever`;
  `escapeHtml` all labels.

## Entry UI (`app/(tabs)/settings.tsx`)

`handleLogDoseChange` gains an optional trigger selector (a `<Chips>`-style single-select over
`DOSE_CHANGE_TRIGGERS`, reusing the existing chip component), **laid out as a single line of five
chips (panel — UX lens)** so the dose-change form never grows into a wall of chips. Skippable —
submitting with none set stores no `trigger`. Direction is **not** an input (it's shown, derived, as
a preview: "this will be recorded as ↓ decrease"), which adds information without a tap or a chance to
enter data that contradicts the numbers. One extra optional tap; the dose amount + unit flow is
unchanged.

**Chip copy is the user's own reason, never an app verdict (panel — clinical lens).** The
`insufficient-effect` chip reads as "wasn't doing enough" / "not enough effect" (what _the user_
reports), not "insufficient" as the app judging efficacy. Labels are phrased in the first person so
the report can attribute the reason to the user, not to the app.

## In-app Trends (`app/(tabs)/trends.tsx`)

The existing `doseChangeMarkers` dots gain an accessible label combining the derived direction and
stored trigger, and the doc-16 "Around dose changes" cards show the trigger in their header. Read-only
derived; no new persisted shape reaches this surface.

## Test plan (`lib/__tests__/`)

1. **Guard + normalizer** — `isDoseChange` accepts a valid trigger and `trigger: undefined` (legacy),
   and returns `false` for a bogus trigger string (stays strict/honest). `parseDoseChange` on that
   same bogus-trigger record **keeps the row with `trigger` omitted** (not `undefined`-vs-dropped
   confusion — the row survives, the facet is gone). `loadDoseChanges` retains the row; a tolerant
   backup parse imports it rather than rejecting the whole list.
2. **Direction derivation** — start (no prior), increase, decrease, hold; a same-day double change;
   a decrease that returns to an earlier value still reads `decrease`; unit-mismatch → `hold`.
3. **Tally** — counts per trigger over a mixed `doses[]`; "reason not recorded" counted separately.
4. **Report render** — exhaustive labels; a legacy no-trigger change renders "reason not recorded";
   `assertNever` proven for both unions.

## Gate compliance

No `any`/`!`/`@ts-*`/eslint-disable. Two closed literal unions with exhaustive `switch` +
`assertNever`. Additive optional field → no migration, no `Backup` shape break (still
`readonly DoseChange[]`). Direction derived, so no stored-vs-computed desync. 100% type-coverage.
`npm run check` green before commit.

## Panel review

Run through the 4-lens panel (2026-07-21): clinical **approve**, UX **approve**, TS-architect and
scope **approve-with-changes**. Must-fixes applied above.

- **Clinical — approve.** Strictly descriptive: the trigger is the user's own recorded reason, not
  the app judging efficacy, and the tally is pure counting. _Applied:_ chip copy phrased in the first
  person ("wasn't doing enough") so `insufficient-effect` never reads as an app verdict; confirmed the
  unknown-trigger resolution keeps the user's stated reason rather than silently rewriting it.
- **Strict-TypeScript architect — approve-with-changes.** Store-the-trigger / derive-the-direction is
  correct (direction is recoverable, so persisting it would desync); closed `DOSE_CHANGE_TRIGGERS`
  union + exhaustive `switch`/`assertNever` is sound. _Must-fix (applied):_ keep-record-drop-trigger
  cannot live in the `isDoseChange` predicate (would make `value is DoseChange` lie) — added a
  `parseDoseChange` normalizer mirroring `parseEveningCheckin`, routed through `loadDoseChanges` and
  backup parsing.
- **Mobile UX / friction — approve.** Contained to the occasional Settings dose-change flow: one
  optional skippable chip tap, daily check-in untouched, direction shown as a read-only preview.
  _Applied:_ trigger chips constrained to a single line of five values.
- **Data-model / migration + privacy + scope — approve-with-changes.** Additive optional field, no
  new key, `Backup` shape unchanged; facet-not-taxonomy stays inside collect→log→provider. _Must-fix
  (applied):_ the same all-or-nothing hazard (`loadDoseChanges` filter + `isDoseChangeList` in
  `parseBackup`) sized honestly and fixed via the normalizer, not hand-waved.
