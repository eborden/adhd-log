> **Status:** Proposed (2026-07-23) · **Priority:** P2 · Ref: innovation batch (5 new plans) ·
> **Hard dependency: extends pending doc 11 ([`11-visit-anchoring.md`](11-visit-anchoring.md))**

# Post-visit provider decision log

## Problem / Context

Doc 11 introduces `Visit { date, note? }` — a bare appointment date the patient logs, feeding a
"since last visit" report range. That closes the loop on _when_ the patient was seen, but not on
_what happened_ there. A `Visit`'s only content today is a single free-text `note`, with nothing
distinguishing "what I plan to ask" (written before) from "what the provider actually decided"
(written after) — and nothing links a visit to the `DoseChange` it may have prompted.

The single highest-value fact in a longitudinal titration record is the provider's own decision
at each visit: hold, increase, decrease, switch, add an adjunct, refer out — and why. Without a
structured place for it, rereading the app's own history six months later shows only self-rated
moods and a list of dose-change dates with no connective tissue between them: a `DoseChange` on
2026-08-03 and a `Visit` on 2026-08-01 are two unrelated facts on two unrelated lists, and the
report has no way to say "the Aug 1 visit is why the Aug 3 dose changed." A new provider
inheriting the case — or the same provider a year later — loses that context entirely. This doc
closes that loop with a small, structured, **optional** decision record attached to a `Visit`,
filled in by the patient after the appointment. It is self-reported, at the same epistemic level
as every other field in this app — never the app's own clinical claim, never inferred from
anything but what the user typed.

## Goals / Non-goals

**Goals**

1. A `VisitDecision` discriminated union — a coarse `kind` plus an optional free-text `reason` —
   attached to doc 11's `Visit` as one new optional field.
2. An opportunistic, dismissible prompt in Settings: a past (already-occurred) visit with no
   decision yet gets a small "Log what was decided?" affordance next to its row — never a forced
   modal, revisitable any time by tapping the visit again.
3. Render it in the report's existing "Visits in range" list (doc 11): the decision's label +
   escaped reason, and — only when an actual `DoseChange` falls within a small window of the
   visit date — one descriptive connecting line juxtaposing the two dated facts.
4. Full storage-boundary guard, `Backup` round-trip riding on doc 11's own `visits` field (this
   doc adds no new storage key), and Vitest coverage of the RN-free logic.

**Non-goals**

- **No structured medical taxonomy beyond six coarse kinds + freeform "other."** Not an
  ICD-coded decision system, not a drug-interaction checker.
- **No inference of what happened at a visit.** Always user-typed, always past-tense self-report
  — the app never guesses a decision from a nearby `DoseChange` (see the connecting-line rule
  below, which juxtaposes dated facts without asserting causation).
- **No requirement to fill it in.** Every `Visit` remains fully usable with `decision` absent,
  exactly as doc 11 specified — this is a pure additive enrichment.
- **No `Visit`-to-`DoseChange` foreign key.** Doc 11 explicitly rejected coupling a dose change
  to a visit as a persisted relationship ("Alternatives considered" in that doc); this doc's
  report-side connecting line is a **display-time date-proximity check**, computed fresh each
  render, never a stored link.

## Data model (`lib/types.ts`)

Assumes doc 11 has landed and `Visit` exists. Adds:

```ts
export const VISIT_DECISION_KINDS = [
  'doseIncrease',
  'doseDecrease',
  'doseHold',
  'medicationSwitch',
  'adjunctAdded',
  'referral',
  'other',
] as const;
export type VisitDecisionKind = (typeof VISIT_DECISION_KINDS)[number];

export interface VisitDecision {
  readonly kind: VisitDecisionKind;
  readonly reason?: string;
}

// Visit (doc 11) gains one optional field:
readonly decision?: VisitDecision;
```

`reason` follows the same `exactOptionalPropertyTypes` discipline as `Visit.note` and
`DoseChange.note` — set via conditional spread, never assigned `undefined`.

**If doc 11 has not yet shipped when this lands:** fold `decision?` into doc 11's own `Visit`
definition at implementation time rather than landing it as a separate migration — both are
still-pending docs on the same type, and there is no reason to ship `Visit` twice. This doc is
written and reviewed independently so the design is ready either way, matching this repo's
existing practice of writing dependent docs before their prerequisite lands (doc 16 was drafted
against doc 06 the same way).

