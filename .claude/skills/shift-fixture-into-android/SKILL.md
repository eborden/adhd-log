---
name: shift-fixture-into-android
description: Loads one of this repo's report fixtures (lib/__fixtures__/reports/*.backup.json) into a running Android emulator by shifting its dates to end on today and writing straight into the installed app's AsyncStorage-backed SQLite database via adb. Use this when testing the Today, Trends, History, or Settings screens on the Android emulator, when preparing golden data for an emulator screenshot, or when asked to load/seed test data / a fixture backup onto the Android emulator.
---

# Shift Fixture Into Android

## Overview

This is the Android-emulator counterpart to `shift-fixture-into-web`: same fixtures, same
date-shift/re-derivation logic (shared via `../_shared/shift-fixture.mjs`), different seeding
target. Instead of writing into a browser's `localStorage`, it writes directly into the
installed app's AsyncStorage-backed SQLite database (`RKStorage`) on the emulator via
`adb ... run-as ... sqlite3`, bypassing the in-app "Import JSON backup" flow entirely.

Read `../shift-fixture-into-web/SKILL.md` first if this is the first fixture-seeding skill
you're touching — the "why the shift" rationale (re-deriving `createdAt`, forcing
`lockEnabled: false`) lives once in `../_shared/shift-fixture.mjs` and isn't repeated here.

## Why write straight into RKStorage instead of using the real import button

Confirmed live against a Pixel 7 API 34 AVD: `@react-native-async-storage/async-storage`
(v2.2.0, this repo's version) backs its Android implementation with a SQLite database at
`databases/RKStorage`, table `catalystLocalStorage`, schema `(key TEXT PRIMARY KEY, value TEXT
NOT NULL)` — the same three keys (`profile`, `doses`, `entries`) the app's `lib/storage.ts`
reads via `AsyncStorage.getItem`. Writing rows into that table directly is functionally
identical to the app loading a real backup, without having to drive the native file picker
`importJsonBackup()` (`lib/export.ts`) opens — which, unlike on web, isn't broken here, but
automating "tap Import → navigate the system document picker → pick the right file" via blind
`adb input tap` coordinates is far more fragile than a direct SQL write.

## Workflow

**Prerequisite:** an Android emulator running with the app already installed (`adb devices`
shows it). If the app process needs a cold start after seeding (see step 4), a debug build also
needs Metro reachable: `npm start` (or `npm run android`'s underlying `expo start`) running, and
`adb -s <serial> reverse tcp:8081 tcp:8081` — without this, a force-stopped debug build shows
"Unable to load script" instead of the app. Confirmed by hitting this exact wall while building
this skill.

1. **Pick a fixture**, same as `shift-fixture-into-web` — list
   `lib/__fixtures__/reports/*.backup.json` and choose one matching what's being tested.

2. **Read the emulator's own clock**, not this shell's — same "use the target's clock" principle
   as the web skill, different mechanism (there, the browser's `new Date()` runs the shift
   in-page; here, there's no in-app JS to run this in, so the date has to be fetched first):

   ```bash
   TODAY=$(adb -s <serial> shell date +%Y-%m-%d | tr -d '\r')
   ```

   (`tr -d '\r'` matters — `adb shell` output is CRLF-terminated and a trailing `\r` will corrupt
   the date string if passed through uncleaned.)

3. **Generate the seed SQL** from the fixture and that date:

   ```bash
   node .claude/skills/shift-fixture-into-android/scripts/generate-seed-sql.mjs \
     lib/__fixtures__/reports/<name>.backup.json "$TODAY" \
     > /tmp/seed.sql
   ```

   This computes the same shift/re-derivation `shift-fixture-into-web` does (via the shared
   `shiftFixture` function) and prints three `INSERT OR REPLACE INTO catalystLocalStorage ...`
   statements to stdout, plus a JSON summary (`shiftDays`, `today`, `firstEntryDate`,
   `lastEntryDate`, `doseDates`, `startDate`, `createdAt`) to stderr — use the summary to
   sanity-check before moving on, same as the web skill's return value.

4. **Apply the SQL** to the installed app's database, then force a fresh read:

   ```bash
   adb -s <serial> shell "run-as <package> sqlite3 databases/RKStorage" < /tmp/seed.sql
   adb -s <serial> shell am force-stop <package>
   adb -s <serial> shell am start -n <package>/.MainActivity
   ```

   This repo's package id is `com.adhdlog.app`. `run-as` requires the installed build to be
   debuggable (true for anything built via `npm run android` / Expo dev client / `npm run apk` in
   its default debug configuration) — if `run-as` itself fails with a permission error, the
   installed build isn't debuggable and this approach doesn't apply.

   The force-stop + restart is the Android equivalent of the web skill's "reload the page" — a
   screen that's already mounted may not re-read `AsyncStorage` on its own, so don't skip it.

5. **Verify** the same way the web skill does: Today should show a streak/coverage count
   matching the fixture's entry count (not stale from whatever was seeded before), History
   should list every entry, and Settings should show the fixture's medication/dose. Screenshot
   the app and check, or use `adb shell dumpsys activity` / a quick `uiautomator dump` if
   screenshotting isn't convenient yet.

## Gotchas

- **This is real, persistent app storage.** Like the web skill's `localStorage` seed, this
  writes to the actual installed app's database and persists until overwritten or the app's
  storage is cleared (`adb shell pm clear <package>` — note this also resets `lockEnabled` and
  any other settings, not just the fixture data).
- **A snapshot-resumed emulator already has its app process warm** — if the emulator was booted
  from a saved snapshot with the app mid-session (not freshly launched), the force-stop in step 4
  is what triggers the "needs Metro" cold-start path. If you're only re-seeding without wanting
  to deal with Metro, you can skip the force-stop and instead navigate away from and back to the
  affected screen in-app — but this is less reliable than a clean restart, since not every screen
  re-reads `AsyncStorage` on focus.
- **`sqlite3` must exist on the emulator image.** Confirmed present on a Pixel 7 API 34 AVD; if a
  different/minimal system image lacks it, this approach doesn't work and there's no good
  fallback short of the real import-button UI automation this skill exists to avoid.
- Fixture backups (`*.backup.json`) and the standalone report fixtures (`*.html`, used by
  `capture-app-screenshots` for the provider-report screenshot) are independent files generated
  from the same scenario — seeding one has no effect on the other.
