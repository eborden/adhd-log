> **Status:** Proposed — **decision needed** (2026-07-23) · **Priority:** P3 (large modeling
> effort, standards-compliance risk, gated on a product-scope call — same framing as docs
> 20/26/34/38/39) · Ref: innovation batch, round 5

# Structured health-data export (FHIR-lite)

## Problem

Every export this app produces today is built for a **human** reader: the PDF report (visual
tables, sparklines) and doc 30's portal digest (a short paragraph). Nothing produces data a
receiving system could **ingest structurally** — a growing number of EHR patient portals and
some newer patient-generated-data intake flows accept standards-based health data (HL7 FHIR
resources) rather than requiring a human to retype numbers from a PDF. A structured export would
let this app's data flow into a provider's own record system with far less transcription risk
than a human rekeying figures off a printed page. This is a genuinely ambitious "expand
capability" idea and, done carelessly, a genuinely risky one — FHIR is a large, precise
specification, and a sloppy or non-compliant mapping could produce data a receiving system
either rejects or, worse, silently misinterprets.

## Options

### Option A — recommended if built: a minimal, narrowly-scoped FHIR Bundle export

- Export a FHIR `Bundle` (type `collection`) containing only the resource types this app's data
  maps to cleanly and unambiguously:
  - **`MedicationStatement`** — one per `DoseChange`, `medicationRequested`/`medicationCodeableConcept`
    left as **text-only** (the free-text `Profile.medName`, no coded drug identifier — see
    Non-goals for why this app cannot safely emit an RxNorm/NDC code) with `dosage.text` carrying
    the plain "40 mg" string doc 30's `formatDose` already produces, `effectiveDateTime` = the
    change's date.
  - **`Observation`** — one per logged rating (`mood`, `focus`, etc.), `code.text` = the metric's
    schema label, `valueInteger` = the 1–5 rating, `effectiveDateTime` = the day, `category` =
    `survey` (a patient-reported observation, not a lab/vital — the correct FHIR categorization
    for exactly what this data is).
  - **No `Patient` resource with identifying data.** The bundle carries no name, no birthdate, no
    MRN — those belong to whatever system receives and reconciles the bundle with an existing
    patient record; this app has none of that information to include correctly even if it wanted
    to.
- **Generated on-demand, exported the same way the existing JSON/PDF already are** (share sheet,
  user-initiated) — not a live API integration, not a SMART-on-FHIR OAuth flow. This is a file
  format change to an existing export gesture, not a new data-transmission capability.

### Option B — simpler fallback: attach the raw JSON backup alongside the PDF, unconverted

Rather than mapping to FHIR at all, bundle the existing `Backup` JSON as a second attachment in
the same share action that produces the PDF — a receiving system with custom intake tooling
could parse this app's own native JSON shape directly (documented, versioned by this app's own
schema) rather than a standards body's schema. Far less modeling risk than Option A (no FHIR
compliance surface at all), but only useful to a receiving system willing to write a custom
parser for this app's specific JSON shape — a real, if narrower, subset of the value Option A
would deliver to any FHIR-aware system.

### Option C — rejected: a live SMART-on-FHIR API integration (OAuth, direct submission to an EHR)

Rejected outright — this would require this app to authenticate against a specific health
system's API, handle OAuth token storage, and make a real network call to a third party's
server, which is a categorical breach of the local-only, user-initiated-export contract this
app has held throughout. A generated file the user shares through the existing share sheet is
categorically different from an app that talks to a health system's server directly.

## Non-goals (all options)

- **No coded drug identifiers (RxNorm, NDC).** Mapping `Profile.medName`'s free text to a
  standardized drug code requires a drug-terminology lookup this app has no access to and no
  business performing without real pharmacological data behind it — a wrong code mapped from a
  loosely-typed free-text name is a worse outcome than an honest `text`-only field a human
  reviewing the bundle can read correctly. `medicationCodeableConcept.text` only, never `.coding`.
- **No FHIR `Condition`/diagnosis resources.** This app tracks no diagnosis; nothing in scope
  here should imply one exists by including a resource type this app has no data to back.
- **No live API submission, no OAuth, no network call of any kind** — see Option C.
- **No claim of full FHIR compliance.** "FHIR-lite" is the honest name: a small, careful subset
  of two resource types, correctly formed for what they contain, not a general-purpose clinical
  data interoperability layer. A receiving system that expects a fuller resource graph (encounters,
  practitioners, care plans) will not find one here.

## Feasibility / cost, stated plainly

- **FHIR resource construction is a data-mapping problem, not a native-dependency problem** —
  unlike most other decision docs in this batch, this doesn't need a new platform SDK or native
  bridge; it's TypeScript interfaces and JSON serialization, fully RN-free and unit-testable.
  The cost here is **correctness risk**, not engineering plumbing: getting resource shapes,
  required fields, and cardinality wrong produces a bundle that looks plausible but fails
  validation against a receiving system's FHIR server, possibly silently.
