# docs/pending/

Self-contained, independently shippable design docs awaiting implementation. Two tracks share
one number line so they never collide:

- **Architecture / correctness (01–05)** — distilled from the architecture expert-panel review
  (2026-07-18). Fix confirmed data-loss paths and make the codebase's own contracts true.
- **User-value / features (06–46)** — 06–16 distilled from the user-value analysis (2026-07-18);
  17–20 distilled from the titration-log research (2026-07-21, `docs/research/titration-log-examples.md`);
  21 a clinical-lens alternative to #13; 22–46 five rounds of an innovation batch (2026-07-23)
  pushing capability further while staying inside the collect → log → provider mission. Each run
  through the same 4-expert design-review panel (see "How the docs were produced").

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

| #   | Plan                                                                         | Priority | Why it matters                                                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 06  | ~~Provider report overhaul~~ ✅ landed (see DECISIONS)                       | **P1**   | The report is the deliverable: per-period & before/after-dose averages, adherence, side-effect summary, notes, sparklines, a 20-second cover                                                                                         |
| 07  | [Confounder / context tags](07-confounder-context-tags.md)                   | **P1**   | Optional one-tap evening tags so the provider can discount confounded days — the biggest lever on signal quality                                                                                                                     |
| 08  | ~~Rolling-average trend smoothing~~ ✅ landed (see DECISIONS)                | **P1**   | 7-day smoothing makes the weeks-long trend visible under day-to-day noise                                                                                                                                                            |
| 09  | ~~Trend data honesty: coverage + gaps~~ ✅ landed (see DECISIONS)            | **P1**   | "Logged 22 of 30 days" coverage caption + unambiguous gap rendering on the in-app Trends surface; report-side denominator moved to 16                                                                                                |
| 10  | ~~Side-effect severity & onset~~ ✅ landed (see DECISIONS)                   | **P1**   | Severity + first-appearance turns a checkbox into a real push-through-or-change input                                                                                                                                                |
| 11  | [Visit anchoring & "since last visit"](11-visit-anchoring.md)                | **P1**   | Record appointments → report defaults to "since last visit" + pre-visit nudge; ties the loop to the care rhythm                                                                                                                      |
| 12  | [Dose adherence & timing](12-dose-adherence-timing.md)                       | P2       | taken/late/missed (+ time) instead of a boolean; adherence % feeds the report                                                                                                                                                        |
| 13  | ~~Weekly global-impression check-in~~ ✅ landed (see DECISIONS)              | P2       | A lightweight weekly PGI-C-style "vs last week: better/same/worse" — a global-change signal clinicians use                                                                                                                           |
| 14  | [Baseline capture at medication start](14-baseline-capture.md)               | P2       | A pre-start snapshot so current-vs-baseline deltas are legible                                                                                                                                                                       |
| 15  | [Check-in friction reducers](15-checkin-friction-reducers.md)                | P2       | "Same as yesterday" prefill + notification quick-actions/snooze — protect the completion rate every trend depends on                                                                                                                 |
| 16  | ~~Before/after dose-change comparison~~ ✅ landed (see DECISIONS)            | P2       | Rescoped: report section shipped in 06 — remaining was surfacing sample-size + adherence beside each mean, plus the unbuilt in-app Trends view                                                                                       |
| 17  | [Objective measurements (BP · HR · weight)](17-objective-measurements.md)    | **P1**   | The titration anchor the target alpha-agonists/atomoxetine actually turn on; separate episodic store, descriptive only — the biggest gap the log research found                                                                      |
| 18  | [Dose-change trigger (the "why")](18-dose-change-trigger.md)                 | **P1**   | One optional field capturing the user's reason per step; direction derived — turns the report's dose list into the titration narrative a prescriber reads                                                                            |
| 19  | [Titration onset context](19-titration-onset-context.md)                     | P2       | "Day/Week N on current dose" + honest "effects build over weeks" framing — reframes an early flat trend as expected, not failure; nothing persisted                                                                                  |
| 20  | [Combination / adjunct medication](20-combination-medication.md)             | P3       | Decision doc: ship single-med honesty copy now (Option A), hold the pre-designed optional-adjunct expansion (Option B), reject a full N-med manager (C)                                                                              |
| 21  | [Weekly validated self-report instrument](21-weekly-validated-instrument.md) | P2       | Clinical-lens _alternative_ to #13: capture a validated instrument (ASRS) verbatim as raw-total trend. Panel outcome: #13 wins the weekly slot; this lands later as a monthly snapshot on the tracked med's own effects              |
| 22  | [Adaptive reminder timing](22-adaptive-reminder-timing.md)                   | P2       | Suggest (never auto-apply) a re-timed daily reminder from the user's own `completedAt` history — proactive complement to doc 15's reactive snooze/quick-actions                                                                      |
| 23  | [Trend divergence window](23-trend-divergence-window.md)                     | **P1**   | "Largest measured change" split-point search over a metric's range, reusing `computeTrend`'s exact thresholds — surfaces a slow-building shift the fixed midpoint arrow can dilute or miss                                           |
| 24  | [Post-visit provider decision log](24-visit-decision-log.md)                 | P2       | Extends doc 11's `Visit` with an optional structured decision (hold/increase/decrease/switch/adjunct/referral/other) + a display-time proximity note to any nearby dose change                                                       |
| 25  | [Intraday "moment" micro check-in](25-intraday-moment-log.md)                | P2       | Optional sub-5-second episodic capture (feeling + optional side effect + note) for symptom spikes that fade before the evening check-in — mirrors doc 17's append-only store shape                                                   |
| 26  | [Passive sleep corroboration (Health)](26-passive-sleep-corroboration.md)    | P3       | Decision doc (doc-20 format): opt-in HealthKit/Health Connect sleep-duration prefill for the existing `sleepHours` field. Recommends not building until manual-entry accuracy is a demonstrated pain point                           |
| 27  | [Pre-visit "what's changed" digest](27-pre-visit-digest.md)                  | P2       | Mechanical since-last-visit digest (new side effects, dose changes, adherence, weekly tallies) surfaced ahead of an upcoming visit — pre-visit counterpart to #24's post-visit decision log                                          |
| 28  | [Day-of-week descriptive pattern](28-day-of-week-pattern.md)                 | P2       | Purely descriptive weekday-bucketed averages, gated to ranges ≥21 days, neutral styling only — a different statistical lens than #23's before/after split                                                                            |
| 29  | [Unified titration timeline](29-titration-timeline.md)                       | P2       | One chronological strip interleaving dose changes, visits, and side-effect onsets — pure synthesis of existing data, no new storage; supersedes the per-metric dose-change dot                                                       |
| 30  | [Portal-message text digest](30-portal-message-digest.md)                    | P2       | A short, copyable plain-text summary (not the PDF) sized for a patient-portal message box, reusing the report's own pure helpers; one small new dependency (`expo-clipboard`)                                                        |
| 31  | [Planned medication pause log](31-medication-pause-log.md)                   | **P1**   | Distinguishes a planned dosing pause from unexplained non-adherence — corrects a real honesty gap in the landed adherence block; the one doc that edits already-shipped code, additively                                             |
| 32  | [Notes full-text search](32-notes-search.md)                                 | P2       | Case-insensitive substring search over free-text evening notes, gated behind a tap-to-expand affordance on History; pure legibility over data already collected, no new statistics                                                   |
| 33  | [QR-code portal digest](33-qr-digest.md)                                     | P3       | Renders doc 30's plain-text digest as a scannable QR code for in-person/kiosk intake scanners — a second presentation mode, zero new data; hard dependency on doc 30                                                                 |
| 34  | [Home-screen widget MVP](34-home-screen-widget.md)                           | P3       | Decision doc resolving doc 15's flagged-but-unbuilt widget stretch goal — a read-only morning/evening glance, tap-to-open; the largest-effort doc in the pending set (a second native build target per platform)                     |
| 35  | [Periodic backup reminder](35-backup-reminder.md)                            | P2       | A monthly, dismissible nudge to export a JSON backup, addressing the real data-loss risk `docs/PLANNING-v0.md`'s own Open Items already flags; also owns the Today-tab secondary-card ordering/cap convention                        |
| 36  | [Medication supply / refill countdown](36-supply-countdown.md)               | P2       | A private, patient-facing "~N doses left" logistics countdown from self-reported refill counts — deliberately kept off every provider-facing surface, no pharmacy integration                                                        |
| 37  | [Confounder-tag day marker](37-context-tag-comparison.md)                    | P2       | A monochrome Trends marker for days carrying a doc-07 context tag — narrowed from an earlier draft's mean comparison after clinical review flagged a correlation-shaped claim                                                        |
| 38  | [OCR prescription-label dose capture](38-ocr-dose-capture.md)                | P3       | Decision doc: camera+on-device-OCR prefill for a dose change, with mandatory affirmative confirmation before Save can commit an OCR-derived value — recommends deferral pending demonstrated need                                    |
| 39  | [Local-network device-to-device sync](39-local-sync.md)                      | P3       | Decision doc: one-shot, local-Wi-Fi-only backup transfer between a user's own devices, no cloud relay — the first doc to add inbound networking; recommends building only if manual export/import proves insufficient                |
| 40  | [Hours-since-dose moment annotation](40-hours-since-dose-pattern.md)         | P2       | Per-moment elapsed-time-since-dose fact (never aggregated) — reworked from an earlier bucketed-mean design the clinical lens rejected as self-selection-biased and pharmacodynamically misleading for this med class                 |
| 41  | [Streak grace period](41-streak-grace-period.md)                             | P2       | An opt-in "forgive one miss per week" streak variant, motivated by doc 34's own flagged streak-pressure concern — clinically confirmed to resolve the guilt-on-break harm only, not the logging-honesty-bias harm                    |
| 42  | [Structured health-data export (FHIR-lite)](42-structured-export.md)         | P3       | Decision doc: a minimal FHIR Bundle (MedicationStatement + Observation, text-only, no Patient resource) for direct EHR ingestion — lands as a scope-boundary record; ships neither option without a demonstrated receiving system    |
| 43  | [Report methodology appendix](43-report-methodology-appendix.md)             | P2       | A fixed, plain-language PDF appendix explaining the report's own descriptive-statistics conventions (deadbands, sample floors, "insufficient") once, consistently addressed to the provider as reader                                |
| 44  | [Report cover note](44-report-cover-note.md)                                 | P2       | An optional, ephemeral, patient-authored free-text note entered at export time and rendered first in the report with unmistakable quote-style attribution — never persisted                                                          |
| 45  | [Password-protected PDF export](45-password-protected-pdf.md)                | P3       | Decision doc: post-processed PDF encryption before sharing — the dependency question (a real PDF-encryption-capable library) is left genuinely open after an earlier draft's specific library claim proved incorrect                 |
| 46  | [Same-day edit affordance legibility](46-checkin-undo.md)                    | P2       | Reworked from a rejected "add a new Edit link" design once verified the app already has a permanent one-tap edit path — narrows to a brief legibility nudge on the existing affordance, with the data-quality tension named directly |

