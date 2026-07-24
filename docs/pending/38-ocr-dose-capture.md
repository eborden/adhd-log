> **Status:** Proposed — **decision needed** (2026-07-23) · **Priority:** P3 (new native
> dependency, real data-integrity risk, gated on a product-scope call — same framing as docs
> 20/26/34) · Ref: innovation batch, round 4

# OCR prescription-label dose-change capture

## Problem

Logging a `DoseChange` today means typing the amount and picking a unit by hand — a small
friction cost, but a real one at exactly the moment a titration step happens (a new bottle, a
new label, sometimes a slightly different-looking pill). The pharmacy label already has the
dose amount, drug name, and quantity printed on it. A camera-plus-OCR flow that reads a label
and pre-fills the `DoseChange` form is a genuinely bold "reduce friction at the highest-stakes
data-entry moment" idea, and worth writing up honestly rather than either building it
speculatively or leaving the idea unexamined.

**The risk is equally real, stated up front.** `DoseChange.dose.amount` is the single most
load-bearing number in this entire app — every trend, every before/after comparison, every
titration-timeline entry keys off it. An OCR misread (a `5` read as `6`, a decimal point missed
entirely turning `0.5mg` into `5mg`) that silently populates the form is a **worse** failure mode
than typing being slightly slow, because a wrong number that looks plausible is far more likely
to be saved without a second look than a manual entry someone typed themselves and is already
paying attention to. This doc's entire design is built around never letting that happen.

## Options

### Option A — recommended, if built at all: OCR as a same-screen suggestion, never an auto-fill

- The camera captures a photo of the label; on-device OCR (see Feasibility) extracts candidate
  text, and a best-effort parser looks for a dose amount + unit pattern in it.
- **The result populates the form fields as editable text, pre-selected/highlighted, never
  submitted.** The user sees exactly what was read, in the same numeric-keypad fields they'd
  type into manually.
- **A visible "read from photo" provenance marker** stays attached to the draft (not the saved
  record — `DoseChange` itself gains no new field) so the confirmation screen can visually
  distinguish "this came from OCR, double-check it" from a manually-typed value, right up until
  the moment of Save.