## Storage (`lib/storage.ts`)

```ts
export function isVisitDecisionKind(value: unknown): value is VisitDecisionKind {
  return typeof value === 'string' && (VISIT_DECISION_KINDS as readonly string[]).includes(value);
}

export function isVisitDecision(value: unknown): value is VisitDecision {
  if (!isRecord(value) || !isVisitDecisionKind(value['kind'])) return false;
  const reason = value['reason'];
  return reason === undefined || typeof reason === 'string';
}
```

**`isVisit` (doc 11) is deliberately left untouched — it must NOT gain a `decision` check
(panel — scope lens must-fix, headline finding).** An earlier draft added
`if (!(decision === undefined || isVisitDecision(decision))) return false;` to `isVisit`. That
is exactly wrong for an enrichment this doc's own Non-goals call "pure additive" and "fully
usable with `decision` absent": doc 11's `isVisitList` is all-or-nothing (`.every(isVisit)`),
so widening `isVisit`'s failure surface to include `decision` means **one malformed decision on
one visit silently discards every visit in the list** — on both live load and backup import. It
is also a forward-compat trap: a `decision` written by a future app version with a **seventh**
`VisitDecisionKind`, read by today's code, would fail `isVisitDecisionKind` and, by the same
path, wipe every visit the user has ever logged. A cosmetic enrichment field must never be able
to take down the record it enriches.

Instead, `decision` is validated and **normalized (drop-if-invalid, never reject-the-visit)** at
the point a raw value is turned into a `Visit`, mirroring this codebase's existing precedent for
exactly this shape of problem: `parseSideEffectReports` (`lib/storage.ts:200-219`) drops/migrates
malformed side-effect entries rather than failing the whole `EveningCheckin`, and `parseDayEntry`
drops an unparseable sub-part rather than failing the whole `DayEntry`. A parallel helper here:

```ts
/**
 * Reads `decision` off a raw, not-yet-typed visit record, dropping it if malformed rather than
 * failing the visit — a corrupt or future-versioned `decision` must never cascade into losing
 * the `Visit` itself (panel — scope lens must-fix).
 */
function readOptionalVisitDecision(value: Record<string, unknown>): VisitDecision | undefined {
  const decision = value['decision'];
  return isVisitDecision(decision) ? decision : undefined;
}
```

Doc 11's per-element visit parsing (its own `isVisit`, used by `isVisitList` and — per its
"Accuracy note" — the tolerant load path it flags as a possible future consistency fix) calls
`readOptionalVisitDecision` when materializing a `Visit` from a raw record, in the same place it
already reads `date`/`note`, rather than as an all-or-nothing field on the boolean predicate.
`isVisit` itself keeps checking only `date`/`note`, exactly as doc 11 specified — this doc adds
no new failure mode to that structural guard.

No new `STORAGE_KEYS` entry — `decision` rides inside doc 11's existing `"visits"` key and its
`Backup.visits` field, so `buildBackup`/`parseBackup`/`restoreBackup` need no changes beyond
what doc 11 already specifies.

A new update helper, since doc 11's `appendVisit` only adds/replaces by date and there is no
existing "patch one field on an existing visit" operation:

```ts
export async function setVisitDecision(
  date: IsoDate,
  decision: VisitDecision,
): Promise<readonly Visit[]> {
  const existing = await loadVisits();
  const next = existing.map((v) => (v.date === date ? { ...v, decision } : v));
  await saveVisits(next);
  return next;
}
```

## UI (`app/(tabs)/settings.tsx`)

In the Visits section (doc 11), each **past** visit row (`date <= today`) with no `decision`
gets a small "+ Log decision" link. Tapping it expands an inline picker: a row of choice chips
for the six `VisitDecisionKind` values plus "Other" (reusing the `Chips`-style single-select
interaction, not `EveningCheckin`'s multi-select side-effect chips — at most one decision per
visit) and an optional short reason text field, with a Save button calling `setVisitDecision`.
A visit that already has a decision shows it inline (kind label + reason) with a small edit
affordance rather than the "+ Log decision" prompt.

**Future visits never show the prompt** — nothing has happened yet to log a decision about.

## Report (`lib/report-html.ts`)

