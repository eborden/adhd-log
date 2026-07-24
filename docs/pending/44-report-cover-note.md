> **Status:** Proposed (2026-07-23) · **Priority:** P2 · Ref: innovation batch, round 5

# Report cover note

## Problem / Context

Everything in the current provider report is either a computed summary (averages, trends,
adherence) or a per-day dated record (notes, side effects, context tags). There is no place for
the patient to say, in their own words, what they most want the provider to know **before**
reading any of the data — the equivalent of the sentence someone rehearses in the waiting room
and then forgets to say once the appointment starts. A short, free-text note the patient writes
once, at the moment of export, and that appears at the very top of the report — before the cover
summary, before anything computed — gives that rehearsed sentence a durable, visible place. This
is distinct from the existing per-day evening `notes` field (dated, retrospective, one entry per
day) and from doc 27's mechanical since-last-visit digest (computed counts, not the patient's own
words) — this is the patient's own framing, entered fresh for this specific export, read first.

## Goals / Non-goals

**Goals**

1. An optional free-text field, entered on the export screen immediately before generating the
   PDF, rendered verbatim (escaped) as the very first content in the report — before the cover
   summary.
2. Never persisted beyond the single export it's written for — this is not a new stored record,
   it's a one-time input at export time, cleared after use.
3. Zero required interaction — the export flow works exactly as it does today if the field is
   left blank; the report simply has no cover note section.

**Non-goals**

- **Not a new persisted type.** The note is a `buildReportHtml` parameter, entered fresh on the
  export screen and passed straight through to the render — it is never written to
  AsyncStorage, never part of `Backup`, never recoverable after the export completes. If the
  same note is wanted again for a later export, the user retypes it — this is a deliberate
  simplicity choice, not an oversight (see Alternatives).
- **No length limit enforced as a hard cap in code**, beyond a reasonable practical UI
  constraint (a multi-line text area, not a single-line field) — this is a cover note, not a
  second free-text journal; keeping it short is a UX nudge (see UI), not a validated rule.
- **No interpretation or auto-summarization of the note's content.** It is rendered exactly as
  typed (escaped for HTML safety), never analyzed, categorized, or folded into any other
  computed section.
- **No requirement that it relate to any specific tracked metric.** The patient can write
  anything — this app doesn't validate or constrain the note's subject matter, matching the
  existing evening `notes` field's own unstructured freedom.

## Core logic — none

