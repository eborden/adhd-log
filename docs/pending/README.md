# docs/pending/

Self-contained, independently shippable design docs awaiting implementation. Two tracks share
one number line so they never collide:

- **Architecture / correctness (01–05)** — distilled from the architecture expert-panel review
  (2026-07-18). Fix confirmed data-loss paths and make the codebase's own contracts true.
- **User-value / features (06–20)** — 06–16 distilled from the user-value analysis (2026-07-18);
  17–20 distilled from the titration-log research (2026-07-21, `docs/research/titration-log-examples.md`).
  Each run through the same 4-expert design-review panel (see "How the docs were produced").

Do them roughly in numbered order within each track. The architecture track (01–05) generally
comes first: several feature docs assume the schema-driven write path (02), tolerant parsing
(03), and the restore fix (01) are in place.

## Architecture / correctness

Numbers encode priority = payoff ÷ (effort + over-engineering risk), as adjudicated by the
architecture panel's chief-architect synthesis.

Landed plans move to `docs/DECISIONS.md` and are struck through here.

| #   | Plan                                                                               | Effort       | Why it matters                                                                                   |
| --- | ---------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------ |
| 01  | ~~Extract `restoreBackup` + fix dose-restore data loss~~ ✅ landed (see DECISIONS) | Small        | Fixed a confirmed data-loss bug in the disaster-recovery path                                    |
| 02  | ~~Schema-drive the check-in write path~~ ✅ landed (see DECISIONS)                 | Small–Medium | Made the "add a metric in schema.ts only" contract actually true; closed a silent data-drop hole |
| 03  | ~~Tolerant entry parsing + no destructive overwrite~~ ✅ landed (see DECISIONS)    | Medium       | Protects months of accreting data from total loss on one bad record                              |
| 04  | ~~Extract a `<DoseInput>` component~~ ✅ landed (see DECISIONS)                    | Small        | Removed the only real verbatim cross-screen UI duplication                                       |
| 05  | [Add a native time picker](05-native-time-picker.md)                               | Small        | Makes reminder minutes (already modeled) reachable; the one justified new dependency             |

## User-value / features

Priority = value ÷ effort within the mission (**collect → log → provider**), P1 before P2.
Each doc references its source item in the user-value analysis.

