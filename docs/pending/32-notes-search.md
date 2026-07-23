> **Status:** Proposed (2026-07-23) · **Priority:** P2 · Ref: innovation batch, round 3

# Notes full-text search

## Problem / Context

`EveningCheckin.notes` is free text, and over months of titration it accumulates into a real
personal journal — but the only way to read it today is `app/(tabs)/history.tsx`'s day-by-day
scroll, or the report's dated notes list (bounded to whatever export range was chosen). Neither
lets a patient or provider answer "when did I first mention the headaches?" or "how often have I
written about sleep?" without reading every day by hand. The data already exists, fully on-device
— this doc adds a way to search it.

This is squarely a **utility/legibility** feature, not a new data capability: the search finds
existing text exactly as written, never summarizes, categorizes, or interprets it.

## Goals / Non-goals

**Goals**

1. A pure, case-insensitive substring search over every dated note in the full log, reusing the
   landed `collectNotes` (`lib/report-metrics.ts:368-377`) rather than re-deriving note
   collection.
2. A search field on `app/(tabs)/history.tsx` (the natural home — it's already the day-by-day
   browsing surface) filtering the visible list to matching days, with the matched substring
   highlighted in context.
3. Tapping a result opens that day's existing detail view (`app/entry/[date].tsx`) — no new
   screen, no new navigation concept.

**Non-goals**

- **No fuzzy matching, stemming, or ranking.** A plain substring match (case-insensitive) is the
  entire feature — no search-relevance scoring, no "did you mean," no NLP. Predictable and
  auditable: if the exact characters aren't in the note, it isn't a match.
- **No search over rating values or side effects.** Scoped to free-text `notes` only; searching
  structured fields (ratings, side effects) is a different, unrequested feature with its own
  UI shape (a filter, not a text search) and is out of scope here.
- **No persisted search history or saved searches.** Ephemeral component state only, cleared on
  leaving the screen.
- **No cross-field or cross-entry aggregation.** Results are a filtered list of days, not a
  count, a frequency chart, or a "most common word" analysis — any of those would start
  resembling an interpretive layer over free text, which this doc deliberately avoids.

## Core logic (`lib/notes-search.ts`, new, RN-free)

```ts
export interface NoteSearchResult {
  readonly date: IsoDate;
  readonly text: string; // collectNotes' trimmed note text, unescaped — caller escapes per surface
  readonly matchStart: number; // index of the first match, for highlight rendering
  readonly matchLength: number; // always query.length; named for clarity at call sites
}

/**
 * Case-insensitive substring search over dated notes, reusing the existing collectNotes shape.
 * Empty/whitespace-only queries return an empty result set rather than "matching everything" —
 * an empty search box should show nothing found, not the entire log.
 */
export function searchNotes(
  notes: readonly DatedNote[],
  query: string,
): readonly NoteSearchResult[] {
  const trimmed = query.trim();
  if (trimmed === '') return [];
  const lower = trimmed.toLowerCase();
  const results: NoteSearchResult[] = [];
  for (const note of notes) {
    const matchStart = note.text.toLowerCase().indexOf(lower);
    if (matchStart === -1) continue;
    results.push({ date: note.date, text: note.text, matchStart, matchLength: trimmed.length });
  }
  return results;
}
```

`DatedNote` (`lib/report-metrics.ts:359-362`) and `collectNotes` are imported as-is. The caller
supplies `collectNotes(rowsInRange(entries, datesInRange(loggingStartDate(profile), today)))` —
i.e., the **full** logged history, not an export-range slice, since a search is explicitly
"find this anywhere I've ever written it," not "find this within the currently selected report
range." `loggingStartDate`/`rowsInRange`/`datesInRange` are all existing, landed exports
(`lib/metrics.ts:66-68`, `lib/metrics.ts:37-42`, `lib/storage.ts:434-442`).

## UI (`app/(tabs)/history.tsx`)

**Gated visibility, not a permanent fixture (panel — UX lens must-fix).** History today is a
plain, chrome-free scrollable list; a search box pinned above it unconditionally would be dead
weight for the common case — a new install, or anyone with only a handful of logged days, gains
an empty input with nothing meaningful to search. The search affordance renders only once there
is enough history to be worth searching (a small minimum note count, e.g. via `collectNotes`'s
own output length over the full log), and even then starts collapsed behind a small icon/link in
the header that expands into the text input on tap — never an always-visible box on a screen
that's otherwise a bare list.

