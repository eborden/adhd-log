> **Status:** Proposed (2026-07-23) · **Priority:** P2 · Ref: innovation batch, round 2 ·
> **Dependency on doc 11, precisely stated (panel correction): `lib/timeline.ts` needs doc 11's
> `Visit` type declared in `lib/types.ts` to compile at all — sequence this doc's build after doc
> 11's types land. Its runtime/rendering behavior is what degrades gracefully: the `visits`
> parameter is optional, so the timeline works with just dose changes + side-effect onsets
> whenever no visits are passed. "Soft dependency" in an earlier draft conflated these two and
> is corrected here — see [`11-visit-anchoring.md`](11-visit-anchoring.md).**

# Unified titration timeline

## Problem / Context

Three kinds of dated event now exist in this app's data, each rendered in its own place with no
shared view: `DoseChange` (the dose timeline, in the report and as Trends markers),
`firstOnsetDates` (side-effect first-appearance, landed, rendered only inside the report's
side-effect table), and — once doc 11 lands — `Visit` (appointment dates). A reader trying to
answer "what was going on around when this side effect started?" today has to cross-reference
two or three separate lists by eye. The data to answer that already exists; there is simply no
single place it is laid out on one shared timeline.

This doc adds no new persisted data. It is a pure synthesis view — one horizontal timeline, both
in-app and in the report, interleaving dose changes, visits (when present), and side-effect
onsets, each a plain dated fact rendered next to the others with no causal language connecting
them (the same "bare juxtaposition" discipline doc 24 establishes for its dose-change/visit
connecting line).

## Goals / Non-goals

**Goals**

1. A pure function assembling a chronological `TimelineEvent[]` from already-loaded
   `DoseChange[]`, optionally `Visit[]`, and `firstOnsetDates` — a derived view, never a new
   store.
2. An in-app strip on `app/(tabs)/trends.tsx`, above the per-metric bars, showing the same date
   range's events as small labeled ticks.
3. A report section listing the same events chronologically, replacing (not duplicating) the
   existing bare dose-change list with a richer superset.
4. **Graceful degradation without doc 11.** If `Visit` doesn't exist yet (doc 11 not landed),
   the timeline still works with just dose changes + side-effect onsets — this doc does not hard-
   block on doc 11 the way doc 24 does, since a timeline missing one event type is still useful,
   unlike a `Visit.decision` field with nothing to attach to.

**Non-goals**

- **No new persisted type.** `TimelineEvent` is assembled at render time from data that already
  exists; nothing about it is stored.
- **No causal connections drawn between events.** Two events sharing a date (or near dates) are
  listed adjacently, never phrased as "because of" or "leading to" — the exact discipline doc
  24's connecting line already established for dose-change/visit proximity, applied here across
  three event kinds instead of two.
- **No new event kinds beyond these three for v1.** Doc 25's moments and doc 17's measurements
  are deliberately not folded in here — each already has its own display surface, and a first
  version of a unified timeline should prove the concept with the three longest-standing event
  types before absorbing more. A follow-on could widen it.
- **No filtering/search UI.** The timeline shows every event in the selected range; no per-kind
  toggle, no "show only visits" filter — keeping the surface small for v1.

## Core logic (`lib/timeline.ts`, new, RN-free)

```ts
export type TimelineEvent =
  | {
      readonly kind: 'doseChange';
      readonly date: IsoDate;
      readonly dose: Dose;
      readonly note?: string;
    }
  | { readonly kind: 'visit'; readonly date: IsoDate; readonly note?: string }
  | { readonly kind: 'sideEffectOnset'; readonly date: IsoDate; readonly effect: SideEffect };

/**
 * Assembles a chronological timeline from data the app already holds. `visits` is optional so
 * this works identically before and after doc 11 lands — an absent `visits` list simply omits
 * that event kind rather than requiring a caller-side branch.
 */
export function buildTimeline(
  doses: readonly DoseChange[],
  onset: ReadonlyMap<SideEffect, IsoDate>,
  rangeStart: IsoDate,
  rangeEnd: IsoDate,
  visits?: readonly Visit[],
): readonly TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const change of doses) {
    if (change.date >= rangeStart && change.date <= rangeEnd) {
      events.push({
        kind: 'doseChange',
        date: change.date,
        dose: change.dose,
        ...(change.note !== undefined ? { note: change.note } : {}),
      });
    }
  }
  for (const visit of visits ?? []) {
    if (visit.date >= rangeStart && visit.date <= rangeEnd) {
      events.push({
        kind: 'visit',
        date: visit.date,
        ...(visit.note !== undefined ? { note: visit.note } : {}),
      });
    }
  }
  for (const [effect, date] of onset) {
    if (date >= rangeStart && date <= rangeEnd) {
      events.push({ kind: 'sideEffectOnset', date, effect });
    }
  }
  return events.sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    return dateCompare !== 0 ? dateCompare : KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  });
}

// Explicit tiebreaker for same-date events (panel — TS lens must-fix): `Array.prototype.sort`
// is stable, so relying on push-order alone is an implicit, fragile contract — the loop above
// pushes doseChange, then visit, then sideEffectOnset, which does NOT match this doc's own test
// plan ("doseChange before sideEffectOnset before visit on a tie"). A named ranking makes the
// order an explicit, tested decision instead of an accident of insertion order.
const KIND_ORDER: Readonly<Record<TimelineEvent['kind'], number>> = {
  doseChange: 0,
  sideEffectOnset: 1,
  visit: 2,
};
```

