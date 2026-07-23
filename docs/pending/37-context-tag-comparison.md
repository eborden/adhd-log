> **Status:** Proposed (2026-07-23) · **Priority:** P2 · Ref: innovation batch, round 4 ·
> **Hard dependency: extends pending doc 07's `contextTags`
> ([`07-confounder-context-tags.md`](07-confounder-context-tags.md))** ·
> **Narrowed from an earlier draft after clinical-lens review — see Panel review**

# Confounder-tag day marker

## Problem / Context

Doc 07 adds one-tap context tags (`poorSleep`, `sick`, `stressfulDay`, `traveled`, `alcohol`,
`extraCaffeine`) to the evening check-in and renders them in the report's daily log — a purely
descriptive record of "this day had a known confounder." Doc 07's own "Alternatives considered"
section names, as a deferred low-risk follow-on, exactly the gap this doc fills: "a subtle dot
row under the trend bars marking tagged days would help visually... low-risk follow-up: a
monochrome marker row analogous to `doseChangeMarkers`." This doc builds exactly that follow-on
— and, per a clinical review of an earlier, broader draft (see Panel review), **only** that
follow-on: a visual marker for which days carry a tag, nothing that aggregates ratings by tag.

**What this doc does NOT do, stated up front because an earlier draft did exactly this and it
was flagged as a real problem, not a wording issue:** it does not partition logged days into
"tagged" vs. "untagged" and compute or display a mean for each side. That is structurally the
elementary form of a correlation claim — doc 07's own Non-goals explicitly forbid exactly that
("no correlation, no risk flag, no adherence scoring") — and, separately, the tag and the rating
it would be compared against come from the same person on the same evening, so any observed gap
between the two means can't be told apart from "a hard day produced both a low rating and a
tag" — no amount of disclaiming copy resolves that shared-source coupling, because it's a
structural property of self-report data, not a framing choice. This doc's actual contribution
below avoids the whole problem: a day either carries a tag or it doesn't, shown as a bare visual
fact, with no rating attached to either side of anything.

## Goals / Non-goals

**Goals**

1. The monochrome marker row doc 07 itself named: a `contextTagMarkers` row on Trends, analogous
   to the existing `doseChangeMarkers`, showing which days carry **at least one** context tag —
   presence only, no rating value attached.
2. Zero new statistics, zero new persisted state — a pure derive over doc 07's `contextTags`
   field once it lands, exactly like the marker doc 07 already sketched.

**Non-goals**

- **No mean comparison, no partitioning by tag presence, in any form.** See Problem/Context —
  this was in an earlier draft of this doc and was removed after review, not merely reworded.
  Any future doc that wants to revisit an aggregated tag-based comparison needs its own review
  against the two structural problems named above (a correlation-shaped claim, and shared-source
  coupling), not a reuse of this doc's marker.
- **No per-tag distinction in the marker itself.** One dot means "this day has at least one tag"
  — which specific tag(s) is available in the report's existing Context column (doc 07), not
  re-encoded into the marker's color or shape. A per-tag-colored marker row would start
  reintroducing the same "does this visual difference imply something" risk this doc exists to
  avoid.
- **No new persisted state.** The only input (`contextTags`) already exists once doc 07 lands;
  this doc is a pure derive, same posture as doc 29's marker-row precedent.

## Core logic (`lib/storage.ts`, alongside `doseChangeMarkers`)

```ts
/** Which of `dates` should render a context-tag marker — presence of any tag, no rating involved. */
export function contextTagMarkers(
  entries: Readonly<Record<IsoDate, DayEntry>>,
  dates: readonly IsoDate[],
): ReadonlySet<IsoDate> {
  return new Set(dates.filter((date) => (entries[date]?.evening?.contextTags ?? []).length > 0));
}
```

Mirrors `doseChangeMarkers`'s `ReadonlySet<IsoDate>` return shape, but — as the strict-TS lens
caught in the earlier draft — its **input** is necessarily different: `doseChangeMarkers(doses:
readonly DoseChange[], dates)` reads a dose list, while a tag marker needs the full `entries`
map (tags live on `EveningCheckin`, not on any separate list). This is a new function with a
signature suited to its actual input, not a drop-in reuse of `doseChangeMarkers`'s signature.

## In-app Trends (`app/(tabs)/trends.tsx`)

