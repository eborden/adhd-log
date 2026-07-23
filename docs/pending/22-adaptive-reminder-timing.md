> **Status:** Proposed (2026-07-23) · **Priority:** P2 · Ref: innovation batch (5 new plans),
> follow-on to doc 15's friction-reducer track

# Adaptive reminder timing (suggest, never auto-change)

## Problem / Context

`Profile.morningReminder` / `Profile.eveningReminder` (`lib/types.ts:94-95`) are a fixed
`TimeOfDay` set once at onboarding and editable in Settings. `scheduleReminders`
(`lib/notifications.ts:110-135`) fires an exact `DAILY` trigger at that hour/minute, every day,
forever — nothing in the app ever revisits whether that time still fits how the person actually
lives. Doc 15 (check-in friction reducers) already attacks the completion problem from the
_reactive_ side: quick-actions and snooze on the notification itself, for the moment it's
already ringing. This doc attacks the same problem from the other direction, proactively: if
someone's evening check-ins reliably land around 9:40pm while the reminder still rings at
8:00pm, every single ping is a slightly-wrong nudge, and the app has the data to notice — the
`completedAt: IsoTimestamp` on every `MorningCheckin`/`EveningCheckin` it already stores.

Missed or late reminders are exactly the failure mode the app should design around: for the
target user (someone whose executive-function tax is the reason the medication exists), a
mistimed nudge is more likely to be dismissed than acted on, and completion rate is the silent
dependency of the whole multi-week trend (doc 15's own framing). A quiet, opt-in suggestion —
"your evening check-ins usually land around 9:40pm — update your reminder to match?" — costs one
tap to accept and protects the exact thing every other doc in this repo depends on: enough
logged days to see a trend.

This is entirely a local, arithmetic transform over data already on the device. No network, no
telemetry leaves the phone, no behavioral model beyond "what time did you actually check in."

## Goals / Non-goals

**Goals**

1. A pure, RN-free helper that derives a suggested `TimeOfDay` per session from the session's
   recent `completedAt` history — nothing persisted beyond what already exists.
2. Surface it as a dismissible **suggestion**, never a silent change: the reminder time changes
   only on an explicit tap, exactly like every other Settings edit already does (which already
   calls `scheduleReminders` on change).
3. Remember a dismissal so an unchanged suggestion doesn't re-surface on every Settings visit,
   but let it resurface if the pattern drifts further from what was dismissed.
4. Full storage-boundary guard for the one new optional `Profile` field, Vitest coverage of the
   pure logic, no change to the daily check-in flow.

**Non-goals**

- **No automatic rescheduling.** `scheduleReminders` is only ever called from an explicit user
  action (Apply), never from this feature's own computation.
- **No behavioral scoring or judgment copy.** No "you're inconsistent," no completion-rate
  percentage shown here (Trends/report already have their own honest coverage captions — doc
  09, landed). The suggestion card states a time, nothing else.
- **No cross-midnight session handling.** A check-in completed just after midnight is a known,
  accepted edge case (see Data model) — not solved here.
- **No new permission or notification channel.** Reuses the existing notification permission and
  the existing `DAILY` trigger machinery unchanged.

## Data model (`lib/types.ts`)

One additive, optional `Profile` field recording the last suggestion the user dismissed per
session, so a repeat of the same suggestion doesn't re-nag:

```ts
export interface DismissedReminderSuggestion {
  readonly time: TimeOfDay;
}

// Profile gains:
readonly dismissedReminderSuggestions?: Readonly<Partial<Record<Session, DismissedReminderSuggestion>>>;
```

Optional and additive — existing profiles keep working with the field absent, matching the
`enabledEveningMetrics?` / `weeklyReminder?` precedent already on `Profile`
(`lib/types.ts:97-99`).

## Core logic (`lib/reminder-timing.ts`, new, RN-free)

**The one correctness trap, stated up front:** `completedAt` is minted by `isoTimestampNow()`
(`lib/storage.ts:393-399`), which is `clock.toISOString()` — always UTC. Deriving a "time of
day" from it must **not** slice the ISO string (that yields UTC hour, not the hour the person
actually experienced locally); it must go through `new Date(ts)` and read `getHours()`/
`getMinutes()`, which JS returns in the runtime's local timezone — the same implicit contract
`loggingStartDate` already relies on (`lib/metrics.ts:66-68`, `new Date(profile.createdAt)`).