**Framing, added (panel — clinical lens must-fix).** The decision labels ("Dose increased,"
"Referral," etc.) would otherwise render as bare, authoritative-looking lines inside the
report — the one artifact that leaves the phone and lands in front of a clinician. A hurried
reader cannot tell a patient-typed "Dose increased" from the app's own characterization of what
happened. The doc's epistemics are already correct (self-report, never the app's own claim —
see Non-goals); the report copy must say so. The "Visits in range" section gains a one-time
lead-in — _"Visits in range (as logged by you)"_ — rather than annotating every row, so the
disclosure is stated once and doesn't clutter each line.

Doc 11's "Visits in range" `<ul>` gains, per visit with a `decision`:

- The decision's kind label (a `Readonly<Record<VisitDecisionKind, string>>` map in
  `lib/schema.ts`, matching the `SIDE_EFFECT_LABELS`/`WEEKLY_IMPRESSION_LABELS` precedent) and
  the escaped `reason`, if present.
- **The connecting line**, only when a `DoseChange` falls within `±VISIT_DECISION_WINDOW_DAYS`
  (3) of the visit's date — a new pure helper, **corrected to actually pick the closest change**
  (panel — TS lens must-fix; an earlier draft's `Array.find` returned the first in-window
  change in date-sorted order, not the nearest one, silently contradicting this doc's own test
  plan):

  ```ts
  /** Whole-day difference between two IsoDates (positive when `b` is later), via the existing
   * `parseIsoDate` — no `as`, no string arithmetic. */
  function daysBetween(a: IsoDate, b: IsoDate): number {
    const msPerDay = 24 * 60 * 60 * 1000;
    return Math.round((parseIsoDate(b).getTime() - parseIsoDate(a).getTime()) / msPerDay);
  }

  export function nearbyDoseChange(
    doses: readonly DoseChange[],
    visitDate: IsoDate,
    windowDays = 3,
  ): DoseChange | undefined {
    let closest: { readonly change: DoseChange; readonly distance: number } | undefined;
    for (const change of doses) {
      const distance = Math.abs(daysBetween(change.date, visitDate));
      if (distance > windowDays) continue;
      if (closest === undefined || distance < closest.distance) {
        closest = { change, distance };
      }
    }
    return closest?.change;
  }
  ```

  Rendered as, e.g.: _"→ dose changed to 45 mg on Aug 3"_ — a bare juxtaposition of two dated
  facts, never phrased as "because of" or "as a result of."

  **Deliberately not exposed as a stored relationship:** if a `Visit` is later edited to a
  different date, or a `DoseChange` is added/removed, the connecting line simply recomputes on
  next render — there is nothing to keep in sync, which is exactly why doc 11 rejected a
  persisted foreign key in the first place.

Every interpolated string (`reason`, kind label) runs through the existing `escapeHtml`.

## Test plan (`lib/__tests__/`)

1. **Guards** — each `VisitDecisionKind` round-trips through `isVisitDecision`; a missing/invalid
   `kind` is rejected by `isVisitDecision` itself; a non-string `reason` is rejected. Separately,
   `readOptionalVisitDecision`/the per-element visit parse: a record with no `decision`, one with
   a valid `decision`, and one with a **malformed** `decision` all produce a valid `Visit` — the
   malformed case drops the decision and keeps the rest of the visit, and critically **does not**
   cause `isVisit` to return `false` (the regression this doc's must-fix exists to prevent: a
   malformed `decision` must never cascade into `isVisitList` discarding the entire list).
2. **`setVisitDecision`** — sets the decision on the matching date only, leaves other visits
   untouched, and is a no-op-shaped update (not an append) when the date doesn't exist in the
   list (returns the list unchanged — asserted explicitly so a typo'd date can't silently grow
   the list with a partial record).
3. **`nearbyDoseChange`** — finds a change exactly at the window boundary (`±3` days) and
   excludes one just outside it; returns `undefined` when `doses` is empty; picks the closest
   when multiple changes are in range.
4. **Report render** — a decision with a `<`/`&` in `reason` renders the escaped substring; the
   connecting line appears only within the window and never outside it; a visit with no decision
   renders exactly as doc 11 already specifies (no regression).

## Gate compliance

