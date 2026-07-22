# Reminders & notifications

Map of the daily-reminder path — scheduling the morning/evening local notifications
from the profile's reminder times, and deep-linking a tapped notification straight into
the right check-in session. Small but spread across the app shell, so easy to lose track
of without a hub.

## Core module

- [[lib/notifications.ts]] — lazy-loads `expo-notifications` (guarded because it throws
  at import time on Android in Expo Go), high-importance Android channel,
  `requestNotificationPermissions`, `scheduleReminders` (daily morning + evening
  triggers carrying a `session` payload, plus an opt-in weekly `Calendar`-weekday
  (Monday) trigger carrying `data: { kind: 'weekly' }` when `profile.weeklyReminder` is
  set), `sessionFromResponse`, `notificationKindFromResponse`, `addNotificationTapListener`
  (now takes both an `onSessionTap` and an `onWeeklyTap` callback)

## App shell wiring

- [[app/_layout.tsx]] — `configureNotificationHandler` on mount and
  `addNotificationTapListener` routing a session tap to `/checkin?session=…` and a
  `'weekly'` tap to `/weekly`

## Where reminder times are set

- [[app/onboarding.tsx]] — initial morning/evening hours, first `scheduleReminders`
- [[app/(tabs)/settings.tsx]] — editing hours re-requests permission and reschedules;
  also the weekly-reminder Toggle + hour Stepper (minute fixed at `:30`, distinct from
  the daily reminders' fixed `:00`, so the weekly trigger can never collide with either)

## Types

- [[lib/types.ts]] — `Profile` (`morningReminder` / `eveningReminder` /
  `weeklyReminder?`), `TimeOfDay`, `Session`, `WeeklyImpression`
- [[lib/storage.ts]] — `isSession` guard used by `sessionFromResponse`; `isProfile`
  validates the optional `weeklyReminder` field

## Weekly check-in itself

The weekly-impression cadence this reminder deep-links into lives in
[[docs/hubs/report-and-backup.md]] (`app/weekly.tsx`, `lib/storage.ts`'s
`weekStart`/`lastCompletedWeekStart`/`WeeklyCheckin` guards, and the report's
weekly-impression-timeline section) — kept as its own hub since it's a distinct,
non-daily surface, not an extension of the daily check-in flow above.
