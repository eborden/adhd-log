# Check-in flow

Map of the files behind the daily check-in — from tapping into a session through to
what gets persisted.

## Entry points

- [[app/(tabs)/index.tsx]] — Today tab; surfaces morning/evening session cards plus the
  weekly-impression card (see [[docs/hubs/reminders-and-notifications.md]] and
  [[docs/hubs/report-and-backup.md]] for that cadence's own map — it's a separate, non-daily
  flow and deliberately doesn't touch the daily `Draft`/schema seams below)
- [[app/checkin.tsx]] — the check-in screen itself (morning or evening)
- [[app/entry/[date].tsx]] — view/edit a past day's entry

## Draft state

- [[lib/checkin.ts]] — RN-free `Draft` state and the pure conversions to/from the
  typed `MorningCheckin`/`EveningCheckin` shapes

## Schema — what gets tracked

- [[lib/schema.ts]] — `MORNING_METRICS` / `EVENING_METRICS`, the single source of
  truth for tracked fields; both sessions render generically from these
- [[lib/types.ts]] — the `Metric` discriminated union, `Rating`, `Session`,
  `DayEntry`, and the `Parsed<T>` storage-boundary result type

## Persistence

- [[lib/storage.ts]] — AsyncStorage-backed load/save, the untrusted-JSON type
  guards, and `saveCheckin`'s merge-without-clobbering logic

## Presentational components

- [[components/ScaleSelector.tsx]]
- [[components/Toggle.tsx]]
- [[components/Stepper.tsx]]
- [[components/Chips.tsx]]
- [[components/SeveritySelector.tsx]]
- [[components/DoseInput.tsx]]

## Tests

- [[lib/__tests__/checkin.test.ts]]
- [[lib/__tests__/schema.test.ts]]
- [[lib/__tests__/storage.test.ts]]