```ts
import type { IsoTimestamp, TimeOfDay } from './types';
import { isHour, isMinute } from './storage';

/** Local wall-clock time a timestamp was recorded at — NOT a string-slice of the UTC ISO value. */
export function localTimeOfDay(ts: IsoTimestamp): TimeOfDay {
  const date = new Date(ts);
  const hour = date.getHours();
  const minute = date.getMinutes();
  if (!isHour(hour) || !isMinute(minute)) {
    throw new Error(`Unreachable: Date-derived hour/minute out of range (${String(ts)})`);
  }
  return { hour, minute };
}

/** Minutes since local midnight — the scalar the median is computed over. */
function toMinutes(time: TimeOfDay): number {
  return time.hour * 60 + time.minute;
}

function toTimeOfDay(minutes: number): TimeOfDay {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  if (!isHour(hour) || !isMinute(minute)) {
    throw new Error(`Unreachable: derived minutes out of 24h range (${String(minutes)})`);
  }
  return { hour, minute };
}

/** Minimum sample count before a suggestion is offered — below this, one late night skews it. */
export const MIN_REMINDER_SAMPLES = 5;

/** How many of the most recent completions to consider — a rolling window, not the full history. */
export const REMINDER_SAMPLE_WINDOW = 14;

/**
 * Median local completion time over the most recent `REMINDER_SAMPLE_WINDOW` timestamps for a
 * session, or `undefined` below `MIN_REMINDER_SAMPLES`. Median (not mean) so one very-early or
 * very-late outlier can't pull the suggestion toward a time nobody actually checks in at.
 */
export function suggestedReminderTime(
  completedAts: readonly IsoTimestamp[],
): TimeOfDay | undefined {
  const recent = completedAts.slice(-REMINDER_SAMPLE_WINDOW);
  if (recent.length < MIN_REMINDER_SAMPLES) return undefined;
  const minutes = recent.map((ts) => toMinutes(localTimeOfDay(ts))).sort((a, b) => a - b);
  const mid = Math.floor(minutes.length / 2);
  // Guard-and-narrow, not `as number`: noUncheckedIndexedAccess makes every indexed read
  // `number | undefined` (panel — TS lens must-fix). `mid`/`mid - 1` are always in-bounds given
  // `recent.length >= MIN_REMINDER_SAMPLES`, so this is unreachable in practice, but the guard
  // proves it rather than asserting it — the same idiom `localTimeOfDay`/`toTimeOfDay` use.
  const hi = minutes[mid];
  if (hi === undefined) throw new Error('Unreachable: mid index out of bounds');
  let median = hi;
  if (minutes.length % 2 === 0) {
    const lo = minutes[mid - 1];
    if (lo === undefined) throw new Error('Unreachable: mid - 1 index out of bounds');
    median = (lo + hi) / 2;
  }
  return toTimeOfDay(Math.round(median));
}
```

**Cross-midnight non-goal, made concrete:** a session completed at 12:03am reads as `00:03`
local, which sorts as the _earliest_ possible time-of-day rather than "very late." A person who
consistently checks in just after midnight would get a nonsensical median pulled toward
midnight. This is accepted for v1 (documented, not silently wrong) because the target sessions
are morning/evening, not a graveyard-shift check-in; a circular-median fix is a named follow-on
if it turns out to matter in practice.

**Whether to show the suggestion at all.** Two must-fixes from the UX lens land here together:
comparing `TimeOfDay`s for exact equality is too strict in both directions. A suggestion one
minute off the current setting isn't worth a card (a 21:00 reminder against a 21:03 median is
noise, not a useful nudge), and a dismissal shouldn't be forgotten the instant the rolling
median wobbles by a single minute the next time the window advances — that would recreate the
exact recurring nag this doc exists to avoid. Both comparisons go through the same minute-delta
helper, banded rather than exact:

