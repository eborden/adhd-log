> **Status:** Proposed — pending implementation · **Priority:** P2 · Ref: analysis #6

# Check-in friction reducers

## Problem / Context

Completion rate is the silent dependency of everything this app promises. A non-stimulant ADHD medication's signal accumulates over _weeks_; the value the provider gets is the shape of the trend line in `app/(tabs)/trends.tsx`, not any single day. Gaps corrupt that shape twice over: `averageOf` in `lib/metrics.ts` silently drops missing days, so a sparsely-logged fortnight produces an average computed from three data points and reads as confidently as one from fourteen. And `computeStreak` — the one motivational lever on the Today screen — resets to zero the moment a day is skipped, which for the target user (someone whose executive-function tax is the whole reason the medication exists) is the exact failure mode the app should be designed around.

So the intervention that most protects trend quality is not a new metric — it is _removing taps and removing decisions_ from the daily loop. This doc bundles three friction reducers, ranked by effort and confidence:

- **(a) "Same as last time"** — a one-tap prefill in `app/checkin.tsx` that seeds the `Draft`'s **scale ratings** from the most recent prior entry of the same session. It copies only the slow-moving scale ratings; the day-specific, report-facing fields (`doseTaken`, `sleepHours`, `sideEffects`, `notes`) are always entered fresh (see Data model — this is the central change from the first draft, forced by the measurement-validity review).
- **(b) Notification quick-actions / snooze** — "Log morning"/"Log evening" and "Snooze 1h" actions on the reminder itself, so an intercepted reminder becomes a deferral instead of a dismissal.
- **(c) Home-screen widget** — a **clearly-labeled stretch**, honestly scoped: it requires native modules outside Expo Go and is not a committed deliverable here.

Crucially, none of these change _what_ is collected or _how it means anything_ — they change how cheaply the existing data gets captured.

**Explicitly not solved here:** `computeStreak`'s hard reset-to-zero, named above as a motivating failure mode, is a _streak-scoring_ change, not a _capture-speed_ change. Softening it (e.g. a one-day grace window) is out of scope for this doc and is deferred to a fast-follow streak-resilience doc; folding it in here would mix a display/motivation heuristic into a pure input-plumbing change. This doc attacks the same completion problem from the taps side only.

## Goals / Non-goals

**Goals**

- One-tap prefill of a new check-in's **scale ratings** from the last same-session entry, implemented as a pure, Vitest-covered selector plus a pure copy transform, so the load-bearing logic runs without native shims.
- Reminder-time quick actions: deep-link straight into the correct check-in, or snooze the reminder once for an hour.
- Zero net-new _persisted_ domain types; reuse `MorningCheckin` / `EveningCheckin` / `Draft` / `Rating` verbatim.
- Full backward compatibility for both persisted data **and** already-scheduled OS notification triggers (see Notifications — Migration / rollout): no forced re-onboarding, no mutation of historical entries.

**Non-goals**

- No new tracked metric, no schema field. This is a _capture-speed_ doc, not a _what-we-track_ doc.
- No interpretation, scoring, or nudging (see guardrails).
- No auto-submission. "Same as last time" prefills a draft the user still reviews and taps Save on — it never writes an entry unattended. A silently-cloned day would be _fabricated_ trend data, which is worse than a gap.
- **No carry-forward of volatile fields.** `doseTaken`, `sleepHours`, `sideEffects`, and `notes` are never inherited from a prior day (rationale in Data model). Prefill is scale-ratings-only.
- Widget interactivity (logging _from_ the widget) is explicitly out of scope even within the stretch; a widget, if built, is read-only glanceable state that deep-links into the app.

## Mission fit & guardrails

The mission is collect → log → provider-supplies-meaning. Each sub-feature sits squarely inside "collect", making it cheaper, and touches neither "log" nor "meaning":

- **"Same as last time" is descriptive, not predictive.** It copies scale values the user _already reported_, presented as an editable starting point the user confirms — it never infers, averages, or suggests a "likely" value. The copied numbers are the user's own prior self-report, not a model's guess. Copy reads "Start from your last morning check-in" / "Start from your last evening check-in" — an input convenience, not a claim about today.
- **The anchoring risk is bounded, not waved away.** Confirm-required prefill is _categorically different_ from the auto-submit and rolling-average variants we reject outright (those fabricate or interpret data — see Alternatives). But it is not risk-free: for an executive-function-impaired user, blanket prefill-then-Save can degrade into unedited carry-forward (LOCF), biasing the trend toward artificial flatness. We mitigate this _structurally_ rather than by exhortation — by excluding the most dose-actionable, report-facing fields (`sideEffects`, `notes`) and the adherence signal (`doseTaken`) from the copy entirely, so those are always a fresh judgment (Data model, UI touch points).
- **Quick actions carry no content.** "Log morning"/"Log evening" is navigation; "Snooze 1h" is a timer. Neither surfaces data or judgement.
- **Local-only is preserved.** Everything here is on-device: a pure array scan over `loadEntries()`, a local notification trigger. No network, no new persistence surface leaves the phone. The widget stretch, if ever built, renders locally from a **locally-bridged copy** of on-device state (it cannot read AsyncStorage directly — see Alternatives (c)); no data leaves the device either way.

