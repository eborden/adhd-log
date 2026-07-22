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

1. Confirm an Android emulator is running with the app installed: `adb devices` should list it.
   If none is running, start one (e.g. `emulator -avd Pixel_7_API_34 -no-window -no-audio
-no-boot-anim -gpu swiftshader_indirect &`, adjusting the AVD name to what's available —
   `emulator -list-avds`). The committed screenshots were all taken at a Pixel 7 API 34's native
   resolution (1080×2400), which is also why that's the AVD to prefer for a consistent grid.
2. **Seed golden data by invoking the `shift-fixture-into-android` skill** — don't reinvent
   this. It reads the emulator's own clock, generates SQL from a
   `lib/__fixtures__/reports/*.backup.json` fixture, and writes it straight into the installed
   app's AsyncStorage-backed SQLite database via `adb ... run-as ... sqlite3`, then force-stops
   and restarts the app. Read that skill for the full mechanics and its gotchas (needing Metro +
   `adb reverse tcp:8081 tcp:8081` for the restart on a debug build, `run-as` requiring a
   debuggable install).
3. Before capturing anything, take one screenshot and check for dev-mode overlays (e.g. an
   "Open debugger to view warnings" LogBox toast). Dismiss them first — an overlay sitting over
   the bottom tab bar intercepts taps on later navigation, not just spoils the image. This bit a
   prior capture session directly: the toast overlapped the tab bar and ate the first couple of
   navigation taps before it was dismissed.
4. Navigate with `adb -s <serial> shell input tap <x> <y>` (coordinates in device pixels, read
   off the most recent screenshot — not any scaled-down preview of it) and capture with:
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
   own scrollable/zoomable image viewer:
   ```md
   [![Provider PDF report](docs/screenshots/report-preview.png)](docs/screenshots/report.png)
   ```

## Updating README.md

- The "## Screenshots" section is a series of 2-column markdown tables (one table per row).
  Add new screenshots in the same pattern, then run `npx prettier --write README.md` — the
  repo's pre-commit hook enforces `prettier --check` on markdown, and table column widths need
  reflowing by hand otherwise.
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