```ts
// Below this gap, a suggestion is indistinguishable from "already correct" — showing a card for
// a 1-3 minute difference would be noise, not a useful nudge (panel — UX lens must-fix).
const MIN_MEANINGFUL_DELTA_MINUTES = 15;

// A dismissed suggestion is suppressed for any later suggestion within this band of it, so a
// 1-minute drift in the rolling median doesn't immediately re-surface a card the user just
// dismissed (panel — UX lens must-fix).
const DISMISSAL_TOLERANCE_MINUTES = 10;

function minutesApart(a: TimeOfDay, b: TimeOfDay): number {
  return Math.abs(toMinutes(a) - toMinutes(b));
}

export function shouldOfferSuggestion(
  suggested: TimeOfDay | undefined,
  current: TimeOfDay,
  dismissed: TimeOfDay | undefined,
): suggested is TimeOfDay {
  if (suggested === undefined) return false;
  if (minutesApart(suggested, current) < MIN_MEANINGFUL_DELTA_MINUTES) return false;
  if (dismissed !== undefined && minutesApart(suggested, dismissed) < DISMISSAL_TOLERANCE_MINUTES) {
    return false;
  }
  return true;
}
```

A suggestion that drifts far enough from a prior dismissal (≥`DISMISSAL_TOLERANCE_MINUTES` away)
still resurfaces, so a real, sustained schedule shift is never permanently suppressed by one old
dismissal.

## Storage boundary (`lib/storage.ts`)

Extend `isProfile` with the same optional-field shape already used for `enabledEveningMetrics`
(`lib/storage.ts:115-123`):

```ts
function isDismissedReminderSuggestion(value: unknown): value is DismissedReminderSuggestion {
  return isRecord(value) && isTimeOfDay(value['time']);
}

// inside isProfile, alongside the existing weeklyReminder check:
const dismissed = value['dismissedReminderSuggestions'];
if (dismissed !== undefined) {
  if (!isRecord(dismissed)) return false;
  for (const session of ['morning', 'evening'] as const) {
    const entry = dismissed[session];
    if (entry !== undefined && !isDismissedReminderSuggestion(entry)) return false;
  }
}
```

No new storage key — this rides inside the existing `profile` key.

## UI (`app/(tabs)/settings.tsx`)

Below each session's reminder-time `Stepper` pair, compute
`suggestedReminderTime(completedAtsForSession)` from the already-loaded `entries` (map to
`row.morning?.completedAt` / `row.evening?.completedAt`, filtered to defined) and, when
`shouldOfferSuggestion` is true, render a small `Card` in the same visual language as the
existing weekly-reminder toggle: _"Your {session} check-ins usually land around {time} — update
your reminder to match?"_ with **Apply** and **Dismiss** actions.

- **Apply** → `updateProfile` with the new `TimeOfDay` for that session (existing pattern already
  used by the reminder Steppers), then `scheduleReminders(profile)` (already called on every
  reminder-time change today).
- **Dismiss** → write `dismissedReminderSuggestions[session] = { time: suggested }`, no
  reschedule.

The card never appears for a session with `< MIN_REMINDER_SAMPLES` logged completions, so a
brand-new profile sees nothing extra during onboarding's first two weeks.

## Test plan (`lib/__tests__/reminder-timing.test.ts`)

**Timezone hazard, addressed directly in the tests:** because `localTimeOfDay` depends on the
test runner's local timezone via `Date`, fixtures must **not** hard-code an expected
hour/minute derived by hand from a UTC string. Every test computes its expected value the same
way the code under test does (`new Date(fixtureTs).getHours()`), so the assertion is
tautologically timezone-consistent rather than accidentally passing only in one CI timezone —
the failure mode the panel's TS lens is expected to flag if this isn't made explicit.

1. `localTimeOfDay` — round-trips a `Date`-constructed timestamp's local hour/minute.
2. `suggestedReminderTime` — `< MIN_REMINDER_SAMPLES` ⇒ `undefined`; a tight cluster of times ⇒
   median near the cluster; one far outlier among ≥5 samples doesn't move the median past a
   neighboring sample (median resistance); only the most recent `REMINDER_SAMPLE_WINDOW` count.
