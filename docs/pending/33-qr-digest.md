> **Status:** Proposed (2026-07-23) · **Priority:** P3 · Ref: innovation batch, round 3 ·
> **Depends on pending doc 30's `buildPortalDigest` ([`30-portal-message-digest.md`](30-portal-message-digest.md))**

# QR-code presentation of the portal digest

## Problem / Context

Doc 30 puts the same short summary doc 30 builds onto the clipboard for pasting into a
patient-portal message. That's the right shape for asynchronous, between-visit contact. But
there's a second, different moment doc 30 doesn't serve: standing at an in-person intake desk or
kiosk with a barcode/QR scanner — increasingly common at clinics with EHR-integrated intake —
where handing over a phone screen to be typed from by hand is slower than a scan, and reading
numbers aloud is error-prone. A QR code carrying the exact same short digest text turns a
"read this out loud" moment into a "scan this" one, with zero new data and zero new statistics —
purely a second **presentation mode** for data doc 30 already computes.

## Goals / Non-goals

**Goals**

1. A "Show as QR code" view alongside doc 30's "Copy summary for a portal message" action,
   rendering `buildPortalDigest`'s output as a scannable QR code — the exact same string, just
   encoded differently.
2. Purely presentational: no new data model, no new computation — this doc's entire contribution
   is a rendering choice over an existing string.

**Non-goals**

- **No QR code for anything except the portal digest.** Not a general "export via QR" feature —
  the PDF/JSON exports stay file-based (share sheet); only the short text digest is small enough
  to encode as a scannable QR code in the first place (see Feasibility, below).
- **No scanning/receiving side.** This doc only _generates_ a QR code for someone else's scanner
  to read; the app never scans a QR code itself (no camera permission requested, no import path).
- **No encryption of the QR payload.** The digest is already the exact plain text doc 30 puts on
  the clipboard — a QR code is a different encoding of the same non-secret-scoped text, sharing
  doc 30's threat model, not a strictly identical one: a QR code is machine-readable at a
  distance a screen photo of plain text often isn't (panel — scope lens nuance). Given the
  payload is provider-facing summary data the user is deliberately presenting to a clinic
  scanner at the moment they choose to show it, this is a benign difference, not a new exposure
  — but it's a real one worth naming rather than folding into "changes the transport, not the
  sensitivity."

## Disclaimer survival, a dependency note (panel — clinical lens)

Because the QR code is byte-identical to doc 30's digest text, the "This is a personal log, not
medical advice" trailing line survives inside the encoded payload exactly as long as doc 30's
own digest carries it. A scan at an EHR-integrated intake desk may drop the decoded text
straight into a record with no app chrome around it, so that line is the only thing preserving
the "not medical advice" framing once the text leaves this app entirely. This is not something
for this doc to fix (it's inherited, not introduced, and doc 30 already includes and tests for
that line) — flagged here as a dependency note for whoever implements doc 30, so its removal is
never treated as a purely cosmetic edit.

## Feasibility / cost, stated plainly

- **QR codes have a real capacity ceiling.** At a scannable, reasonably-sized rendering, a QR
  code reliably holds roughly 1–2 KB of text before scan reliability degrades and/or the rendered
  code becomes too dense to read from a normal viewing distance. Doc 30's digest — a handful of
  short lines (medication, adherence, a few metric averages, one side-effect line, a disclaimer)
  — is comfortably within that budget; a full PDF or JSON backup is not and is correctly excluded
  by this doc's Non-goals.
- **One new dependency**, materially lighter than doc 26's Health integration but real enough to
  name: a QR-rendering library (e.g. `react-native-qrcode-svg`) plus its peer dependency
  `react-native-svg`. `react-native-svg` is one of the most widely used, Expo-Go-compatible RN
  libraries (ships prebuilt in Expo Go itself), so the practical risk is low — but it is still a
  new native dependency, unlike doc 30's `expo-clipboard` decision (a pure-behavior addition with
  no rendering surface). Comparable in cost to doc 05's native time picker ("the one dependency
  the panel endorsed adding") rather than to doc 26's two-native-module Health situation.
- **No permission prompt, no config plugin requirement** beyond standard autolinking — this is a
  rendering library, not a hardware-access one.

## UI (`app/(tabs)/settings.tsx`, export section)

Beside doc 30's "Copy summary for a portal message" button, a second action: "Show as QR code."
Tapping it opens a simple modal/full-screen view containing only the rendered QR code (large,
centered, high-contrast) and a "Done" dismiss — no other chrome, since the entire point is
handing the screen to someone else's scanner without distraction. Builds the code from
`buildPortalDigest(...)` — the exact same call doc 30's copy button already makes — so the two
presentations are guaranteed to show identical content, never two independently-maintained
summaries that could drift apart.

