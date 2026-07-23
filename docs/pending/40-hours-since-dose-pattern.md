> **Status:** Proposed (2026-07-23) · **Priority:** P2 · Ref: innovation batch, round 4 ·
> **Hard dependency: extends this batch's pending doc 25's `MomentLog`
> ([`25-intraday-moment-log.md`](25-intraday-moment-log.md))** ·
> **Substantially reworked after a clinical-lens reject on the original design — see Panel review**

# Hours-since-dose moment annotation

## Problem / Context

Doc 25 adds `MomentLog` — an episodic, timestamped feeling capture for symptom spikes that fade
before the evening check-in. Its own Non-goals deliberately deferred one specific analysis: "No
auto-comparison of moment timing against `MorningCheckin.doseTaken`/time... explicitly deferred
as a named follow-on." This doc is that named follow-on — narrowly. Knowing how long ago a dose
was taken when a moment was logged is useful context for reading that one moment (a patient or
provider reading "logged 4.5h after that day's dose" learns something concrete about the
circumstance of that specific entry); the original draft of this doc went further and tried to
turn that context into an aggregated statistic, which a clinical review caught as a real problem
(see Panel review) and this doc has been reworked to avoid.

**What this doc does NOT do, stated up front because an earlier draft did exactly this and it
was rejected:** it does not bucket moments by elapsed time and average `feeling` within each
bucket. Two independent problems make that unsound for this app specifically: (1) doc 25's
`MomentLog` is a **self-selected sample** — a patient logs a moment because something felt
notably off, not as a representative sample of how they felt throughout the day, so a per-bucket
mean is an artifact of _when spikes happened to be logged_, not a measurement of how the patient
felt at that elapsed time; and (2) bucketing by elapsed-time-since-dose is itself an onset/peak/
offset framing — exactly the intraday dose-response curve this app's own founding premise says
does **not** apply to its target medication class (`docs/PLANNING-v0.md`: "effects accumulate
over weeks — the useful signal is the trend, not a single day"). No amount of disclaiming copy
neutralizes either problem, because both are structural properties of the data and the axis, not
a framing choice. This doc's real, narrower contribution below avoids both: it never averages
across moments, and it never presents a bucketed curve — one moment, one annotation, no
aggregation.

## Goals / Non-goals

**Goals**

1. A pure function computing the elapsed hours between a single `MomentLog` and that day's
   morning dose (only when a dose was actually taken — see Non-goals), returning a plain number
   or `undefined` when there's no valid anchor.
2. Render that elapsed-time fact **per moment**, wherever a moment is already shown (the report's
   Moments section from doc 25, and this batch's doc 29 timeline if it lands) — a contextual
   annotation on an individual record, never a computed statistic across records.
3. No new UI section, no new Trends surface — this doc adds one fact to an existing display, not
   a new place to look.

**Non-goals**

- **No aggregation, ever.** No mean, no bucket, no "moments tend to cluster around N hours" —
  see Problem/Context. If a future doc wants to revisit aggregation, it needs its own review
  against the two structural problems named above, not a reuse of this doc's per-moment fact.
- **No causal or pharmacokinetic claim.** "Logged 4.5h after that day's dose" is a bare elapsed-
  time fact about one record, stated the same way a timestamp already is — never framed as
  proximity to an onset/peak/offset window.
- **Only moments with a valid dose-taken anchor show the annotation.** A moment on a day with no
  morning check-in, or a `doseTaken: false` day, renders with no elapsed-time annotation at all
  — never a placeholder implying "no dose" is itself a meaningful data point for this fact.
- **No per-moment side-effect timing breakdown.** This doc adds one fact (elapsed hours) to the
  existing moment display; it does not restructure how `sideEffect`/`feeling` are shown.

## Core logic (`lib/moment-timing.ts`, new, RN-free)

```ts
/**
 * Elapsed hours between a moment and that day's morning dose, or undefined when there's no
 * valid anchor (no morning check-in that day, or a dose that wasn't taken) or the moment
 * predates the dose (an out-of-order same-day entry). A single scalar per moment — never
 * aggregated across moments; see Problem/Context for why aggregation was removed from this doc.
 */
export function hoursSinceDose(
  moment: MomentLog,
  entries: Readonly<Record<IsoDate, DayEntry>>,
): number | undefined {
  const date = formatIsoDate(new Date(moment.timestamp));
  const morning = entries[date]?.morning;
  if (morning === undefined || !morning.doseTaken) return undefined;
  const hoursElapsed =
    (new Date(moment.timestamp).getTime() - new Date(morning.completedAt).getTime()) /
    (60 * 60 * 1000);
  return hoursElapsed >= 0 ? hoursElapsed : undefined;
}
```

`formatIsoDate` is the existing, landed guard-and-throw helper — used here only to look up that
day's `DayEntry`, not for any duration arithmetic. The elapsed-hours calculation is a raw
timestamp difference between two absolute instants, immune to the calendar-day DST pitfall doc
35 had to fix — a duration between two `Date` instants needs no day-walking at all.

## Report / display (`lib/report-html.ts`, and doc 29's timeline if it lands)

Wherever a `MomentLog` already renders (doc 25's report Moments section today; doc 29's
chronological timeline if/when both land), append one optional clause when `hoursSinceDose`
returns a number: _"(4.5h after that day's dose)"_ — plain text, no styling distinct from the
rest of the row, no color, no visual emphasis that would make it read as more significant than
the timestamp it sits beside. Absent entirely when `hoursSinceDose` returns `undefined` — no
placeholder, no "no dose data" note cluttering a moment that simply doesn't have a valid anchor.

## Test plan (`lib/__tests__/moment-timing.test.ts`)

1. `hoursSinceDose` — a moment on a `doseTaken: true` day returns the correct elapsed hours; a
   moment on a `doseTaken: false` day returns `undefined`; a moment with no morning check-in
   that day returns `undefined`; a moment timestamped before that day's `completedAt` returns
   `undefined` rather than a negative number.
2. **No DST sensitivity** — a fixture straddling a DST transition still returns the correct
   elapsed hours, since the calculation is a raw timestamp difference rather than a calendar-day
   walk (the same contrast test the original draft specified, still valid for this narrower
   function).
3. **Report render** — the annotation clause appears only when `hoursSinceDose` is defined;
   absent entirely otherwise; no aggregation of any kind is computed or asserted anywhere in this
   suite (a structural test that the feature stayed narrow).

## Gate compliance

No `any`/`!`/`@ts-*`/eslint-disable. No new persisted type — pure derive over doc 25's
`MomentLog` and existing `DayEntry`/`MorningCheckin` fields. `npm run check` must pass before
commit.

## Dependencies & sequencing

**Hard dependency on doc 25**: `MomentLog` doesn't exist without it. Land after doc 25.
Read naturally alongside doc 29's timeline (both render individual dated/timestamped events) but
shares no code with it.

## Alternatives considered

- **The original bucketed-mean design:** rejected by the clinical lens and removed from this
  doc — see Panel review for the full reasoning (self-selection bias in the sample, and an
  onset/peak/offset framing this app's medication class doesn't support).
- **Bucketing by clock time-of-day instead of elapsed-since-dose:** moot once aggregation was
  removed — there is no bucket of any kind in the current design.
- **Showing elapsed time only when it falls within some "notable" window (e.g. flagging moments
  logged unusually soon after a dose):** rejected — any threshold here would be exactly the kind
  of app-computed significance judgment this doc's Non-goals rule out; the fact is shown for
  every valid moment identically, with no distinction drawn between them.

## Panel review

Run through the 4-lens panel (2026-07-23): the **original bucketed-mean design was rejected by
the clinical lens** and has been substantially reworked into the narrower per-moment annotation
above, which the same lens's own suggested alternative describes almost verbatim. Re-review of
the reworked design against the panel's stated concerns (not a formal re-run of all four lenses,
since the design changed in response to the reject rather than needing a fresh independent pass
on an unrelated point):

- **Clinical — the original reject, and why the rework resolves it.** The original design
  bucketed `feeling` by elapsed-time-since-dose and averaged within each bucket. Verdict:
  **reject**, for two structural reasons neither disclaiming copy nor a sample-size floor could
  fix: (1) `MomentLog` is a self-selected sample of symptom _spikes_, not a representative
  sampling of feeling across the day, so a per-bucket mean measures "how the spikes that
  happened to be logged in this window felt," not "how you feel at this elapsed time" — handing
  that number to a prescriber, arranged against a dose-timing axis, is affirmatively misleading
  regardless of framing; (2) bucketing by elapsed-time-since-dose is itself an onset/peak/offset
  framing, and this app's whole founding premise for its target (non-stimulant) medication class
  is that intraday timing is _not_ the clinically meaningful signal — unlike doc 28's weekday
  buckets, which carry no pharmacological meaning, a time-since-dose axis carries that meaning
  intrinsically, so the precedent transfer from doc 28's "descriptive-only" defense doesn't hold
  here. The lens's own suggested alternative: "a raw chronological display of individual moments
  relative to dose time... stays in doc 25's episodic-record spirit" — which is exactly what
  this reworked doc now is: one fact, per moment, never averaged, never bucketed.
- **Strict-TypeScript architect — approve (on the original design; the rework is simpler and
  raises no new concerns).** The original design's sketch didn't compile (a `metricAverage`
  signature mismatch the doc itself flagged) and the panel supplied a concrete, compiling
  resolution — a new `averageOfRatings(values: readonly Rating[]): MetricAverage` sibling to
  `metricAverage`, plus a corrected, fully-narrowed bucketing loop. That code is now moot: the
  reworked `hoursSinceDose` returns a single `number | undefined` per moment with no averaging,
  no `Map`, no bucket-finding — a materially simpler function with no comparable signature risk.
- **Mobile UX / friction — no verdict received.** The UX lens agent did not deliver findings for
  this round despite three explicit re-requests (a recurring pattern already noted in this
  project's memory). Not treated as blocking: the rework in response to the clinical reject
  removed the only UI surface (a new collapsed Trends section + report table) the other lenses'
  UX-adjacent concerns would have applied to — the reworked doc adds a single inline text clause
  to an existing display, with no new screen real estate to review.
- **Data-model / migration + privacy + scope — approve (unaffected by the rework).** Confirmed
  independently: no new persisted type, no `Backup` change, correctly refuses to build without
  doc 25's `MomentLog`. The rework changes only what is computed and shown, not the storage/
  scope posture, which was already sound.