This doc introduces no new pure function beyond passing a string through to the renderer; the
only "logic" is presence/absence (render the section only when non-blank after trimming, the
same pattern the existing evening `notes` field's report rendering already uses).

## Report (`lib/report-html.ts`)

**Parameter placement, made concrete (panel — TS lens must-fix).** The real signature is
`buildReportHtml(profile, doses, entries, weekly, rangeStart, rangeEnd, options =
DEFAULT_REPORT_OPTIONS)` (`lib/report-html.ts:484`), and every existing call site
(`app/(tabs)/settings.tsx:166`, the golden-scenario tests, `report-html.test.ts`) passes
positional arguments up to `options`. An earlier draft's "threaded in before the cover summary
rendering" described render order, but if read as inserting a new parameter earlier in the
positional list, it would shift every argument after it and break every existing call site and
golden fixture. The fix, made explicit rather than left as an open choice: **fold `coverNote`
into `ReportOptions`** as `readonly coverNote?: string`, absent from `DEFAULT_REPORT_OPTIONS` —
`app/(tabs)/settings.tsx:166` already passes an options object at that call site, so this is the
cleaner integration than appending an 8th positional parameter, and it keeps every call site that
doesn't care about this feature completely unchanged.

When `options.coverNote` is present and non-blank after `.trim()` (mirroring `collectNotes`'s own
trim-and-skip pattern, `lib/report-metrics.ts:368`), it renders as the report's first content
block — escaped via the existing `escapeHtml`. **Visually distinguished from computed content,
not styled identically to it (panel — clinical lens must-fix).** An earlier draft rendered the
note "in the same neutral `palette` styling as every other text block," which risks a provider
skimming the top of the report mistaking the patient's own framing for the app's own computed
summary — exactly the confusion a "From the patient" label is meant to prevent, undercut by
making it look identical to the sections that follow. The block must carry unmistakable
attribution as unverified, patient-authored narrative entered at export time — a quote-style
treatment (e.g. a left border accent and a distinct, clearly-labeled heading like "In the
patient's own words") that a reader cannot mistake for a computed section, even skimming quickly.
Absent entirely when blank or not provided — the report's existing structure is completely
unchanged for anyone who doesn't use this field.

## UI (`app/(tabs)/settings.tsx`, export screen)

**Collapsed by default, not an always-visible text area (panel — UX lens must-fix).** An earlier
draft put a standing multi-line text area above the export screen's primary action, adding
visual weight and pushing the "Export PDF" button down on every single visit to the screen, for
a field most exports won't use. This repo already has the right pattern for exactly this
shape — `app/checkin.tsx`'s existing evening `notes` field renders as a low-emphasis "+ Add
notes" link that expands into a text input only on tap (`app/checkin.tsx:165-204`). The cover
note field follows the same pattern: a quiet "Add a note for your provider (optional)" link on
the export screen, expanding into the multi-line field only when tapped, so the common one-tap
"Export PDF" flow is completely unchanged in the case (the majority) where no cover note is
written. Ephemeral component state (`useState`), cleared when the export screen is left or after
a successful export — never written to the profile or any persisted store. Generating the PDF
passes the current field value into `ReportOptions.coverNote`.

## Test plan (`lib/__tests__/report-html.test.ts`)

1. `buildReportHtml` — a non-blank `coverNote` renders as the first content block, before the
   cover summary; a blank or whitespace-only `coverNote` (or the parameter omitted entirely)
   renders nothing extra — byte-identical output to calling `buildReportHtml` without the
   parameter at all, confirmed by an explicit equality assertion (this is the load-bearing
   backward-compatibility guarantee: every existing call site and every existing golden fixture
   must still match without passing the new parameter).
2. **Escaping** — a `coverNote` containing `<`/`&` renders the escaped substring, matching every
   other free-text field's existing test convention in this report.

Golden report fixtures are **unaffected** (no scenario needs a new `coverNote` case to stay
green, since the parameter's default/absent behavior is exactly today's output) — one new test
case may optionally add a cover-note-present scenario if desired for the golden gallery, but is
not required for backward compatibility.

## Gate compliance

No `any`/`!`/`@ts-*`/eslint-disable. No new persisted type, no `Backup`/`STORAGE_KEYS` change —
one new optional field on the existing `ReportOptions` interface, defaulted-absent in
`DEFAULT_REPORT_OPTIONS`. `npm run check` must pass before commit.

## Dependencies & sequencing

Independent of every other doc in this batch and prior rounds. If doc 43's methodology appendix
also lands, the two sit at opposite ends of the report (cover note first, appendix last) with no
interaction between them.

## Alternatives considered

- **Persisting the cover note (e.g. on `Profile`, reused across exports until changed):**
  rejected — a "what I want to say" note is inherently tied to a specific moment/appointment, not
  a standing fact about the patient; persisting it risks a stale note silently riding along into
  an export it was never written for (e.g. forgetting it's still set from three months ago). A
  fresh, ephemeral field is the more honest shape, even at the cost of retyping for each export
  that wants one.
- **Folding this into doc 27's pre-visit digest instead of a separate field:** rejected — doc 27
  is mechanical, computed counts; this is a free-text field with no structure and no computation.
  The two are complementary (a patient could use both — read doc 27's digest to remember what
  changed, then write a cover note in their own words) but serve different needs and shouldn't
  be merged into one surface.
- **A character/word limit enforced in code:** rejected — see Non-goals; a soft UX nudge (a
  multi-line area sized for a short note, not a long-form field) is enough without adding a
  validated constraint this feature doesn't need.

## Panel review

Run through the 4-lens panel (2026-07-23): approve (scope), approve-with-changes (clinical,
strict-TS, UX). Must-fixes applied above.

- **Clinical — approve-with-changes.** Confirmed this doesn't repeat doc 40's problem — the app
  makes no claim of its own, rendering the patient's own words verbatim and attributed; ephemeral,
  never persisted, escaped, with no analysis or categorization. _Must-fix (applied):_ identical
  styling to computed sections risked a provider mistaking the patient's own framing for the
  app's computed summary — added an unmistakable quote-style visual treatment so the note can
  never be read as fact rather than attributed narrative, even skimming quickly. _Noted, not
  requiring a redesign:_ placement before the data carries a real anchoring risk (the patient's
  framing priming how the data that follows is read) — accepted as legitimate patient voice,
  provided the attribution fix above makes clear it's subjective framing, not the report's own
  conclusion.
- **Strict-TypeScript architect — approve-with-changes.** _Must-fix (applied):_ the "byte-
  identical when omitted" claim only holds if the new field doesn't shift existing positional
  arguments — verified the real `buildReportHtml` signature and every real call site, and folded
  `coverNote` into the existing `ReportOptions` interface (which `app/(tabs)/settings.tsx:166`
  already passes as an object) rather than inserting a new positional parameter mid-list, which
  would have broken every existing call site and golden fixture.
- **Mobile UX / friction — approve-with-changes.** _Must-fix (applied):_ an always-visible
  multi-line text area above the export screen's primary action would add weight and push the
  "Export PDF" button down on every visit for a field most exports won't use — replaced with the
  same collapsed-behind-a-tap pattern `app/checkin.tsx`'s existing evening notes field already
  uses, so the common one-tap export flow is unchanged. _Noted (batch-level, not specific to this
  doc):_ the export screen is accumulating optional fields/buttons across this round (30, 35, 42,
  44, 45) — worth a consolidating "Advanced export options" grouping if several land together,
  not a blocker on any single doc.
- **Data-model / migration + privacy + scope — approve.** Confirmed the "never persisted beyond
  the single export" claim holds against the real code: the note lives in ephemeral `useState` on
  the export screen, that screen's own load hook (`useFocusLoad`) is read-only, and nothing in
  this app autosaves Settings-screen component state — as long as the note stays off `Profile`
  (which the Alternatives section already rejects), the claim is enforceable, not just asserted.
  Back-compat is airtight: byte-identical output when the field is absent means every existing
  call site and golden fixture stays green with no fixture churn. No must-fix.