## Data model

The headline is that **no new persisted domain type is required** for (a) or (b). We add two pure, RN-free helpers and one small in-memory type in `lib/storage.ts` (not `types.ts`), plus one flat payload type in `lib/notifications.ts`. Nothing new is written to AsyncStorage.

### Prior-entry selector

To let a caller tell _which_ session shape came back without an unsafe cast — illegal "morning shape tagged evening" states are unrepresentable — we add a discriminated union. This one earns its keep: `prior.checkin` narrows to `MorningCheckin` / `EveningCheckin` off the `session` discriminant.

```ts
// lib/storage.ts — return type for the prefill selector.
// Discriminated on `session` so the caller narrows to the right check-in shape.
// Both members are READ-ONLY VIEWS over data already validated by parseEntries;
// they are never re-serialized and never written back, so no new Parsed<T> guard
// is required here (see Storage & guards).
export type PriorCheckin =
  | { readonly session: 'morning'; readonly date: IsoDate; readonly checkin: MorningCheckin }
  | { readonly session: 'evening'; readonly date: IsoDate; readonly checkin: EveningCheckin };
```

```ts
// lib/storage.ts
/**
 * Most recent entry of `session` strictly before `before`, scanning backward.
 * Pure over already-loaded `entries` so it is Vitest-covered without native shims.
 * Returns undefined when there is no prior same-session check-in — the caller
 * then leaves EMPTY_DRAFT in place (illegal to fabricate a "same as last time").
 * The prior entry object itself is only READ, never mutated.
 */
export function mostRecentSession(
  entries: Readonly<Record<IsoDate, DayEntry>>,
  session: Session,
  before: IsoDate,
): PriorCheckin | undefined {
  const dates = Object.keys(entries)
    .filter((date): date is IsoDate => isIsoDate(date) && date < before)
    .sort((a, b) => b.localeCompare(a)); // newest first; ISO dates sort lexically
  for (const date of dates) {
    const entry = entries[date]; // T | undefined under noUncheckedIndexedAccess
    if (entry === undefined) continue;
    if (session === 'morning' && entry.morning !== undefined) {
      return { session: 'morning', date, checkin: entry.morning };
    }
    if (session === 'evening' && entry.evening !== undefined) {
      return { session: 'evening', date, checkin: entry.evening };
    }
  }
  return undefined;
}
```

`date < before` uses lexical comparison on branded `IsoDate` strings — valid because `IsoDate` is `Brand<string, …>` and the `YYYY-MM-DD` format sorts chronologically. `before` is exclusive, so opening today's check-in offers _yesterday's_ values, and re-opening a past day to edit never offers that same day back.

### Copy transform (the mitigation)

The first draft prefilled the whole draft via `draftFromMorning`/`draftFromEvening`. That is now rejected: those functions carry `doseTaken` (morning) and `sideEffects`/`notes` (evening), and blanket carry-forward of those fields is exactly the LOCF/report-poisoning risk the clinical and UX lenses flagged. Instead we add a dedicated pure transform that copies **only the scale ratings** and lets the caller merge them over an otherwise-empty draft:

```ts
// lib/storage.ts — pure, RN-free, Vitest-covered.
// Copies ONLY the slow-moving scale ratings from a prior same-session check-in.
// Deliberately NOT copied (must be entered fresh each session):
//   - doseTaken   : the adherence signal the whole trend depends on; a stale `true`
//                   is the single most costly field to get wrong.
//   - sleepHours  : a nightly quantity, not a stable trait.
//   - sideEffects : the one field from this feature that reaches the provider PDF
//                   (buildReportHtml Daily-log "Side effects" column) and the most
//                   dose-actionable signal in non-stimulant titration.
//   - notes       : stale narrative context ("started new job") must not persist.
export function copyableRatings(prior: PriorCheckin): Partial<Record<RatingKey, Rating>> {
  // Since the 2026-07-18 "Ratings as a record" reshape, every check-in already isolates its
  // scale ratings in `checkin.ratings` — doseTaken, sleepHours, sideEffects, and notes live
  // *outside* that record. So copying the record spreads exactly the copyable fields and
  // structurally excludes the must-be-fresh ones; no cherry-picking, no session split.
  // Undefined optionals are simply absent from the source record (nothing to spread).
  return { ...prior.checkin.ratings };
}
```

