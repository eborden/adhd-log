---
name: capture-app-screenshots
description: Captures or updates the README's app screenshots (docs/screenshots/*.png) from a running Android emulator seeded with golden fixture data via adb, plus the standalone provider-report HTML fixture. Use when asked to add, update, retake, or regenerate a screenshot for the README, or after a UI change makes an existing one stale.
---

# Capture App Screenshots

## Overview

`docs/screenshots/*.png` feeds the "## Screenshots" grid in `README.md`. There are two
different sources, captured two different ways:

1. **Live app screens** (Today, Morning check-in, Trends, History, Settings, ...) — captured
   from a running Android emulator via `adb`, after seeding it with golden fixture data.
   Not the Expo web build — every screenshot currently in the repo was captured from the
   emulator, and the web build has its own known gaps (broken import button, non-functional
   lock screen — see `shift-fixture-into-web`) that make it a worse match for what real users
   see than the emulator is.
2. **The provider report** — not a live screen. `exportPdfReport()` (`lib/export.ts`) goes
   straight to the OS share sheet with no in-app preview to screenshot, so it's captured by
   opening the standalone rendered fixture at `lib/__fixtures__/reports/<name>.html` directly
   in a browser instead (this part has no Android/web distinction — it's just a static HTML
   file, so a browser is the right tool regardless).

Every screenshot currently in the repo uses the `clean-responder` scenario
(`lib/__fixtures__/reports/clean-responder.backup.json` / `.html`) — reuse it unless the user
asks for a different one, so the grid stays visually consistent (same person, same date range,
same numbers across every screenshot).

## Workflow: live app screens

