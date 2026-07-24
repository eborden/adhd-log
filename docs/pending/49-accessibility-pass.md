> **Status:** Proposed (2026-07-23) · **Priority:** P1 · Ref: innovation batch, round 6

# Accessibility pass

## Problem / Context

This app has never had a dedicated accessibility review. Its own design tokens already carry
the raw material for one (`lib/tokens.ts`'s `fontSize` scale, `lib/theme.ts`'s light/dark
`useColorScheme` support), but nothing in this repo's history has systematically checked Dynamic
Type scaling, screen-reader labeling, or minimum tap-target sizing across the app's actual
screens. This matters for this app specifically, not just as general good practice: a
non-stimulant ADHD medication's target population plausibly includes people with co-occurring
visual, motor, or attention-related accessibility needs, and a check-in flow that's fast for a
sighted, precise-tapping user but slow or unusable for someone using VoiceOver or larger text
undermines the exact "make daily logging actually happen" mission this app's friction-reduction
docs (15, 46) already treat as load-bearing. This is a genuine capability expansion — reaching
users the app currently may not serve well — not a cosmetic polish pass.

## Goals / Non-goals

**Goals**

1. **Dynamic Type / large-text support** audited and fixed across every screen: confirm text
   scales with the OS text-size setting rather than being fixed-size, and that layouts don't
   truncate, overlap, or push critical actions (Save, the scale buttons) off-screen at larger
   sizes.
2. **VoiceOver/TalkBack labeling** audited and added where missing: every interactive element
   (the `ScaleSelector` buttons, `Toggle`, `Chips`, `Stepper`, all icon-only buttons) needs an
   `accessibilityLabel` that reads sensibly aloud, not just a visual label a sighted user infers
   from position or icon shape.
3. **Minimum tap-target size** audited across every tappable element — a real concern for this
   app's own target user (motor/attention differences can make small targets meaningfully harder
   to hit accurately, and a mis-tap is exactly the data-quality problem doc 46 already exists to
   mitigate from a different angle).

**Non-goals**

- **No new features, no new screens.** This is an audit-and-fix pass over existing screens and
  components — every fix here makes an existing surface more accessible, none adds new
  capability beyond that.
- **No new design system, no new token layer.** `lib/tokens.ts`/`lib/theme.ts` already provide
  the values this pass needs (font sizes, colors, spacing); this doc uses them more
  consistently and completely, it does not replace or restructure them.
- **No platform-specific accessibility feature beyond the standard ones** (Dynamic Type,
  VoiceOver/TalkBack, tap-target size) — more exotic accessibility APIs (e.g. Switch Control,
  Voice Control) are out of scope for a first pass; get the fundamentals right before the
  advanced cases.
- **No claim of full compliance with any specific accessibility standard** (WCAG, platform
  guidelines) as a certification — this is a genuine, careful improvement pass, described
  honestly as that, not marketed as a compliance guarantee this doc can't actually verify without
  a dedicated audit tool or professional review.

## Scope, itemized against real screens

**(panel — mobile UX lens, must-fix: verified against the actual current component code, not
assumed.)** An earlier draft of this doc treated every component below as starting from zero
accessibility support. Reading the real components shows a mixed starting point — some already
have real support that needs **enriching** with missing context, others have a **genuine gap**
with no accessibility props at all. Both kinds of work are real, but they're different kinds of
work, and this doc now says which is which:

- **`components/ScaleSelector.tsx` — enrich, not add.** Already has, per rating button:
  `accessibilityLabel={`${label}: ${String(rating)}`}` and `accessibilityState={{ selected }}`
  (`components/ScaleSelector.tsx:36-38`). The gap is narrower than "no label at all": the label
  states the rating number but not the scale's low/high anchor text a sighted user reads from the
  row's flanking labels — enrich to `` `${label}: ${rating} of 5, ${rating === lowest ? low : rating
