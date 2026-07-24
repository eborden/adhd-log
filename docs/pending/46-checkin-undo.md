> **Status:** Proposed (2026-07-23) · **Priority:** P2 · Ref: innovation batch, round 5 ·
> **Substantially reworked after a UX-lens reject on the original design — see Panel review**

# Same-day edit affordance legibility

## Problem / Context

**Corrected premise, stated up front because the original draft of this doc got this wrong and
was rejected for it:** an earlier draft assumed the only way to fix a same-day mis-tap (an
accidental scale selection, a chip toggled the wrong way, a Save pressed one row early) was a
three-step detour through History → `app/entry/[date].tsx`. That's false about this app as it
exists today. `app/(tabs)/index.tsx`'s `SessionCard`, once a session is saved, already shows the
caption **"Tap to edit"** and its `onPress` already routes back into `/checkin` with the same
session param, no date needed; `app/checkin.tsx` already loads today's entry and pre-fills the
draft via the existing `draftFromMorning`/`draftFromEvening` hydration. Tapping the same card a
user just saved is **already** a permanent, one-tap, pre-filled edit path — exactly the
capability the original draft proposed adding, except already built, and permanent rather than
disappearing after a time window.

**The real, narrower gap:** that caption is quiet — a small text label on an otherwise
done-looking card — and a user moving quickly (tap-tap-tap-Save, exactly the fast flow this app
optimizes for) may genuinely not register that the just-saved card is still tappable. The actual
opportunity is **legibility of an existing affordance right after the moment it becomes most
relevant** (immediately after a save, when a mis-tap is freshest in memory and easiest to
correct), not a new capability layered on top of one that already exists.

## Goals / Non-goals

**Goals**

1. Immediately after a successful Save, briefly make the **existing** "Tap to edit" affordance on
   that `SessionCard` more noticeable — not a new UI element, not a new tap target, the exact
   same permanent one this app already has.
2. The emphasis fades after a short window; the underlying tap target and its behavior **never**
   disappear or change — only the momentary visual/textual prominence does. This is the
   structural fix for the original draft's rejected design: nothing about the actual editing
   capability is time-boxed, only a discoverability nudge is.
3. Zero added friction to the common case: a correct check-in, saved and left alone, looks and
   behaves exactly as it does today, both during and after the emphasis window.

**Non-goals**

- **Not a new edit path, not a new component, not a new route.** This doc changes only the
  caption/emphasis on the existing `SessionCard` done state for a short window — the tap target,
  its `onPress`, and the check-in screen it opens are all completely unchanged.
- **No confirmation dialog on Save itself** — same reasoning as the original draft: that would
  add friction to every save to guard against an occasional mistake, the tradeoff doc 15's
  friction-reducer philosophy already rejects elsewhere.
- **Not framed as an invitation to reconsider the rating, only to fix a mis-tap (panel — clinical
  lens must-fix).** The emphasis copy must read as "did that save correctly?" not a generic,
  open-ended "want to make changes?" — the narrower framing matters because this batch has
  repeatedly had to guard against features that could quietly encourage revising an honest,
  in-the-moment rating after the fact (docs 37/40/41 all touch this concern from different
  angles). This doc's own honesty about that tension is addressed directly below, not left
  implicit.
- **No new persisted state.** The emphasis window is ephemeral component state (which session,
  saved how recently), never written to `Profile` or any storage key.

## The data-quality tension, named directly (panel — clinical lens must-fix)

A window that draws attention to "you can still change this" — even one this narrow, even one
this honestly motivated — carries a real, symmetric risk alongside the one it's meant to fix: it
could invite softening an honest-but-uncomfortable rating on reflection (tap a genuinely low mood,
then reconsider and "fix" it upward a minute later), not just correcting an actual mis-tap. This
doc does not eliminate that risk — it cannot, since the underlying edit capability is permanent
and pre-existing regardless of this doc. What bounds it to a small, acceptable risk: (1) the
emphasis window is short and appears only immediately after the exact moment a mis-tap is most
memorable and least distinguishable from deliberate reconsideration in the _opposite_ direction
(there is no way to design around this precisely, but the window's brevity limits how much
"cooling off" time it invites); (2) the copy is narrowly framed around confirming what was just
tapped, not a generic "want to make changes?" invitation (see Non-goals); (3) `entry/[date].tsx`
already allows editing any day, including today, at any time, permanently — this doc changes
discoverability of an existing capability's timing, not the capability's existence, so the
marginal risk this doc adds is bounded to "slightly more likely to notice you can still edit
right now," not "a new way to revise a rating that didn't exist before."

## Core logic — none new

Identical to the original draft's mechanics, retargeted at emphasis instead of a new link: a
small piece of ephemeral view state (which session, saved how recently) in
`app/(tabs)/index.tsx`'s component state, checked against a fixed window constant.

```ts
// Component-local UI timing, not domain logic — no lib/ export.
const EDIT_EMPHASIS_WINDOW_MS = 2 * 60 * 1000; // 2 minutes
```

## UI (`app/(tabs)/index.tsx`, `SessionCard`)