`copyableRatings` needs no `session` branch: both `MorningCheckin.ratings` and
`EveningCheckin.ratings` are `Partial<Record<…RatingKey, Rating>>` sub-records, so spreading
either yields a value assignable to `Partial<Record<RatingKey, Rating>>`. (The
notification-routing ternary below is likewise a total two-arm branch over the closed `Session`
union — the repo's `switch`+`assertNever` convention is for open/extensible discriminants, so a
`never`-guarded switch there would be dead ceremony.)

### Notification payload

```ts
// lib/notifications.ts — flat payload (NOT a discriminated union).
// `kind` is written for forward-compat / observability; routing does NOT branch on it
// (routing keys off response.actionIdentifier, an OS string). It is read only through
// the defensive parser below, which treats an absent kind as 'scheduled'.
type ReminderData = { readonly session: Session; readonly kind: 'scheduled' | 'snoozed' };
```

We deliberately flattened this from the first draft's discriminated union: per the routing logic, `kind` never gates behavior, so a discriminant buys no narrowing safety — it would be dead weight. If a future revision needs `kind` to change behavior, promote it back to a discriminated union then.

## Provenance decision (fresh vs. copied)

The clinical lens raised a real question: should each day record whether it was authored fresh or copied, so a provider can tell whether a flat stretch of the trend is genuine stability or unedited repetition? Recording collection-method metadata is data-quality annotation, not clinical interpretation, so it does not by itself violate the mission.

**Decision for this doc: no persisted provenance field ships here, and the tradeoff is escalated to `docs/DECISIONS.md` rather than settled silently inside this feature doc** (which is the specific process objection the lens raised). Reasoning:

1. The structural mitigation above removes the acute harm the provenance marker was meant to compensate for. The only fields that reach the provider PDF are `sideEffects`, `sleepQuality`/`sleepHours`, `mood`, `focus`, and the averages tables. Of the _copied_ fields, only the scale ratings (`mood`, `focus`, etc.) reach the report; `sideEffects` and `notes` are now never copied, so the most dose-actionable report-facing field is always a fresh judgment. LOCF-to-PDF via side effects — the worst case — is eliminated at the source.
2. A provenance field is a _persisted_ field, which contradicts this doc's scope discipline (no new AsyncStorage shape, no migration) and would need `isDayEntry`/`isEntries` guard extension, a backup round-trip change, and an export decision. That is a separate, non-trivial change with its own migrate-on-read story.
3. Surfacing "copied" in the export invites exactly the meaning-making the app must not seed; hiding it makes it useless to the provider. The clinical benefit is real but not clearly worth the persistence-and-privacy cost for a single-user tool.

**Required shipping artifact:** a `docs/DECISIONS.md` entry recording this tradeoff and its acceptance, and sketching the future shape if reversed: an _optional_ `authoredBy?: 'fresh' | 'copied'` on `MorningCheckin`/`EveningCheckin`, defaulted via `??` on read, decoded by extended `isMorningCheckin`/`isEveningCheckin`, surfaced (if ever) only as a neutral provenance marker, never as a value judgment. This doc does not implement it.

## Schema

**n/a.** `lib/schema.ts` (`MORNING_METRICS`, `EVENING_METRICS`, `DEFAULT_ENABLED_EVENING_METRICS`) is the single source of truth for _which fields exist and render_. This doc adds no field and no `Metric` variant, so schema is untouched — and deliberately so: adding a `Metric` variant would trip the `assertNever` seam in `checkin.tsx` (and force edits to the `metric.kind === 'scale'` filters in `trends.tsx` and `entry/[date].tsx`), which is exactly the churn a friction-reduction feature should avoid. `copyableRatings` enumerates rating keys explicitly rather than iterating the schema, because it must make a per-field _policy_ decision (which fields are volatile); this is intentional and is the one place the feature is not schema-generic. If a new `RatingKey` is added by another doc, `copyableRatings` should be extended to decide whether it is a stable trait (copy) or day-specific (exclude) — noted in Dependencies.

## Storage & guards

- **New pure exports in `lib/storage.ts`:** `mostRecentSession`, `copyableRatings`, and the `PriorCheckin` type. All RN-free and Vitest-covered.
- **No new AsyncStorage key, no new guard.** `mostRecentSession` consumes the output of the existing `parseEntries` guard; `PriorCheckin.checkin`'s two members (`MorningCheckin`, `EveningCheckin`) are **read-only views over already-guard-validated data, never re-serialized** — so no `Parsed<T>` guard of their own is needed. The `isIsoDate` filter in the selector is defensive narrowing of `Object.keys` (typed `string[]`), not a parse of external data.
- **Backward compatibility (persisted data).** Nothing is persisted differently:
  - No `Profile` field is added, so `parseProfile` is unchanged and existing profiles load as-is — **no forced re-onboarding**.
  - Historical `DayEntry` records are read-only inputs; **the prior entry object itself is never touched, only read** — "Same as last time" writes a _new_ entry for the current date through the existing `saveCheckin` merge, exactly as a manual check-in does.
  - No migrate-on-read is needed because no stored shape changes.
