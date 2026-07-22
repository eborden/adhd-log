---
name: capture-app-screenshots
description: Captures or updates the README's app screenshots (docs/screenshots/*.png) from a live Expo web build seeded with golden fixture data, plus the standalone provider-report HTML fixture. Use when asked to add, update, retake, or regenerate a screenshot for the README, or after a UI change makes an existing one stale.
---

# Capture App Screenshots

## Overview

`docs/screenshots/*.png` feeds the "## Screenshots" grid in `README.md`. There are two
different sources, captured two different ways:

1. **Live app screens** (Today, Morning check-in, Trends, History, Settings, ...) — captured
   from `expo start --web` after seeding it with golden fixture data.
2. **The provider report** — not a live screen. `exportPdfReport()` (`lib/export.ts`) goes
   straight to the OS share sheet with no in-app preview to screenshot, so it's captured by
   opening the standalone rendered fixture at `lib/__fixtures__/reports/<name>.html` directly
   in a browser instead.

Every screenshot currently in the repo uses the `clean-responder` scenario
(`lib/__fixtures__/reports/clean-responder.backup.json` / `.html`) — reuse it unless the user
asks for a different one, so the grid stays visually consistent (same person, same date range,
same numbers across every screenshot).

## Workflow: live app screens

1. Start the web build: `npm run web` (`expo start --web`), or confirm it's already running
   (default `http://localhost:8081`).
2. **Seed golden data by invoking the `shift-fixture-into-web` skill** — don't reinvent this.
   It runs `generate-seed-script.mjs` against a `lib/__fixtures__/reports/*.backup.json`
   fixture, evaluates the generated seed function _in the browser page_ via the chrome-devtools
   MCP tools, and reloads. Read that skill for the full mechanics and its gotchas (re-deriving
   `profile.createdAt` after the date shift, forcing `lockEnabled: false`, why the shift must
   run on the browser's own clock and not this shell's).
3. Pick one phone-shaped viewport and reuse it for every screen in this session, so the grid
   ends up uniform — e.g. `mcp__plugin_chrome-devtools-mcp_chrome-devtools__resize_page` to
   something like 412x915 (a common phone CSS viewport).
4. Take a snapshot/screenshot and check for dev-mode overlays before capturing anything (Expo's
   web dev toolbar, a LogBox-style toast, etc.). Dismiss them first — an overlay sitting over
   the tab bar can intercept taps on later navigation, not just spoil the image (this bit a
   prior capture session on Android: a "open debugger" toast overlapped the bottom tab bar and
   ate the first couple of navigation taps).
5. Navigate to each screen with `click` / `navigate_page` and capture with
   `mcp__plugin_chrome-devtools-mcp_chrome-devtools__take_screenshot`, `filePath` pointed at
   `docs/screenshots/<name>.png`. Use `fullPage: true` only for screens whose content can
   scroll past the viewport (e.g. Trends with several metrics charted); a plain viewport
   screenshot is more representative of what a phone screen actually shows for everything else.

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

- Don't try to match the pixel dimensions of the original Android-emulator-captured screenshots
  (1080×2400) exactly. This skill's web-based capture won't reproduce those dimensions bit-for-
  bit, and that's fine — consistency _within_ one capture session matters far more than matching
  historical files.
- Fixture backups (`*.backup.json`, for seeding the live app) and fixture HTML (`*.html`, for
  the report) are generated from the same underlying scenario but are two independent files —
  seeding one has no effect on the other.
- Verify the seed actually landed before spending time composing screenshots: History
  non-empty, Trends showing solid bars with a real `logged X of Y days` count (not `0 of 1`),
  Settings showing the fixture's medication/dose. See `shift-fixture-into-web`'s own
  verification step for the full checklist.