`onset` is the existing `firstOnsetDates(entries)` (`lib/storage.ts:330-346`, landed) passed
straight through — this doc adds no new onset computation. `Visit` is imported as a type-only
dependency (`import type { Visit } from './types'`) — this compiles once doc 11 has declared
`Visit` in `lib/types.ts` (a type-only import needs only the declaration to exist, not a runtime
module), which is exactly the sequencing dependency stated in this doc's header. Once compiled,
the function's **runtime** behavior is source-independent of whether any visits are ever passed:
callers simply omit the `visits` argument and get a timeline of just dose changes + side-effect
onsets.

## In-app Trends (`app/(tabs)/trends.tsx`)

A collapsed-by-default "Timeline" strip **placed once, above all per-metric blocks** (a single
thin header row when collapsed — panel-checked: the first metric's bars must still be visible
near the top of a typical phone viewport, not pushed down by a tall collapsed element). When
expanded: one row of small ticks along the same date axis the bars already use, colored/shaped
distinctly per `kind`. **Discrete ticks, no connecting marks (panel — clinical lens guardrail):**
events render as independent ticks with no connecting lines, arrows, or brackets linking adjacent
ones — unlike doc 24's connecting line, which is a deliberate, singular exception scoped to
dose-change/visit proximity in the decision log. A general timeline juxtaposing three kinds of
event must stay visually inert between them, or proximity alone starts to read as causation.
Renders nothing when `buildTimeline` returns an empty array.

**Reconciled with the existing dose-change markers (panel — UX lens must-fix).** `DoseChange`
dates already render as dots in each metric's own `markersRow` (`app/(tabs)/trends.tsx:300-308`).
Adding a second, differently-styled dose-change tick on this new strip would show the same event
in two visual languages on the same screen. Resolution: **this Timeline strip becomes Trends'
single place dose-change events render**, once it ships — the per-metric `markersRow` dose-change
dot is removed at the same time this doc lands, so a dose change appears exactly once on the
screen (on the shared Timeline strip, visible regardless of which metric block a reader is
looking at) rather than once per metric block **and** once more on the new strip. This is a
real, scoped edit to already-shipped `trends.tsx` rendering — called out explicitly here and in
Dependencies, not hidden inside "pure additive synthesis" framing.

## Report (`lib/report-html.ts`)

**Replaces the existing bare dose-change list, does not duplicate it.** The report currently
renders dose changes as their own list; this doc widens that into one chronological "Timeline"
list carrying all three event kinds, each rendered via an exhaustive `switch (event.kind)` →
`assertNever` so a fourth kind (should one ever be added) fails to compile until every render
site handles it. Every string (`note`, effect label) runs through the existing `escapeHtml`.
Because this replaces existing report output, golden fixtures (`lib/__fixtures__/reports/*.html`)
must be regenerated via `vitest -u` and the change reviewed in the rendered output — a
report-rendering change, per `CLAUDE.md`'s "UI changes aren't done until screenshotted" rule.

## Test plan (`lib/__tests__/timeline.test.ts`)

1. `buildTimeline` — merges and sorts all three kinds correctly; filters strictly to the given
   range on all three; omits `visit` events entirely when `visits` is not passed (not an empty
   array vs. `undefined` distinction bug — both produce zero visit events); two events on the
   same date resolve via the explicit `KIND_ORDER` tiebreaker — `doseChange` before
   `sideEffectOnset` before `visit` on a tie — asserted directly against a same-date fixture
   rather than relying on `Array.prototype.sort`'s stability/insertion order (which would not,
   on its own, produce this order given the loop's dose→visit→onset push sequence).
2. **Report render** — exhaustive `switch` compiles with an `assertNever` default; a `note`
   containing `<`/`&` renders escaped.

## Gate compliance

