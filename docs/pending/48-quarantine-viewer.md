> **Status:** Proposed (2026-07-23) · **Priority:** P2 · Ref: innovation batch, round 6

# Quarantine / data-health viewer

## Problem / Context

Doc 03 (tolerant entry parsing, landed) gave this app a real safety net: when the `entries`
store is unreadable or partially corrupt, `quarantineEntries` copies the raw, unparseable blob
to a timestamped key (`` `${STORAGE_KEYS.entries}.corrupt.${isoTimestampNow()}` ``) rather than
silently discarding it, so a bad write never destroys recoverable history. That mechanism has
been quietly protecting data ever since — and is also **completely invisible**. Nothing in the
app today lists these quarantine keys, shows how many exist, or offers any way to inspect or
clear them. A user who has, say, three quarantined blobs accumulated over months of use has no
way to know they exist, no way to see what's in them, and no way to ever remove them —
`AsyncStorage` just keeps them forever. This doc surfaces that existing, landed safety mechanism
instead of leaving it as a silent, growing, invisible pile.

## Goals / Non-goals

**Goals**

1. A Settings section listing every quarantined key currently present (via `AsyncStorage
.getAllKeys()`, already a real, used API in this codebase's test mock per the tolerant-
   parsing doc's own test coverage) — how many, and for each, when it was quarantined (parsed
   from the key's own timestamp suffix).
2. A way to **view** a quarantined blob's raw content (for a technically-inclined user or in
   case it's ever worth manually salvaging), and a way to **delete** an individual quarantine
   entry once reviewed — the first delete-capable data-management action of this kind in the app.
3. Zero change to the quarantine mechanism itself — this doc is purely a **read/delete surface**
   over `AsyncStorage` keys that already exist; `quarantineEntries`'s own write behavior
   (`lib/storage.ts:561-564`) is completely untouched.

**Non-goals**

- **No automatic repair or re-import of quarantined data.** A quarantined blob failed
  `parseEntriesTolerant`'s own guards for a reason — this doc does not attempt to reconstruct or
  re-validate it into a usable `DayEntry`. Viewing it is for the user's own inspection/manual
  recovery (e.g., copying a value out by hand if something in it is recognizable), never an
  automated "fix and restore" action.
- **No automatic deletion.** Quarantine entries persist until the user explicitly reviews and
  deletes them — this doc adds visibility and a manual delete action, never a background
  cleanup job that could remove something before anyone looked at it.
- **No change to when a blob gets quarantined in the first place.** `saveCheckin`'s existing
  hard-failure/partial-failure quarantine triggers (`lib/storage.ts:596-625`) are unchanged;
  this doc only makes the results of that existing behavior visible and manageable.
- **No extension to quarantine other stores.** Only `entries` is ever quarantined today (doses
  are filtered per-element and dropped silently, per doc 03's own design) — this doc surfaces
  what exists, it does not add quarantine behavior to stores that don't have it.

## Core logic (`lib/storage.ts`, alongside `quarantineEntries`)

```ts
export interface QuarantineRecord {
  readonly key: string; // the full AsyncStorage key, e.g. "entries.corrupt.2026-06-01T08:00:00.000Z"
  readonly quarantinedAt: IsoTimestamp; // parsed from the key's own timestamp suffix
}

/**
 * Lists every quarantined entries-store key currently present. Pure read, no mutation — mirrors
 * how every other list-loading function in this file works, just over AsyncStorage's key space
 * instead of a single value.
 */
export async function listQuarantinedEntries(): Promise<readonly QuarantineRecord[]> {
  const allKeys = await AsyncStorage.getAllKeys();
  const prefix = `${STORAGE_KEYS.entries}.corrupt.`;
  const records: QuarantineRecord[] = [];
  for (const key of allKeys) {
    if (!key.startsWith(prefix)) continue;
    const suffix = key.slice(prefix.length);
    if (isIsoTimestamp(suffix)) records.push({ key, quarantinedAt: suffix });
  }
  return records.sort((a, b) => a.quarantinedAt.localeCompare(b.quarantinedAt));
}

/**
 * (panel — data-model/scope lens, must-fix.) Both accept only a key that structurally matches
 * the quarantine shape — the same prefix-plus-valid-timestamp check `listQuarantinedEntries`
 * already applies — rather than trusting whatever key string a caller passes in. This makes "this
 * function can only ever touch a quarantine key" a structural guarantee enforced at the function
 * boundary, not a convention the UI caller has to uphold correctly every time it calls these.
 */
function isQuarantineKey(key: string): boolean {
  const prefix = `${STORAGE_KEYS.entries}.corrupt.`;
  return key.startsWith(prefix) && isIsoTimestamp(key.slice(prefix.length));
}

/** Raw content of one quarantined blob, for manual inspection — returned as-is, never re-parsed. */
export async function readQuarantinedEntry(key: string): Promise<string | null> {
  if (!isQuarantineKey(key)) return null;
  return AsyncStorage.getItem(key);
}

/** Removes one quarantined blob after the user has reviewed it. */
export async function deleteQuarantinedEntry(key: string): Promise<void> {
  if (!isQuarantineKey(key)) return;
  await AsyncStorage.removeItem(key);
}
```

`isIsoTimestamp` guards the parsed suffix rather than trusting it — a key that happens to start
with the quarantine prefix but doesn't carry a valid timestamp suffix (which shouldn't occur
given how `quarantineEntries` always mints the suffix via `isoTimestampNow()`, but is checked
rather than assumed) is silently excluded from the list rather than crashing the read, and the
same `isQuarantineKey` check now guards `readQuarantinedEntry`/`deleteQuarantinedEntry` directly,
so neither can ever act on an arbitrary AsyncStorage key even if a future UI bug passed one in.
**Every function here is additive** — `listQuarantinedEntries`/`readQuarantinedEntry`/
`deleteQuarantinedEntry` are new exports; nothing about `quarantineEntries` or `saveCheckin`'s
existing quarantine-on-failure behavior changes.

## UI (`app/(tabs)/settings.tsx`)

A "Data health" section, visible only when `listQuarantinedEntries()` returns a non-empty list
(absent entirely for the overwhelming majority of users who never trigger the tolerant-parsing
safety net at all — this section must never appear as a standing, empty "0 issues" fixture,
matching this batch's repeated discipline against permanent chrome for a rare case). When
present: a plain count ("2 quarantined records from failed saves") and a list, each with a
human-readable quarantine date, a "View" action (shows the raw JSON string in a read-only,
scrollable text view — no attempt to pretty-print or re-validate it beyond what it already is),
and a "Delete" action with a simple confirmation ("This can't be undone").

## Test plan (`lib/__tests__/storage.test.ts`)

1. `listQuarantinedEntries` — returns keys matching the real quarantine prefix, sorted by
   timestamp; ignores keys that share the prefix but have a malformed timestamp suffix; returns
   `[]` when no quarantine keys exist (the common case, tested explicitly since it drives the
   Settings section's visibility).
2. `readQuarantinedEntry`/`deleteQuarantinedEntry` — round-trip against the existing test-mock
   `AsyncStorage` (already extended with `getAllKeys` per the tolerant-parsing doc's own test
   coverage, so no new mock capability is needed): a written quarantine key reads back its exact
   raw string; deleting it removes it from a subsequent `listQuarantinedEntries` call. A key that
   does **not** match the quarantine shape (e.g. `entries` itself, or an arbitrary unrelated key)
   is rejected by both — `readQuarantinedEntry` returns `null`, `deleteQuarantinedEntry` is a
   no-op — the load-bearing test for the `isQuarantineKey` structural guard.
3. **Integration with the real quarantine trigger** — a test that actually exercises
   `saveCheckin`'s hard-failure path (writing malformed raw entries data, then calling
   `saveCheckin`) and confirms the resulting quarantine key is discoverable via
   `listQuarantinedEntries` — proving this doc's read surface actually sees what the existing
   write path produces, not just a hand-constructed fixture.

## Gate compliance

No `any`/`!`/`@ts-*`/eslint-disable. `QuarantineRecord` is a plain interface; the timestamp
suffix is guarded via `isIsoTimestamp`, never asserted. No new persisted type — this doc reads
and deletes existing `AsyncStorage` keys, it introduces no new store, no `Backup`/`STORAGE_KEYS`
entry (quarantine keys are deliberately **not** included in the JSON backup — they are
diagnostic artifacts of a failed write, not data worth carrying forward into a fresh restore).
`npm run check` must pass before commit.

## Dependencies & sequencing

Independent of every other doc in this batch and prior rounds. Builds only on landed code (doc
03's `quarantineEntries`/`saveCheckin`, and the already-real `AsyncStorage.getAllKeys` API this
codebase's own test mock already supports).

## Alternatives considered

- **Automatically attempting to salvage/re-import a quarantined blob's individually-valid days
  (re-running `parseEntriesTolerant` against it and offering to merge any survivors):**
  considered as a stronger version of this doc, but rejected for v1 as real added complexity
  (a merge-conflict question: what if a day in the quarantined blob and the current live store
  disagree?) for a genuinely rare case (most users will have zero quarantine entries ever); a
  future doc could revisit this once basic visibility has shipped and proven whether quarantine
  entries occur often enough to be worth an automated recovery flow.
- **Surfacing quarantine count as a persistent Settings badge even when the list is empty:**
  rejected — an always-visible "0 issues" line is exactly the kind of standing chrome for a rare
  case this batch has repeatedly avoided elsewhere (docs 35/36's Today-tab discipline, doc 44's
  collapsed-by-default cover note).
- **Including quarantine keys in the JSON backup export:** rejected — see Gate compliance; a
  quarantined blob is evidence of a failed write, not data the user actually wants carried into a
  restored copy on a new device.

## Panel review

Run through the 4-lens panel (2026-07-23): approve (clinical), approve (strict-TypeScript),
approve (mobile UX), approve-with-changes (data-model/scope). One must-fix, cleanly scoped.

- **Clinical — approve.** Purely a diagnostic/data-recovery surface with no clinical claims or
  interpretation; nothing to change.
- **Strict-TypeScript architect — approve.** `QuarantineRecord` and the guard functions are
  already correctly typed against real symbols (`isIsoTimestamp`, `STORAGE_KEYS.entries`); no
  `any`/`!`/`@ts-*` introduced.
- **Mobile UX / friction — approve.** The empty-by-default, non-permanent Settings section
  correctly matches this batch's established discipline against standing chrome for a rare case.
- **Data-model / migration + privacy + scope — approve-with-changes.** Required
  `readQuarantinedEntry`/`deleteQuarantinedEntry` to structurally verify the key shape themselves
  (added the `isQuarantineKey` guard above) rather than relying on the UI caller to only ever pass
  a key that came from `listQuarantinedEntries` — a delete-capable function should not trust its
  caller's discipline as its only safety mechanism.
