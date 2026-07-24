> **Status:** Proposed (2026-07-23) · **Priority:** P2 · Ref: innovation batch, round 2 ·
> **Hard dependency: reuses pending doc 11's `Visit`/`ReportRange`/`sinceLastVisitRange`
> ([`11-visit-anchoring.md`](11-visit-anchoring.md)) — none of those symbols exist yet, so this
> doc has no type to compile against and no UI surface (doc 11's Visits section) without it**

# Pre-visit "what's changed" digest

## Problem / Context

Doc 11 gives the app a concept of an appointment (`Visit`), a "since last visit" report range,
and a one-off reminder to export the PDF report a couple of days out. That solves getting the
_data_ to the visit. It does not solve the much smaller, much more common failure: walking into
the room and forgetting what's actually happened since last time — a new side effect that showed
up three weeks ago and is easy to forget in the moment, a stretch of missed doses, a dose change
already logged and half-forgotten. The full PDF report (doc 06, landed) is the artifact for the
_provider_ to read; nothing today gives the _patient_ a fast, low-effort way to re-orient
themselves in the 30 seconds before that door opens.

This doc adds a small, purely mechanical "what's changed since your last visit" digest —
bullet-point facts, zero scoring, reusing data and helpers that already exist. It complements
doc 24 (the post-visit decision log) as its pre-visit counterpart: 24 records what the provider
decided _after_ the appointment; this doc helps the patient remember what to bring up _before_
it.

## Goals / Non-goals

**Goals**

1. A pure function that compiles a small set of mechanical facts over doc 11's
   `sinceLastVisitRange` window: new side effects, a dose-change count, an adherence tally, and a
   weekly-impression tally — every one of these already computed elsewhere in the app for other
   purposes, just not collected into one place.
2. Surface it passively next to an **upcoming** (future-dated) visit in Settings' Visits section
   (doc 11) — available to open, never pushed as a second notification alongside doc 11's
   existing export reminder.
3. Zero new persisted state — a read-time derive over `entries`, `doses`, `weekly`, and
   `visits`, all already loaded elsewhere in the app.

**Non-goals**

- **Not a replacement for the PDF report.** The report stays the artifact handed to the
  provider; this digest is a patient-facing self-orientation aid, shorter and framed
  differently, and is never exported or shared as-is.
- **No scoring, no trend verdict.** "3 new side effects logged" is a count, not a verdict; no
  "you're doing better/worse since last time" language anywhere in this surface.
- **No second reminder/notification.** Doc 11 already owns the one pre-visit nudge
  (export-your-report); this doc adds no new `expo-notifications` trigger, no new permission
  ask — it's a passive, tap-to-open view, not a push.
- **No interpretation of _why_ something changed.** A new side effect and a dose change in the
  same window are listed side by side, never connected with "because."

## Core logic (`lib/pre-visit-digest.ts`, new, RN-free)

```ts
export interface PreVisitDigest {
  readonly rangeStart: IsoDate;
  readonly rangeEnd: IsoDate;
  readonly newSideEffects: readonly SideEffect[]; // first onset falls inside the range
  readonly doseChangeCount: number;
  readonly adherence: { readonly taken: number; readonly logged: number }; // from adherenceInWindow
  readonly weeklyImpressionCounts: Readonly<Record<WeeklyImpression, number>>;
}

/**
 * Compiles the since-last-visit digest from data the app already holds. Every field is a
 * straight count or list — no derived judgment. Returns `undefined` when the range has no data
 * to summarize (nothing logged yet since the last visit), so the UI can render nothing rather
 * than an empty-looking card.
 */
export function buildPreVisitDigest(
  range: ReportRange, // from doc 11's sinceLastVisitRange
  entries: Readonly<Record<IsoDate, DayEntry>>,
  doses: readonly DoseChange[],
  weekly: Readonly<Record<IsoDate, WeeklyCheckin>>,
): PreVisitDigest | undefined {
  const rows = rowsInRange(entries, datesInRange(range.range.start, range.range.end));
  if (rows.every((row) => row.morning === undefined && row.evening === undefined)) {
    return undefined;
  }
  const onsetBeforeRange = firstOnsetDates(
    // onset computed over the FULL log, then filtered — "new" means first-ever, not
    // first-in-this-window, so a side effect that reappears after fading isn't miscounted as new.
    entries,
  );
  const newSideEffects = SIDE_EFFECTS.filter((effect) => {
    const onset = onsetBeforeRange.get(effect);
    return onset !== undefined && onset >= range.range.start && onset <= range.range.end;
  });
  const doseChangeCount = doses.filter(
    (d) => d.date >= range.range.start && d.date <= range.range.end,
  ).length;
  const adherence = adherenceInWindow(rows); // lib/report-metrics.ts, landed — reused, not reimplemented
  const weeklyImpressionCounts = tallyWeeklyImpressions(weekly, range.range);
  return {
    rangeStart: range.range.start,
    rangeEnd: range.range.end,
    newSideEffects,
    doseChangeCount,
    adherence,
    weeklyImpressionCounts,
  };
}
```

`tallyWeeklyImpressions` is a small new pure helper (filter `weekly`'s keys into the range,
count by `.overall`) — the only genuinely new counting logic in this doc; everything else
(`adherenceInWindow`, `firstOnsetDates`, `rowsInRange`, `datesInRange`) is an existing, landed
export reused as-is.

## UI (`app/(tabs)/settings.tsx`, Visits section from doc 11)

Each **future**-dated visit row gets a small "What's changed since last time?" link (visible
only when `buildPreVisitDigest` returns a non-`undefined` result — i.e., there's something to
show). Tapping it expands an inline, read-only card:

> Since your last visit (Jul 1–Jul 21):
>
> - New side effects: dizziness
> - Dose changes logged: 1
> - Doses taken: 18 of 21 mornings logged
> - Weekly check-ins: 2 same, 1 better

No edit affordance, no dismiss state — it's a passive lookup, collapsible the same way it
expanded, never persisted as "seen."

## Report

**None.** This digest is deliberately not mirrored into `buildReportHtml` — the report already
covers every one of these facts in more depth (side-effect onset table, dose timeline,
adherence block, weekly timeline), and duplicating a compressed version of the same data into
the PDF would be redundant, not additive. This digest exists only as a faster, patient-facing
substitute for re-reading the whole report before a visit.

## Test plan (`lib/__tests__/pre-visit-digest.test.ts`)

1. `buildPreVisitDigest` — returns `undefined` when the range has no logged data at all; a side
   effect first seen before the range is excluded from `newSideEffects` even if still ongoing
   inside it; a side effect first seen inside the range is included; dose-change count matches a
   manually-constructed fixture; adherence matches `adherenceInWindow` called directly on the
   same rows (an agreement check, not a reimplementation).
2. `tallyWeeklyImpressions` — counts only weeks whose `weekOf` falls inside the range; empty
   `weekly` ⇒ all-zero counts.

## Gate compliance

No `any`/`!`/`@ts-*`/eslint-disable. No new persisted type, no new `STORAGE_KEYS` entry, no
`Backup` change — purely a read-time derive over data every other landed/pending feature already
produces. `npm run check` must pass before commit.

## Dependencies & sequencing

**Hard dependency on doc 11 (panel — scope lens correction):** an earlier draft called this a
"soft" dependency, implying some graceful-degradation path without doc 11 (in the mold of doc
29's genuinely-optional `visits` parameter). That's not accurate here — `Visit`, `ReportRange`,
and `sinceLastVisitRange` don't exist in `lib/types.ts`/`lib/storage.ts` today, so this doc has
no type to import, no range helper to call, and no Settings UI section (doc 11's Visits list) to
attach its link to. This doc must land **after** doc 11, full stop — not a preference, a
compile-time and UI-surface requirement. Independent of doc 24 (the two are a natural pair —
pre/post visit — but share no code and can land in either order once both are past doc 11).
Independent of every other doc in this round.

## Alternatives considered

- **Push this as a notification alongside doc 11's export reminder:** rejected — doc 11 already
  identified notification-fatigue risk as a reason to keep that reminder a single terse one-shot;
  adding a second push here would double the pre-visit notification surface for marginal value
  over a passive, tap-to-open card.
- **Include a mirrored section in the PDF report:** rejected as redundant — see Report, above.
- **Compute "new" side effects as first-in-window rather than first-ever:** rejected — a side
  effect that faded and later reappeared would be miscounted as brand-new every time it recurred,
  which is a less honest signal than "first time this has ever been logged."

## Panel review

Run through the 4-lens panel (2026-07-23): approve (clinical, strict-TS, UX),
approve-with-changes (scope). Must-fix applied above.

- **Clinical — approve.** The example card is bare counts only, no residual trend-verdict
  language; the weekly-impression tally is a count of the user's own self-reports, not an app
  judgment. Returning nothing rather than an empty card when there's no data avoids the "no
  change" misread. No must-fix.
- **Strict-TypeScript architect — approve.** Every reused symbol checks out against the real
  exports (`adherenceInWindow`, `firstOnsetDates`, `rowsInRange`, `datesInRange`, `SIDE_EFFECTS`);
  the `IsoDate` relational comparisons are legal lexicographic string ops. No must-fix. _Noted:_
  `tallyWeeklyImpressions`'s `Readonly<Record<WeeklyImpression, number>>` must be built complete
  over all three `WEEKLY_IMPRESSIONS` members, not `Partial`-then-cast — matching doc 28's own
  completeness discipline.
- **Mobile UX / friction — approve.** Settings-only, tap-to-expand, no notification, shown only
  when there's data — reads as a self-orientation aid the user opens, not homework attached to
  an appointment. No must-fix. _Noted:_ keep the link a quiet text link, not a badge/CTA, so it
  never reads as an action item.
- **Data-model / migration + privacy + scope — approve-with-changes.** _Must-fix (applied):_ the
  doc's "soft dependency" framing on doc 11 was inaccurate — `Visit`/`ReportRange`/
  `sinceLastVisitRange` don't exist without doc 11, so there is no compile path or UI surface
  without it; corrected to a hard dependency in both the header and Dependencies & sequencing.
  Confirmed zero new persisted state, no `Backup`/`STORAGE_KEYS` change, and explicitly never
  exported — scope stays mechanical counts/lists with no scoring.