- **No new runtime dependency required for Option A** if resources are hand-modeled as plain
  TypeScript interfaces (the FHIR spec for these two resource types is well-documented and
  narrow enough to model directly); a full FHIR validation library would be a heavier, optional
  addition if stricter guarantees are wanted later.
- **The receiving side is entirely outside this app's control.** Even a perfectly-formed bundle
  is only useful if whatever the user shares it to actually accepts a FHIR Bundle file import —
  this varies enormously by provider/EHR vendor, and this app has no way to know in advance
  whether a given recipient can use it. Option B's plainer JSON attachment has the same property
  but a lower bar (any custom intake tooling, not specifically FHIR-aware tooling).

## Recommendation

**The decision, made explicitly, not left implicit (panel — scope lens must-fix): ship neither
option now.** This doc's header says "decision needed" — the decision is: **do not build
without evidence a real receiving system** (a specific EHR patient-portal upload flow, a
specific provider's intake process) can actually ingest a FHIR Bundle file today. This is the one
decision doc in this batch whose value is almost entirely dependent on the receiving-end
ecosystem, which this app has no visibility into and no control over, so — absent from that
evidence — this doc's actual, real value today is as a **scope-boundary record**: it documents
why this app will not emit a `Patient` resource, will not map coded drug identifiers, and will
not become a live SMART-on-FHIR integration (Option C), so a future contributor doesn't have to
re-litigate those boundaries from scratch. That record is worth landing now; the modeling work
in "Design for Option A" below is ready-to-build reference, not greenlit work. If a concrete,
demonstrated intake path appears later, Option A is worth the investment; Option B (attach the
raw JSON) is the near-zero-cost placeholder if a narrower, non-FHIR-aware custom intake ever
shows up first. Option C stays rejected regardless.

## Design for Option A, if built

### `lib/fhir-export.ts` (new, RN-free)

```ts
export interface FhirBundle {
  readonly resourceType: 'Bundle';
  readonly type: 'collection';
  readonly entry: readonly FhirBundleEntry[];
}

export type FhirBundleEntry =
  { readonly resource: FhirMedicationStatement } | { readonly resource: FhirObservation };

// Minimal shapes for exactly the fields this app populates — not the full FHIR resource
// definitions, which carry many more optional fields this app has no data to fill. `IsoDate` and
// `MedName` (panel — scope lens must-fix) are used at this boundary instead of bare `string`,
// keeping the branded-type discipline all the way to the serializer rather than widening early.
export interface FhirMedicationStatement {
  readonly resourceType: 'MedicationStatement';
  readonly status: 'active';
  readonly medicationCodeableConcept: { readonly text: MedName }; // text-only, see Non-goals
  readonly dosage: readonly [{ readonly text: string }];
  readonly effectiveDateTime: IsoDate; // FHIR dateTime permits date precision
}

export interface FhirObservation {
  readonly resourceType: 'Observation';
  readonly status: 'final';
  // `system` included (panel — TS lens must-fix): a strict FHIR validator rejects a `coding`
  // entry with a `code` but no `system` — an earlier draft omitted it.
  readonly category: readonly [
    { readonly coding: readonly [{ readonly system: string; readonly code: 'survey' }] },
  ];
  // Scale anchor folded into the label (panel — clinical lens must-fix): a bare `code.text:
  // "focus"` next to `valueInteger: 4` is genuinely ambiguous once this leaves the PDF's
  // surrounding context — no range, no direction, no signal this is a single-item self-rating
  // rather than a validated instrument score. `code.text` must state range + direction inline,
  // e.g. "Focus (self-report, 1=worst – 5=best)" — reusing the schema's own low/high anchor text
  // (`scaleAnchorCaption`'s inputs in `lib/schema.ts`), never a bare metric name.
  readonly code: { readonly text: string };
  readonly valueInteger: Rating;
  readonly effectiveDateTime: IsoDate;
}

