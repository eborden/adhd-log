> **Status:** Proposed — **decision needed** (2026-07-21) · **Priority:** P3 (largest effort;
> gated on a product-scope call) · Ref: titration-log research
> (`docs/research/titration-log-examples.md`), design finding #5

# Combination / adjunct medication tracking

## Problem

Several of the most detailed ADHD titration logs in the research are **combinations**, not a single
drug: clonidine + atomoxetine (research examples 14–16), and a multi-year log on methylphenidate +
guanfacine + lamotrigine simultaneously (17). Non-stimulant patients — this app's exact audience —
are frequently on an alpha-agonist _adjunct_ to a stimulant, or a second agent added when the first
plateaus (76). A real titration story is often "held med A, added med B."

The app assumes **one** medication: `Profile` has a single `medName` + `currentDose`, `DoseChange` is
a flat list with no med reference, and the report/Trends bucket by that single drug's steps. A user on
a combination cannot represent it without conflating two drugs' doses into one timeline.

## Why this is a decision doc, not a build-now plan

The `docs/pending` ground rules put scope discipline first, and the panels have repeatedly flagged
over-engineering. Multi-med is **cross-cutting**: it touches `Profile`, `DoseChange`, `Backup`,
onboarding, Settings, the report, Trends, and every dose-bucketing calculation in `lib/report-metrics.ts`. It is
by far the largest of the research-derived plans, and it risks turning a focused single-drug titration
tracker into a general medication manager — a different product.

So this doc's job is to **frame the choice and recommend**, not to green-light a large refactor. Three
options, cheapest first:

### Option A — Do nothing (status quo). Recommended near-term.

Keep the single-med model. Document the limitation honestly in onboarding copy: "Track the one
medication you're titrating; log the others in your notes." Most users titrating a _new_ non-stimulant
are focused on that one drug, and the free-text `notes` field absorbs the rest. Zero cost, zero scope
risk. **Cost:** combination stories remain second-class.

### Option B — Optional single "adjunct" med (minimal expansion).

Add **one** optional secondary med to `Profile` — a name + its own dose-change list — without
generalizing to N drugs:

```ts
export interface AdjunctMed {
  readonly medName: MedName;
  readonly startDate: IsoDate;
  readonly currentDose: Dose;
}
export interface Profile {
  // …existing fields…
  readonly adjunct?: AdjunctMed; // NEW optional — at most one
}
// DoseChange gains an optional discriminant of which med it belongs to:
export type DoseTarget = 'primary' | 'adjunct';
export interface DoseChange {
  readonly date: IsoDate;
  readonly dose: Dose;
  readonly note?: string;
  readonly target?: DoseTarget; // absent ⇒ 'primary' (back-compat)
}
```

`target === undefined` reads as `'primary'`, so every existing `DoseChange` and backup stays valid
(migration-free). `doseActiveOn` gains a `target` parameter; the report shows two dose timelines
side-by-side; Trends can filter/overlay. **Cost:** medium-plus — every dose calc becomes
target-aware, the report doubles its dose section, onboarding/Settings gain optional adjunct fields.
**Benefit:** covers the common stimulant + alpha-agonist reality without becoming a med manager.

### Option C — Full N-medication model. Not recommended.

Generalize to an array of meds each with its own dose history. Correct in the abstract, but it
re-architects the data model and every consumer, and pushes the product toward a general tracker.
Out of scope for a personal single-titration tool; explicitly rejected unless the mission changes.

## Recommendation

**Ship A now** (honest copy about the single-med scope), and hold **B** as the ready design if real
usage shows combination titration is common enough to justify the cross-cutting cost. Do **not** build
C. This doc exists so that if/when the adjunct need is confirmed, Option B's back-compat-safe shape
(optional `adjunct`, `target`-defaulting `DoseChange`) is already thought through — not so that it is
scheduled.

## If Option B is chosen — sketch of the work (not a commitment)

- **Types:** `AdjunctMed`, optional `Profile.adjunct`, `DoseTarget`, optional `DoseChange.target`
  (default primary). All additive/optional → migration-free.
