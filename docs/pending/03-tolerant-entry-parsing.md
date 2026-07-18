# 03 — Tolerant per-key entry parsing + no destructive overwrite

**Priority:** 3
**Effort:** Medium
**Risk / over-engineering:** Low

## Problem

For an app whose entire value is data that accretes over weeks/months, the read path can turn a
single bad record into total, permanent history loss:

1. **All-or-nothing parse.** `isEntries` (`lib/storage.ts:147-150`) uses
   `Object.entries(value).every(...)`. One malformed day (a bug, a partial write, a hand-edited
   backup) fails the entire map.
2. **Silent empty fallback.** `loadEntries` (`lib/storage.ts:305-310`) returns `{}` on any parse
   failure, with no signal — indistinguishable from a fresh install.
3. **Destructive cascade.** `saveCheckin` (`lib/storage.ts:321-338`) does
   `loadEntries()` → merge one day → `saveEntries({ ...entries, [date]: merged })`. So after a
   parse failure returns `{}`, the _next_ check-in overwrites the whole `entries` blob with a single
   day. A recoverable, merely-unvalidated history is destroyed.

The same silent-fallback shape applies to `loadProfile` (→ `null`) and `loadDoseChanges` (→ `[]`),
but entries are where the irreplaceable longitudinal data lives, so scope this plan to entries
(+ the doses list, cheaply).

## Change

### 1. Parse entries day-by-day; keep the good, quarantine the bad

Add a tolerant parser to `lib/storage.ts` that returns both the survivors and a signal about what
failed, rather than collapsing to `{}`:

```ts
export interface EntriesParse {
  readonly entries: Readonly<Record<IsoDate, DayEntry>>;
  readonly droppedKeys: readonly string[]; // days that failed isDayEntry (or bad IsoDate key)
  readonly hardFailure: boolean; // raw wasn't even an object → not a genuinely-empty store
}

export function parseEntriesTolerant(raw: unknown): EntriesParse {
  if (!isRecord(raw)) return { entries: {}, droppedKeys: [], hardFailure: true };
  const entries: Record<IsoDate, DayEntry> = {};
  const droppedKeys: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (isIsoDate(key) && isDayEntry(value)) entries[key] = value;
    else droppedKeys.push(key);
  }
  return { entries, droppedKeys, hardFailure: false };
}
```

A single corrupt day now costs one day, not the entire log.

### 2. Quarantine dropped/failed data before any write

When `droppedKeys.length > 0` or `hardFailure`, copy the raw string to a timestamped quarantine key
(e.g. `entries.corrupt.<isoTimestampNow()>`) **before** anything can overwrite it, so a future you
can recover it manually. Keep this to a single `AsyncStorage.setItem` — no framework.

### 3. Make the write path refuse to clobber on hard failure

`loadEntries` should distinguish "genuinely empty store" from "failed to parse". Simplest safe shape:
have `saveCheckin` read via `parseEntriesTolerant`, and if `hardFailure` is true, **abort the merge
write** (surface an error to the caller) rather than merging onto `{}`. A partial parse (some
`droppedKeys`) is safe to merge onto — those days are already quarantined and would fail validation
anyway; merging today's entry onto the survivors is correct.

Keep `loadEntries()`'s existing signature for read-only callers (Today/History/Trends/Entry) — it
can return `parseEntriesTolerant(raw).entries`. The behavioral change is confined to the **write**
path (`saveCheckin`) refusing to proceed on `hardFailure`.

### 4. (Cheap) same tolerant treatment for the doses list

`isDoseChangeList` (`lib/storage.ts:111-113`) is also all-or-nothing `.every`. Apply the same
per-element filter in `loadDoseChanges` so one bad dose change doesn't wipe the timeline.

## Acceptance criteria

- An `entries` blob with one malformed day loads all the other days (not `{}`).
- A malformed/hard-failure `entries` blob does **not** get overwritten by the next `saveCheckin`;
  the raw bad value is preserved under a quarantine key.
- Read-only screens still render survivors with no crash.
- Existing valid data loads unchanged.

## Tests (extend `lib/__tests__/storage.test.ts`)

- `parseEntriesTolerant`: mixed good/bad days → returns only good days + lists dropped keys.
- Non-object raw → `hardFailure: true`, `entries: {}`.
- `saveCheckin` aborts (and does not overwrite) when the stored blob is a hard failure; quarantine
  key is written with the original raw string.
- `saveCheckin` succeeds and merges when the store is genuinely empty (raw `null`).
- `loadDoseChanges` drops one bad change and keeps the rest.

## Non-goals

- **No `{v:1, data}` schema-version envelope right now.** The panel downgraded this from "high" to
  "worth it only if trivial": the guards already tolerate additive optional fields, and the schema
  is frozen at 9 metrics. If you happen to be in `storage.ts` anyway and it's ~15 lines, adding the
  envelope + a `migrate(v, raw)` switch is fine insurance — but it must not block this plan.
- No user-facing error banner/toast system — the quarantine + no-clobber logic is the real
  protection; UI signaling is out of scope (and flagged as over-engineering).

## Gates

`npm run check` green; `type-coverage` 100%. Note any envelope decision in `docs/DECISIONS.md`.
