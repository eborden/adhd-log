> **Status:** Proposed — **decision needed** (2026-07-23) · **Priority:** P3 (a new binary-asset
> persistence architecture this app has never needed, camera/photo-library permissions, real
> backup-size implications — same framing as docs 20/26/34/38/39/42/45) · Ref: innovation batch,
> round 6

# Symptom photo diary

## Problem

Some side effects are far easier to show than to describe: a rash, visible swelling, a tremor
caught on video-length attention, a bruise from a fall during a dizzy spell. Today's side-effect
chips (`SideEffectReports`, keyed severity per `SideEffect`) capture _that_ something happened
and _how bad_ it felt, but nothing visual.

**(panel — clinical lens, must-fix.)** The original framing of this doc pitched the photo as
provider-facing evidence — but see Non-goals and "JSON backup — explicitly excluded" below: a
photo never reaches the PDF report or the JSON export, by this doc's own design. Claiming
provider value for data the provider structurally never sees is dishonest framing this doc must
not carry. The real, honest use case is **patient-side recall aid**: a photo helps the _patient_
remember and describe what a rash or bruise actually looked like days later, either from memory
or by literally showing the phone screen to a provider in person during a visit — an in-person,
show-your-phone artifact, not a report artifact. The Recommendation below is revised accordingly.

This is a genuinely new kind of data for this app — every other tracked field is text, numbers,
or small enums. A photo is a binary asset, and this app has never needed to persist, back up, or
manage growing binary storage before. That is a real architectural step, not a data-model
tweak, and this doc treats it with the weight that deserves.

## Options

### Option A — recommended if built: one optional photo per side-effect-day, local files only

- From the evening check-in's side-effect chips (once an effect is selected), an optional
  "Add a photo (optional)" affordance appears, offering the camera or the photo library.
- The chosen image is copied into this app's own sandboxed document directory (via
  `expo-file-system`), **not** referenced from the system photo library — so deleting or moving
  the original elsewhere on the phone never breaks the app's own copy, and the app's copy is
  fully under its own lifecycle (deleted when the day's entry is deleted, if that ever becomes
  possible; today nothing deletes a `DayEntry`, so neither does this).
- `EveningCheckin`'s per-effect `SideEffectDetail` gains one new optional field: a filename/path
  reference to the locally-stored image, never the image bytes themselves inline in the JSON
  record.
- **No photo analysis of any kind.** The image is stored and displayed, never processed,
  classified, or described by this app — a photo is exactly as opaque to this app as a person's
  own memory of what they saw.

### Option B — deferred: multiple photos per side-effect-day

One photo per effect per day is the minimal, reviewable version; letting a patient attach a small
gallery (progression photos over several days of a rash, say) is a real and plausible want, but
multiplies the storage-growth and UI-gallery-viewer surface for a first version that hasn't yet
proven the single-photo case is worth the architectural investment. Named, not designed here.

### Option C — rejected: cloud photo storage (even opt-in, even provider-facing)