### How the 06–46 docs were produced

Each was drafted against this repo's real symbols/seams, then reviewed by a 4-lens expert
panel before landing here (17–20 followed the identical process on 2026-07-21, sourced from
`docs/research/titration-log-examples.md`; 22–26, 27–31, 32–36, and 37–41 followed it again on
2026-07-23 as four rounds of an innovation batch, each with independently-spawned reviewers):

1. **Clinical / behavioral-health measurement** — is the captured data actually usable by a
   prescriber for non-stimulant titration, and does it stay descriptive (never advice)?
2. **Strict-TypeScript architect** — branded/union/discriminated types, illegal states
   unrepresentable, exhaustive `switch` + `assertNever`, parse-don't-validate, no escape hatches.
3. **Mobile UX / friction & completion** — does the daily check-in stay fast?
4. **Data-model / migration + privacy + scope** — optional-field back-compat with no forced
   re-onboarding, migrate-on-read for changed shapes, 100% on-device, no scope creep into advice.

Every doc ends with a **## Panel review** section recording each lens's verdict and what
changed. Rounds 1–3 (22–36) came back `approve` / `approve-with-changes` on every doc (no
rejects). Round 4 (37–41) was the first to include a genuine **reject**: doc 40's original
bucketed-mean design was rejected by the clinical lens (self-selection bias in the underlying
sample, and an intraday dose-response framing this app's own non-stimulant premise doesn't
support) and was substantially reworked into a narrower per-moment annotation rather than
patched with copy — the doc now stands at approve/approve-with-changes on that reworked design.
Doc 37's original mean-comparison was independently narrowed for a related reason before it
reached reject. Round 4's Mobile UX / friction lens did not deliver findings for any of that
round's five docs despite repeated re-requests (a recurring cross-round pattern, tracked in this
project's memory as `feedback-panel-review-agents-stall`) — each doc's own Panel review section
states this explicitly rather than fabricating a UX verdict. Round 5 (42–46) added a second
**reject**, this time from the Mobile UX lens itself (once it did deliver): doc 46's original
design proposed a new "Edit" affordance whose entire premise — that no same-day edit path
existed — was factually wrong about the already-shipped app (a permanent, one-tap, pre-filled
edit path already exists on the same `SessionCard`), verified directly against the real code
before the doc was reworked into a narrower legibility improvement on the existing affordance.
Round 5 also caught an incorrect dependency-capability claim (a named PDF library that does not
actually implement the encryption feature it was chosen for) independently from two lenses.

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
