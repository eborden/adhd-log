# Provider report & backup

Map of the export path — the app's reason to exist: turn the on-device log into a
PDF a provider can read and a JSON backup the user controls. Nothing here leaves the
device except through the user-initiated actions in the Settings screen.

## Core modules

- [[lib/report-html.ts]] — `buildReportHtml` (the whole PDF: cover trends, per-period
  tables, before/after-dose comparison, adherence, side-effect and notes sections,
  sparklines, the weekly-impression timeline) plus `ReportOptions` /
  `DEFAULT_REPORT_OPTIONS`, the daily-log cell renderers, and the weekly-impression
  helpers `weeklyAdherence` / `doseChangeInWeek` / `impressionGlyph`
- [[lib/report-metrics.ts]] — the data `buildReportHtml` renders: period bucketing
  (`bucketByWeek` / `bucketByDosePeriod`), `beforeAfterDose`, `sideEffectSummary`,
  `computeAdherence` / `adherenceInWindow`, `collectNotes`
- [[lib/metrics.ts]] — generic `DayEntry` selectors/stats shared with the Trends and
  entry-detail screens: `ratingAccessor`, `rowsInRange`, `coverage`, `metricAverage`,
  `computeTrend`
- [[lib/backup.ts]] — the backup surface: `Backup` (now `{ …, weekly }`), `buildBackup`,
  `parseBackup` (treats a _missing_ `weekly` key as `{}` for pre-weekly-checkin backups,
  but still hard-fails a present-but-malformed one — the first missing-key-tolerant
  branch in `parseBackup`; a template for any future doc adding a new top-level field)
- [[lib/export.ts]] — only the three device-boundary actions: `exportPdfReport` /
  `exportJsonBackup` / `importJsonBackup`

## Weekly global-impression check-in (its own cadence, feeding this same export)

A once-per-week self-rating (better/same/worse vs. the week before, plus an optional
note) for the most recently _completed_ ISO week — deliberately not wired through the
daily check-in seams in [[docs/hubs/checkin-flow.md]].

- [[app/weekly.tsx]] — the check-in screen itself; computes
  `lastCompletedWeekStart(todayIsoDate())`, hydrates any existing entry for that week
  (edit-in-place)
- [[components/WeeklyImpressionPicker.tsx]] — the three worse/same/better choice buttons
- [[app/(tabs)/index.tsx]] — the `WeeklyCard` on Today: a low-weight, self-resolving
  `Card` row (quiet prompt while unanswered, collapses to a one-line summary once
  logged) — see [[docs/hubs/checkin-flow.md]] for the daily cards it sits below
- [[lib/storage.ts]] — `weekStart` / `lastCompletedWeekStart` (Monday-start ISO week);
  guards `isWeeklyImpression` / `isWeeklyCheckin` / `isWeeklyRecord` (the last enforces
  map-key === `entry.weekOf` and rejects a non-canonical `weekOf`); `parseWeekly`;
  `loadWeekly` / `saveWeekly` / `saveWeeklyCheckin` (upsert-by-week)
- [[lib/schema.ts]] — `WEEKLY_IMPRESSION_LABELS`
- [[lib/types.ts]] — `WEEKLY_IMPRESSIONS` / `WeeklyImpression`, `WeeklyCheckin`
- Reminder scheduling for this cadence lives in
  [[docs/hubs/reminders-and-notifications.md]] (`lib/notifications.ts`'s weekly
  `Calendar` trigger, `app/(tabs)/settings.tsx`'s weekly-reminder Toggle + Stepper)

## Schema & types it renders from

- [[lib/schema.ts]] — `REPORT_RATING_ORDER` (single source of truth for metric order
  in the report), `directionForRatingKey`, `WEEKLY_IMPRESSION_LABELS`
- [[lib/types.ts]] — `Rating`, `DayEntry`, `Profile`, `DoseChange`, `TrendDirection`,
  `WeeklyCheckin`, and the `Parsed<T>` result `parseBackup` returns

## Storage it reads/writes

- [[lib/storage.ts]] — `loadEntries` / `loadDoseChanges` / `loadProfile` / `loadWeekly`
  feed the export; `restoreBackup` writes an imported backup back (now including
  `saveWeekly`); date helpers (`loggedDateRange`, `datesInRange`) auto-fit the report
  window; `firstOnsetDates` drives side-effect onset

## UI trigger

- [[app/(tabs)/settings.tsx]] — the Export/Import card: PDF (with an include-notes
  toggle and auto-fitted day count), JSON export, and JSON import via `restoreBackup`

## Golden fixtures & tests

- [[lib/__fixtures__/scenarios.ts]] — 10 hand-authored deterministic datasets, each
  exercising a distinct slice of `buildReportHtml`, each with its own `weekly` map of
  checkins matching that scenario's clinical narrative (e.g. `non-responder`'s three
  weeks all self-rate "about the same," agreeing with its flat daily trends)
- [[lib/__tests__/report-html.test.ts]] — unit tests for daily-log cells,
  `buildReportHtml`, and the weekly-impression-timeline helpers/section
- [[lib/__tests__/report-metrics.test.ts]] — unit tests for bucketing, before/after,
  side effects, adherence, notes
- [[lib/__tests__/metrics.test.ts]] — unit tests for the generic selectors/stats
- [[lib/__tests__/backup.test.ts]] — unit tests for `buildBackup` / `parseBackup`,
  including the missing-vs-malformed `weekly` key branches
- [[lib/__tests__/export.test.ts]] — unit tests for the three native I/O actions
- [[lib/__tests__/weekly.test.ts]] — unit tests for `weekStart` /
  `lastCompletedWeekStart` and the weekly guards/storage
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