| #   | Plan                                                                         | Priority | Why it matters                                                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 06  | ~~Provider report overhaul~~ ✅ landed (see DECISIONS)                       | **P1**   | The report is the deliverable: per-period & before/after-dose averages, adherence, side-effect summary, notes, sparklines, a 20-second cover                                                                            |
| 07  | [Confounder / context tags](07-confounder-context-tags.md)                   | **P1**   | Optional one-tap evening tags so the provider can discount confounded days — the biggest lever on signal quality                                                                                                        |
| 08  | ~~Rolling-average trend smoothing~~ ✅ landed (see DECISIONS)                | **P1**   | 7-day smoothing makes the weeks-long trend visible under day-to-day noise                                                                                                                                               |
| 09  | ~~Trend data honesty: coverage + gaps~~ ✅ landed (see DECISIONS)            | **P1**   | "Logged 22 of 30 days" coverage caption + unambiguous gap rendering on the in-app Trends surface; report-side denominator moved to 16                                                                                   |
| 10  | ~~Side-effect severity & onset~~ ✅ landed (see DECISIONS)                   | **P1**   | Severity + first-appearance turns a checkbox into a real push-through-or-change input                                                                                                                                   |
| 11  | [Visit anchoring & "since last visit"](11-visit-anchoring.md)                | **P1**   | Record appointments → report defaults to "since last visit" + pre-visit nudge; ties the loop to the care rhythm                                                                                                         |
| 12  | [Dose adherence & timing](12-dose-adherence-timing.md)                       | P2       | taken/late/missed (+ time) instead of a boolean; adherence % feeds the report                                                                                                                                           |
| 13  | [Weekly global-impression check-in](13-weekly-global-impression.md)          | P2       | A lightweight weekly PGI-C-style "vs last week: better/same/worse" — a global-change signal clinicians use                                                                                                              |
| 14  | [Baseline capture at medication start](14-baseline-capture.md)               | P2       | A pre-start snapshot so current-vs-baseline deltas are legible                                                                                                                                                          |
| 15  | [Check-in friction reducers](15-checkin-friction-reducers.md)                | P2       | "Same as yesterday" prefill + notification quick-actions/snooze — protect the completion rate every trend depends on                                                                                                    |
| 16  | ~~Before/after dose-change comparison~~ ✅ landed (see DECISIONS)            | P2       | Rescoped: report section shipped in 06 — remaining was surfacing sample-size + adherence beside each mean, plus the unbuilt in-app Trends view                                                                          |
| 17  | [Objective measurements (BP · HR · weight)](17-objective-measurements.md)    | **P1**   | The titration anchor the target alpha-agonists/atomoxetine actually turn on; separate episodic store, descriptive only — the biggest gap the log research found                                                         |
| 18  | [Dose-change trigger (the "why")](18-dose-change-trigger.md)                 | **P1**   | One optional field capturing the user's reason per step; direction derived — turns the report's dose list into the titration narrative a prescriber reads                                                               |
| 19  | [Titration onset context](19-titration-onset-context.md)                     | P2       | "Day/Week N on current dose" + honest "effects build over weeks" framing — reframes an early flat trend as expected, not failure; nothing persisted                                                                     |
| 20  | [Combination / adjunct medication](20-combination-medication.md)             | P3       | Decision doc: ship single-med honesty copy now (Option A), hold the pre-designed optional-adjunct expansion (Option B), reject a full N-med manager (C)                                                                 |
| 21  | [Weekly validated self-report instrument](21-weekly-validated-instrument.md) | P2       | Clinical-lens _alternative_ to #13: capture a validated instrument (ASRS) verbatim as raw-total trend. Panel outcome: #13 wins the weekly slot; this lands later as a monthly snapshot on the tracked med's own effects |

### How the 06–20 docs were produced

Each was drafted against this repo's real symbols/seams, then reviewed by a 4-lens expert
panel before landing here (17–20 followed the identical process on 2026-07-21, sourced from
`docs/research/titration-log-examples.md`; all four returned approve / approve-with-changes):

1. **Clinical / behavioral-health measurement** — is the captured data actually usable by a
   prescriber for non-stimulant titration, and does it stay descriptive (never advice)?
2. **Strict-TypeScript architect** — branded/union/discriminated types, illegal states
   unrepresentable, exhaustive `switch` + `assertNever`, parse-don't-validate, no escape hatches.
3. **Mobile UX / friction & completion** — does the daily check-in stay fast?
4. **Data-model / migration + privacy + scope** — optional-field back-compat with no forced
   re-onboarding, migrate-on-read for changed shapes, 100% on-device, no scope creep into advice.

Every doc ends with a **## Panel review** section recording each lens's verdict and what
changed. All 06–20 came back `approve` / `approve-with-changes` (no rejects); must-fixes were
applied before commit.

## Ground rules that apply to every plan

- All gates in `npm run check` must pass before commit (typecheck, eslint `--max-warnings 0`,
  prettier `--check`, vitest with coverage thresholds, `type-coverage --at-least 100`).
- No `any`, `@ts-ignore`, non-null `!`, or inline eslint-disable — see `CLAUDE.md`.
- Business logic goes in RN-free `lib/` modules with Vitest coverage; components stay presentational.
- Stay inside the mission: **collect → log → provider**. New surfaces show data and defer meaning
  to the provider — no interpretation, risk scoring, or dose guidance. Data never leaves the device
  except through user-initiated exports.
- Log any decision that deviates from these plans in `docs/DECISIONS.md`.

## Explicitly out of scope (panels flagged as over-engineering here)

Global state library · keyed-`ratings`-record migration (as a first move) · a `{v:1,data}` schema
envelope right now · error-boundary/toast system · CI/dependency bots · a UI kit · a charting
library · any clinical interpretation, scoring, or recommendation engine. See each plan's
"Non-goals" section.
