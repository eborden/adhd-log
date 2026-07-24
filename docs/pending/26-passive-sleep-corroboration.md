> **Status:** Proposed — **decision needed** (2026-07-23) · **Priority:** P3 (large effort, new
> native dependency, gated on a product-scope call — same framing as doc 20) · Ref: innovation
> batch (5 new plans)

# Opt-in passive sleep-duration corroboration (HealthKit / Health Connect)

## Problem

`MorningCheckin.sleepHours` (`lib/schema.ts:29`, a `Stepper` 0–14 step 1) is a number the user
types from memory every morning. `docs/PLANNING-v0.md` itself flags it as "the one genuinely
continuous field," and it's also one of the more error-prone self-report fields the app collects
— people are broadly bad at estimating sleep duration from memory, and the exact
attention/executive-function profile this app is built around makes that estimate noisier
still. At the same time, sleep is one of the most clinically load-bearing signals for this app's
target drug class: guanfacine ER and other alpha-agonists are explicitly sedating, which is
already the entire rationale doc 17 gives for capturing blood pressure and heart rate. Most
phones already hold a passively-recorded, objective sleep-duration number in Apple Health or
Android Health Connect — from the OS itself or a paired wearable — sitting on the device,
already there, never having touched a network.

This is the most boundary-pushing of the five ideas in this batch precisely because it would be
the first time the app **reads from outside its own storage**. It stays inside the local-only
mission — Health data lives on the phone and is read via an on-device API, never uploaded
anywhere by this feature — but it is a real new dependency and a real new OS permission prompt,
distinct from notifications and biometrics. This repo has a documented history of scrutinizing
every new dependency (doc 05's native time picker was explicitly "the one dependency the panel
endorsed adding"; doc 15 flagged a home-screen widget as a stretch specifically because it needs
native modules outside Expo Go). So this doc is written and reviewed as a **scoped decision
document**, in doc 20's format, not a committed build — the design is made ready; whether/when
to build it is a separate call.

## Options

### Option A — recommended MVP: opt-in sleep-duration prefill only

- A single Settings toggle, **off by default**: "Show last night's sleep from Health." The OS
  permission prompt is requested **only** when the toggle is switched on — never at onboarding,
  never proactively.
- **Read-only, one metric only:** total hours asleep for the most recent night, fetched
  **on-demand** when the morning check-in screen opens — not a background sync, no continuous
  listener, no scheduled refresh. Mirrors the existing lazy-import discipline
  `lib/notifications.ts` already uses for `expo-notifications` on Expo Go
  (`lib/notifications.ts:17-20`).
- **A prefill suggestion, never a silent write.** Shown exactly like doc 22's reminder-time
  suggestion card: _"Health says 6.8h — use this?"_ with a one-tap Apply next to the existing
  `sleepHours` `Stepper`. Declining or ignoring it leaves the manual stepper's current value
  (the existing `DEFAULT_SLEEP_HOURS` prefill from `lib/checkin.ts:27`) exactly as it is today.
- **No new persisted type.** The value still lands in `MorningCheckin.sleepHours: number | undefined`
  exactly as manual entry does — Health is an alternate **input source** for the same existing
  field, not a parallel store. `Backup`, the report, and Trends are completely unaffected: they
  already render `sleepHours` regardless of how it got there.

### Option B — deferred: heart-rate corroboration for doc 17's `Measurement`

The same shape of feature (opt-in, on-demand, prefill-only) applied to doc 17's
`heartRate`/`bloodPressure` measurement entry. Not built here — a larger native surface
(HealthKit heart-rate types + Health Connect's equivalents; blood pressure is **not** a standard
Health Connect record type as of this writing, unlike heart rate, so BP corroboration may not be
achievable on Android at all). Logged as a named follow-on if Option A proves worth the
dependency cost in practice.

### Option C — rejected: general health sync

Any background/continuous sync, any write-back to Health, any other data type (steps, activity,
mindfulness minutes, workouts). No mission fit beyond the one sedating-medication-relevant
metric Option A scopes; this is the "full N-med manager"-equivalent over-reach doc 20 rejected
for combination medications, applied here to health data.

## Non-goals (all options)

- **No interpretation.** No "your sleep is too low," no threshold coloring — same non-goal
  precedent as every other doc in this repo (doc 17's vitals, doc 09's coverage captions). The
  Health-sourced number renders exactly like a manually-typed one, because — after Apply — it
  _is_ one.
- **No requirement to grant permission.** The feature is fully invisible and a complete no-op
  with the toggle off, the permission denied, or the native module absent (e.g. an iOS simulator
  with no Health data) — the manual `Stepper` is the one required, load-bearing path in every
  case.
- **No cross-platform abstraction beyond the one function boundary described below.** Two
  distinct native modules are used; nothing here pretends they're the same API underneath.

## Feasibility / cost, stated plainly

- **Two native modules, not one:** iOS needs a HealthKit wrapper (e.g.
  `@kingstinct/react-native-healthkit` or `react-native-health`); Android needs
  `react-native-health-connect`. No single package covers both platforms for this app's Expo +
  bare-native-build setup.
