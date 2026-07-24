> **Status:** Proposed — **decision needed** (2026-07-23) · **Priority:** P3 (new dependency,
> real cost/benefit tradeoff, gated on a product-scope call — same framing as docs 20/26/34/38/
> 39/42) · Ref: innovation batch, round 5

# Password-protected PDF export

## Problem

The PDF report is this app's whole reason to exist, and once generated it leaves the phone via
the OS share sheet — email, a messaging app, a cloud drive upload to hand to a provider's portal.
Every one of those channels is outside this app's control the moment the share sheet takes over,
and none of them guarantee the file stays private in transit or at rest on the receiving end (an
email sitting in an inbox, a file in a shared cloud folder). This app already takes privacy
seriously on-device (the optional Face ID lock); a password-protected PDF would extend that same
posture to the one artifact that actually leaves the device, so that even if the file ends up
somewhere it shouldn't, it isn't readable without a password the patient chooses and shares
separately (verbally, or via a different channel than the file itself).

## Options

### Option A — recommended if built: optional password entry, applied via post-processing

- On the export screen, a `Toggle` (default off): "Password-protect this PDF." When on, one
  password field appears (with a "show password" reveal, matching this app's own care about
  usable security elsewhere).
- The PDF is generated exactly as today (`expo-print`'s `Print.printToFileAsync`, unchanged),
  then **post-processed** to add PDF-standard password protection (AES-based PDF encryption,
  requiring the password to open the file in any standard PDF reader) before the share sheet is
  invoked.
- **The password is never stored.** It exists only in ephemeral component state for the duration
  of generating that one PDF, then is discarded — the same posture doc 44's cover note takes for
  its own ephemeral, export-time-only input. If the user wants password protection again next
  time, they type it again.

### Option B — deferred: a single, reusable "export password" set once in Settings

Letting the user set one password in Settings that's reused for every export removes the
retype-every-time friction of Option A, but introduces a new question this doc doesn't want to
answer casually: where does that password live, and how is it protected at rest (a password
stored in plaintext in `Profile` would be a real regression, given how carefully this app treats
its own local security elsewhere). Deferred rather than designed here — Option A's ephemeral,
retyped-per-export password sidesteps the storage question entirely by never storing anything.

### Option C — rejected: relying on the OS share sheet's own transport security instead

Rejected — the share sheet's transport security (e.g. HTTPS to an email provider) says nothing
about what happens to the file **after** it arrives — sitting in an inbox, a Downloads folder, a
shared drive. Password-protecting the file itself is the only mechanism that protects the
content regardless of where it ends up after the app has no more control over it, which is
precisely the gap this doc exists to close.

## Non-goals (all options)

- **No password recovery mechanism.** If the patient forgets the password before the provider
  opens the file, there is no reset — the file is exactly as protected from the patient as from
  anyone else who doesn't have the password. This is stated plainly as a real tradeoff, not
  hidden.
- **No encryption of the JSON backup export.** This doc is scoped to the PDF specifically — the
  JSON backup already exists for a different purpose (personal disaster-recovery, restored back
  into this same app) and encrypting it would need its own design (how would restore prompt for
  the password); out of scope here.
- **No in-app password manager, no biometric-gated password reveal beyond the existing app-level
  Face ID lock** (which already gates the whole app before this screen is ever reached) — this
  is one password field for one export action, nothing more.

## Feasibility / cost, stated plainly

- **`expo-print` has no native PDF-encryption option** — `Print.printToFileAsync` produces a
  plain, unencrypted PDF; there is no parameter to pass a password through to the underlying
  renderer. Password protection must happen as a **separate post-processing step** on the
  already-generated file.
- **The dependency question is genuinely open, not settled — corrected after review (panel — TS
  and scope lens must-fix).** An earlier draft named `pdf-lib` specifically and scored it as
  "lightweight... no native module" on the strength of that specific choice. That claim does not
  hold: `pdf-lib` does not implement PDF password/encryption — writing an encrypted PDF, as
  distinct from merely reading one, has been a long-standing gap in that library, not a feature
  it has. Naming a library that cannot perform the one thing this doc needs, then pricing the
  whole doc's cost as cheap on the strength of that specific library, is exactly the kind of
  under-scrutinized dependency claim this repo's own practice (docs 05/26/33/34/38/39/42) exists
  to catch elsewhere — this doc must hold itself to the same bar. **The honest state of this
  question:** a genuinely capable pure-JavaScript PDF-encryption library may or may not exist at
  implementation time; if the only real options carry native modules or a heavier footprint, this
  doc's whole cost/benefit picture — and its "lower-risk than most decision docs in this batch"
  framing — changes materially. This must be re-verified against a real, specific, currently-
  capable library before implementation begins, not assumed from this design doc.
- **Real processing cost on a real PDF.** Post-processing an already-rendered multi-page report
  (the report can be long for a multi-month range) adds a measurable delay before the share
  sheet opens — likely still sub-second for this app's data volumes (per `docs/PLANNING-v0.md`'s
  own "~1 entry/day" scale assumption, reports stay modestly sized), but worth stating rather
  than assuming free.