**Brightness and screen-wake, required (panel — UX lens must-fix).** The entire feature depends
on a scanner successfully reading the screen, and two default mobile behaviors actively work
against that: habitual low brightness (fails to scan in normal clinic lighting) and the idle
auto-lock timer (dims/locks mid-handoff). While the QR modal is presented: force boosted/maximum
screen brightness and keep the screen awake (e.g. `expo-keep-awake`, already in the same
dependency-weight class as this doc's other additions), restoring both the prior brightness and
the normal auto-lock behavior on dismiss. This is not a nice-to-have — a QR code that fails to
scan because the screen dimmed mid-handoff defeats the entire point of the feature.

**Length guard, stated explicitly:** if `buildPortalDigest`'s output ever exceeds a safe QR
capacity threshold (e.g. because a very long side-effect list or an unusually long date range
padded the text), the "Show as QR code" action is disabled with a short explanatory line
("Summary too long for a QR code — use Copy instead") rather than rendering an unreliable,
barely-scannable code. This threshold is a rendering-safety check, not a new business rule —
doc 30's digest format is not changed to accommodate it.

## Test plan

RN-free logic here is minimal (this doc adds no new pure functions beyond the length guard), so
the test surface is small:

1. **Length guard** — a helper `fitsQrCapacity(text: string): boolean` (a simple length check
   against the chosen safe threshold) is unit-tested at and around the boundary.
2. **Content parity** — a test (or a shared fixture) asserting the QR view and the clipboard-copy
   button build from the exact same `buildPortalDigest(...)` call with the same arguments, so a
   future edit to one presentation can't silently diverge from the other.

The QR rendering itself (an SVG library's own correctness) is not this app's code to test —
manual verification (scan the rendered code with a real device/app and confirm the decoded text
matches) is a manual test-plan step, the same posture doc 26 takes for its own native-module
integration point.

## Gate compliance

No `any`/`!`/`@ts-*`/eslint-disable. No new persisted type, no new `Backup`/`STORAGE_KEYS`
change — this doc adds a rendering path over an existing string, nothing more. `npm run check`
must pass before commit.

## Dependencies & sequencing

**Hard dependency on doc 30**: there is no digest to render as a QR code until
`buildPortalDigest` exists. Land after doc 30. Independent of every other doc in this round and
prior rounds.

## Alternatives considered

- **A QR code for the full JSON backup, chunked across multiple codes:** rejected — multi-code
  chunking (the kind some device-pairing flows use) is real added complexity for a capability
  (device-to-device backup transfer without cloud/AirDrop) this app doesn't currently offer by
  any other means either; if that capability is ever wanted, it deserves its own doc rather than
  riding in as a QR-chunking side effect of this one.
- **Barcode (1D) instead of QR:** rejected — 1D barcodes hold far less data than a QR code and
  offer no benefit here; QR is also more universally supported by modern intake scanners.
- **Making the QR code itself the primary/only presentation, dropping doc 30's clipboard copy:**
  rejected — the two solve different moments (in-person scan vs. asynchronous portal message);
  neither replaces the other.

## Panel review

Run through the 4-lens panel (2026-07-23): approve (clinical, strict-TS, scope),
approve-with-changes (UX). Must-fix applied above.

- **Clinical — approve.** All clinical content is inherited unchanged from doc 30's
  `buildPortalDigest` — this doc adds no new pure function beyond the length guard and is purely
  a second presentation mode. The content-parity test prevents a divergent second summary from
  drifting away from doc 30's reviewed framing. No must-fix. _Added:_ a dependency note that the
  "not medical advice" line's survival inside the encoded payload rests entirely on doc 30
  continuing to include it — flagged for whoever implements doc 30, not a fix to this doc.
- **Strict-TypeScript architect — approve.** `fitsQrCapacity(text: string): boolean` is trivially
  sound; the dependency on doc 30's real `buildPortalDigest(...)` signature is accurate. No new
  persisted type, no `Backup`/`STORAGE_KEYS` change. No must-fix.
- **Mobile UX / friction — approve-with-changes.** _Must-fix (applied):_ the doc said nothing
  about screen brightness or the idle auto-lock timer, both of which actively work against a
  scanner successfully reading the code — added an explicit requirement to force boosted
  brightness and keep the screen awake while the modal is shown, restoring both on dismiss.
  Confirmed the distraction-free modal (just the code + Done) is otherwise the right shape for
  handing the phone to someone else's scanner.
- **Data-model / migration + privacy + scope — approve.** Tightly scoped: no scanning/receiving
  side, no camera permission, no new persisted state — a second presentation mode over an
  existing string. The dependency-cost comparison to docs 05/26/30 (naming both
  `react-native-qrcode-svg` and its `react-native-svg` peer, anchored to doc 05's single-
  dependency precedent rather than doc 26's heavier case) holds up. No must-fix. _Wording
  refined above:_ a QR code is machine-readable at a distance in a way a screen photo of plain
  text often isn't — a benign difference given the deliberate, in-person disclosure context, but
  worth stating rather than folding into "same sensitivity as doc 30."