For `EDIT_EMPHASIS_WINDOW_MS` after a session is saved (tracked as local component state seeded
on navigation return from `checkin.tsx`, never read from `completedAt` — the same reasoning the
original draft gave for not persisting this: it should not survive an app restart), the
`SessionCard`'s existing done-state caption changes from the plain "Tap to edit" to a
slightly more prominent, narrowly-framed variant — e.g. **"Saved — tap to fix a mis-tap"** —
using the same tap target, the same `onPress`, the same pre-filled edit flow, with only the
caption text and perhaps a brief visual emphasis (not a new color scheme, nothing that competes
with the primary done-state styling) drawing the eye to it. After the window elapses, the
caption reverts to the existing plain "Tap to edit" — which remains **exactly as functional as
it was during the window** and exactly as it already is today without this doc at all. Nothing
that works now stops working; only the wording that draws attention to it changes, temporarily.

## Test plan

The time-window check is the only testable logic, small enough it may live inline rather than in
its own module — if extracted, a one-line pure function `isWithinEmphasisWindow(savedAt: number,
now: number): boolean`, unit-tested at the boundary. The `SessionCard` caption-swap itself is
UI-component behavior, not unit-tested under this repo's RN-free convention — a manual
verification step (save a check-in, confirm the emphasized caption appears and the tap target
still opens the correct pre-filled edit flow, confirm the caption quietly reverts to "Tap to
edit" after the window while remaining fully tappable) is the test plan for that layer.

## Gate compliance

No `any`/`!`/`@ts-*`/eslint-disable. No new persisted type, no `Backup`/`STORAGE_KEYS` change,
no new component, no new route. `npm run check` must pass before commit.

## Dependencies & sequencing

Independent of every other doc in this batch and prior rounds. Builds only on landed code (the
existing `SessionCard` done-state caption and its already-working edit route) — no new storage,
no new report/Trends surface, no new capability of any kind.

## Alternatives considered

- **The original draft's design — a new, time-boxed "Edit" link that disappears after the
  window:** rejected by the UX lens and removed. The premise it was built on (no existing
  same-day edit path) is false — the identical capability already exists, permanently, on the
  same card. A second link duplicating an existing permanent one, then making the duplicate
  disappear, is strictly worse than the status quo: it risks a user who misses the window later
  wondering "wasn't there an edit option?" when the real one was there the whole time and never
  left.
- **A toast/snackbar "Undo" reverting the save outright:** rejected for the same reason the
  original draft rejected it — a true revert needs to restore whatever was there before (which
  may itself have been a real prior entry), adding real complexity `entry/[date].tsx`'s existing
  editor already handles more simply by just being reopenable.
- **Doing nothing (leaving the existing quiet caption as-is):** considered seriously, since the
  existing capability already technically closes the gap. Rejected in favor of this doc's narrow
  legibility nudge because "the capability exists" and "a fast-moving user notices it exists in
  the specific moment they'd want it" are different claims, and the data-quality tension named
  above is judged (by the clinical lens's own approve-with-changes, not a reject) to be an
  acceptable, bounded cost for closing that gap.

## Panel review

Run through the 4-lens panel (2026-07-23) on the original design (a new, time-boxed "Edit" link);
substantially reworked in response to a **reject**, not a must-fix, from the UX lens:

- **Clinical — approve-with-changes on the original draft; incorporated into this rework.**
  Confirmed the original design's core motivation (fewer permanently-baked mis-taps) is real, but
  required naming the symmetric risk it never addressed: a lingering "Edit" affordance could
  invite softening an honest rating on reflection, not only correcting a genuine mis-tap — the
  same category of concern this batch has repeatedly had to guard (docs 37/40/41). Required the
  affordance be framed narrowly around confirming a mis-tap, not a generic "want to make
  changes?" invitation. Both are addressed directly in the reworked doc's own "data-quality
  tension" section, argued to a bounded, acceptable risk rather than eliminated (the underlying
  edit capability is permanent and pre-existing regardless of this doc, so the marginal risk is
  about attention-timing, not a new capability to misuse).
- **Strict-TypeScript architect — approve on the original draft; unaffected by the rework.** The
  time-window check (`isWithinEditWindow`/now `isWithinEmphasisWindow`) using plain `number`
  epoch-millis was confirmed consistent with this repo's existing plain-`number` usage for
  ephemeral UI timing (no branded-millis type exists, and inventing one would be over-modeling);
  correctly rejecting `completedAt` as the timing source (so the affordance/emphasis can't
  survive a restart) was confirmed as the right call. No must-fix in either version.
- **Mobile UX / friction — REJECT on the original draft, driving this rework.** The original
  design's premise was factually wrong: `app/(tabs)/index.tsx`'s `SessionCard` already shows a
  "Tap to edit" caption once a session is done, already routes back into `/checkin` with the
  session pre-filled via the existing `draftFromMorning`/`draftFromEvening` hydration — a
  permanent, one-tap, pre-filled edit path already exists on the identical card the original
  design proposed attaching a second, disappearing link to. Verified directly against the real
  code before accepting the reject. The lens's own suggested reframing — "make the existing
  same-day edit affordance more legible" rather than "add a disappearing second link" — is
  exactly what this doc now does: no new tap target, no new capability, only a temporary,
  narrowly-worded emphasis on what already permanently works.
- **Data-model / migration + privacy + scope — approve on the original draft; unaffected by the
  rework.** Confirmed "no new persisted state" holds in both versions — the emphasis/affordance
  timing is ephemeral component state, deliberately not derived from the persisted `completedAt`
  field specifically so it cannot survive an app restart, and editing (in both versions) reuses
  the exact same `saveCheckin` merge path every other edit already uses. No `Backup`/
  `STORAGE_KEYS` surface in either version.