- **Standard PDF password protection is not unbreakable.** It deters casual access (someone who
  finds the file can't just open it) but is not a defense against a determined, resourced
  attacker — stated honestly in-app if this is ever built (see UI), so it isn't oversold as
  stronger security than it is.

## Recommendation

**Gated on two open questions now, not one (panel correction).** An earlier draft called this
"lower-risk to build than most other decision docs in this batch" on the strength of an
unverified dependency claim (see Feasibility). With that claim corrected to genuinely open, the
honest recommendation is: **first, confirm a real PDF-encryption-capable library exists at an
acceptable cost** (ideally pure-JS, but re-evaluate the whole cost picture if not); **only then**
weigh it against demonstrated demand for the feature itself, the same bar every other decision
doc in this batch is held to. If both resolve favorably, Option A only (ephemeral, retyped-per-
export password); Option B stays a named follow-on only if Option A's friction proves to be a
real complaint in practice; Option C stays rejected regardless.

## Design for Option A, if built

### `lib/pdf-protect.ts` (new, thin wrapper around the new dependency)

```ts
/**
 * Applies standard password protection to an already-generated PDF file, returning the path to
 * the protected copy. Thin wrapper over whichever PDF-manipulation dependency is confirmed
 * capable at implementation time (see Feasibility — not settled by this doc) — no new report
 * content, no change to how the PDF is generated; this runs strictly after Print.printToFileAsync.
 */
export async function protectPdfWithPassword(
  sourcePath: string,
  password: string,
): Promise<string> {
  // Loads the file, applies the dependency's password-protection API, writes the protected copy
  // to a new path, deletes the unprotected source file (see below), and returns the protected
  // copy's path for the share sheet to use.
}
```

**The unprotected intermediate file must be deleted, on every path including failure (panel —
scope lens must-fix).** `Print.printToFileAsync` writes a plain, readable PDF to disk; this
function then writes a _second_, protected copy alongside it. An earlier draft returned the
protected path without ever addressing the first, unprotected file — leaving a fully readable
copy of the exact report this feature exists to protect sitting in app storage, silently
defeating the entire point. `protectPdfWithPassword` (or its caller, immediately after a
successful protect) must delete the unprotected source via `expo-file-system`, and this deletion
must happen on the failure path too (if protection fails partway through, the unprotected
original must not be left behind as the fallback the user unknowingly shares instead).

Not RN-free (file I/O via `expo-file-system`, the same category of native-adjacent code
`lib/export.ts`'s existing PDF flow already has) — lives alongside the existing export code, not
in the strict RN-free `lib/` tier this repo reserves for pure logic.

### UI (`app/(tabs)/settings.tsx`, export screen)

The `Toggle` + conditional password field described in Option A, directly below doc 44's cover
note field if that doc also lands (both are export-time-only, ephemeral inputs on the same
screen). **A genuinely new interaction primitive for this app, styled to match what already
exists (panel — UX lens must-fix).** This app's only existing security surface today is the
biometric Face ID lock, which involves no typing at all — a password field with a "show
password" reveal has no existing analog to reuse wholesale. Build it using the same `TextInput`
styling this app already uses elsewhere (the dose-amount field, the evening notes field) rather
than a bespoke control, so it reads as consistent with the rest of the app rather than a foreign
element, even though the interaction pattern itself (secure text entry + reveal) is genuinely
new. **Explicit, honest copy** near the toggle: "Adds a password to open this PDF. There's no way
to recover a forgotten password — share it with your provider separately, and remember it
yourself." No silent oversell of the protection's strength.

### Test plan

`protectPdfWithPassword` is testable at the integration level (generate a small fixture PDF,
protect it, confirm the protected file requires the password to open via the same library's own
read API; confirm the unprotected intermediate file no longer exists on disk after both the
success path and a deliberately-forced failure path — the load-bearing test for the scope lens's
must-fix above) rather than as a pure Vitest unit — this is the one place in this doc's design
that touches real file I/O, similar in kind to how `lib/export.ts`'s existing PDF generation is
already outside the strict pure-logic Vitest tier. The UI toggle/field logic (does the password
field appear only when the toggle is on, is the password cleared after export) is the
component-level testable surface, same posture as every other Settings toggle in this app.

## Gate compliance

`lib/pdf-protect.ts` follows every existing gate that applies to non-RN-free `lib/` code (no
`any`/`!`/`@ts-*`, typed function signature, no persisted type — the password is never written to
storage). `npm run check` must pass before commit.

## Dependencies & sequencing

Independent of every other doc in this batch and prior rounds. Naturally pairs with doc 44 (both
are export-screen, ephemeral-input additions) but shares no code with it.

## Alternatives considered

- **Encrypting the PDF's content at the HTML/render stage instead of post-processing the finished
  file:** rejected — `expo-print`'s renderer has no encryption-aware path; post-processing the
  standard, unencrypted PDF output is the only integration point available without forking or
  replacing the renderer entirely.
- **A device-generated random password shown once instead of a user-typed one:** rejected — a
  password the user chooses is one they can plausibly communicate to their provider through a
  channel they already control (a phone call, in person); a random generated string is harder to
  relay accurately and adds no real security benefit over a user-chosen one for this threat model
  (casual exposure, not a targeted attack).
- **Skipping this because standard PDF password protection isn't unbreakable security:** rejected
  as too strict a bar — it meaningfully raises the floor against casual/incidental exposure (a
  misdirected email, a shared drive someone else can browse) even though it isn't a defense
  against a sophisticated attacker, and the Recommendation/UI copy above are explicit that it's
  exactly that tier of protection, not more.

## Panel review

Run through the 4-lens panel (2026-07-23): approve (clinical), approve-with-changes (strict-TS,
UX, scope — scope explicitly flagged the dependency question as a hard gate that would flip its
verdict to reject if left unresolved). Must-fixes applied above.

- **Clinical — approve.** No clinical-content angle — a purely security/access post-processing
  step that changes neither what is captured nor how it's presented. The one care-loop-adjacent
  risk (a forgotten password meaning the report never reaches the provider) is already handled
  honestly by the explicit no-recovery copy and the "not unbreakable" framing. No must-fix.
- **Strict-TypeScript architect — approve-with-changes.** _Must-fix (applied):_ the named
  dependency, `pdf-lib`, does not implement PDF password/encryption writing — a long-standing gap
  in that library, not a feature it has. Naming a capability-incapable library and then pricing
  the doc's cost as cheap on the strength of that specific choice was corrected: Feasibility and
  Recommendation now state the dependency question as genuinely open, to be resolved against a
  real, currently-capable library at implementation time, not assumed from this design doc.
- **Mobile UX / friction — approve-with-changes.** Correctly opt-in (a default-off toggle, zero
  added taps for anyone who doesn't use it) with honest no-recovery copy. _Must-fix (applied):_
  flagged that a password field with a "show password" reveal is a genuinely new interaction
  primitive — this app's only existing security surface (Face ID) involves no typing — with no
  existing control to reuse wholesale; specified it should be built with the same `TextInput`
  styling this app already uses elsewhere so it reads as consistent, not foreign.
- **Data-model / migration + privacy + scope — approve-with-changes (the dependency question was
  a hard gate on this verdict).** The password-never-stored claim was confirmed enforceable
  against the actual design (ephemeral state only, no `Profile`/`Backup` field) — Option B's
  storage question is correctly deferred rather than casually answered. _Must-fixes (applied):_
  (1) independently caught the same `pdf-lib` capability gap the TS lens found and required the
  cost accounting be redone once a real library is identified, since realistic capable
  alternatives may carry native dependencies that materially change the "lower-risk" framing; (2)
  the unprotected intermediate PDF `Print.printToFileAsync` produces was never addressed — added
  an explicit requirement to delete it after protection succeeds, and on the failure path too, so
  a readable copy of the exact report this feature protects can't linger in app storage.