A `contextTagMarkers` row below the existing dose-change `markersRow`, in its own row —
distinguished from it (per this batch's doc 25 must-fix precedent: two marker meanings never
share one row) rather than merged into it. Renders nothing when no day in range has any tag.
That is the entire feature: no expandable section, no numbers, no comparison of any kind.

## Report

**None.** The report already renders context tags in doc 07's Context column, day by day —
that is already the complete, non-aggregated record of which days carry which tags. This doc's
marker is an in-app Trends convenience only; it adds nothing to the report that doc 07 doesn't
already show.

## Test plan (`lib/__tests__/storage.test.ts`)

1. `contextTagMarkers` — a date with `contextTags: ['poorSleep']` is included; a date with an
   empty `contextTags` array is excluded; a date with no evening check-in at all is excluded; a
   date outside the given `dates` list is never returned even if it has tags (the function
   respects the caller's range, matching `doseChangeMarkers`'s own contract).

## Gate compliance

No `any`/`!`/`@ts-*`/eslint-disable. No new persisted type — pure derive over doc 07's
`contextTags` field once it lands. `npm run check` must pass before commit.

## Dependencies & sequencing

**Hard dependency on doc 07**: `EveningCheckin.contextTags` doesn't exist without it. Land after
doc 07. Independent of every other doc in this batch and prior rounds.

## Alternatives considered

- **The original two-bucket mean comparison:** removed after clinical review — see Panel review
  for the full reasoning. Not rejected outright by the panel (it was scored approve-with-changes,
  one severity level short of doc 40's reject in this same round for a structurally similar
  issue), but the safer resolution the clinical lens itself offered — ship the marker alone — is
  the one this doc takes, for consistency with how doc 40's more severe version of the same
  underlying problem was resolved in this round.
- **Color- or shape-coding the marker by which tag is present:** rejected — see Non-goals; adds
  back a version of the same "does this visual distinction mean something" risk in miniature.
- **Folding this marker into the existing dose-change `markersRow` instead of a separate row:**
  rejected — doc 25's own must-fix in this batch already established that two different marker
  meanings sharing one row risks illegibility and ambiguity about which event a dot represents.

## Panel review

Run through the 4-lens panel (2026-07-23) on the earlier, broader draft (marker row + a
two-bucket mean comparison per tag); the comparison half has been removed from this doc in
response, leaving only the marker:

- **Clinical — approve-with-changes on the original draft, requiring this narrowing.** The
  marker row alone was approved unconditionally ("I'd approve that unconditionally... matches
  doc 07's own named low-risk follow-on"). The two-bucket comparison was flagged as a real
  problem, not a copy issue: "partitioning an outcome by a factor and displaying the gap _is_ an
  association claim regardless of the words around it," and doc 07's Non-goals explicitly forbid
  exactly that ("no correlation, no risk flag, no adherence scoring"). A second, independent
  issue: the tag and the rating share a source (same person, same evening), so the comparison
  "cannot distinguish 'the confounder depressed the rating' from 'a bad day got both a low
  number and a tag.'" The lens's own stated fallback — "the safer resolution is to ship the
  marker row alone and drop the aggregated comparison" — is the resolution this doc adopts.
- **Strict-TypeScript architect — approve-with-changes on the original draft; now resolved by
  the narrowing.** Confirmed `contextTagMarkers`'s signature must differ from
  `doseChangeMarkers`'s (different input shape — applied above) and flagged that the rendering
  gate for the (now-removed) comparison referenced a module-private `MIN_HALF_SAMPLES`
  unreachable from Trends/report code; that concern is moot now that there is no comparison to
  gate. Also flagged a phantom `BeforeAfter` type citation in the removed section, likewise moot.
- **Mobile UX / friction — no verdict received.** The UX lens agent did not deliver findings for
  this round despite three explicit re-requests (a recurring pattern already noted in this
  project's memory). Not treated as blocking: the narrowed doc has no UI surface beyond a single
  marker row, materially smaller than what any UX concern in this batch has been raised against.
- **Data-model / migration + privacy + scope — approve on the original draft, unaffected by the
  narrowing.** Confirmed no new persisted type, correct refuse-to-build-without-doc-07 behavior.
  The narrowing only removes computation and display; the storage/scope posture was already
  sound and stays sound.
