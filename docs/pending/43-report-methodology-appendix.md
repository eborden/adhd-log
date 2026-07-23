> **Status:** Proposed (2026-07-23) · **Priority:** P2 · Ref: innovation batch, round 5

# Report methodology appendix

## Problem / Context

The provider report has accumulated real statistical sophistication over its many landed and
pending docs: a neutral deadband before a trend renders as an arrow (`TREND_DEADBAND`), a
minimum-sample floor before a comparison is shown at all (`MIN_HALF_SAMPLES`), an explicit
"insufficient" state distinct from a measured flat trend, dose-period-clamped recent windows,
and (if this batch's docs land) weekday buckets, tag markers, and a divergence-window search —
each individually well-reasoned and individually captioned, but nowhere explained **as a set**.
A provider opening this report for the first time sees terms like "insufficient (not enough
logged days to compare halves)" or a recent-average column with no stated definition of "recent,"
and has to reconstruct the app's own conventions from scattered inline captions rather than
reading them once. This doc adds exactly that: a short, static appendix at the end of the PDF
explaining the report's own descriptive-statistics conventions, once, in plain language.

## Goals / Non-goals

**Goals**

1. One new, fixed, mostly-static section at the end of the PDF report — not computed from data,
   not personalized beyond which conventions are actually in play for that render — explaining
   in a few short paragraphs: what "insufficient" means and why it appears instead of a noisy
   arrow, what the recent-window/dose-period-clamping means, and (once/if this batch's docs land)
   what a "biggest measured change" split or a weekday bucket represents.
2. Reduce the per-caption repetition burden: existing inline captions may be shortened once this
   appendix exists as the canonical explanation, though this doc does not require rewriting any
   existing caption — it is additive, not a mandate to edit landed copy.
3. Zero new data, zero new computation — a purely explanatory addition.

**Non-goals**

- **No new statistics, no new sections beyond the appendix itself.** This doc explains what
  already exists elsewhere in the report; it computes nothing new.
- **No per-patient customization of the explanation text.** One fixed appendix, identical across
  every export — the methodology doesn't change per patient, so neither does its explanation.
- **No claim of statistical rigor beyond what's true.** The appendix must describe the app's
  actual, simple arithmetic (means, deadbands, sample floors) honestly as exactly that — plain
  descriptive statistics, not "analysis" or "insights" — matching the same restrained register
  every other report section already uses.
- **No removal of existing inline captions.** Even with the appendix present, each section keeps
  its own brief in-context caption (e.g. "insufficient (not enough logged days to compare
  halves)") — the appendix is a fuller explanation for a reader who wants one, not a replacement
  for the at-a-glance context every section already provides.

## Content (fixed copy, not computed)

**Audience pinned to the provider, consistently (panel — clinical lens must-fix).** An earlier
draft's example copy mixed registers — "the ratings and events **you** logged" (patient-
directed) alongside "discuss... with **the patient's provider**" (third-person, and circular if
the provider is the one reading it) and "the **patient's** own account" (third-person again).
This appendix rides on a report whose reader is the provider — the copy must address that reader
consistently, not shift between "you" and "the patient" mid-paragraph:

> **About this report's numbers**
>
> This report shows the ratings and events the patient logged, summarized descriptively — it
> does not diagnose, score, or recommend anything. A few notes on how the summaries work:
>
> - **"Insufficient"** appears instead of an up/down/flat arrow when either side of a comparison
>   has too few logged days to be a stable average — a deliberate choice to avoid showing a
>   direction driven by noise rather than a real pattern.
> - **"Recent"** figures use a trailing window that never spans a dose change, so a recent
>   average always reflects only the current dose, never a blend of two.
> - Every average is a plain arithmetic mean of self-reported 1–5 ratings — not a validated
>   clinical score. Read them alongside the daily log and the patient's own account, not in
>   place of either.
>
> These numbers describe logged data; they do not interpret it — please discuss anything here
> directly with the patient.

The exact wording is a copy-review detail for implementation, not fixed by this doc — the shape
(a handful of short, plain-language bullets restating existing, already-approved conventions,
consistently addressed to the provider as reader) is the actual contribution, reusing language
this repo's own landed docs already established rather
than inventing new claims.

## Report (`lib/report-html.ts`)