3. `shouldOfferSuggestion` — `undefined` suggestion ⇒ false; suggestion within
   `MIN_MEANINGFUL_DELTA_MINUTES` of current ⇒ false (not just exactly equal); suggestion within
   `DISMISSAL_TOLERANCE_MINUTES` of a prior dismissal ⇒ false; a suggestion that has since
   drifted past both bands ⇒ true again.
4. `isProfile` — accepts a profile with/without `dismissedReminderSuggestions`; rejects a
   malformed per-session entry.

## Gate compliance

No `any`/`!`/`@ts-*`/eslint-disable. `localTimeOfDay`/`toTimeOfDay` throw on a value that cannot
occur (a JS `Date`'s own hour/minute can never be out of range) rather than asserting — the same
guard-and-throw idiom `formatIsoDate` uses, not a cast. `Session`-keyed optional record follows
the existing `Partial<Record<Session, …>>` shape already used elsewhere in this codebase.
Additive `Profile` field → no migration, no forced re-onboarding. `npm run check` must pass
before commit.

## Dependencies & sequencing

Independent of every other pending doc — reads only `completedAt`, which already exists on both
check-in types. Can land before or after doc 15's friction reducers; the two are complementary
(reactive snooze vs. proactive re-timing) and share no code.

## Alternatives considered

- **Auto-apply above a confidence threshold:** rejected outright — a silent schedule change is
  the one thing this doc is careful never to do, per the mobile-UX precedent set by every other
  doc in this track (nothing here auto-changes user-facing state without a tap).
- **Mean instead of median:** rejected — a single very-late night would drag a mean noticeably;
  median is more robust to the exact kind of one-off outlier a nightly check-in habit produces.
- **A full histogram / "most common hour" mode:** considered and dropped as over-engineering for
  a suggestion that only needs to be roughly right, not maximally precise; median over a
  14-sample rolling window is the simplest thing that could work and is trivially testable.

## Panel review

Run through the 4-lens panel (2026-07-23): approve (clinical, scope), approve-with-changes
(strict-TS, UX). Must-fixes applied above.

- **Clinical — approve.** Captures/renders no clinical data (it only re-times a local
  reminder); copy is operational, not evaluative, and explicitly avoids "you're inconsistent" /
  completion-rate framing. No must-fix.
- **Strict-TypeScript architect — approve-with-changes.** _Must-fix (applied):_ the median
  calculation's `minutes[mid] as number` / `minutes[mid - 1] as number` violated
  `noUncheckedIndexedAccess` (`CLAUDE.md`: "narrow it, don't assert it") — replaced with a
  guard-and-throw on the indexed read, matching the `localTimeOfDay`/`toTimeOfDay` idiom already
  in the doc. Confirmed `isHour`/`isMinute` are real exports and the `isProfile` extension
  mirrors the actual `enabledEveningMetrics`/`weeklyReminder` optional-field checks.
- **Mobile UX / friction — approve-with-changes.** _Must-fixes (applied):_ added
  `MIN_MEANINGFUL_DELTA_MINUTES` so the card never offers a change indistinguishable from the
  current setting; changed the dismissal comparison from exact `TimeOfDay` equality to a
  `DISMISSAL_TOLERANCE_MINUTES` band, so a 1-minute rolling-median wobble can't immediately
  re-surface a just-dismissed card. Confirmed placement (Settings, below the reminder Steppers,
  off the daily flow) and copy discipline were already correct.
- **Data-model / migration + privacy + scope — approve.** Additive/optional `Profile` field,
  no forced re-onboarding, rides inside the existing `profile` key for backup round-trip; pure
  on-device arithmetic over data already stored, no telemetry. _Noted, not a must-fix:_
  `isProfile` is all-or-nothing, so a corrupted `dismissedReminderSuggestions` would (like every
  other optional profile field) reject a whole-backup restore — a pre-existing property of the
  profile parse, not something this doc's field newly introduces; acknowledged here rather than
  changing the guard's posture.