- **Documented migrate-on-read template (for other docs in this set).** When a future doc _does_ add a persisted `Profile`/checkin field, follow this precedent: add it as an **optional** field, default it on read with `??`, and extend the corresponding `is*` guard to accept its presence or absence. Example (the deferred snooze-duration setting): `snoozeMinutes?: Minute` on `Profile`, read as `profile.snoozeMinutes ?? 60`, decoded by an `isProfile` that tolerates the field being absent. This is the cleanest migration shape in this feature set; reuse it verbatim.
- **Backup parse (`lib/backup.ts`).** `Backup = { exportedAt; profile; doses; entries }` is unchanged — no new top-level key, no new persisted field — so `buildBackup` / `parseBackup` and their round-trip test remain valid untouched.

## UI touch points

Every seam that must change, with the non-generic ones flagged.

**`app/checkin.tsx` — the primary surface.** This is a **non-generic seam** by design, but the prefill deliberately avoids the four-edit "new metric" dance because it adds no field:

- Add a "Same as last time" button near the top of the form. **Single consolidated visibility condition** (do not split this — wiring only one half creates an accidental-overwrite hazard): show the button **iff both** (i) `mostRecentSession(entries, session, date)` returns a value **and** (ii) the current session's draft is empty, i.e. `entries[date]?.[session] === undefined`. Condition (ii) keeps it off when editing a day that already has real data (the edit flow hydrates from that day's own entry via `draftFrom*`, and offering an older day over real data is confusing).
- Wire `onPress` to the pure transform, merging copied ratings over an otherwise-empty draft:
  ```ts
  const prior = mostRecentSession(entries, session, date);
  // prior is a PriorCheckin discriminated union — narrow, don't assert.
  if (prior !== undefined) {
    // EMPTY_DRAFT restores doseTaken, sleepHours, sideEffects ({}), notes ('')
    // to their fresh defaults; only scale ratings are carried forward.
    setDraft({ ...EMPTY_DRAFT, ratings: copyableRatings(prior) });
  }
  ```
  This is the enforcement point for the volatile-field exclusions: because we spread `EMPTY_DRAFT` and overwrite **only** `ratings`, `doseTaken` returns to its default (`true`), `sleepHours` to its default, and `sideEffects` (`{}`) / `notes` (`''`) to empty — regardless of what the prior day held. `draftFromMorning`/`draftFromEvening` are **not** used for prefill (they remain the edit-flow hydrators).
- Button label is session-parameterized: `session === 'morning' ? 'Start from your last morning check-in' : 'Start from your last evening check-in'`. Do not hardcode the evening wording.
- After a successful prefill, scroll the form to (or otherwise surface) the Save action, so "glance-and-confirm" does not require a manual scroll to find the button that completes the loop.
- `handleSave`, the `renderMetric` switch (`Toggle`/`ScaleSelector`/`Stepper`/`Chips`/inline-`TextInput`, `default: assertNever(metric)`), and `draftFrom*` are **otherwise untouched**. The existing `loadEntries()` effect already has `entries` in hand; capture it in state so both the edit-hydration effect and the prefill button can read it.

**`app/(tabs)/settings.tsx`.** No change for (a). For (b), no new setting in scope (snooze duration is fixed at 1h). Notification category registration happens in the app-init path, not settings — see Notifications.

**`app/(tabs)/trends.tsx`.** No change. Fully schema-driven; prefilled days produce the same `DayEntry` shape it already renders.

**`app/entry/[date].tsx`.** No change. This file hard-codes each `RatingRow` and is a known non-generic seam — but only a _new rating_ forces edits here, and we add none.

**`app/(tabs)/index.tsx` (Today).** No change required; optionally the `SessionCard` CTA could deep-link identically to the "Log now" action, but that is cosmetic.

**`components/`.** Optionally a thin `PrefillButton` presentational component, or reuse existing button styling inline. No new stateful component.

**Lock-screen interaction (b).** When `profile.lockEnabled` is on, "Log now" opens the app to the foreground but the app's own `LockScreen` still gates entry — a device-level unlock is not an app-level unlock. So the real tap-to-form latency for a locked user is: tap action → (device unlock if needed) → app `LockScreen` → `checkin`. This is consistent with the app's existing security posture and is left as-is; documented here so the latency expectation is honest rather than implied to be zero-step.

## Export / report

**n/a for the report body.** The `lib/metrics.ts` accessors (`ratingAccessor`, `averageOf`, `rowsInRange`) and `buildReportHtml` (`lib/report-html.ts`) are unchanged — the data they consume is identical in shape whether a day was logged manually or via prefill. `escapeHtml` usage and palette-derived colors stay exactly as they are.

Honest caveats worth recording (not code changes):

