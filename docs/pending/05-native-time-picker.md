# 05 — Add a native time picker so reminder minutes become settable

**Priority:** 5
**Effort:** Small
**Risk / over-engineering:** Low (the one dependency the panel endorsed adding)

## Problem

`TimeOfDay` fully models `minute: Minute` (0–59) — see `lib/types.ts:25-30, 58-61` — and the whole
notification path passes it through (`lib/notifications.ts:77-83` uses `time.minute` in the DAILY
trigger). But every UI path **hardcodes `minute: 0`** and exposes only an hour `Stepper`:

- `app/onboarding.tsx:51-52` — `morningReminder: { hour, minute: 0 }`, `eveningReminder: { …, minute: 0 }`
- `app/(tabs)/settings.tsx:102-103` — same, in `handleReminderChange`

So the domain can express an 8:30 reminder, but the app can never set one. A scrolling time wheel is
exactly the native-feel widget not worth hand-rolling (a two-field hour+minute stepper would be
clunky), so this is the single justified new dependency.

## Change

### 1. Add the dependency via Expo

```
npx expo install @react-native-community/datetimepicker
```

Use `expo install` (not raw `npm install`) so the version is pinned to what Expo SDK 57 expects.
It's an Expo-supported community module with a native build step — a config-plugin/prebuild will be
required; the repo already does local Android release builds, so document the rebuild in the PR.

### 2. Replace the hour-only Steppers with a time picker

Introduce a small presentational wrapper (e.g. `components/TimeField.tsx`) that renders the current
`TimeOfDay` as a tappable "8:30 AM"-style label and opens the platform picker in `time` mode,
returning `{ hour, minute }`. Keep it controlled:

```ts
interface TimeFieldProps {
  readonly label: string;
  readonly value: TimeOfDay;
  readonly onChange: (next: TimeOfDay) => void;
}
```

- Narrow the picker's output through the existing `isHour` / `isMinute` guards
  (`lib/storage.ts:55-61`) before constructing a `TimeOfDay` — do **not** cast. If either guard
  fails, ignore the change (matches the current `handleReminderChange` guard style).
- `onboarding.tsx`: replace `morningHour`/`eveningHour` number state + the two hour Steppers with two
  `TimeField`s backed by `TimeOfDay` state (default `{ hour: 8, minute: 0 }` / `{ hour: 20, minute: 0 }`).
- `settings.tsx`: replace the two hour Steppers (`:261-281`) and update `handleReminderChange` to take
  a full `TimeOfDay` instead of just an hour; keep the `scheduleReminders` re-schedule side effect.

### 3. Keep it out of `lib/`

The picker is pure UI; `lib/notifications.ts` already consumes `minute` correctly, so no lib change
is needed beyond reusing the existing guards.

## Acceptance criteria

- A user can set, e.g., an 8:30 morning reminder in both onboarding and settings, and it persists.
- The scheduled notification fires at the chosen hour **and** minute (verified against
  `scheduleReminders` receiving the real `minute`).
- Guards reject out-of-range values without a cast or a crash.
- Works (or degrades gracefully) in Expo Go per the existing `NOTIFICATIONS_UNAVAILABLE` handling —
  the picker itself is independent of notifications, so time can still be set even where scheduling
  is a no-op.

## Verification note

This touches a native module and notification scheduling, so it can't be fully validated by Vitest.
Plan to drive it in the running app (see the `run` / `verify` skills): set a non-zero minute, confirm
it persists across relaunch, and confirm the scheduled trigger carries the minute.

## Non-goals

- No other new dependencies. The panel's standing verdict: **don't** add date-fns/dayjs, zod, a form
  library, a charting library, or a UI kit. The only conditional future add is `react-native-svg`,
  and **only** if the Trends bar chart outgrows flexbox — note that as the intended path in
  `docs/DECISIONS.md`, don't act on it now.

## Gates

`npm run check` green (the picker is UI, so no coverage regression expected). Record the dependency
decision and the required rebuild in `docs/DECISIONS.md`.