1. Confirm an Android emulator is running: `adb devices` should list it. If none is running,
   start one (e.g. `emulator -avd Pixel_7_API_34 -no-window -no-audio -no-boot-anim -gpu
swiftshader_indirect &`, adjusting the AVD name to what's available — `emulator -list-avds`).
   The committed screenshots were all taken at a Pixel 7 API 34's native resolution (1080×2400),
   which is also why that's the AVD to prefer for a consistent grid.

2. **Get a debug build installed — not the CI release APK.** If the ask is "screenshot the
   latest build," the instinct is to reach for `npm run apk:ci` (see `docs/CI.md`), which
   downloads and installs the latest **release** APK from GitHub Actions. That's fine for
   confirming the build installs, but step 3 below (fixture seeding) needs `run-as`, which
   **always** fails against it: `run-as: package not debuggable`. Release builds are never
   debuggable regardless of keystore — there's no flag to flip. Confirmed hitting this wall
   directly: `npm run apk:ci` installed clean, then `shift-fixture-into-android`'s `run-as` step
   failed outright.

   Instead: `adb uninstall com.adhdlog.app` (needed anyway — a release APK and a debug APK are
   signed with different keystores, so installing one over the other fails with
   `INSTALL_FAILED_UPDATE_INCOMPATIBLE`), then `npm run android` (`expo run:android`) to build
   and install a local **debug** build of the same source. This is visually identical to what CI
   would produce — release vs. debug only changes signing and native optimization, not what
   renders — so it satisfies "screenshot the latest build" while staying seedable.

   **If you're in a git worktree**, it does not inherit `node_modules` from the main checkout —
   run `npm ci` there first. Skipping this doesn't fail the native/Gradle build (that resolves
   packages by walking up to a parent checkout's `node_modules`), so `expo run:android` reports
   `BUILD SUCCESSFUL` and installs fine, but Metro serves the JS bundle from the worktree's own
   project root and throws `UnableToResolveError: ... ./node_modules/expo-router/entry` at
   runtime — the app shows a red error screen instead of loading. `npm ci` in the worktree, then
   force-stop and relaunch the app, fixes it.

3. **Seed golden data by invoking the `shift-fixture-into-android` skill** — don't reinvent
   this. It reads the emulator's own clock, generates SQL from a
   `lib/__fixtures__/reports/*.backup.json` fixture, and writes it straight into the installed
   app's AsyncStorage-backed SQLite database via `adb ... run-as ... sqlite3`, then force-stops
   and restarts the app. Read that skill for the full mechanics and its gotchas (needing Metro +
   `adb reverse tcp:8081 tcp:8081` for the restart on a debug build, `run-as` requiring a
   debuggable install — see step 2 above if that's news).

   If a plain `adb shell am start -n com.adhdlog.app/.MainActivity` restart leaves the app on a
   black screen (dev client launched but never loaded a bundle), relaunch through the
   dev-client deep link instead — this reconnects it to Metro directly:

   ```bash
   adb -s <serial> shell am start -a android.intent.action.VIEW \
     -d "adhdlog://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081"
   ```

4. Before capturing anything, take one screenshot and check for dev-mode overlays (e.g. an
   "Open debugger to view warnings" LogBox toast). Dismiss them first — an overlay sitting over
   the bottom tab bar intercepts taps on later navigation, not just spoils the image. This bit a
   prior capture session directly: the toast overlapped the tab bar and ate the first couple of
   navigation taps before it was dismissed.
5. Navigate with `adb -s <serial> shell input tap <x> <y>` (coordinates in device pixels). For
   large, obvious targets, reading coordinates off the most recent screenshot (not any
   scaled-down preview of it) is fine. For small or closely-spaced targets — the bottom tab bar
   is the repeat offender — visually estimating from a screenshot is not reliable enough and
   wastes several capture-verify round trips on taps that silently miss. Get exact bounds
   instead:
   ```bash
   adb -s <serial> shell uiautomator dump /sdcard/window_dump.xml
   adb -s <serial> pull /sdcard/window_dump.xml /tmp/window_dump.xml
   grep -oE 'text="Trends"[^>]*bounds="\[[0-9,]+\]\[[0-9,]+\]"' /tmp/window_dump.xml
   ```
   then tap the center of the reported `bounds="[x1,y1][x2,y2]"`. Note the clickable element's
   bounds can extend well beyond the visible icon+label (e.g. the tab bar's tappable area reaches
   almost to the bottom of the screen) — don't assume the tap target is centered on what you can
   see.
6. Capture with:
   ```bash
   adb -s <serial> exec-out screencap -p > docs/screenshots/<name>.png
   ```
   `screencap` captures exactly what's on screen — there's no full-page/scrolled capture the way
   a browser tool offers, so for a screen with more content than fits (e.g. Trends with several
   metrics charted), the screenshot is whatever's visible without scrolling, same as every
   screenshot already in the repo.

## Workflow: provider report

1. `navigate_page` to `file://<absolute-repo-path>/lib/__fixtures__/reports/clean-responder.html`
   (or whichever scenario was chosen).
2. `resize_page` to the size the export actually prints at — 816x1056 (US letter @ 96dpi) —
   before measuring or capturing.
3. Check `document.body.scrollHeight` via `evaluate_script`. The report is much taller than one
   page — the current one is ~4276px at 1x / ~8552px at a 2x device pixel ratio — because it
   includes weekly averages, dose-period comparisons, before/after sections, adherence, side
   effects, and the full daily log.
4. `take_screenshot` with `fullPage: true`, saved to `docs/screenshots/report.png`.

### The thumbnail-link pattern (report only)

The full report screenshot is far taller than the other screenshots, and GitHub's README
sanitizer strips inline `style` attributes — there is no way to embed a real scrollable box in
a GitHub-rendered markdown file. Instead:

1. Crop the top of the full screenshot to the **same aspect ratio** as the other screenshots, so
   it renders at the same height in the grid:
   ```bash
   magick docs/screenshots/report.png -crop <width>x<crop_height>+0+0 +repage \
     docs/screenshots/report-preview.png
   ```
   where `crop_height = width * (other_screenshot_height / other_screenshot_width)` — e.g. for
   screenshots shaped like 1080×2400, `crop_height = width * 2.222`.
2. In `README.md`, wrap the preview in a link to the full image, so clicking it opens GitHub's
   own scrollable/zoomable image viewer — see the HTML `<a><img></a>` pattern below.

## Updating README.md

- The "## Screenshots" section is a series of 2-column HTML `<table>`s (one table per row), not
  markdown pipe tables:
  ```html
  <table>
    <tr>
      <th width="50%">Today</th>
      <th width="50%">Morning check-in</th>
    </tr>
    <tr>
      <td><img src="./docs/screenshots/today.png" width="100%" alt="Today screen" /></td>
      <td>
        <img src="./docs/screenshots/checkin.png" width="100%" alt="Morning check-in screen" />
      </td>
    </tr>
  </table>
  ```
  Deliberately not markdown pipe tables: a markdown table's column widths are just
  text-padding — GitHub's renderer sizes columns from content, so two screenshots with
  different aspect ratios throw off the intended 50/50 split. Explicit `width="50%"` on each
  `<th>` (inherited by the `<td>` below it) plus `width="100%"` on each `<img>` forces the grid
  regardless of each image's native dimensions. This works specifically because GitHub's HTML
  sanitizer strips inline `style="..."` attributes but leaves real `width="..."` attributes
  alone (see the thumbnail-link pattern above for the same distinction cutting the other way —
  it's _why_ a scrollable box isn't achievable, but it's also why this **is**).
  For the report link, wrap the `<img>` in an `<a href="./docs/screenshots/report.png">`, same
  as the existing Trends/Provider-report row.
  Add new screenshots in the same pattern, then run `npx prettier --write README.md` — the
  repo's pre-commit hook enforces `prettier --check` on markdown/HTML, and it reformats the
  table's indentation and line-wrapping automatically.
- Keep alt text short and screen-accurate (`Today screen`, `Morning check-in screen`, ...).

## Gotchas

- The report screenshot (from a browser) and the live-screen screenshots (from the emulator)
  come from different pixel grids by nature — the report is a printed-page-shaped export
  (816×1056 @ 96dpi), the live screens are a phone's native resolution (1080×2400). Don't try to
  force them into matching absolute dimensions; the thumbnail-link pattern above only needs
  matching _aspect ratio_, not matching pixel counts.
- Fixture backups (`*.backup.json`, for seeding the live app) and fixture HTML (`*.html`, for
  the report) are generated from the same underlying scenario but are two independent files —
  seeding one has no effect on the other.
- Verify the seed actually landed before spending time composing screenshots: Today showing a
  streak/coverage count matching the fixture (not stale from whatever was seeded before),
  History non-empty, Trends showing solid bars with a real `logged X of Y days` count (not `0 of
1`), Settings showing the fixture's medication/dose. See `shift-fixture-into-android`'s own
  verification step for the full checklist.
- Switching between a CI release install and a local debug install (either direction) fails with
  `INSTALL_FAILED_UPDATE_INCOMPATIBLE: ... signatures do not match`, not a debuggability error —
  the two are signed with different keystores. `adb uninstall com.adhdlog.app` before installing
  the other one; this also wipes app storage, so re-seed after.
- A Trends chart can render with visibly correct bars but a stale header line (e.g. still saying
  `logged 14 of 14 days` right after switching the 7d/14d/30d range) for a moment — re-screenshot
  after a beat rather than trusting the first capture after a tap that changes derived text, not
  just visual state.
