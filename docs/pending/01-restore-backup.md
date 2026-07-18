# 01 — Extract `restoreBackup` and fix the dose-restore data-loss bug

**Priority:** 1 (highest — confirmed correctness bug in the disaster-recovery path)
**Effort:** Small
**Risk / over-engineering:** None

## Problem

`handleImportJson` in `app/(tabs)/settings.tsx:139-163` restores a JSON backup, but for the
**doses** section it only updates React state:

```ts
// settings.tsx:152-156
if (importedProfile !== null) {
  updateProfile(importedProfile); // persists (saveProfile) ✓
}
setDoses(importedDoses); // ✗ state only — never written to AsyncStorage
await saveEntries(importedEntries); // persists ✓
Alert.alert('Backup restored'); // claims success regardless
```

`saveDoseChanges` is not even imported into this screen. On the next launch `loadDoseChanges`
reads the **old** `doses` key, so all imported dose-change history is silently lost — exactly the
data a provider-facing restore is meant to recover. The alert says "Backup restored" anyway.

Root cause: multi-key data-integrity orchestration ("write profile + doses + entries together") is
hand-inlined in a screen, untested, and easy to get subtly wrong — which is how one of the three
writes got dropped.

## Change

### 1. Add `restoreBackup` to `lib/storage.ts` (RN-free, testable)

Write all three keys atomically-ish and consistently, so the screen can't drop one:

```ts
import type { Backup } from './export'; // or move Backup's type into a shared spot if a cycle appears

export async function restoreBackup(backup: Backup): Promise<void> {
  await Promise.all([
    backup.profile !== null ? saveProfile(backup.profile) : Promise.resolve(),
    saveDoseChanges(backup.doses),
    saveEntries(backup.entries),
  ]);
}
```

- `Backup` currently lives in `lib/export.ts:205`. `storage.ts` importing from `export.ts` is fine
  (`export.ts` already imports from `storage.ts`, so verify no import cycle — if one appears, move
  the `Backup` interface into `lib/types.ts`, which both already import).
- Keep it in `lib/` so Vitest exercises it against the existing `lib/__mocks__/async-storage.ts`.

### 2. Simplify the screen to call it

In `settings.tsx`, replace the inline three-step block with a single `await restoreBackup(result.value)`,
then refresh local state from disk (call the existing `refresh` callback) so the UI reflects what was
actually persisted, rather than hand-setting `setDoses`/`updateProfile`. Only show
`Alert.alert('Backup restored')` after `restoreBackup` resolves.

## Acceptance criteria

- Importing a backup that contains dose changes → those changes survive an app relaunch
  (verified by a unit test: `restoreBackup(b)` then `loadDoseChanges()` returns `b.doses`).
- Importing a backup with `profile`, `doses`, and `entries` persists all three; a `null` profile
  leaves the existing profile untouched **or** is explicitly documented as clearing it (pick one —
  current UI only calls `updateProfile` when non-null, so preserve that: skip the profile write when
  `backup.profile === null`).
- The "Backup restored" alert only fires on success.

## Tests (add to `lib/__tests__/storage.test.ts`)

- `restoreBackup` writes profile + doses + entries; each `load*` reads them back.
- `restoreBackup` with `profile: null` does not overwrite an existing profile.
- Round-trip: `buildBackup(...)` → `restoreBackup` → `load*` returns equal data.

## Non-goals

- No schema-version envelope (see plan 03 for the parsing side).
- No transactional/rollback guarantees beyond `Promise.all` — AsyncStorage has no real transactions
  and this is a single-user app; consistency-on-success is enough.

## Gates

`npm run check` green. New logic is fully covered (keep `type-coverage` at 100%).