Once expanded: a single text input, debounced (a small local `useState` + the existing
render-on-change pattern — no new dependency for debouncing at this data volume; a plain
`onChangeText` is fast enough given "~1 entry/day" scale, per `docs/PLANNING-v0.md`'s own
no-charting-library reasoning). While non-empty, the day list below filters to
`searchNotes(...)` results only, each row showing the date and the note text with the matched
substring visually emphasized (bold or a subtle background highlight via `theme` tokens — no new
palette entries). Clearing the search field restores the normal, unfiltered day list — the
search is a filter on the existing screen, not a separate results screen.

**Empty state, stated explicitly:** a query with zero matches shows a plain "No notes match
'{query}'" line, not a blank screen that could read as a bug.

## Test plan (`lib/__tests__/notes-search.test.ts`)

1. `searchNotes` — case-insensitive match; empty/whitespace query returns `[]`; no match across
   any note returns `[]`; `matchStart`/`matchLength` correctly bound the first occurrence in a
   note containing the query multiple times (only the first is reported, since highlighting is
   presentational and one visible anchor per row is enough); a query matching a substring inside
   a larger word (e.g. "head" inside "headache") still matches — deliberately unanchored, since a
   patient searching "head" plausibly means "headache," not only a whole-word "head."
2. **Integration with `collectNotes`** — a day with an empty/whitespace-only note is already
   excluded by `collectNotes` itself (existing, unmodified behavior) and therefore never appears
   as a search candidate — asserted as a passthrough behavior, not reimplemented.

## Gate compliance

No `any`/`!`/`@ts-*`/eslint-disable. No new persisted type, no new `Backup`/`STORAGE_KEYS`
change — pure read/derive over data `collectNotes` already exposes. `String.prototype.indexOf`
returning `-1` is checked explicitly, never coerced through a truthy/falsy shortcut that could
mishandle a match at index `0`. `npm run check` must pass before commit.

## Dependencies & sequencing

Independent of every other doc in this batch and prior rounds — the only symbol it reuses
(`collectNotes`/`DatedNote`) is already landed. No sequencing constraint.

## Alternatives considered

- **A dedicated search screen/route instead of a filter on History:** rejected — History is
  already the day-browsing surface; a second screen for "the same days, filtered" would
  duplicate navigation for no benefit.
- **Search-as-you-type across the report's date range only:** rejected — a search is most useful
  precisely when a patient doesn't remember which range something happened in; scoping it to the
  full log is more useful than mirroring the report's range selector.
- **A word-boundary-only match (no substring-inside-a-word matches):** rejected — see the
  `searchNotes` test rationale above; free-text health notes are exactly the kind of casual
  writing where partial-word recall ("head" for "headache") is common and worth matching.

## Panel review

Run through the 4-lens panel (2026-07-23): approve (clinical, strict-TS, scope),
approve-with-changes (UX). Must-fix applied above.

- **Clinical — approve.** The out-of-context risk this lens watches for is well handled: a
  matched result always carries the note's full text with the match highlighted in place, never
  a standalone fragment, so nothing is misrepresented by clipping. The Non-goal against
  cross-entry aggregation (a frequency count would edge toward the app characterizing symptom
  burden) is exactly the right line, held. No must-fix.
- **Strict-TypeScript architect — approve.** Every reused symbol (`DatedNote`, `collectNotes`,
  `loggingStartDate`, `rowsInRange`, `datesInRange`) checks out against the real exports; the
  explicit `=== -1` check correctly preserves a match at index `0`. No must-fix. _Noted:_
  `NoteSearchResult.text`'s comment corrected above — it's `collectNotes`' already-trimmed text,
  not a raw untrimmed note.
- **Mobile UX / friction — approve-with-changes.** _Must-fix (applied):_ an always-visible search
  box on an otherwise bare, chrome-free History list was dead weight for the common case (a new
  install or a short log) — gated the affordance behind a minimum-history threshold and a
  tap-to-expand header icon, rather than a permanent fixture. Confirmed filtering in place (no
  new screen) and the explicit empty state keep this off the daily check-in flow entirely.
- **Data-model / migration + privacy + scope — approve.** Zero persisted state, zero
  `Backup`/`STORAGE_KEYS` change, ephemeral component state only. Confirmed the Non-goals
  structurally prevent any drift toward an interpretive layer over free text — a plain substring
  match, nothing more. No must-fix.