- **Storage:** extend `isProfile` to validate `adjunct` as absent-or-valid via a new `AdjunctMed`
  guard mirroring the profile field checks; extend `isDoseChange`/its normalizer to accept
  absent-or-valid `target`; no new key (adjunct doses live in the same `doses[]`, discriminated by
  `target`). **Same all-or-nothing hazard as doc-18 (panel — TS + scope):** an unknown `target` value
  must not reject the whole `doses[]` on import — route through the doc-18 `parseDoseChange`
  normalizer (drop the row to primary or omit, never fail the list).
- **The "primary" filter is `target === undefined || target === 'primary'`** (panel — TS lens): the
  default must match both absent (legacy) and explicit-primary.
- **`doseActiveOn(doses, date, target = 'primary')`** — filter by target before resolving; all
  existing callers get primary by default. **Every** dose-timeline consumer in `lib/report-metrics.ts`
  and `lib/storage.ts` (`bucketByDosePeriod`, `beforeAfterDose`, `lastChangeOnOrBefore`,
  `doseChangeMarkers`) must become target-aware, or it silently merges two meds' steps — this is the
  real cost of B (panel — TS lens).
- **Report/Trends:** a second, clearly-labeled dose track; before/after (doc-16) computed per target.
  On the small mobile Trends chart a two-track render is the genuine clutter risk (panel — UX lens) —
  not the data model; the second track must not crowd the primary med's bars/markers. Keep the "log
  and discuss with your provider" framing visible wherever two med tracks appear (panel — clinical
  lens): a combination view that stays silent on interactions could imply there are none.
- **Onboarding/Settings:** an optional "add an adjunct medication" affordance, never required and
  never on the daily check-in (panel — UX lens).
- **Non-goals even under B (load-bearing fence — panel clinical + scope):** no drug database, no
  interaction checking (that is clinical advice — forbidden), no more than one adjunct, no per-med
  reminder proliferation. This fence is the line between B and a general medication manager.

## Test plan (only if B proceeds)

Guard back-compat (legacy `DoseChange` with no `target` → primary), `doseActiveOn` target filtering,
two-track report render, backup round-trip with and without an adjunct.

## Gate compliance

Whatever option: no `any`/`!`/`@ts-*`/eslint-disable; new unions discriminated + exhaustive; additive
optional fields only, so no destructive migration; 100% type-coverage. Under A, the only change is
onboarding copy.

## Panel review

Run through the 4-lens panel (2026-07-21): **all four approve** the recommendation (ship Option A now,
hold B, reject C). No must-fixes to the recommendation itself; the panel's Option-B carry-forwards are
folded into the sketch above so B is pre-thought-through if ever triggered.

- **Clinical — approve.** Deferring to single-med with honest onboarding copy is clinically sound.
  _Carried into B:_ keep "log and discuss with your provider" visible wherever two med tracks appear —
  a combination tracker silent on interactions could imply there are none; interaction checking stays
  forbidden (clinical advice).
- **Strict-TypeScript architect — approve.** Option A is copy-only, zero type surface. _Carried into
  B:_ B's shapes are type-sound and back-compat (optional `adjunct`, `target` defaulting primary), but
  `isProfile` + a new `AdjunctMed` guard must validate the field, the primary filter must be
  `target === undefined || target === 'primary'`, and every dose-timeline consumer in
  `lib/report-metrics.ts`/`lib/storage.ts` becomes target-aware — the doc now books that cost.
- **Mobile UX / friction — approve.** From this lens A is ideal (zero daily-flow change). _Carried
  into B:_ adjunct entry stays optional and off the daily check-in, and the two-track mobile chart —
  not the data model — is the real clutter risk to manage.
- **Data-model / migration + privacy + scope — approve.** Multi-med is the single largest
  scope-creep vector toward a general manager; naming that and recommending A is the disciplined call.
  _Carried into B:_ the unknown-`target` all-or-nothing hazard mirrors doc-18 and is resolved the same
  way; the "one adjunct, no drug DB, no interaction checking" fence is load-bearing.
