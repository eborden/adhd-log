# Profile, settings & dose management

Map of the configuration path — first-run onboarding that mints the `Profile`, and the
Settings tab where the med, dose changes, reminder times, evening-metric selection, and
the app lock are all edited afterward. Also covers the privacy lock, which is small
enough to live here rather than in its own hub.

## First run

- [[app/index.tsx]] — routes to onboarding when no profile exists, else into the tabs
- [[app/onboarding.tsx]] — collects med name, starting dose, start date, reminder
  hours, and lock preference; writes the initial `Profile` and schedules reminders

## Settings screen

- [[app/(tabs)/settings.tsx]] — edit med/dose (logs a `DoseChange` and updates
  `currentDose`), reminder hours, which evening ratings are enabled, the Face ID /
  passcode lock, plus the export/import actions (see the report-and-backup hub)

## Privacy lock

- [[app/_layout.tsx]] — `LockState` gate; re-evaluates on `AppState` → active
- [[components/LockScreen.tsx]] — the unlock screen shown while locked

## Inputs

- [[components/DoseInput.tsx]] — amount + unit (`mg`/`mcg`/`mL`)
- [[components/Stepper.tsx]] — reminder-hour steppers
- [[components/Toggle.tsx]] — evening-metric and lock toggles

## Domain logic

- [[lib/schema.ts]] — `enabledEveningMetricKeys`, `withEveningMetricToggled`,
  `DEFAULT_ENABLED_EVENING_METRICS`
- [[lib/checkin.ts]] — `parseDoseAmount`
- [[lib/storage.ts]] — `loadProfile` / `saveProfile`, `appendDoseChange` /
  `loadDoseChanges`, `doseActiveOn`, `isMedName` / `isHour` guards, `todayIsoDate`
- [[lib/types.ts]] — `Profile`, `Dose`, `DoseChange`, `DoseUnit`, `TimeOfDay`,
  `EveningRatingKey`

## Tests

- [[lib/__tests__/storage.test.ts]]
- [[lib/__tests__/schema.test.ts]]