export function buildFhirBundle(
  profile: Profile | null,
  doses: readonly DoseChange[],
  entries: Readonly<Record<IsoDate, DayEntry>>,
  rangeStart: IsoDate,
  rangeEnd: IsoDate,
): FhirBundle {
  // Assembles one MedicationStatement per in-range DoseChange and one Observation per logged
  // rating in range, via the existing rowsInRange/ratingAccessor helpers — no new data
  // collection, purely a different serialization of data already gathered for the PDF/JSON.
  //
  // Two must-fixes from the strict-TS lens, both about narrowing rather than asserting:
  // 1. `medicationCodeableConcept.text` needs `profile.medName`, but `profile` is `Profile |
  //    null` and there is nowhere else a medication name lives (DoseChange carries only
  //    `date`/`dose`/`note` — never a name). When `profile === null`, emit NO
  //    MedicationStatement entries at all (the bundle still carries every in-range Observation)
  //    — never a placeholder string, never a non-null assertion.
  // 2. `ratingAccessor(...)` returns `Rating | undefined` per row; each candidate Observation's
  //    value must be narrowed via the same `filter((v): v is Rating => v !== undefined)` idiom
  //    `metricAverage`/`averageOf` already use before constructing the resource — never asserted.
}
```

Reuses `rowsInRange`, `ratingAccessor`, `formatDose`, `REPORT_RATING_ORDER` — every existing,
landed pure helper the PDF report and portal digest already call. This file adds a third
**serializer** over the same inputs, never a fourth data-collection path.

### UI (`app/(tabs)/settings.tsx`, export section)

A third export option, "Export health data (FHIR)" (shortened per UX review to avoid wrapping on
narrow screens), beside the existing PDF/JSON
buttons, using the same selected date range. Produces a `.json` file (a FHIR Bundle is itself
JSON) via the same share-sheet flow the JSON backup export already uses — no new file format
handling, no new native capability.

### Test plan

Fully unit-testable, RN-free: `buildFhirBundle` — correct resource count and shape for a fixture
with dose changes and ratings in range; `medicationCodeableConcept`/`code` always carry `.text`
only, never a coding system (a structural test that Non-goals are honored, not just described);
`effectiveDateTime` matches the source `IsoDate` exactly; out-of-range doses/ratings are excluded.
Correctness against the actual FHIR spec (resource validity, required-field completeness for a
real receiving server) is not verifiable by this app's own test suite — a manual step (validate
a generated bundle against a public FHIR validator, e.g. HL7's own reference validator) is the
test plan for spec compliance, distinct from this app's own shape tests.

## Gate compliance

No `any`/`!`/`@ts-*`/eslint-disable. No new persisted type — pure derive/serialize over existing
`DoseChange`/`DayEntry`/`Profile` data. `npm run check` must pass before commit.

## Dependencies & sequencing

Independent of every other doc in this batch and prior rounds. Builds only on landed code
(`rowsInRange`, `ratingAccessor`, `formatDose`). If Option B is chosen instead, it depends on
nothing beyond the already-landed `buildBackup`.

## Alternatives considered

- **Modeling every FHIR resource type this app's data could theoretically map to (Encounter,
  Practitioner, CarePlan):** rejected — this app has no data for most of those resource types,
  and fabricating placeholder values to fill required fields would be actively dishonest data.
- **A configurable resource-type selector (choose which resources to include):** rejected as
  premature configuration surface for a feature with no confirmed receiving-end demand yet — see
  Recommendation.
- **Requiring a FHIR validation library dependency from day one:** deferred — hand-modeling the
  narrow two-resource subset is tractable without one; a validation library is a reasonable
  later addition if stricter guarantees become worth the dependency cost.

## Panel review

Run through the 4-lens panel (2026-07-23): approve (UX), approve-with-changes (clinical,
strict-TS, scope). Must-fixes applied above.

- **Clinical — approve-with-changes.** `category: survey` was confirmed as the correct, standard
  FHIR categorization for patient-reported ratings (the value set's own examples are assessment
  instruments like MoCA/Apgar) — neither overstating clinical status nor understating it. The
  "no coded drug identifiers" Non-goal was confirmed adequate; unlike doc 40's rejected design,
  this export makes no correlation/aggregate claim (1:1 serialization, no bucketing, no means).
  _Must-fix (applied):_ `Observation.code.text` carried a bare metric name with no scale anchor —
  a raw `4` is genuinely ambiguous once it leaves the PDF's surrounding context (no range, no
  direction, no signal it's a single-item self-rating). Folded the schema's own low/high anchor
  text into `code.text` so the value can't be misread out of context.
- **Strict-TypeScript architect — approve-with-changes.** _Must-fixes (applied):_ `profile`'s
  `Profile | null` type means `medicationCodeableConcept.text` has no source when `profile ===
null` (no medication name lives anywhere else, including `DoseChange`) — resolved by emitting
  no `MedicationStatement` entries in that case, never a placeholder or assertion; `ratingAccessor`
  returns `Rating | undefined`, so each candidate Observation value must be narrowed via the same
  `filter` idiom `metricAverage` already uses, never asserted. _Noted, incorporated:_
  `category[].coding[].code` needs a `system` field or a strict validator rejects it;
  `effectiveDateTime` and `medicationCodeableConcept.text` now use `IsoDate`/`MedName` rather than
  bare `string`, keeping the branded-type discipline at the serializer boundary.
- **Mobile UX / friction — approve.** Zero daily-flow impact — a third button in the Export
  card, no new screen. No must-fix. _Applied:_ shortened the button label to avoid wrapping on
  narrow screens. _Noted, not blocking this doc:_ the export screen's accumulating button/field
  count across this batch's docs (30, 35, 42, 44, 45) is a batch-level concern, addressed where
  it was raised (see doc 44's panel review).
- **Data-model / migration + privacy + scope — approve-with-changes.** Confirmed this stays a
  third pure serializer over already-collected data — no new inbound data, no `Backup`/
  `STORAGE_KEYS` change, no network, no FHIR-side data collection introduced. _Must-fix
  (applied):_ the doc's "decision needed" header must resolve to an actual decision rather than
  read as greenlit modeling work — made explicit: ship neither option now; the doc's real,
  landed value today is as a scope-boundary record (documenting the `Patient`/coded-drug-ID/
  live-API rejections) rather than a build spec.