No `any`/`!`/`@ts-*`/eslint-disable. `VisitDecisionKind` is a closed literal union;
any render `switch` on it ends in `assertNever`, so a seventh kind fails to compile until every
consumer (the label map, any future UI) handles it. `reason` follows
`exactOptionalPropertyTypes` via conditional spread. No new `STORAGE_KEYS` entry, no new
`Backup` field — this doc rides entirely inside doc 11's existing `visits` shape. `npm run check`
must pass before commit.

## Dependencies & sequencing

**Hard dependency: doc 11 must exist (landed or implemented alongside) before this doc's `Visit`
field addition makes sense** — there is no `Visit` to extend otherwise. Independent of docs 22,
23, 25, and 26 in this batch; independent of doc 17 (measurements) except that both may want a
shared "date-proximity to a `DoseChange`" helper (`nearbyDoseChange` here vs. doc 17's own
same-date annotation check) — worth a small refactor to share the helper once both exist, not
required for either to land alone.

## Alternatives considered

- **A separate `visitDecisions` store keyed by visit date, instead of a field on `Visit`:**
  rejected — a decision has no independent existence from the visit it belongs to (it can't be
  logged for a visit that doesn't exist, and deleting a visit should delete its decision), so a
  field is the more honest shape and avoids a second list that must stay in sync with the first.
- **Persisting the visit↔dose-change link as a foreign key:** rejected, consistent with doc 11's
  own explicit rejection of the same coupling — the display-time proximity check gives the same
  reader-facing value without an invariant to maintain.
- **Free-text-only decision (no `kind` taxonomy):** rejected — a bare note is already available
  via `Visit.note` today; the coarse `kind` is what makes the report able to render a
  scannable label at all, and "other" + `reason` covers anything the six kinds miss.

## Panel review

Run through the 4-lens panel (2026-07-23): approve-with-changes on all four lenses. Must-fixes
applied above.

- **Clinical — approve-with-changes.** The six-kind taxonomy is standard, prescriber-usable
  titration-decision vocabulary and does not overstep into judgment — these are categories of a
  factual event the patient witnessed, not an app inference. _Must-fix (applied):_ the report's
  decision labels could otherwise read as the app's own characterization of a clinical decision
  rather than the patient's self-report of it — added a one-time "Visits in range (as logged by
  you)" lead-in to the report section rather than annotating every row.
- **Strict-TypeScript architect — approve-with-changes.** The `VisitDecisionKind` label map,
  `isVisitDecisionKind`/`isVisitDecision` guards, and `setVisitDecision`'s no-op-on-missing-date
  update all check out against the real `SIDE_EFFECT_LABELS`/`isSideEffect` precedent.
  _Must-fixes (applied):_ `nearbyDoseChange` used `Array.find`, returning the first in-window
  `DoseChange` rather than the closest — contradicted this doc's own test plan and is now a
  proper closest-by-distance scan; `daysBetween` was left as a hand-wave ("or equivalently
  expressed") and is now pinned as an integer day-delta via the existing `parseIsoDate`, no `as`.
- **Mobile UX / friction — approve.** "+ Log decision" lives in Settings on past-visit rows only,
  as an inline picker, never a forced modal, and is fully revisitable — truly optional and
  non-blocking. No must-fix. _Noted, not required:_ the affordance has no dismiss and will
  persist on every decision-less past visit indefinitely; acceptable in low-frequency Settings,
  but a "no decision to log" option is worth considering if visit lists grow long in practice.
- **Data-model / migration + privacy + scope — approve-with-changes.** _Must-fix (applied,
  headline finding):_ the original `isVisit` extension validated `decision` as part of the
  all-or-nothing structural guard doc 11's `isVisitList` uses (`.every(isVisit)`), so one
  malformed or future-versioned `decision` would silently discard **every** logged visit on both
  live load and backup import — directly contradicting this doc's own "pure additive enrichment"
  Non-goal. Reworked so `isVisit` never inspects `decision` at all; a malformed decision is
  dropped by a separate, tolerant `readOptionalVisitDecision` step, never fails the visit.
  Confirmed the field correctly rides inside doc 11's existing `visits`/`Backup.visits` — no new
  `STORAGE_KEYS` entry, no `Backup` shape change — and the sequencing note (fold into doc 11 if
  it hasn't shipped yet) is sound. Scope held: coarse taxonomy, no ICD coding, no persisted
  `Visit`↔`DoseChange` foreign key, consistent with doc 11's own rejection of that coupling.
