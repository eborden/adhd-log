> **Status:** Proposed (2026-07-23) · **Priority:** P2 · Ref: innovation batch, round 3

# Periodic backup reminder

## Problem / Context

`docs/PLANNING-v0.md`'s own "Open Items" section names the risk this doc addresses directly:
"JSON backup/restore: not in the original export pick, but data is local-only so a lost/reset
phone loses everything." The JSON export exists — but nothing in the app ever prompts anyone to
actually use it. For a titration log that accumulates its entire clinical value over weeks to
months, a lost, stolen, or factory-reset phone with no recent backup is not a minor
inconvenience; it is the complete, permanent loss of the exact record this whole app exists to
produce. Doc 11's pre-visit export nudge covers a different moment (get the report to an
upcoming appointment); nothing covers "it's been a while since your data was backed up
anywhere but this one phone."

This is a data-safety feature, not a clinical-content feature — but it protects the one thing
every other doc in this repo's pending set assumes will still be there next time the app is
opened: the log itself.

## Goals / Non-goals

**Goals**

1. A single, low-frequency (monthly, not weekly — see Non-goals) local reminder nudging the user
   to export a JSON backup, only when it's actually been a while since the last one.
2. Track the last backup export timestamp — a genuinely new, small piece of state, since nothing
   today records when (or whether) a JSON export last happened.
3. A passive Settings indicator ("Last backed up: 3 weeks ago" / "Never backed up") alongside the
   existing export buttons, independent of whether the reminder has fired.

**Non-goals**

- **Not a nag.** Monthly, not weekly or daily — backup hygiene is not the daily check-in, and
  this reminder must never compete with or dilute the two daily reminders' importance. A single
  dismiss suppresses it until the next monthly interval regardless of whether a backup actually
  happened (see Core logic) — the reminder's job is to prompt, not to enforce.
- **No automatic/background export.** The export stays a manual, user-initiated action exactly
  as it is today (`CLAUDE.md`'s "nothing leaves the phone except through user-initiated exports"
  contract) — this doc adds a nudge to do that action, never an automatic write to a file the
  user didn't ask for.
- **No cloud backup of any kind.** The reminder points at the existing on-device JSON
  export/share flow — it does not introduce iCloud/Google Drive/any remote storage. Staying
  100% on-device is unaffected; the exported file's destination is entirely the user's own choice
  via the existing share sheet, same as today.
- **No verification that an export actually succeeded or was stored safely.** The app cannot
  know what the user did with a shared file after the OS share sheet takes over — this doc
  tracks "the export flow was completed," not "a durable backup now exists somewhere safe." That
  distinction is stated in the reminder copy (see UI).

## Data model (`lib/types.ts`)

One additive, optional `Profile` field:

```ts
// Profile gains:
readonly lastBackupExportedAt?: IsoTimestamp;
```

