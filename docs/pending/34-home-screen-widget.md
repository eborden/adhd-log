> **Status:** Proposed — **decision needed** (2026-07-23) · **Priority:** P3 (large effort, new
> native surface per platform, gated on a product-scope call — same framing as docs 20/26) ·
> Ref: innovation batch, round 3 · **Supersedes the "stretch, not committed" flag in doc 15**

# Home-screen widget MVP

## Problem

Doc 15 (check-in friction reducers) already named a home-screen widget as the highest-leverage
remaining friction reducer and, in the same breath, honestly scoped it out: "a clearly-labeled
stretch: it requires native modules outside Expo Go and is not a committed deliverable." That
flag has sat unresolved since. This doc gives it the same treatment doc 20 gave combination
medication and doc 26 gave Health integration: a properly scoped decision document rather than
either silently building it or silently forgetting it.

The value case is real and specific to this app's target user: "have I logged today?" is
answerable today only by opening the app to the Today tab. A home-screen glance
(morning/evening done-or-not) removes exactly one interaction step for someone whose
executive-function tax is the reason the app exists — directly serving the same completion-rate
goal doc 15's other friction reducers already target. (An earlier framing of this value case
also cited the streak count; see the clinical must-fix under Option A for why that's deferred to
a deliberate decision rather than assumed.)

## Options

### Option A — recommended MVP: read-only status glance, platform-native, no interactivity

- One glanceable widget per platform showing a done/not-done indicator for morning and evening
  sessions — the exact same facts already on the Today tab's top section, nothing new.
- **Tap-to-open only.** The widget deep-links into the app (to Today, or directly to
  `checkin?session=morning|evening` if tapping the specific not-done indicator) — it does not
  attempt in-widget check-in entry. Interactive widgets (buttons that submit data without opening
  the app) are a materially larger platform surface (iOS 17+ App Intents, Android's
  `RemoteViews`/Glance interactive actions) for a first version that has not yet proven the
  simpler glance is worth the investment. Implementers should verify the deep link actually opens
  the pre-selected session rather than a generic Today screen — a tap that only saves one app-open
  and still requires picking the session again wastes most of the interaction step this feature
  exists to remove.