- Prefill improves _completion_, which makes `averageOf`'s "ignore undefined" behavior less lossy — more filled days, fewer silent drops.
- Because `sideEffects` and `notes` are never copied, the one directly dose-actionable report-facing field (side effects) is always a fresh entry; the feature cannot inflate a flat side-effect profile through carry-forward.
- The copied scale ratings _can_ still be re-affirmed without genuine re-assessment. We accept and record this residual anchoring risk in `docs/DECISIONS.md` (see Provenance decision) rather than surfacing a fresh/copied marker in the export, because marking days would invite interpretation the app must not seed and would require a persisted field this doc keeps out of scope. This is a weaker claim than the first draft's "a confirmed day is a confirmed day" — it is a bounded, explicitly-accepted tradeoff, not a dismissal.

## Notifications

Changes land in `lib/notifications.ts`, preserving its lazy-load discipline (`loadNotifications()` returns `null` under `NOTIFICATIONS_UNAVAILABLE` — Android + Expo Go — so every new function early-returns on `null`).

- **Action categories (session-qualified).** Register two categories so the button label names the session — an ambiguous "Log now" on a stale morning reminder sitting next to a fresh evening reminder could route the user's attention to the wrong check-in:

  ```ts
  const CATEGORY_MORNING = 'adhd-log-reminder-morning';
  const CATEGORY_EVENING = 'adhd-log-reminder-evening';
  const ACTION_LOG_NOW = 'log-now';
  const ACTION_SNOOZE = 'snooze-1h';

  async function ensureReminderCategories(notifications: NotificationsModule): Promise<void> {
    await notifications.setNotificationCategoryAsync(CATEGORY_MORNING, [
      {
        identifier: ACTION_LOG_NOW,
        buttonTitle: 'Log morning',
        options: { opensAppToForeground: true },
      },
      {
        identifier: ACTION_SNOOZE,
        buttonTitle: 'Snooze 1h',
        options: { opensAppToForeground: false },
      },
    ]);
    await notifications.setNotificationCategoryAsync(CATEGORY_EVENING, [
      {
        identifier: ACTION_LOG_NOW,
        buttonTitle: 'Log evening',
        options: { opensAppToForeground: true },
      },
      {
        identifier: ACTION_SNOOZE,
        buttonTitle: 'Snooze 1h',
        options: { opensAppToForeground: false },
      },
    ]);
  }
  ```

  In `scheduleDaily`, attach `categoryIdentifier: session === 'morning' ? CATEGORY_MORNING : CATEGORY_EVENING` and set `data` to `{ kind: 'scheduled', session }`. Registration is idempotent; call `ensureReminderCategories` from `configureNotificationHandler` alongside `ensureAndroidChannel`.

- **Snooze.** Add `scheduleSnooze(session: Session): Promise<void>` that schedules a one-off `TimeInterval` trigger `3600` seconds out on the existing `ANDROID_CHANNEL_ID` channel, with the matching `categoryIdentifier` and `data: { kind: 'snoozed', session }`, under a distinct fixed identifier (`adhd-log-snooze-<session>`) so a re-snooze cancels-then-reschedules rather than stacking. _Morning-session caveat:_ snoozing a morning reminder delays the waking-mood / sleep-quality report away from the moment of waking, which the momentary-assessment literature treats as degrading state-rating accuracy. Fixed 1h keeps this modest, and re-snooze cannot stack (single fixed ID), so the delay is capped at one hour per morning; documented so a future reviewer knows the tradeoff was considered rather than missed.

- **Response routing.** Extend the `addNotificationResponseReceivedListener` handler to branch **only** on `response.actionIdentifier` (a genuinely open-ended OS string — a catch-all default is correct, not a gap):
  - `ACTION_SNOOZE` → `scheduleSnooze(session)` (no navigation).
  - `ACTION_LOG_NOW`, the default tap, or a tapped snoozed notification → deep-link to `checkin` via the existing `onTap(session)` path.

- **Reading the payload — parse-don't-validate (strict-TS must-fix).** `response.notification.request.content.data` round-trips through the OS notification subsystem and is therefore an **untrusted boundary**, exactly like persisted JSON. It is never trusted as `ReminderData` by cast. `session` is read through a guard; `kind` is **not required for routing** and is tolerated when absent (legacy triggers predating this change carry `{ session }` with no `kind`):

  ```ts
  function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null;
  }

  // Parse the OS-delivered payload. Absent/unknown `kind` => 'scheduled' (legacy triggers).
  function parseReminderData(data: unknown): ReminderData | null {
    if (!isRecord(data)) return null;
    const session = data['session']; // bracket access: noPropertyAccessFromIndexSignature
    if (!isSession(session)) return null;
    const kind = data['kind'] === 'snoozed' ? 'snoozed' : 'scheduled';
    return { session, kind };
  }
  ```

  `sessionFromResponse` keeps its `Session | null` signature unchanged: `parseReminderData(response.notification.request.content.data)?.session ?? null`. No `app/_layout` caller changes. This closes the ambiguity the architect flagged: `kind` is read, but only through a total parser that never assumes the union is complete over real-world runtime payloads, and never casts.