- **Affirmative confirmation is required before Save can commit an OCR-derived value — the exact
  same Save button is not enough (panel — clinical lens must-fix).** An earlier version of this
  design reused doc 04's `<DoseInput>` Save button unchanged, reasoning that "review before save"
  was itself the safeguard. It isn't sufficient on its own: a value pre-filled into the same
  field a habituated single tap already commits will sometimes be tapped through unread,
  precisely because a wrong-but-plausible OCR read (the `5`→`6` / `0.5mg`→`5mg` case named above)
  looks right at a glance — the exact failure mode visual review is supposed to catch, defeated
  by the same muscle memory that makes manual entry fast. Concretely: while the "read from photo"
  provenance marker is attached, the amount field must be **actively edited or explicitly
  re-confirmed by the user** (e.g. the field must receive and lose focus, or a distinct "Looks
  right" tap on the specific digits) before Save is enabled for that draft — a plain, unmodified
  OCR-derived value sitting in the field is not, by itself, a state Save can act on. This is one
  extra deliberate touch, not a modal or a second screen, but it cannot be the same reflexive tap
  that would have committed a manually-typed value.
- **No auto-retry loop, no "are you sure" dialog theater beyond the one required touch above.**
  The safeguard is a single, specific interaction with the actual digits, not a generic
  confirmation modal that would itself become as automatic as the first tap.

### Option B — deferred: OCR-assisted supply count (doc 36) instead of dose amount

Reading a bottle's fill quantity to pre-fill doc 36's `MedicationSupply.dosesOnHand` is a lower-
stakes version of the same idea — a wrong supply count is an inconvenience (a countdown that's
off by a few doses), not a corrupted titration record. If Option A's OCR pipeline is ever built,
this is the natural, safer first application of it. Not built here; named so the OCR
investment, if made, isn't assumed to apply to dose amounts by default.

### Option C — rejected: silent auto-fill with no review step

Rejected outright per the Problem section — this is the one thing this doc exists to design
around, not toward. A misread that saves without a human looking at the specific digits is a
data-integrity regression on the single most load-bearing field in the app.

## Non-goals (all options)

- **No cloud OCR API.** Any text recognition must run on-device (see Feasibility) — sending a
  photo of a prescription label to a third-party cloud OCR service would be a real breach of
  this app's local-only contract, not a gray area.
- **No auto-detection of the medication name or drug identity.** Even if OCR could plausibly read
  the drug name off the label, this doc's dose-amount-only scope stays narrow; a name mismatch
  between the label and the existing `Profile.medName` is not reconciled or flagged automatically
  — that would drift toward the multi-med-manager scope doc 20 already rejected.
- **No photo storage, and no OCR-text retention either (panel — scope lens must-fix: an earlier
  draft bounded only the image).** The captured image is used transiently to extract text and
  then discarded — never saved to the device's photo library, never attached to the `DoseChange`
  record, never included in any export. **The same applies to the raw recognized text itself,
  not just the photo:** a pharmacy label's OCR output carries more than the dose — patient name,
  prescriber, Rx number, pharmacy name and address — and that full recognized-text string is
  arguably the higher-risk artifact of the two, not the image. It is used transiently to extract
  the dose amount/unit and then discarded in full — never persisted, never logged (including to
  any crash/analytics tooling, if this app ever adds any), never attached to the `DoseChange`
  record, never included in any export. Nothing beyond the confirmed `amount`/`unit` values
  themselves ever leaves this transient extraction step.

## Feasibility / cost, stated plainly

- **On-device OCR is genuinely available without a heavy new dependency.** Both platforms ship
  first-party, on-device text recognition: iOS's Vision framework (`VNRecognizeTextRequest`) and
  Android's ML Kit Text Recognition (on-device model, no network call). Unlike doc 26's Health
  situation, this is not a from-scratch two-platform native build — it's two platform SDKs doing
  the same job, each requiring a thin native bridge (or an existing community Expo module
  wrapping one/both) rather than a second build target the way doc 34's widget does.
- **Camera permission is a real, new permission prompt** — this app currently requests no camera
  access at all. A permission this narrowly scoped (used only when the user explicitly starts
  this flow, never backgrounded) is a reasonable ask, but it is a new category of access, worth
  naming rather than treating as free.
- **OCR accuracy on real-world pharmacy labels is inconsistent** — small print, glare, curved
  bottle surfaces, and pharmacy-specific label layouts (dose amount is not always in the same
  position or format) mean the extraction step will frequently produce a low-confidence or wrong
  parse. Option A's design (editable suggestion, never auto-submitted) is not a nice-to-have
  given this — it is load-bearing for the feature to be safe to ship at all.
- **A forced native rebuild** once the OCR bridge is added, per `docs/BUILD.md`'s cost table —
  comparable to doc 05/33's single-dependency cost, materially smaller than doc 26/34's.

## Recommendation

**Do not build without a demonstrated friction problem at the dose-change moment specifically** —
unlike doc 26 (health data) or doc 34 (widget), where the value case is about daily-use
friction, dose changes are infrequent (a handful of times over a titration), so the total time
saved across a whole titration is small even if OCR works perfectly every time. If ever built,
Option A only, with the review-before-save design treated as non-negotiable, not a detail to
simplify away under implementation pressure. Option B is the safer place to spend this
investment first, if it's spent at all. Option C stays rejected.

## Design for Option A, if built

### `lib/label-ocr.ts` (new, thin, RN-free parsing layer)

```ts
/**
 * Extracts a candidate dose amount + unit from raw OCR text, or `undefined` if no confident
 * pattern is found. Pure text parsing — the camera/OCR call itself is native, not RN-free; this
 * function only processes whatever text string that native call already produced.
 */
export function parseCandidateDose(
  ocrText: string,
): { readonly amount: number; readonly unit: DoseUnit } | undefined {
  // A conservative regex over common label phrasings (e.g. "40 MG", "0.5mg", "5 mL") extracts a
  // candidate amount and a unit token; the unit token is narrowed to DoseUnit via a membership
  // guard over the three literals ('mg' | 'mcg' | 'mL') — the same idiom isSideEffect/isContextTag
  // already use — never cast, since a regex capture is a bare `string` until checked (panel — TS
  // lens note). Returns undefined on anything ambiguous (multiple numbers, no recognizable unit)
  // rather than guessing. Ambiguity must resolve to "show nothing, let the user type," never a
  // best-effort guess presented with the same visual confidence as a clean read.
}
```

This function is the only piece of this feature that's meaningfully unit-testable — feed it
sample OCR-plausible strings (including deliberately ambiguous/malformed ones) and assert it
returns `undefined` rather than a wrong guess on anything it isn't confident about.

### UI (`app/(tabs)/settings.tsx`, dose-change logging flow)

A "Scan label" button beside the existing manual dose-amount entry (doc 04's `<DoseInput>`).
Tapping it: camera capture → native OCR → `parseCandidateDose` → if a candidate is found,
pre-fill `<DoseInput>`'s amount/unit fields with a visible "from photo — please confirm" marker;
if not, fall back silently to the empty manual fields with no error dialog (a failed OCR read is
not a failure state worth interrupting the user over — they were always going to type it
manually if this hadn't existed). **Save stays disabled for an OCR-populated draft until the
amount field has been actively touched/re-confirmed** (see the clinical must-fix in Options,
above) — the one deliberate deviation from doc 04's `<DoseInput>` flow, scoped narrowly to only
the OCR-origin case; a manually-typed draft behaves exactly as `<DoseInput>` already does today.

### Test plan

`parseCandidateDose` is fully unit-testable (see above): confident single-match strings parse
correctly; multiple numbers/units in one string return `undefined`; a decimal point rendered
ambiguously by OCR (e.g. a period that could be a stray mark) is treated conservatively — if the
regex can't be confident it's a decimal, it returns `undefined` rather than guessing high or
low. The camera/native-OCR call itself is not unit-testable under this repo's RN-free
convention; manual on-device verification (photograph several real or mocked-up labels, confirm
either a correct pre-fill or a clean fallback to empty fields, never a wrong-but-plausible
silent value) is the test plan for that layer, matching the manual-verification posture docs
26/33/34 already established for their own native integration points.

## Gate compliance

`lib/label-ocr.ts` follows every existing gate (no `any`/`!`/`@ts-*`, RN-free, Vitest covered,
returns `undefined` rather than throwing or guessing on ambiguity). The native
camera/OCR-bridge code lives outside this repo's TypeScript/ESLint/Vitest gates. No new
persisted type — `DoseChange` is unchanged; the OCR provenance marker is ephemeral draft state,
never saved.

## Dependencies & sequencing

Independent of every other doc in this batch and prior rounds. If Option B is ever pursued
instead of/before Option A, it depends on doc 36 (`MedicationSupply`) existing first.

## Alternatives considered

- **Barcode/QR scanning of a pharmacy-printed label code instead of OCR of the printed text:**
  considered — some pharmacy labels carry a barcode, but format and presence vary widely by
  pharmacy chain and aren't standardized the way, say, a retail UPC is, so this would work for
  some labels and not others with no way to know in advance; OCR of the printed dose text is
  more universally applicable even though less precise.
- **Manual photo capture kept as a searchable reference image, without OCR:** rejected — this
  doc's Non-goals already exclude photo storage; a photo archive of prescription labels is a
  different, larger feature (a document vault) than the friction-reduction goal this doc
  targets, and would need its own privacy/storage design.
- **Building this before doc 34's widget or doc 26's Health integration:** rejected in the
  Recommendation above — dose changes are infrequent enough that the aggregate time saved is
  smaller than either of those higher-frequency-use-case docs, despite this one being, on its
  own, an interesting capability.

## Panel review

Run through the 4-lens panel (2026-07-23): approve (strict-TS), approve-with-changes (clinical,
scope). Must-fixes applied above.

- **Clinical — approve-with-changes.** The conservative `parseCandidateDose` contract (returns
  `undefined` rather than guessing on ambiguity) was confirmed load-bearing, and the
  Recommendation's "do not build without a demonstrated friction problem, Option B first" posture
  was confirmed as the clinically correct default given the data-integrity stakes. _Must-fix
  (applied):_ "review before save, never auto-submit" was judged necessary but not sufficient — a
  value pre-filled into the exact same field a habituated Save tap already commits will
  sometimes be tapped through unread, since a wrong-but-plausible OCR read looks right at a
  glance, the exact failure mode visual review is supposed to catch. Added a requirement that
  Save stays disabled for an OCR-populated draft until the amount field is actively touched or
  re-confirmed — one deliberate interaction with the specific digits, not a generic modal that
  would itself become as automatic as the tap it's meant to interrupt.
- **Strict-TypeScript architect — approve.** `parseCandidateDose`'s signature and its
  `undefined`-on-ambiguity contract are type-sound; `DoseUnit`/`Dose.amount` are used consistently
  with their real, existing shapes. No must-fix. _Noted, incorporated above:_ the extracted unit
  token must be narrowed to `DoseUnit` via a membership guard over the three literals, never cast
  — a regex capture is a bare `string` until checked, the same idiom `isSideEffect`/`isContextTag`
  already use.
- **Mobile UX / friction — no verdict received.** The UX lens agent did not deliver findings for
  this round despite three explicit re-requests (a recurring pattern already noted in this
  project's memory). Not treated as blocking: this is a decision doc recommending against
  building without a demonstrated need, so there is no shipped UI surface yet for a UX-specific
  verdict to apply against beyond what the other three lenses already covered.
- **Data-model / migration + privacy + scope — approve-with-changes.** "No auto-detection of
  medication name" and the local-only/no-cloud-OCR boundary were confirmed held throughout.
  _Must-fix (applied):_ the original Non-goals bounded photo retention but not the recognized
  OCR text, which carries more PHI than the dose alone (patient name, prescriber, Rx number,
  pharmacy) and is arguably the higher-risk artifact of the two — extended the Non-goal so the
  full recognized text is discarded after extraction, exactly like the photo.