- **Refreshes on a coarse, OS-scheduled interval** (platform widgets are never truly real-time;
  both iOS WidgetKit and Android's widget update model batch refreshes to preserve battery) — a
  same-day check-in may take a few minutes to reflect on the home screen. This is a platform
  constraint, not a design choice this app can tune away.

**Streak count deferred to a go/no-go decision, not assumed safe by default (panel — clinical
lens must-fix).** An earlier draft included the streak count among the widget's glanceable facts,
reasoning that it's "the exact same fact already on the Today tab." That reasoning is
incomplete: a streak is already a gamification construct, and making it **ambient and
persistent** on a home screen — glanced at far more often, and without the deliberate choice to
open the app — changes its psychological weight from an in-app number the user chooses to check
into a constantly-visible "don't break the chain" counter. For this app's specific target user
(the stated reason the app exists is executive-function load), that ambient pressure risks two
measurement harms: guilt/abandonment when a streak breaks, and logging _to preserve the streak_
rather than logging honestly — which would bias the very data the provider relies on. This is a
clinical-measurement concern, not UX polish, and the go/no-go decision must resolve it
explicitly rather than inherit the streak onto a higher-pressure surface by default: either (a)
the shipped widget shows only the morning/evening done-not-done indicators, with the streak
count dropped from the home-screen surface entirely, or (b) the streak is kept, but only with an
explicit, written justification for why ambient visibility is acceptable for this user despite
the chain-pressure risk. **Option (a) is this doc's default recommendation** unless that
justification is made deliberately at build time.

### Option B — deferred: interactive widget (one-tap log from the home screen)

A widget button that logs a value (e.g. "took dose" or a quick mood tap) without opening the
app. Materially larger scope: iOS requires App Intents (a separate, non-trivial API surface from
WidgetKit's display layer) and Android requires either `RemoteViews` actions wired through a
`BroadcastReceiver` or a Glance-based interactive widget (Jetpack Glance) — either path is a
second native feature on top of Option A's display-only widget, not an incremental extension of
it. Logged as a named follow-on, not built here, and only worth revisiting once Option A has
shipped and proven the glance itself is used.

### Option C — rejected: a widget covering every Trends metric / a mini-chart

Rejected as the "full N-med manager"-equivalent over-reach for this surface: a home-screen widget
is glanceable by nature (small, low-attention), and cramming trend charts into it fights that
constraint while also duplicating the in-app Trends screen for no real benefit — a widget's job
is "have I logged today," not "how's my trend."

## Non-goals (all options)

- **No interpretation.** The widget shows the exact done/not-done state the Today tab already
  computes — no color-coded judgment beyond what `SessionCard`'s existing done/not-done visual
  language already uses, translated to the widget's own platform-native styling.
- **No push notification duplication.** The widget is a passive glance, not a second reminder
  channel — doc 15's/the app's existing notification triggers are unaffected and untouched.
- **No account/sync requirement.** The widget reads the same on-device `entries`/streak data the
  app already computes; no new permission beyond what a platform widget extension itself requires
  to run (see Feasibility).

## Feasibility / cost, stated plainly

This is a **per-platform native extension**, not a single cross-platform module — materially
different in kind from every prior native-dependency doc in this batch (docs 05/26/33 all added a
_library_ to the existing app target; this adds a **second build target** per platform):

- **iOS: a WidgetKit extension.** Requires a separate Xcode extension target (SwiftUI-based,
  since WidgetKit has no Objective-C/UIKit widget API), an App Group for sharing data between the
  main app's storage and the widget extension's own sandboxed process (AsyncStorage's data is not
  directly readable from a widget extension without this), and a way to keep the widget's copy of
  streak/session state in sync (writing a small shared snapshot to the App Group container
  whenever the main app's relevant state changes). Expo's bare workflow can host a native
  extension target (via manual Xcode project editing or a config-plugin-based approach such as
  `@bacons/apple-targets`), but this is a genuinely different category of native work from adding
  an npm package — it is closer to maintaining a second small native app.
- **Android: an App Widget.** Requires a `RemoteViews`-based (or Jetpack Glance-based) widget
  provider registered in the Android manifest, a `BroadcastReceiver` for update ticks, and the
  same "how does the widget read the main app's data" question — Android widgets run in the host
  app's process (unlike iOS's separate extension), so this is comparatively simpler than iOS but
  still real native Kotlin/Java code, not a config-plugin-only addition.
- **Two independent implementations to build and maintain**, not one shared one — a home-screen
  widget has no cross-platform abstraction the way, say, `expo-notifications` gives one API over
  two platforms' notification systems. Concretely larger than every other native-dependency doc
  in this repo's history (docs 05, 26, 33), each of which added at most one or two npm packages
  to the existing single app target.
- **A forced native rebuild** on both platforms once built, per `docs/BUILD.md`'s cost table —
  same category of cost as doc 26, but doubled (two platform-specific extension builds instead of
  one shared library addition).

## Recommendation

**Do not build speculatively; this is the largest-effort doc in the repo's pending set.** Ship
Option A only with a deliberate scope decision to invest in two small platform-native extension
targets — a real engineering commitment, not a quick add. If greenlit, build **one platform
first** (Android is the lower-cost path, per Feasibility above) and validate the glance is
actually used before building the second platform's extension. Option B stays a named,
separately-scoped follow-on; Option C stays rejected.

## Design for Option A, ready to build

### Shared data contract (`lib/widget-snapshot.ts`, new, RN-free)

Reflects this doc's default recommendation (streak omitted from the ambient surface — see the
clinical must-fix above). Add `streak` back only alongside the explicit written justification
that decision calls for:

```ts
export interface WidgetSnapshot {
  readonly morningDone: boolean;
  readonly eveningDone: boolean;
  readonly updatedAt: IsoTimestamp;
}

/** The exact same facts app/(tabs)/index.tsx already computes, packaged for a widget to read. */
export function buildWidgetSnapshot(
  entries: Readonly<Record<IsoDate, DayEntry>>,
  today: IsoDate,
): WidgetSnapshot {
  const entry = entries[today];
  return {
    morningDone: entry?.morning !== undefined,
    eveningDone: entry?.evening !== undefined,
    updatedAt: isoTimestampNow(),
  };
}
```

`isoTimestampNow` is reused unchanged. `computeStreak` (`lib/storage.ts:464-479`) is deliberately
**not** called here under the default recommendation — it would only be reintroduced alongside
the streak-visibility justification the clinical must-fix requires.

**Regenerable, non-authoritative, and locked to non-PII (panel — scope lens must-fix.)**
`WidgetSnapshot` is derived data, not a source of truth, and must be treated that way through its
whole lifecycle, not just at creation:

- **Excluded from `Backup`/`restoreBackup`.** The App Group/`SharedPreferences` copy is a cache
  the platform plumbing regenerates from `entries` on every relevant state change — it is never
  the authoritative record and must never be threaded into the JSON backup the way every other
  new store in this batch has been (docs 17/24/25/31/36's must-fix pattern does not apply here,
  precisely because this isn't a new fact, only a cached restatement of existing ones).
- **Cleared on any data-reset path.** If a full-wipe / clear-all-data feature is ever built (none
  exists today, per doc 11's own "forward obligation" note), it must also clear the widget
  snapshot on both platforms — otherwise a stale "logged" state can linger visibly on the home
  screen indefinitely after the underlying data is gone, which is a real privacy/data-hygiene gap
  for a health app, not merely a cosmetic staleness issue.
- **Locked to non-PII, as an explicit constraint, not an accident of the current shape.**
  `WidgetSnapshot` today happens to contain nothing more sensitive than two booleans and a
  timestamp — no medication name, no notes, no ratings. That must stay a deliberate constraint on
  this surface (visible to anyone glancing at the phone, unlike the app itself, which sits behind
  the optional Face ID lock) — any future addition to `WidgetSnapshot` must be checked against
  this constraint before being added, not assumed safe because the file compiles.

This is the **one piece of genuinely cross-platform logic** in the whole feature — everything
else below is platform-specific plumbing to get this small object from the main app's storage
into each platform's widget-rendering surface.

### Platform plumbing (native, not RN-free — described, not code-specified here)

- **iOS**: on every relevant app state change (check-in saved, streak recalculated), write
  `buildWidgetSnapshot`'s JSON to the shared App Group container; call `WidgetCenter.shared.
reloadAllTimelines()` to request a refresh (subject to the OS's own throttling). The WidgetKit
  extension's SwiftUI view reads that JSON and renders it — a small, separate Swift codebase.
- **Android**: on the same triggers, write the snapshot to `SharedPreferences` (or a small file)
  the widget provider can read; call `AppWidgetManager.updateAppWidget(...)`. The widget
  provider's layout XML/Glance composable renders it — a small, separate Kotlin codebase.

### Test plan

`buildWidgetSnapshot` is fully unit-testable in Vitest like any other pure `lib/` function. The
platform-native rendering code is **not** unit-testable under this repo's Vitest/RN-free
convention (`CLAUDE.md`: "components stay thin and presentational... RN component rendering isn't
Vitest-friendly") and doubly so for native extension code outside the RN tree entirely — manual
on-device verification (add the widget to a home screen, confirm it reflects a check-in within
the OS's normal refresh window, tap it and confirm the correct deep link) is the only test plan
for the platform layers, matching the manual-verification posture doc 26 already established for
its own native integration point.

## Gate compliance

`lib/widget-snapshot.ts` follows every existing gate (no `any`/`!`/`@ts-*`, RN-free, Vitest
covered). The native extension code lives outside this repo's TypeScript/ESLint/Vitest gates
entirely (Swift and Kotlin have their own toolchains) — `npm run check` covers none of it, which
must be stated plainly rather than implied to be covered.

## Dependencies & sequencing

Independent of every other doc in this batch and prior rounds — reuses only `computeStreak`,
already landed. Should be sequenced last among any concurrently-approved native-surface work
(doc 26, doc 33) given its size, and only after a deliberate go/no-go decision separate from this
doc's own drafting.

## Alternatives considered

- **A Live Activity / Dynamic Island (iOS) instead of a static widget:** rejected — Live
  Activities are for short-lived, session-based state (a timer, a delivery tracker), not a
  standing daily-status glance; a static widget is the correct primitive for this use case.
- **Skipping native extensions entirely via a lock-screen notification that stays pinned:**
  considered and rejected — a persistent notification is a different, more intrusive UX than a
  home-screen widget (it occupies notification-shade space continuously) and doesn't solve the
  "glance without opening the app" goal as cleanly as an actual widget surface.
- **Building both platforms simultaneously:** rejected in the Recommendation above in favor of
  Android-first, to validate real usage before committing to iOS's larger App-Group-plus-
  WidgetKit-extension cost.

## Panel review

Run through the 4-lens panel (2026-07-23): approve (strict-TS), approve-with-changes (clinical,
scope), approve (UX, with one non-blocking implementation note). Must-fixes applied above.

- **Clinical — approve-with-changes.** _Must-fix (applied):_ the streak count was inherited onto
  the widget surface with reasoning that didn't examine how ambient, persistent visibility
  changes a metric's psychological weight for this app's specific target user — reframed as a
  deliberate go/no-go decision, with the default recommendation now omitting the streak unless an
  explicit written justification is made. Every other Non-goal (no interpretation, no push
  duplication, no color-coded judgment beyond the existing done/not-done language) was confirmed
  to hold.
- **Strict-TypeScript architect — approve.** `buildWidgetSnapshot` (now without `streak`) compiles
  against the real `isoTimestampNow`/`entries[today]` access pattern under
  `noUncheckedIndexedAccess`, no `!`/cast. No must-fix.
- **Mobile UX / friction — approve.** Correctly not a Today-tab card, so it adds nothing to this
  round's accumulating on-screen surfaces — it's a separate glance entirely, and from a
  completion-rate standpoint the strongest lever in this round (removing an app-open from "have I
  logged today," with a deep link straight into the right check-in session). No must-fix.
  _Noted, incorporated above:_ verify the deep link actually opens the pre-selected session rather
  than a generic Today screen.
- **Data-model / migration + privacy + scope — approve-with-changes.** The native-effort
  accounting (second build target per platform, App Group, forced double rebuild, `npm run check`
  covering none of the native code) was independently confirmed as the most honest, not
  understated, cost accounting in this batch. _Must-fixes (applied):_ the doc never stated what
  happens to the cached widget snapshot on a data-reset path or whether it belongs in `Backup` —
  specified that it's regenerable, non-authoritative, explicitly excluded from
  `Backup`/`restoreBackup`, and must be cleared on any future full-wipe path; and locked
  `WidgetSnapshot`'s non-PII shape (no medication name, no notes, no ratings) as a deliberate,
  checked constraint on a surface visible to anyone glancing at the phone, not an incidental
  property of its current field list.