- **Migration / rollout (data-model must-fix).** Existing installs already have two DAILY triggers scheduled by the pre-existing `scheduleReminders(profile)` with `data = { session }` and **no** `categoryIdentifier`. Nothing about updating the app re-creates those OS-level triggers, so without an explicit refresh: (1) upgraded users who never touch reminder settings would keep firing the old button-less notifications forever, silently making (b) a no-op for them; and (2) a legacy `{ session }` payload reaching the new handler has `kind === undefined`. Both are handled:
  - **On app boot** (the `app/_layout` init path, after `configureNotificationHandler`), if a profile exists, run `scheduleReminders(profile)` once so the fixed-ID DAILY triggers are re-created with the new `categoryIdentifier` and payload shape. No separate cancel call is needed (nor does one exist): `scheduleReminders` delegates to a per-trigger `scheduleDaily`, which already calls `cancelScheduledNotificationAsync(identifier)` on the fixed morning/evening IDs before re-scheduling them. That cancel-then-reschedule on fixed IDs makes the boot refresh idempotent and self-healing — no persisted migration flag is needed.
  - **Legacy payload tolerance** is built into `parseReminderData` above: absent `kind` is treated as `'scheduled'`, so a mid-rollout legacy notification routes correctly instead of failing. TS exhaustiveness over `ReminderData` does not protect against an actual OS-delivered object predating this change — the runtime parser does.

- **Availability caveat.** All of the above is inert in Expo Go on Android (the `null` early-return path) and requires the dev-client / release build the repo already produces. The Android channel `adhd-log-reminders` must exist before any snooze schedules — reuse `ensureAndroidChannel`.

## Test plan

All new _logic_ lives in `lib/storage.ts`, inside the covered set (`lib/{types,schema,storage,backup,metrics,report-metrics,report-html,export,checkin,trends}.ts`), so coverage thresholds (lines/statements/functions 90, branches 85) are satisfied by testing the pure functions. New specs go in `lib/__tests__/storage.test.ts`, importing `{ describe, it, expect }` from `vitest`, using the sanctioned `as IsoDate` / `as IsoTimestamp` literal-fixture idiom.

`mostRecentSession`:

- returns `undefined` for empty `entries`.
- returns `undefined` when no _prior_ same-session entry exists (only a same-day entry, or only entries on/after `before`).
- picks the **nearest prior** date, skipping intervening days that have the _other_ session only (an evening-only day between two mornings must not shadow the earlier morning).
- respects the **strict** `before` bound: an entry dated exactly `before` is excluded (editing today never offers today).
- narrows correctly — assert `result.session === 'evening'` then access `result.checkin.ratings.mood` inside that branch (union narrowing inside the test, never an assertion), proving the discriminant works.
- skips days whose `DayEntry` has neither session (covers the `continue`).

`copyableRatings` (the mitigation — test the exclusions explicitly, since they are the whole point):

- **morning:** returns `{ sleepQuality, wakingMood }` and contains **no** `doseTaken` and no `sleepHours` key (assert those are absent from the returned object / that a draft built from it has `doseTaken` reset).
- **evening:** copies the set scale ratings and **omits `sideEffects` and `notes` entirely** — assert the returned object has no such keys even when the prior evening had non-empty side effects and a note.
- **evening with sparse ratings:** an undefined optional rating (e.g. `libido` unset) is omitted, not carried as `undefined` (exactOptionalPropertyTypes).
- a round-trip check that `{ ...EMPTY_DRAFT, ratings: copyableRatings(prior) }` yields a draft with `doseTaken` at its default (`true`), `sleepHours` at its default, `sideEffects` `{}`, `notes` `''`.

Fixture shape:

```ts
const entries: Readonly<Record<IsoDate, DayEntry>> = {
  ['2026-07-15' as IsoDate]: {
    date: '2026-07-15' as IsoDate,
    evening: {
      ratings: { mood: 4 },
      sideEffects: { nausea: { severity: 'mild' } },
      notes: 'stressful day',
      completedAt: '2026-07-15T20:00:00.000Z' as IsoTimestamp,
    },
  },
  ['2026-07-16' as IsoDate]: {
    date: '2026-07-16' as IsoDate,
    morning: {
      doseTaken: true,
      ratings: { sleepQuality: 3, wakingMood: 3 },
      completedAt: '2026-07-16T07:00:00.000Z' as IsoTimestamp,
    },
  },
};
// mostRecentSession(entries, 'evening', '2026-07-17' as IsoDate)?.date === '2026-07-15'
// copyableRatings(that) === { mood: 4 }  — NOT sideEffects/notes
```