Additive and optional, matching every other late-added `Profile` field
(`enabledEveningMetrics?`, `weeklyReminder?`, and this batch's own doc 22/26 fields) — existing
profiles keep working with it absent, read as "never backed up."

## Storage (`lib/storage.ts`)

**Both new optional fields must be guarded, not just one (panel — TS lens must-fix).** Core logic
below introduces a second `Profile` field (`lastBackupReminderDismissedAt?`) alongside
`lastBackupExportedAt?` — an earlier draft's `isProfile` snippet checked only the first, leaving
the dismissal field a typed-but-unvalidated hole at the parse boundary, which this codebase's
parse-don't-validate discipline doesn't allow. Both checks go before `isProfile`'s existing
terminal `return weeklyReminder === undefined || isTimeOfDay(weeklyReminder);` (`lib/storage.ts:
122-123`), not after it:

```ts
const lastBackupExportedAt = value['lastBackupExportedAt'];
if (!(lastBackupExportedAt === undefined || isIsoTimestamp(lastBackupExportedAt))) return false;
const lastBackupReminderDismissedAt = value['lastBackupReminderDismissedAt'];
if (!(
  lastBackupReminderDismissedAt === undefined || isIsoTimestamp(lastBackupReminderDismissedAt)
)) {
  return false;
}
```

Written by the existing JSON-export handler in `app/(tabs)/settings.tsx` (`handleExportJson` or
equivalent) — the **only** call site that stamps `lastBackupExportedAt`, so "last backup exported
at" means exactly "the last time the export-JSON action ran," nothing inferred.

```ts
export async function recordBackupExport(profile: Profile, at: IsoTimestamp): Promise<Profile> {
  const next: Profile = { ...profile, lastBackupExportedAt: at };
  await saveProfile(next);
  return next;
}
```

## Core logic (`lib/backup-reminder.ts`, new, RN-free)

```ts
export const BACKUP_REMINDER_INTERVAL_DAYS = 30;

// Below this many days of app tenure, never surface the "never backed up" nudge — see the
// fresh-user fix below.
export const MIN_TENURE_BEFORE_BACKUP_NUDGE_DAYS = 14;

/**
 * Whether a backup nudge is due: never backed up (and the app has been in use long enough that
 * the copy is actually true), or the last export was long enough ago. Pure date arithmetic over
 * the two new Profile fields — no I/O.
 */
export function isBackupReminderDue(profile: Profile, today: IsoDate): boolean {
  if (profile.lastBackupExportedAt === undefined) {
    // Fresh-user fix (panel — UX lens must-fix): "it's been a while since you backed up" is
    // untrue, and premature, for someone a few days into using the app with little to lose yet.
    const daysSinceInstall = datesInRange(loggingStartDate(profile), today).length - 1;
    return daysSinceInstall >= MIN_TENURE_BEFORE_BACKUP_NUDGE_DAYS;
  }
  const lastBackupDate = formatIsoDate(new Date(profile.lastBackupExportedAt));
  // DST-safe day count (panel — TS lens must-fix): an earlier draft computed this via raw
  // `getTime()` subtraction divided by a fixed 24-hour millisecond constant, which is NOT
  // DST-safe — a transition inside the window can shift the raw quotient just under the
  // `BACKUP_REMINDER_INTERVAL_DAYS` boundary this function's own tests promise is inclusive.
  // `datesInRange` (lib/storage.ts:434-442) already walks days via `addDays`'s `setDate`
  // arithmetic, which IS DST-safe, so reusing it is both the fix and the thing that actually
  // honors this function's original "mints no new date-conversion logic" intent.
  const daysSince = datesInRange(lastBackupDate, today).length - 1;
  return daysSince >= BACKUP_REMINDER_INTERVAL_DAYS;
}
```

`formatIsoDate`/`parseIsoDate`/`datesInRange`/`loggingStartDate` are all existing, landed
helpers (`lib/storage.ts:371-387,434-442`; `lib/metrics.ts:66-68`) — this function mints no new
date-conversion logic, now genuinely. `datesInRange(start, end).length - 1` gives the day count
between two dates inclusive-of-start, exclusive-of-end — i.e. exactly "days since," reusing the
same DST-safe walk `addDays` already performs rather than a raw millisecond division.

A dismissal is tracked the same lightweight way doc 22 tracks a dismissed reminder suggestion:
the second optional `Profile` field guarded above, `lastBackupReminderDismissedAt?:
IsoTimestamp`, checked alongside `isBackupReminderDue` so a dismissal suppresses the nudge until
roughly the next monthly cycle rather than resurfacing on every subsequent app open.

## UI

**Settings — passive, always-visible indicator** (not gated on the reminder firing): near the
existing export buttons, a plain line — "Last backed up: {relative time}" or "Never backed up" —
so the fact is checkable any time, independent of whether a nudge is currently due.

**Today tab — a single, dismissible, non-blocking card** when `isBackupReminderDue` is true and
not recently dismissed, in the same slim, secondary-visual-weight register as the existing
`WeeklyCard`: _"It's been a while since you backed up your data. Export a JSON backup?"_ with a
direct link into the existing export flow, and a dismiss. **Copy is deliberately about data
safety, not the check-in** — this card must never be confused with, or compete for attention
with, the two daily check-in prompts.

**Today-tab card ordering and cap — owned here (panel — UX lens must-fix: this doc raised the
gap, so this doc resolves it rather than deferring it again).** By this round, three docs (this
one, 25's moment log, and 36's supply countdown) each propose a secondary Today-tab card or line
— doc 27's pre-visit digest and doc 31's pause UI, by contrast, are Settings/Trends-only and add
nothing to Today. Nobody owned a concrete convention beyond "after the `SessionCard`s" — left
unresolved, the daily check-in could end up visually buried under a stack of optional cards,
defeating the entire "Today stays lean" principle every one of these docs individually respects.
The convention, stated once, here:

1. Both `SessionCard`s always render first, unconditionally, at full visual weight — never
   displaced by any secondary card regardless of how many are due.
2. Secondary cards render below them in a **fixed, documented priority order**:
   `WeeklyCard` (existing) → this doc's backup-reminder card → doc 25's moment-log affordance →
   doc 36's supply-countdown line. (Chosen by recency of real-world relevance: a data-safety
   nudge that fires roughly monthly and protects the whole log outranks the always-available,
   low-urgency moment/supply affordances.)
3. **A visible cap of at most two secondary cards at once**, beyond `WeeklyCard`. If more than
   two would be due simultaneously, only the two highest-priority ones show; the rest simply wait
   their turn on a later visit to Today rather than all stacking up in one scroll. This is a
   presentational cap only — it changes what's _shown_, never what's computed or persisted.

Any doc in this batch that adds a Today-tab card should reference this convention rather than
independently deciding its own position.

**No new push notification.** The reminder lives entirely as an in-app card, checked on app
open/Today-tab focus — not a new `expo-notifications` trigger, which would add a third
notification-permission-consuming channel alongside the two daily reminders and doc 11's
visit nudge, for a monthly-cadence concern that doesn't need push urgency.

## Test plan (`lib/__tests__/backup-reminder.test.ts`)

