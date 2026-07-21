# Reminders & notifications

Map of the daily-reminder path — scheduling the morning/evening local notifications
from the profile's reminder times, and deep-linking a tapped notification straight into
the right check-in session. Small but spread across the app shell, so easy to lose track
of without a hub.

## Core module

- [[lib/notifications.ts]] — lazy-loads `expo-notifications` (guarded because it throws
  at import time on Android in Expo Go), high-importance Android channel,
  `requestNotificationPermissions`, `scheduleReminders` (daily morning + evening
  triggers carrying a `session` payload), `sessionFromResponse`,
  `addNotificationTapListener`

## App shell wiring

- [[app/_layout.tsx]] — `configureNotificationHandler` on mount and
  `addNotificationTapListener` routing a tap to `/checkin?session=…`

## Where reminder times are set

- [[app/onboarding.tsx]] — initial morning/evening hours, first `scheduleReminders`
- [[app/(tabs)/settings.tsx]] — editing hours re-requests permission and reschedules

## Types

- [[lib/types.ts]] — `Profile` (`morningReminder` / `eveningReminder`), `TimeOfDay`,
  `Session`
- [[lib/storage.ts]] — `isSession` guard used by `sessionFromResponse`