- **A config plugin is required on both platforms** to add the HealthKit entitlement /
  usage-description string (iOS) and the Health Connect permissions declaration (Android) to
  the native manifests on every `expo prebuild`, following the exact precedent
  `plugins/withReleaseSigning.ts` already sets for "a plugin that must re-apply on every clean
  prebuild" (`docs/BUILD.md`'s "How signing is wired" section).
- **A real new permission dialog** most users will decline, ignore, or never see if they don't
  have the Health app populated at all — the feature must degrade to fully invisible in that
  case, not merely non-functional-with-a-visible-error.
- **A forced native rebuild.** Per `docs/BUILD.md`'s own cost table, adding a native dependency
  triggers the ~9m30s cold prebuild path once (native inputs changed → the `npm run apk`
  fingerprint gate cleans and rebuilds) — a real, bounded, one-time cost stated here rather than
  hand-waved.
- **No EAS/cloud shortcut available or wanted.** `docs/BUILD.md`'s "Why not EAS" section already
  rules that out for this app generally; a Health integration changes nothing about that
  constraint — it's still a local `expo prebuild` + `xcodebuild`/`gradlew` build either way.

## Recommendation

**Do not build speculatively.** Ship Option A only if/when manual `sleepHours` accuracy is a
felt pain point in actual use — this doc exists so the design is ready to execute quickly if
that becomes true, not to schedule the native-dependency work now. If/when it is greenlit, land
Option A only; Option B stays a named, separately-scoped follow-on; Option C stays rejected.

## Design for Option A, ready to build

### `lib/health.ts` (new, thin cross-platform seam)

```ts
/**
 * Reads last night's total sleep duration from the platform Health store, or `null` when
 * unavailable for any reason (no permission, module absent, no data) — the same `null` idiom
 * `loadProfile` already uses for "nothing to show," never a thrown error the caller must catch.
 */
export async function readLastNightSleepHours(): Promise<number | null> {
  if (Platform.OS === 'ios') return readIosSleepHours();
  if (Platform.OS === 'android') return readAndroidSleepHours();
  return null; // web / other — no Health API exists
}
```

Both platform-specific implementations import their native module lazily (dynamic `import()`),
matching `lib/notifications.ts`'s existing pattern exactly, so a build without the module
present (or before it's linked) never crashes at module-load time — only the feature itself is
inert.

### Storage / types

**Almost none.** One new `Profile` field: `readonly healthSleepEnabled?: boolean`,
additive/optional like every other `Profile` flag. **Correction (panel — TS lens):** "no new
guard beyond checking that boolean" undersold the change slightly — `isProfile`'s current final
line is a bare terminal `return weeklyReminder === undefined || isTimeOfDay(weeklyReminder);`
(`lib/storage.ts:122-123`), so adding this field means that return becomes an intermediate check
plus one more: `const h = value['healthSleepEnabled']; return h === undefined || typeof h === 'boolean';`
— trivial, but a real edit to the guard's control flow, not literally nothing. No new `Backup`
field, no new `STORAGE_KEYS` entry. The value this feature produces flows into the exact same
`draft.sleepHours` the manual `Stepper` already writes — the raw Health read is **never cached
or persisted anywhere** except as a user-Applied `sleepHours` value (panel — scope lens: stated
as a hard rule, not left implicit).

**Backup interaction (panel — scope lens):** `healthSleepEnabled` rides inside the whole `profile`
object, so it round-trips through `Backup`/`restoreBackup` for free like every other profile
flag — including the case of restoring onto a **different device** that lacks the Health module
or has never granted permission. That's harmless by construction: the feature degrades to fully
invisible in exactly that case (see Non-goals), the same as a fresh install with the toggle
untouched.

### UI

- Settings: one `Toggle` — "Show last night's sleep from Health" — off by default. Turning it on
  triggers the platform permission request (once); turning it off is always available with no
  permission implications.
- `app/checkin.tsx` morning session: when the toggle is on and `readLastNightSleepHours()`
  resolves to a number that differs from the current `draft.sleepHours`, show the same
  suggestion-card pattern doc 22 establishes for reminder times — _"Health says {n}h — use
  this?"_ with Apply (writes `draft.sleepHours`) / dismiss-for-this-session (no persisted
  dismissal state needed, unlike doc 22's reminder suggestion, since this is re-offered fresh
  every morning rather than nagging about a stable schedule).
- **No mid-interaction reflow (panel — UX lens must-fix).** `readLastNightSleepHours()` resolves
  asynchronously, and the morning check-in's `sleepHours` `Stepper` is exactly the kind of
  control a person is already tapping within the first second or two of opening the screen. If
  the suggestion card pops in above or around the `Stepper` after that tap has started, it
  shifts the control under the user's finger — a classic mobile mis-tap, and precisely the kind
  of daily-flow friction this whole track exists to eliminate, not add. Two rules, both
  required: (1) reserve a fixed-height slot for the card **before** the Health read resolves
  (an empty slot that fills in, not a layout-shifting insert), and (2) show **no spinner or
  placeholder** in that slot while the read is pending — the slot is either the resolved card or
  nothing, never a loading state a user could tap into. If the read hasn't resolved by the time
  the user starts interacting with the `Stepper`, the slot simply stays empty for that
  morning's check-in rather than popping in late.