Rejected outright — this is exactly the kind of sensitive, identifiable health data (a photo of
a patient's own body) this app's local-only contract exists to protect most strictly. No
exception for this data type; if anything, this is the data type that most needs to stay
on-device only.

## Non-goals (all options)

- **No photo analysis, classification, or description of any kind.** No on-device ML model
  reading the image, no auto-tagging, no "this looks like X" — a photo is opaque data this app
  stores and shows, nothing more.
- **No inclusion of photo bytes in the JSON backup export by default.** See Feasibility — a
  base64-embedded image would bloat the JSON export dramatically, and this doc does not require
  solving that for a first version (see Alternatives for the tradeoff considered and deferred).
- **No cropping/editing/annotation tools.** The app displays exactly the photo the user selected
  or captured, unmodified — building an image editor is real scope this feature doesn't need.
- **No requirement that a photo accompany any side effect.** Purely additive and optional, every
  existing side-effect entry (with or without a photo) continues to work exactly as it does
  today.

## Feasibility / cost, stated plainly

- **A new architectural category for this app: binary asset persistence.** Every other piece of
  data this app stores is JSON-serializable text/numbers/enums living in AsyncStorage. A photo
  is a binary file living in the filesystem, referenced by path from a JSON record — a genuinely
  new pattern this codebase has never needed, not just a new field on an existing type.
- **Camera and/or photo-library permission**, a new permission category alongside doc 38's own
  camera-permission cost (if both land, they'd likely share the same permission grant, but each
  must be justified and requested independently at the moment it's actually used, matching this
  app's existing "ask when needed, not upfront" posture).
- **Storage growth is real and unbounded by this app's own design.** Unlike every other field
  (a rating, a chip, a short string), a photo can be hundreds of kilobytes to several megabytes,
  and nothing in this app's model limits how many get taken over a multi-month or multi-year
  titration log. This must be stated honestly rather than assumed away — see Alternatives for a
  rejected fixed-count cap and why a soft, visible size indicator is the better fit.
- **Backup/restore of binary files is a materially harder problem than this app's existing JSON
  backup.** The existing JSON export is a single serializable blob; a backup that also needs to
  carry photo files means either a multi-file archive format (new export shape entirely) or
  accepting that JSON export/import does not carry photos (the recommended default — see
  Non-goals) — this is a real, load-bearing design decision, not a detail to defer casually.
- **(panel — data-model/scope lens, must-fix, most severe finding this round.) OS-level
  auto-backup is a real, unaddressed exposure this doc must reckon with, separate from this
  app's own JSON export.** iOS's iCloud device backup and Android's Google auto-backup both
  capture an app's sandboxed document directory by default — the exact location Option A stores
  photos. A photo of a rash or a bruise, taken specifically because this app is meant to be
  local-only, would by default be swept into the phone's OS-level cloud backup regardless of
  whether the user ever touches this app's own export feature. This is a materially different and
  more severe privacy question than the JSON-export exclusion above (which is a choice this app
  makes about its _own_ export), and this doc must not treat it as solved by that exclusion. If
  built, this requires actively marking the photo directory excluded from OS backup at write time
  (iOS: `NSURLIsExcludedFromBackupKey` on the file/directory; Android: `android:fullBackupContent`
  / `android:allowBackup` configuration excluding the relevant path) — this is a hard _must-fix_
  for Option A, not an optional hardening step, given this app's local-only contract is otherwise
  unconditional.

## Recommendation

**(panel — clinical + data-model/scope lenses, must-fix.)** **Lean toward not building.** Two
independent, compounding reasons, not one:

1. Every other doc in this pending set extends this app's existing JSON/AsyncStorage model; this
   is the first to require a genuinely new persistence category (files on disk, referenced by
   path), with real unbounded storage growth and an unsolved OS-level auto-backup exposure (see
   Feasibility) that no other feature in this app has had to reckon with.
2. Once honestly reframed (see Problem) as a patient-side recall aid rather than provider-facing
   evidence, the feature's value is real but modest — a photo the provider never sees in the
   report or export is a weaker justification for taking on (1)'s architectural cost than the
   original provider-facing framing implied. The combination of "new architecture" and "narrower
   value than first stated" is why this doc's recommendation moved from "confirm value before
   building" to **"don't build, unless a patient-facing recall aid is confirmed valuable enough on
   its own, independent of any provider-facing claim, to justify the new persistence category."**

If built anyway, Option A only, with the JSON-backup exclusion (see Non-goals) and the OS
auto-backup exposure (see Feasibility) both accepted as real, named limitations disclosed to the
user up front — not solved awkwardly later, and not discovered by the user only after a restore
or a device backup silently carried a symptom photo somewhere they didn't expect. Option B stays
a named follow-on; Option C stays rejected.

## Design for Option A, if built

### Data model (`lib/types.ts`)

```ts
// SideEffectDetail (lib/types.ts:50-58) gains one more optional field:
export interface SideEffectDetail {
  readonly severity: SideEffectSeverity;
  readonly origin?: 'migrated';
  readonly photoFilename?: string; // a filename within this app's own document directory, not a full path
}
```

A bare filename, not an absolute path — paths change across app reinstalls/OS versions; the app
always resolves the current document-directory root at read time, matching how this kind of
reference is conventionally handled with `expo-file-system`.

### Storage boundary (`lib/storage.ts`)

**(panel — strict-TypeScript lens, must-fix: corrected symbol reference.)** The relevant guard is
`isSideEffectDetail` (`lib/storage.ts:189`) — a **private, non-exported** function used
internally by the entries-list guard, not exported alongside the public `isSideEffectSeverity`
(`lib/storage.ts:185`) as an earlier draft of this doc implied. It gains one more optional-field
check: `photoFilename === undefined || typeof photoFilename === 'string'` — additive, matching
every other optional-field guard extension in this codebase, and consistent with
`exactOptionalPropertyTypes`: the check accepts the key being absent, never a literal `undefined`
value assigned to it. **A photo whose file has gone missing from disk must degrade gracefully,
never crash the app**: a read path that checks a referenced file exists before attempting to
display it, showing a plain "photo unavailable" placeholder rather than a broken image or an
error boundary.

**(panel — strict-TypeScript lens, must-fix.)** `withSideEffectSeverity` (`lib/schema.ts:147-154`)
rebuilds a `SideEffectDetail` as `{ severity }` only when severity is edited — today that's
correct (it deliberately drops a stale `origin: 'migrated'`, since editing severity makes the
entry user-entered), but if this doc lands, that same rebuild would **silently discard
`photoFilename`** on any severity edit made after a photo was attached, deleting the photo
reference from the record (the file itself stays on disk, orphaned) with no error and no signal
to the user. If built, `withSideEffectSeverity` must be updated to preserve `photoFilename`
explicitly: `{ ...reports, [effect]: { severity, ...(existing?.photoFilename !== undefined ? {
photoFilename: existing.photoFilename } : {}) } }` — carrying the photo forward across a severity
edit, only ever dropping `origin` as it already correctly does.

**(panel — data-model/scope lens, must-fix.)** The photo file itself must be excluded from OS
auto-backup at write time — the concrete implementation of the Feasibility/Recommendation
sections' most severe finding, not left as a stated limitation only. Whichever `expo-file-system`
write call copies the captured photo into the app's document directory (see Options above) must
pair that write with the platform-appropriate backup-exclusion call for that file (iOS:
`NSURLIsExcludedFromBackupKey`; Android's equivalent backup-exclusion configuration) — a photo
this app's own contract says never leaves the device must not be silently swept into the phone's
OS-level cloud backup by omission.

### UI (`app/checkin.tsx`, `app/entry/[date].tsx`)

**(panel — mobile UX lens, must-fix.)** The "Add a photo (optional)" affordance renders **within
or directly below the existing per-effect severity-picker block**, once that effect is selected —
not as a new full-width section elsewhere on the screen. It is one more optional line inside a
block the user is already looking at, matching this app's established friction discipline for
optional add-ons (doc 07's own collapsed context-tags precedent), rather than a second, separate
area competing for attention on an already-dense check-in screen.

**(panel — mobile UX lens, must-fix.)** **A denied camera/photo-library permission must never
block completing or saving the check-in.** If permission is denied (at the OS prompt, or
previously denied and now silently unavailable), the affordance degrades to a plain, non-blocking
message ("Photo access not available — you can still save this check-in without a photo") and
the rest of the check-in flow, including Save, proceeds exactly as if the user had simply chosen
not to add a photo. A missing photo is never a reason this app fails to log a day.

The day-detail view (`app/entry/[date].tsx`) renders any attached photo as a thumbnail beside
that day's side-effect row, tappable to view full-size.

### JSON backup — explicitly excluded, stated plainly (see Non-goals)

`buildBackup`/`restoreBackup` are **not** extended to carry photo bytes. A restored backup on a
new device will show side-effect records with a `photoFilename` reference to a file that does
not exist on that device — the same "missing file" graceful-degradation path above handles this
correctly (shows "photo unavailable," never crashes), and the JSON export's own documentation
(if any exists at export time) should state this limitation plainly: **photos do not travel with
a JSON backup.**

### Test plan

`isSideEffectDetail`'s extended guard is fully unit-testable (accepts/rejects the new optional
field). The file-existence check before rendering is testable at the integration level (mock
`expo-file-system`'s existence check, confirm the placeholder renders when the file is absent).
Actual camera/photo-library capture and file-copy behavior is native, not unit-testable under
this repo's RN-free convention — manual on-device verification (capture a photo, confirm it
persists across an app restart, confirm the missing-file placeholder appears correctly after
manually deleting the underlying file) is the test plan for that layer.

## Gate compliance

The guard extension follows every existing gate (no `any`/`!`/`@ts-*`). The new
`photoFilename?: string` field is additive and optional — no migration, no forced re-onboarding.
The camera/file-system integration code lives outside this repo's strict RN-free `lib/` tier and
outside its Vitest gate, same posture as every other native-integration doc in this batch.

## Dependencies & sequencing

Independent of every other doc in this batch and prior rounds. If doc 38 (OCR dose capture) also
lands, both request camera access independently at their own moment of use — no shared code, no
coordination required beyond both following this app's existing "ask when needed" permission
posture.

## Alternatives considered

- **A fixed cap on the number of stored photos (e.g. 50):** rejected — an arbitrary cap doesn't
  solve the underlying storage-growth question, just delays hitting it, and forcing a patient to
  delete an old photo to make room for a new one during an active flare is exactly the wrong
  moment to add friction. A visible, honest storage-size indicator in Settings (if built) is a
  better fit than a hard cap, though not required for a first version.
- **Embedding photos as base64 directly in the JSON backup, accepting the size cost:** rejected
  — even a handful of photos would balloon the JSON export from a small text file to potentially
  many megabytes, changing its character entirely (today's JSON export is small enough to email
  as a plain attachment without a second thought); excluding photos from the JSON backup and
  stating that limitation honestly is more honest than quietly making every export huge.
- **Storing photos referenced from the system photo library instead of copying them into the
  app's own sandbox:** rejected — a photo library reference can break if the original is deleted,
  edited, or the library permission is later revoked; copying into the app's own sandboxed
  storage keeps the app's data fully under its own control, matching every other piece of data
  this app owns outright rather than referencing externally.

## Panel review

Run through the 4-lens panel (2026-07-23): **approve-with-changes, decision-still-open**
(clinical), **approve-with-changes** (strict-TypeScript), **approve-with-changes** (mobile UX),
**approve-with-changes, most severe finding this round** (data-model/scope). This is the most
privacy-sensitive doc in the whole set; the Recommendation now leans harder toward not building.

- **Clinical — approve-with-changes.** Flagged a framing contradiction: the original Problem
  section claimed provider-facing value for a photo that, by this doc's own design, never reaches
  the PDF report or JSON export. Reframed the Problem and Recommendation around the honest use
  case — a patient-side recall aid / in-person show-your-phone artifact — rather than an
  unsubstantiated provider-value claim.
- **Strict-TypeScript architect — approve-with-changes.** Corrected the claim that
  `isSideEffectDetail` is exported alongside `isSideEffectSeverity` (verified: it's a private,
  non-exported function, `lib/storage.ts:189`); required `withSideEffectSeverity` to preserve
  `photoFilename` across a severity edit instead of silently dropping it (the existing rebuild-as-
  `{severity}`-only behavior, correct for `origin`, would otherwise orphan a photo reference); and
  confirmed the optional-field guard is `exactOptionalPropertyTypes`-safe (absent key, never a
  literal `undefined` value).
- **Mobile UX / friction — approve-with-changes.** Required the photo affordance render within
  the existing per-effect severity block rather than as a new, separate section, and required that
  a denied camera/photo-library permission never block completing or saving the check-in — both
  now stated explicitly above.
- **Data-model / migration + privacy + scope — approve-with-changes, most severe finding.**
  Identified the OS-level auto-backup exposure (iCloud device backup / Google auto-backup
  capturing the app's sandboxed document directory by default) as a real, previously-unaddressed
  gap distinct from and more severe than the JSON-export exclusion this doc already named; added
  an explicit backup-exclusion requirement (`NSURLIsExcludedFromBackupKey` / the Android
  equivalent) as a hard must-fix if built, and pushed the Recommendation from "confirm value
  before building" to "lean toward not building," given the combination of new architectural cost
  and the narrower value that survives the clinical reframing.