`lib/notifications.ts` is **not** in the coverage-scoped set (it needs native mocks via `lib/__mocks__/`), consistent with the current suite. `parseReminderData` is pure and cheap to unit-test against plain objects even so — add best-effort cases for `{ session:'evening' }` (legacy, no `kind` → `'scheduled'`), `{ session:'evening', kind:'snoozed' }`, and a malformed payload (`null`, `{}`, bad session → `null`). These do not count toward thresholds but pin the untrusted-boundary contract. Keep the branching (action → effect) trivially thin so its absence from coverage is immaterial.

## Gate compliance

- **No `any` / unsafe-any:** the selector operates over the already-typed `Record<IsoDate, DayEntry>`; the only `unknown`-adjacent steps are `Object.keys` (typed `string[]`, narrowed by the real `isIsoDate` guard) and `parseReminderData`'s `unknown` input (narrowed by `isRecord` + `isSession` predicates). No `any` enters.
- **No non-null `!`:** every `entries[date]` access is `DayEntry | undefined` under `noUncheckedIndexedAccess`, narrowed with `if (entry === undefined) continue;` — never asserted.
- **No `as` on untrusted data:** production code mints no branded value by cast and reads no OS payload by cast (`isRecord`/`isSession` predicates instead). The sole assertions are `as IsoDate` / `as IsoTimestamp` on known-valid literals inside test fixtures (`type-coverage --ignore-as-assertion`).
- **No `@ts-*` / `eslint-disable`:** none needed; the design is expressible in strict TS.
- **`noPropertyAccessFromIndexSignature`:** `parseReminderData` reads `data['session']` / `data['kind']` via bracket access on the `Record<string, unknown>` predicate result.
- **Exhaustive switch / `assertNever`:** no `Metric` variant added, so the existing `assertNever` seam (`checkin.tsx`) stays green. The two-arm ternaries (`copyableRatings` session split; routing snooze-vs-navigate) are total over a closed two-member union and an open OS string with a correct catch-all, respectively — the doc states why `switch`+`assertNever` is not the right shape there.
- **`exactOptionalPropertyTypes`:** `copyableRatings`'s evening branch uses conditional spreads to omit undefined optionals; `PriorCheckin.checkin` reuses the existing interfaces verbatim.
- **100% type-coverage:** every value in the new code has an inferred or annotated concrete type; the discriminated `PriorCheckin` return and the guarded `parseReminderData` keep call sites fully typed with no widening.

## Dependencies & sequencing

- **Requires a `docs/DECISIONS.md` entry** recording the provenance tradeoff (see Provenance decision) before (a) ships. This is a documentation gate, not a code gate.
- **Coupled to schema-extension docs at one point.** `copyableRatings` enumerates rating keys explicitly to make its volatile-vs-stable policy call, so it is _not_ automatically generic over new `RatingKey`s. Any doc adding a new rating must add that key to `copyableRatings` with a copy/exclude decision (stable trait → copy; day-specific quantity → exclude). No ordering constraint, but this is a required checklist item for those docs — call it out in their non-generic-seam lists alongside the existing `checkin.tsx` four-edit dance.
- **Enables** any future "completion quality" surface: higher completion is the precondition for the trend/report docs to be meaningful. Note for sequencing: higher completion rate is _not_ the same as sufficient signal quality — this doc does not add a global-impression-of-change item, side-effect severity/duration, or an adherence-quality signal beyond boolean `doseTaken`; those remain open roadmap items and should not be assumed covered by "more days logged."
- **Shares the notification substrate** with any reminder-tuning doc; land the category / `ReminderData` / boot-refresh work here first so the other builds on it.
- Sub-features (a) and (b) are independently shippable; ship (a) first (highest confidence, pure-tested, no native surface).

## Alternatives considered / open questions