### Test plan

`lib/health.ts`'s platform branches are mocked in Vitest (both native modules stubbed) to assert:
`readLastNightSleepHours` returns `null` when a module throws/is absent, returns the numeric
value when a mock resolves one, and never touches the network (no test needs a real device for
the pure branching logic). The suggestion-card Apply/dismiss UI logic is unit-testable the same
way; the actual on-device Health read (permission grant/deny, simulator-with-no-data, a real
paired wearable's data appearing correctly) is a **manual verification step**, listed alongside
`docs/PLANNING-v0.md`'s own existing manual-test checklist rather than faked in Vitest.

## Gate compliance

No `any`/`!`/`@ts-*`/eslint-disable. `readLastNightSleepHours` returns `Promise<number | null>`
— no `unknown`/cast at the seam; both native modules' actual return shapes are narrowed by their
own TypeScript definitions (or, if a module ships weak/no types, a local guard narrows its
result before it's trusted — never a bare cast of the module's output). One new optional
`Profile` boolean → no migration, no forced re-onboarding. `npm run check` must pass before any
of this lands.

## Dependencies & sequencing

Independent of every other doc in this batch and every other pending doc in the repo — touches
no shared type beyond the existing `MorningCheckin.sleepHours: number | undefined`. If built,
it should land **after** a real signal that manual entry accuracy is a problem in practice, not
on a fixed schedule relative to any other doc.

## Alternatives considered

- **Bluetooth-direct integration with a specific sleep-tracking wearable**, bypassing the OS
  Health layer entirely: rejected — locks the feature to one vendor's hardware and BLE protocol,
  far larger native surface than reading through the OS's own aggregator, which already
  normalizes data from whatever wearable (if any) the user has.
- **Building this as a general "Health sync" toggle covering multiple metrics from day one:**
  rejected in favor of the narrowest possible Option A — one metric, one direction (read-only),
  one existing field it feeds — so the actual cost/benefit of adding native Health access at all
  can be evaluated on the smallest possible slice before considering Option B.
- **Skipping the manual `Stepper` entirely once Health is enabled:** rejected — the manual path
  must stay fully functional and equally fast in every case (no data, no permission, module
  absent, or the user simply prefers to type their own estimate), per this doc's own Non-goals.

## Panel review

Run through the 4-lens panel (2026-07-23): approve (clinical, strict-TS, scope),
approve-with-changes (UX). Must-fixes applied above.

- **Clinical — approve.** The strongest descriptive discipline of the five despite being the
  most boundary-pushing feature: the objective number is offered as a neutral prefill with no
  high/low or threshold framing, and after Apply it _is_ an ordinary `sleepHours` value, so
  report/Trends stay exactly as descriptive as they are today. No must-fix. _Noted:_ Health
  supplies decimal hours (e.g. 6.8) while the manual `Stepper` is integer-only — harmless (more
  precision is fine), not a blocker.
- **Strict-TypeScript architect — approve.** `readLastNightSleepHours(): Promise<number | null>`
  is cast-free at the seam and feeds the real `MorningCheckin.sleepHours: number | undefined`;
  `lib/health.ts` importing `Platform` from `react-native` (making it not RN-free) is consistent
  with the existing `lib/notifications.ts` precedent, which does the same and is still `lib/`.
  No must-fix. _Correction folded in above:_ "no new guard beyond checking that boolean" was
  imprecise — `isProfile`'s current terminal `return` must become an intermediate check plus one
  more line; noted in Storage / types rather than left as a gloss.
- **Mobile UX / friction — approve-with-changes.** This is the only one of the five that touches
  the daily flow, but net friction-reducing (one-tap Apply vs. estimating on the `Stepper`) and
  fully gated behind an off-by-default toggle. _Must-fix (applied):_ the async Health read must
  not reflow the check-in screen mid-interaction — a suggestion card popping in around the
  `Stepper` after the user has started tapping is a mis-tap hazard. Reserved a fixed-height slot
  that either resolves to the card or stays empty, with no spinner/placeholder in between.
- **Data-model / migration + privacy + scope — approve.** The one doc scrutinized hardest against
  the local-only mission, and the guardrails are sufficient as written: reading from an on-device
  Health store is data entering from another local store, never the user's logged data leaving
  the phone: nothing new crosses the network, and the full guardrail inventory (off-by-default,
  permission-on-toggle-on, on-demand no background sync, prefill-never-silent-write, invisible
  degradation, no interpretation) holds. No must-fix. _Two clarifications added above, per
  request:_ a restored backup's `healthSleepEnabled` degrades harmlessly on a device lacking the
  module/permission; the raw Health read is a hard rule never cached or persisted except as a
  user-Applied `sleepHours` value.
