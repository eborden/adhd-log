# Provider report & backup

Map of the export path — the app's reason to exist: turn the on-device log into a
PDF a provider can read and a JSON backup the user controls. Nothing here leaves the
device except through the user-initiated actions in the Settings screen.

## Core module

- [[lib/export.ts]] — `buildReportHtml` (the whole PDF: cover trends, per-period
  tables, before/after-dose comparison, adherence, side-effect and notes sections,
  sparklines) plus the backup surface (`Backup`, `buildBackup`, `parseBackup`) and the
  three device-boundary actions `exportPdfReport` / `exportJsonBackup` /
  `importJsonBackup`

## Schema & types it renders from

- [[lib/schema.ts]] — `REPORT_RATING_ORDER` (single source of truth for metric order
  in the report), `directionForRatingKey`
- [[lib/types.ts]] — `Rating`, `DayEntry`, `Profile`, `DoseChange`, `TrendDirection`,
  and the `Parsed<T>` result `parseBackup` returns

## Storage it reads/writes

- [[lib/storage.ts]] — `loadEntries` / `loadDoseChanges` / `loadProfile` feed the
  export; `restoreBackup` writes an imported backup back; date helpers
  (`loggedDateRange`, `datesInRange`) auto-fit the report window; `firstOnsetDates`
  drives side-effect onset

## UI trigger

- [[app/(tabs)/settings.tsx]] — the Export/Import card: PDF (with an include-notes
  toggle and auto-fitted day count), JSON export, and JSON import via `restoreBackup`

## Golden fixtures & tests

- [[lib/__fixtures__/scenarios.ts]] — 10 hand-authored deterministic datasets, each
  exercising a distinct slice of `buildReportHtml`
- [[lib/__tests__/export.test.ts]] — unit tests for the report/backup building blocks
- [[lib/__tests__/scenarios.test.ts]] — golden test rendering every scenario and
  pinning its HTML + `Backup` JSON
- [[lib/__fixtures__/reports/clean-responder.html]]
- [[lib/__fixtures__/reports/titration-journey.html]]
- [[lib/__fixtures__/reports/side-effect-heavy.html]]
- [[lib/__fixtures__/reports/non-responder.html]]
- [[lib/__fixtures__/reports/poor-adherence.html]]
- [[lib/__fixtures__/reports/sparse-logging.html]]
- [[lib/__fixtures__/reports/short-week.html]]
- [[lib/__fixtures__/reports/long-multimonth.html]]
- [[lib/__fixtures__/reports/plateau.html]]
- [[lib/__fixtures__/reports/mixed-signals.html]]