A new, fixed HTML block appended after every other section (after the daily log, the last
existing section), rendered via a plain constant string (`escapeHtml`-wrapped where any dynamic
value is ever interpolated, though the base text has none) — no new function beyond a thin
`methodologyAppendixHtml(): string` returning the fixed block. **Always renders** — unlike every
other optional section in this report, this one isn't gated on data presence, since it explains
conventions rather than showing data; a report with very little logged data benefits from the
explanation just as much as (or more than) one with a lot.

## Test plan (`lib/__tests__/report-html.test.ts`)

1. `methodologyAppendixHtml` — returns a fixed, non-empty string containing the key terms it's
   meant to explain (`insufficient`, `recent`); a snapshot-style test (matching this repo's
   existing golden-fixture convention) pins the exact rendered text so an accidental future edit
   to the wording is a deliberate, reviewed change, not a silent drift.
2. **Presence regardless of data** — `buildReportHtml` includes the appendix in both a
   data-rich scenario and a nearly-empty one (reusing this repo's existing golden scenario
   fixtures), confirming it's genuinely unconditional unlike every other optional section.

Golden report fixtures (`lib/__fixtures__/reports/*.html`) regenerated via `vitest -u` — a
report-rendering change, per `CLAUDE.md`'s screenshot rule, reviewed in the rendered output
before landing.

## Gate compliance

No `any`/`!`/`@ts-*`/eslint-disable. No new persisted type, no new `Backup`/`STORAGE_KEYS`
change — a pure, static string addition to the report renderer. `npm run check` must pass before
commit.

## Dependencies & sequencing

Independent of every other doc in this batch and prior rounds for its core mechanics, but its
**content** should be finalized last among this batch's Trends/report-facing docs (23, 28, 29,
37, and any others that land) so the appendix's wording can reference whichever of those
conventions actually shipped, rather than describing features that don't exist yet. Purely a
copy-timing consideration, not a code dependency.

## Alternatives considered

- **An in-app "Learn about this report" screen instead of a PDF appendix:** rejected — the
  report is the artifact that leaves the phone and reaches the provider; an in-app-only
  explanation never travels with it. The provider reading the PDF is exactly who needs this
  context, not the patient re-reading the app.
- **Per-section methodology notes instead of one consolidated appendix:** rejected — this repo's
  reports already carry per-section inline captions; a consolidated appendix is additive
  context for a reader who wants the fuller picture once, not a duplicate of what's already
  inline everywhere.
- **Versioning the appendix text so old exports can be matched to the exact wording that was
  current when they were generated:** rejected as over-engineering for a report that isn't
  stored or compared against past exports by this app itself — the appendix always describes
  the current build's conventions, matching how every other report section already works.

## Panel review

Run through the 4-lens panel (2026-07-23): approve (strict-TS, UX, scope), approve-with-changes
(clinical). Must-fix applied above.

- **Clinical — approve-with-changes.** The copy was confirmed to stay descriptive throughout —
  "not a validated clinical score" and "these numbers describe logged data, they do not
  interpret it" are exactly the right register, and the one instructional-sounding line ("read
  them alongside the daily log... not in place of either") was confirmed to be anti-over-
  interpretation guidance, not clinical guidance, and kept as-is. _Must-fix (applied):_ the
  example copy mixed patient-directed ("you logged") and third-person ("the patient's provider,"
  "the patient's own account") language in a document whose actual reader is the provider —
  pinned the copy to address the provider consistently throughout and removed the circular
  "discuss with the patient's provider" phrasing.
- **Strict-TypeScript architect — approve.** `methodologyAppendixHtml(): string` returning a
  fixed constant is a trivial, correct addition; no new type, no export change needed since it
  lives in the same module as the file-private `escapeHtml`. No must-fix.
- **Mobile UX / friction — approve.** Confirmed zero daily-flow impact — PDF-only, no in-app
  screen, no new tap anywhere. No must-fix.
- **Data-model / migration + privacy + scope — approve.** Zero data-model/privacy/scope surface
  — a fixed static string appended to the report renderer, no new persisted type, no `Backup`/
  `STORAGE_KEYS` change, no computation. Confirmed it stays inside collect → log → provider by
  explaining existing conventions rather than adding new ones. No must-fix.