1. `isBackupReminderDue` — `undefined` `lastBackupExportedAt` with app tenure under
   `MIN_TENURE_BEFORE_BACKUP_NUDGE_DAYS` ⇒ `false` (the fresh-user fix); `undefined` with tenure
   at/over that threshold ⇒ `true`; exactly at the `BACKUP_REMINDER_INTERVAL_DAYS` boundary ⇒
   `true` (inclusive, via `datesInRange().length - 1`, asserted across a fixture that straddles a
   DST transition to prove the fix); one day under ⇒ `false`; a recent backup ⇒ `false`.
2. `recordBackupExport` — persists the given timestamp onto the profile and returns the updated
   value; a second call overwrites the first (last-write-wins, matching every other "record the
   most recent X" field in this codebase).
3. **Dismissal interaction** — a dismissal recorded today suppresses the card even though
   `isBackupReminderDue` alone would return `true`; a dismissal from over a month ago no longer
   suppresses it (so a user who ignores the card for a month sees it again, rather than a single
   dismiss silencing it forever).

**Restoring an old backup, acknowledged (panel — scope lens note).** `lastBackupExportedAt`/
`lastBackupReminderDismissedAt` live on `Profile`, so restoring an older JSON backup overwrites
them with that backup's (older, or absent) values — a restore could momentarily make the nudge
fire again even if a newer backup was exported after the one just restored. This is low-stakes
(a card, not data loss) and self-corrects the next time an export runs; stated here rather than
left as a silent surprise.

## Gate compliance

No `any`/`!`/`@ts-*`/eslint-disable. Two additive, optional `Profile` fields, both guarded at the
parse boundary → no migration, no forced re-onboarding. `isBackupReminderDue`/
`recordBackupExport` are pure/thin wrappers reusing existing, DST-safe date helpers — no new
date-parsing or raw-millisecond arithmetic. `npm run check` must pass before commit.

## Dependencies & sequencing

Independent of every other doc in this batch and prior rounds for its own core logic. **Owns the
Today-tab secondary-card ordering/cap convention** (see UI, above) that docs 25/27/36 should each
reference rather than re-deciding independently.

## Alternatives considered

- **Tie the reminder to a fixed calendar cadence (e.g. "the 1st of every month") instead of
  days-since-last-backup:** rejected — a fixed calendar date fires regardless of whether the user
  backed up yesterday, which is exactly the kind of nag this doc's Non-goals rule out; a
  since-last-backup interval only ever fires when it's actually been a while.
- **A push notification instead of an in-app card:** rejected — see UI; a monthly-cadence,
  non-urgent data-safety nudge doesn't need push urgency and would add a third notification
  channel for marginal benefit over a card seen on the next app open.
- **Verifying the export actually reached durable storage (e.g. confirming a successful iCloud
  Drive save):** rejected — the app has no visibility into what happens after the OS share sheet
  takes over, and pretending otherwise would overstate what "last backed up" actually guarantees;
  the Non-goals section states this limitation directly in the feature's own scope.

## Panel review

Run through the 4-lens panel (2026-07-23): approve (clinical, scope), approve-with-changes
(strict-TS, UX). Must-fixes applied above.

- **Clinical — approve.** Confirmed this stays firmly on the data-safety side and never drifts
  into clinical-sounding copy or false urgency — every user-facing string is plain logistics
  ("Last backed up: 3 weeks ago," "It's been a while since you backed up your data"), and the
  high-stakes framing in Problem/Context never reaches the UI. No must-fix.
- **Strict-TypeScript architect — approve-with-changes.** _Must-fixes (applied):_ `isProfile`
  guarded only the first of two new optional fields, leaving
  `lastBackupReminderDismissedAt` an unvalidated hole at the parse boundary — both fields are now
  guarded before the existing terminal `return`. `isBackupReminderDue`'s day-count used a raw
  `getTime()` subtraction divided by a fixed millisecond constant, which is not DST-safe and
  could flip the function's own promised inclusive boundary — replaced with
  `datesInRange(...).length - 1`, reusing the landed, DST-safe `addDays`-based walk instead of
  hand-rolled arithmetic, which also makes the "mints no new date-conversion logic" claim
  actually true.
- **Mobile UX / friction — approve-with-changes.** _Must-fixes (applied):_ the "never backed up"
  copy fired immediately for a brand-new user with almost nothing logged yet, which is both
  untrue ("a while") and premature — added `MIN_TENURE_BEFORE_BACKUP_NUDGE_DAYS` to suppress the
  never-backed-up nudge until there's a meaningful amount of history. This doc also now **owns**
  the Today-tab secondary-card ordering-and-cap convention it previously deferred — a fixed
  priority order plus a visible cap of two secondary cards at once, so the accumulating set of
  optional cards across this round's docs can never bury the daily check-in.
- **Data-model / migration + privacy + scope — approve.** Migration story confirmed correct: two
  additive, optional `Profile` fields riding the existing whole-`profile` backup round-trip, no
  separate `Backup`/`restoreBackup` threading needed since nothing here is a new top-level store.
  The "data-safety, not clinical-content" framing is held throughout, not blurred, and the
  monthly/dismissible/no-push cadence keeps the feature from competing with the daily reminders.
  No must-fix. _Added above:_ an acknowledgment that restoring an older backup can momentarily
  make the nudge re-fire — low-stakes and self-correcting, but worth stating.