- **Blanket whole-draft prefill (rejected — was the first draft's mechanism).** Copying `doseTaken`, `sleepHours`, `sideEffects`, and `notes` along with the ratings is unedited carry-forward (LOCF) for the exact executive-function-impaired population this app targets, and it pipes stale side effects straight into the provider PDF. Replaced with scale-ratings-only `copyableRatings`.
- **Auto-submit "same as last time" (rejected).** Writing the entry on one tap fabricates trend data the user never affirmed — a direct mission violation. This is categorically worse than the confirm-required anchoring risk we accept for the scale ratings; the doc keeps the two distinct so a future reader does not assume rejecting auto-submit also disposes of the milder concern.
- **Prefill from a rolling average (rejected).** Interpretation dressed as convenience — it invents a value no day actually had.
- **Persisting a "prefilled" flag on the entry (deferred, not silently rejected).** See Provenance decision — escalated to `docs/DECISIONS.md` with the future migrate-on-read shape sketched, rather than settled here.
- **Snooze duration as a setting (deferred).** Fixed 1h keeps zero new `Profile` field and zero migration. If demand appears, add an optional `snoozeMinutes?: Minute` field per the migrate-on-read template in Storage & guards.
- **Softening `computeStreak` (out of scope, fast-follow).** Named as a motivating failure mode but is a scoring change, not a capture-speed change; deferred to a streak-resilience doc.
- **(c) Home-screen widget — STRETCH, feasibility-caveated, not committed.** A glanceable widget (streak + "logged today?" state, deep-linking into `checkin`) genuinely helps the ADHD use case, but requires native modules outside Expo Go: iOS **WidgetKit** and Android **App Widgets**, reachable only via a config plugin + custom dev-client / prebuild — the repo has that machinery (recent signing/splash plugins), so it is _plausible_, not free. Widgets **cannot read the app's AsyncStorage directly**; sharing today's state needs a bridge (iOS App Group `UserDefaults`, Android shared prefs / `DataStore`) written from JS through a native module. It stays **read-only** to preserve the confirm-before-write guardrail. Open questions if greenlit: which shared-storage bridge; how the widget refreshes (timeline reload on app write); whether two native surfaces are justified for a single-user tool. Recommendation: build (a) and (b); treat (c) as a spike, not a deliverable.
- **Open question (a) — resolved.** Whether to offer prefill while editing a past day that already has data: **no.** Encoded in the consolidated visibility condition (`entries[date]?.[session] === undefined`).

## Panel review

### Clinical / behavioral-health measurement — approve-with-changes

- **Must-fix (LOCF / side-effects → PDF):** applied. `sideEffects` and `notes` are now never copied (`copyableRatings` excludes them structurally), so the one dose-actionable, report-facing field is always a fresh entry. Prefill is scale-ratings-only; the "genuine confirmed self-report" overclaim is replaced with an explicitly-bounded residual anchoring risk.
- **Must-fix (provenance decided unilaterally):** applied as the lens's "at minimum" path — the tradeoff is escalated to a required `docs/DECISIONS.md` entry (new "Provenance decision" section), with the future `authoredBy?: 'fresh' | 'copied'` migrate-on-read shape sketched. A persisted provenance field is deferred, not dismissed; reasoning (scope, privacy, and that the field-exclusion mitigation removes the acute report-facing harm) is stated so the deferral is arguable rather than silent.
- **Suggestions folded:** morning-snooze recall-delay caveat documented with the 1h/no-stacking cap; `notes` excluded from copy; roadmap flag added (completion ≠ signal quality; missing PGI-C/severity/adherence-quality items) in Dependencies; auto-submit vs. confirm-required distinction made explicit in Alternatives.

### Strict-TypeScript architect — approve-with-changes

- **Must-fix (untrusted `kind` read path):** applied. Chose the explicit path — `parseReminderData(data: unknown)` guards the OS payload (`isRecord` + `isSession` predicates, bracket access for `noPropertyAccessFromIndexSignature`), routing branches only on `actionIdentifier`, and absent `kind` falls back to `'scheduled'`. No cast on untrusted data.
- **Suggestions folded:** `ReminderData` flattened to a single shape (discriminated-union framing dropped, dead discriminant removed); explicit note added on why the two ternaries are correct vs. `switch`+`assertNever` (closed 2-member union / open OS string with catch-all); one-line callout added that `PriorCheckin.checkin` are read-only views over guard-validated data, so no new `Parsed<T>` is needed.

### Mobile UX / friction & completion — approve-with-changes

- **Must-fix (`doseTaken` carry-forward):** applied. Prefill spreads `EMPTY_DRAFT` and overwrites only `ratings`, so `doseTaken` always returns to its unset starting state.
- **Must-fix (`sideEffects`/`notes` carry-forward):** applied via the same `copyableRatings` exclusion; prefill copies only the stable scale ratings.
- **Suggestions folded:** button-visibility condition consolidated into one place; `computeStreak` softening explicitly scoped out with a fast-follow pointer; session-parameterized copy specified; session-qualified action titles ("Log morning"/"Log evening") via two categories; lock-screen latency one-liner added; auto-scroll-to-Save after prefill added.

### Data-model / migration + privacy + scope — approve-with-changes

- **Must-fix (notification trigger migration):** applied. Added a "Migration / rollout" subsection: one-time `scheduleReminders(profile)` on app boot to re-create fixed-ID triggers with the new category/payload (its per-trigger `scheduleDaily` already cancels each fixed ID before re-scheduling, so no separate cancel is needed), plus legacy-payload tolerance (`parseReminderData` treats absent `kind` as `'scheduled'`).
- **Suggestions folded:** guardrails widget sentence corrected to "locally-bridged copy" (no longer contradicts the (c) storage note); explicit "prior entry is only read, never written back" sentence added next to the selector; the `snoozeMinutes` migrate-on-read shape hoisted into "Storage & guards" as the documented template for other docs.

**Overall:** all four lenses approve-with-changes; every must-fix applied, with the provenance must-fix taken to its "at minimum" DECISIONS.md form and its reasoning recorded rather than a persisted field added.
