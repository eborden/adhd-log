# docs/pending/

Actionable plans distilled from the architecture expert-panel review (2026-07-18). Each file is
one self-contained, independently shippable slice. Do them roughly in numbered order — the numbers
encode priority = payoff ÷ (effort + over-engineering risk), as adjudicated by the panel's
chief-architect synthesis.

| #   | Plan                                                                              | Effort       | Why it matters                                                                                    |
| --- | --------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------- |
| 01  | [Extract `restoreBackup` + fix dose-restore data loss](01-restore-backup.md)      | Small        | Fixes a confirmed data-loss bug in the disaster-recovery path                                     |
| 02  | [Schema-drive the check-in write path](02-schema-driven-checkin-write-path.md)    | Small–Medium | Makes the "add a metric in schema.ts only" contract actually true; closes a silent data-drop hole |
| 03  | [Tolerant entry parsing + no destructive overwrite](03-tolerant-entry-parsing.md) | Medium       | Protects months of accreting data from total loss on one bad record                               |
| 04  | [Extract a `<DoseInput>` component](04-dose-input-component.md)                   | Small        | Removes the only real verbatim cross-screen UI duplication                                        |
| 05  | [Add a native time picker](05-native-time-picker.md)                              | Small        | Makes reminder minutes (already modeled) reachable; the one justified new dependency              |

## Ground rules that apply to every plan

- All gates in `npm run check` must pass before commit (typecheck, eslint `--max-warnings 0`,
  prettier `--check`, vitest with coverage thresholds, `type-coverage --at-least 100`).
- No `any`, `@ts-ignore`, non-null `!`, or inline eslint-disable — see `CLAUDE.md`.
- Business logic goes in RN-free `lib/` modules with Vitest coverage; components stay presentational.
- Log any decision that deviates from these plans in `docs/DECISIONS.md`.

## Explicitly out of scope (panel flagged as over-engineering here)

Global state library · keyed-`ratings`-record migration (as a first move) · a `{v:1,data}` schema
envelope right now · error-boundary/toast system · CI/dependency bots · a UI kit · a charting
library. See each plan's "Non-goals" section.
