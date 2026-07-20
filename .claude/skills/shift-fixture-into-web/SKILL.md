---
name: shift-fixture-into-web
description: Loads one of this repo's report fixtures (lib/__fixtures__/reports/*.backup.json) into the Expo web build's storage by shifting its dates to end on today and seeding localStorage directly. Use this when testing the Trends, History, or Settings screens on `expo start --web`, when the in-app "Import JSON backup" button doesn't work on web, or when asked to load/seed test data / a fixture backup into the web app.
---

# Shift Fixture Into Web

## Overview

The app's "Import JSON backup" button is broken on web — it fails silently, with no visible
error — so fixture data can't be loaded through the UI there. This skill seeds `localStorage`
directly instead: it takes a fixture backup, shifts every date in it by a constant offset so the
most recent entry lands on today (preserving the fixture's original day-to-day spacing exactly),
and writes the shifted `profile`/`doses`/`entries` straight into the keys the app's storage layer
reads from on web.

## Why the import button doesn't work on web

Two separate silent failures compound:

1. `importJsonBackup()` (`lib/export.ts`) calls `File.pickFileAsync()` from `expo-file-system`.
   That API's web shim (`node_modules/expo-file-system/src/ExpoFileSystem.web.ts`) is a stub:
   ```js
   pickFileAsync: () => {
     console.warn('expo-file-system is not supported on web');
     return Promise.resolve();
   },
   ```
   It resolves `undefined` instead of a real picker result, so the very next line in
   `importJsonBackup` (`if (picked.canceled)`) throws a `TypeError`.
2. The screen's `catch` block calls `Alert.alert(...)` to report the failure — but
   `react-native-web`'s `Alert.alert` is a complete no-op (`static alert() {}`), so the error is
   swallowed with zero user-visible feedback. The button just appears to do nothing.

This is a real, documented gap in the app's web support, not a flake — don't re-diagnose it each
time; go straight to seeding `localStorage`.

## Why the shift, not a straight copy

Fixtures are historical scenarios (e.g. `lib/__fixtures__/reports/long-multimonth.backup.json`
spans 2026-01-05 → 2026-03-03). The Trends screen (`app/(tabs)/trends.tsx`) only renders the last
7/14/30 days counting back from _today_, so loading a fixture's dates verbatim shows nothing but
gaps there — History and the PDF export still show the data (they aren't date-window-anchored),
but Trends is the screen most worth exercising and it needs recent dates.

**The shift must also move `profile.createdAt`, not just the entries.** `lib/export.ts`'s
`coverage()` / `loggingStartDate()` floors the Trends "logged X of Y days" denominator at
`profile.createdAt`. Fixtures freeze `createdAt` to their report-generation timestamp. If a shift
only moves the entries and doses but leaves `createdAt` where it was, the coverage floor lands
_after_ the shifted entries, Trends clips its window to almost nothing, and everything renders as
a gap even though real data now exists in `localStorage`/History — the exact bug this skill exists
to avoid. Always re-derive `createdAt` from the shifted `startDate`.

**The seed also forces `profile.lockEnabled` to `false`, regardless of the fixture's own value.**
Several fixtures (e.g. `titration-journey`, `short-week`) set `lockEnabled: true`. On web,
`expo-local-authentication`'s `authenticateAsync()` isn't implemented — its web shim only stubs
the hardware/enrollment-check functions — so `LockScreen`'s unlock attempt always throws and
there's no bypass. Seeding a lock-enabled profile strands the tester on
`This is private, on this device.` / `Couldn't verify — try again.` with no way forward short of
clearing `localStorage` again. Confirmed by hitting this exact wall while building this skill.

## Workflow

**Prerequisite:** `npx expo start --web` running (this repo already has `react-dom` and
`react-native-web` installed). Have the app open in a browser, or reachable via the
chrome-devtools MCP tools.

1. **Pick a fixture.** List `lib/__fixtures__/reports/*.backup.json` and choose one matching what
   the user wants to test (e.g. `titration-journey`, `sparse-logging`, `side-effect-heavy`,
   `long-multimonth`). Each is shaped `{ exportedAt, profile, doses, entries }`.

2. **Generate the shift+seed function** from that fixture:

   ```bash
   node .claude/skills/shift-fixture-into-web/scripts/generate-seed-script.mjs \
     lib/__fixtures__/reports/<name>.backup.json
   ```

   This prints a self-contained `() => { ... }` JS function with the fixture's `profile`/`doses`/
   `entries` embedded as literals. It computes `today` from the browser's own `Date` (not this
   shell's clock — avoids drift if a build straddles midnight), computes the single day-offset
   needed to move the fixture's last entry onto that `today`, and applies that same offset to
   every entry date/key, every dose date, `profile.startDate`, and `profile.createdAt` (re-derived
   from the shifted `startDate`, per the "why" above). It also rewrites each entry's
   `morning`/`evening.completedAt` to the shifted date (cosmetic — nothing in the app's date-range
   logic reads `completedAt`, but it keeps the seeded data internally consistent).

3. **Run that function _in the browser page_, not in this shell** — the whole point is that
   `new Date()` inside it must be the browser's real clock. Preferred: the chrome-devtools MCP
   tool.
   - `mcp__plugin_chrome-devtools-mcp_chrome-devtools__navigate_page` (or `new_page`) to open the
     running app (typically `http://localhost:8081`).
   - `mcp__plugin_chrome-devtools-mcp_chrome-devtools__evaluate_script` with the generated text as
     the `function` argument, verbatim.
   - It returns a summary object (`shiftDays`, `today`, `firstEntryDate`, `lastEntryDate`,
     `doseDates`, `startDate`, `createdAt`) — use it to sanity-check before moving on: the entries
     span should end on `today`, and `createdAt`'s date should be on/before `firstEntryDate`.

   If chrome-devtools MCP tools aren't available, print the generated function wrapped in
   parens-and-call (`(<function>)();`) and have the user paste it into their own browser's
   DevTools console on the app's tab.

4. **Reload the page** (`navigate_page` with `type: "reload"`, or the user's own browser reload).
   `AsyncStorage`'s web implementation reads straight from `window.localStorage` under the plain
   keys `profile` / `doses` / `entries` (see `lib/storage.ts`'s `STORAGE_KEYS`) — no prefix, no
   extra encoding — so the app picks up the seeded data on its next load exactly as if it had been
   restored from a real backup.

5. **Verify** by checking History (lists every entry regardless of date), Trends (should now show
   solid bars for logged days and dashed gap placeholders for unlogged ones, with a real
   `logged X of Y days` count — not `0 of 1`), and Settings (medication name, current dose, and
   the dose-change list should match the fixture).

## Gotcha: this is real, persistent browser state

The seed writes to actual `localStorage` for whatever origin/port the dev server is running on.
It persists across reloads until cleared (Settings has no "reset" affordance for this — clear it
manually via DevTools `localStorage.clear()` or Application panel if a clean slate is needed
before seeding a different fixture).