=== highest ? high : String(rating)}` `` (or equivalent) so a screen-reader user gets the same
  anchor context ("3 of 5, out of control") a sighted user already sees. **Dynamic Type risk,
  flagged separately below** — this is the app's core, highest-frequency input, and its buttons
  use a fixed `aspectRatio: 1.3` (`components/ScaleSelector.tsx:77`) with `typography.cardTitle`
  text for the rating number; at the largest Dynamic Type setting, that fixed-ratio button is the
  single likeliest clipping point in the whole app, and a clipped/illegible rating number is a
  data-quality risk (a genuine mis-read of what a user actually tapped), not just a cosmetic one.
- **`components/Chips.tsx` — enrich.** Already has `accessibilityRole="button"` and
  `accessibilityState={{ selected: active }}` per chip (`components/Chips.tsx:32-33`), but no
  `accessibilityLabel` — a screen reader announces "button, selected" with no indication of
  _which_ chip, the genuine gap to close here.
- **`components/Stepper.tsx` — genuine gap.** The `+`/`−` buttons already carry
  `accessibilityLabel`s (`Decrease ${label}` / `Increase ${label}`), but the current-value `Text`
  itself (`components/Stepper.tsx:33`) has no accessibility role or label at all — a screen
  reader has no way to announce the current value, only the two buttons that change it.
- **`components/Toggle.tsx` — genuine gap.** Renders a bare `Switch` (`components/Toggle.tsx:16-
22`) with its label as a sibling `Text`, and the `Switch` itself carries no `accessibilityLabel`
  — VoiceOver/TalkBack announces "on"/"off" with no indication of _what_ is on or off.
- **`components/DoseInput.tsx`** — audited alongside the above for a correct `accessibilityRole`
  and a label stating current state, same posture as every other input component in scope.
- **`app/checkin.tsx`, `app/(tabs)/index.tsx`, `app/(tabs)/trends.tsx`,
  `app/(tabs)/history.tsx`, `app/(tabs)/settings.tsx`, `app/entry/[date].tsx`** — each screen
  checked for: text that scales with Dynamic Type without truncating or overlapping; a sensible
  screen-reader reading order (top-to-bottom, matching visual layout, not scrambled by absolute
  positioning); icon-only buttons (if any) carrying a text label for screen readers even when
  visually icon-only.
- **`components/LockScreen.tsx`** — the biometric lock gate, checked specifically because it's
  the very first thing anyone using assistive technology encounters, and a poorly-labeled lock
  screen would block access to everything else regardless of how accessible the rest of the app
  becomes.

## UI / implementation notes

No new components. Fixes are applied in-place to existing components/screens: adding/correcting
`accessibilityLabel`/`accessibilityRole`/`accessibilityState` props (already a first-class React
Native API, no new dependency), using `lib/tokens.ts`'s existing font-size scale consistently
rather than any hard-coded pixel value that might resist Dynamic Type scaling, and adjusting
padding/hit-slop on any element found under the minimum tap-target guidance during the audit.

## Test plan

Accessibility label/role correctness and Dynamic Type layout behavior are not verifiable by this
repo's Vitest/RN-free convention — they require a real device or simulator with VoiceOver/
TalkBack enabled and the OS text-size setting adjusted, which is squarely UI-component/manual
verification territory (`CLAUDE.md`: "components stay thin and presentational... RN component
rendering isn't Vitest-friendly"). The test plan is explicitly manual, screen by screen:

1. Enable VoiceOver (iOS) or TalkBack (Android); navigate every screen in the Scope list above
   using only swipe/tap gestures a screen-reader user would use; confirm every interactive
   element announces a sensible label and current state, and that the reading order matches the
   visual layout.
2. Set the OS text size to its largest Dynamic Type / font-scale setting; revisit every screen;
   confirm no text is truncated, no critical action (Save, the scale buttons) is pushed off
   visible bounds, and no layout overlaps. **(panel — mobile UX lens, must-fix.)** Give
   `ScaleSelector` specific, named attention here — its fixed `aspectRatio: 1.3` buttons are the
   likeliest clipping point in the app at the largest text size, and it's also the app's
   highest-frequency input, so a clipped rating number is a real data-quality risk (a user
   confidently tapping a rating they can no longer clearly read), not merely a cosmetic one;
   confirm the rating digit stays fully legible at every supported text-size step, not just that
   the screen doesn't visibly break.
3. Measure or visually confirm tap-target sizes against platform minimum guidance for every
   button/chip/toggle across the screens in scope.

This manual checklist should be run once per platform (iOS + Android) before this doc is
considered complete, matching the manual-verification posture this batch already uses for every
native-integration point that can't be unit-tested.

## Gate compliance

No `any`/`!`/`@ts-*`/eslint-disable introduced — this is prop additions/corrections on existing
typed components, not new logic. No new persisted type, no `Backup`/`STORAGE_KEYS` change.
`npm run check` must still pass (typecheck/lint/format/test/type-coverage are all about code
correctness, not accessibility — this doc's manual test plan is the actual verification
mechanism, run alongside, not instead of, the existing automated gates).

## Dependencies & sequencing

Independent of every other doc in this batch and prior rounds — a horizontal pass across
existing screens, not a new vertical feature. Best sequenced **after** any other in-flight UI
work in a given landing cycle (so newly-added components get audited too, rather than needing a
second pass) rather than strictly before or after any specific pending doc.

## Alternatives considered

- **Deferring accessibility work indefinitely in favor of only new-capability features:**
  rejected — this batch has produced twenty-plus new capability docs across five rounds; an
  accessibility pass is the first to ask whether the app's _existing_ surfaces actually reach
  everyone in its target population, which is squarely inside "expand capability" read as
  "expand who the app actually serves," not a departure from this round's mandate.
- **A third-party accessibility-audit library/service integration:** rejected as unnecessary
  dependency weight for what is fundamentally a manual review-and-fix pass over a small, known
  set of screens; this app's own component inventory is small enough to audit directly.
- **Scoping this to only the check-in flow (the highest-frequency screens) and deferring the
  rest:** considered, but rejected in favor of covering every screen in one pass — the lock
  screen in particular must be accessible for anything else to be reachable at all, so a
  check-in-only scope would leave a real gap at the very front door of the app.

## Panel review

Run through the 4-lens panel (2026-07-23): approve (clinical), approve (strict-TypeScript),
approve-with-changes (mobile UX), approve (data-model/scope). One must-fix, verified directly
against the current component source.

- **Clinical — approve.** The target-population rationale for prioritizing this pass is sound and
  makes no clinical claims of its own; nothing to change.
- **Strict-TypeScript architect — approve.** Prop additions/corrections on existing typed
  components introduce no new logic and no gate risk; nothing to change.
- **Mobile UX / friction — approve-with-changes.** Caught that the original Scope section treated
  every component as starting from zero accessibility support. Verified directly against
  `ScaleSelector.tsx`, `Chips.tsx`, `Stepper.tsx`, and `Toggle.tsx`: the first two already have
  partial support needing **enrichment** (a label missing anchor context; a role/state with no
  label), while `Stepper`'s value text and `Toggle`'s `Switch` have **genuine gaps** (no
  accessibility props at all) — rewrote Scope to state which is which. Also added an explicit
  Dynamic Type call-out for `ScaleSelector`'s fixed-`aspectRatio` buttons as the likeliest
  clipping point in the app, given it's the highest-frequency input and a clipped rating number
  is a data-quality risk.
- **Data-model / migration + privacy + scope — approve.** No persisted type, no `Backup`/
  `STORAGE_KEYS` change, no scope creep beyond the stated horizontal audit; nothing to change.