No `any`/`!`/`@ts-*`/eslint-disable. `TimelineEvent` is a discriminated union on `kind`; the
report's render `switch` ends in `assertNever`, so this doc introduces one new exhaustiveness
obligation (matching doc 11's own note about its `ReportRange` anchor `switch`). `Visit` is
imported type-only, which requires doc 11's declaration of `Visit` in `lib/types.ts` to exist for
`lib/timeline.ts` to compile at all (a type-only import needs the type declared, not a runtime
module present) — this is a real, stated compile-time dependency on doc 11's types having landed
as source, not something that "compiles standalone" regardless of sequencing (corrected from an
earlier draft's claim — see the header and Dependencies, below). No persisted state — pure
derive. `npm run check` must pass before commit.

## Dependencies & sequencing

**Precisely stated dependency on doc 11 (panel correction — an earlier draft's "soft, not hard"
framing conflated two different things).** `lib/timeline.ts` cannot compile until doc 11 has
declared `Visit` in `lib/types.ts` — sequence this doc's implementation after that landing, full
stop, at the source level. What genuinely is flexible is the **runtime** integration: build
`lib/timeline.ts` and the report/Trends wiring with `visits` as an optional parameter from the
start, so once doc 11's type exists, callers can pass a real `Visit[]` (or keep omitting it,
functioning identically to before doc 11 landed) with no rework either direction. Independent of
every other doc in this round and the prior one. Naturally complements doc 24 (which needs
`Visit` to exist) and doc 27 (which also reuses
`firstOnsetDates`) without sharing code with either.

## Alternatives considered

- **A persisted, cached timeline for performance:** rejected — the merge is a handful of small
  arrays sorted once per render; no caching is needed at this data volume (matching this app's
  existing "no charting library, ~1 entry/day" scale assumption from `docs/PLANNING-v0.md`).
- **Folding doc 25's moments and doc 17's measurements in immediately:** rejected for v1 — see
  Non-goals; keeping the first version to three event kinds makes it reviewable and lets a
  follow-on widen the union deliberately once the pattern is proven.
- **A zoomable/pannable timeline widget:** rejected as unnecessary complexity — a simple
  chronological list (report) and a static tick strip bounded to the selected range (in-app) are
  legible without any interaction model beyond what Trends' range selector already provides.

## Panel review

Run through the 4-lens panel (2026-07-23): approve (clinical), approve-with-changes (strict-TS,
UX, scope). Must-fixes applied above.

- **Clinical — approve.** The exhaustive `switch` → `assertNever` render pattern and the explicit
  "no causal connections" Non-goal reusing doc 24's bare-juxtaposition precedent were confirmed
  sound. _Guardrail added, not a strict must-fix but incorporated:_ ticks must render as
  independent marks with no connecting lines/arrows/brackets between them — proximity alone on a
  three-kind timeline can imply causation to a lay reader more readily than doc 24's single,
  deliberate connecting line, so this doc stays purely juxtapositional with zero visual linking.
- **Strict-TypeScript architect — approve-with-changes.** _Must-fix (applied):_ `buildTimeline`'s
  sort relied on `Array.prototype.sort`'s stability plus the loop's push order (dose→visit→onset)
  to produce a tie order, but that push order does not match this doc's own test-plan-documented
  tie order (doseChange→sideEffectOnset→visit) — added an explicit `KIND_ORDER` tiebreaker so the
  order is a named, tested decision rather than an accident of insertion order. Confirmed the
  `TimelineEvent` union, the `Dose`/`SideEffect` field types, and the conditional `note` spread
  under `exactOptionalPropertyTypes` are all correct against the real types.
- **Mobile UX / friction — approve-with-changes.** _Must-fixes (applied):_ reconciled the new
  Timeline strip with the existing per-metric `markersRow` dose-change dots — rather than showing
  the same dose change in two visual languages, the Timeline strip becomes Trends' single place
  dose-change events render, and the redundant per-metric dot is removed at the same time,
  explicitly called out as a real (if small) edit to shipped `trends.tsx` code, not hidden inside
  "pure additive" framing; confirmed the collapsed strip is a single thin row so the first
  metric's bars stay visible near the top of a typical viewport.
- **Data-model / migration + privacy + scope — approve-with-changes.** _Must-fix (applied):_ the
  "compiles standalone / soft dependency" framing was internally contradictory — a type-only
  import of `Visit` still requires doc 11 to have declared that type before `lib/timeline.ts` can
  compile, which is a real, stated compile-time dependency, not a soft one; corrected throughout
  (header, core logic, Gate compliance, Dependencies) to separate the hard compile-time
  requirement from the genuinely flexible runtime behavior (`visits` staying optional). Confirmed
  no new persisted type and added the golden-fixture-regeneration note for the report change,
  which replaces existing rendered output.
