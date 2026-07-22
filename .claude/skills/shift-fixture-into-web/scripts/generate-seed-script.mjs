// Reads a lib/__fixtures__/reports/*.backup.json fixture (shape: { exportedAt, profile, doses,
// entries }) and prints a self-contained JS function that, when run *in the browser page* (not in
// this Node process), shifts every date in the fixture so the most recent entry lands on
// "today" — computed from the browser's own `new Date()`, so it's correct regardless of clock
// drift between this shell and the page — then seeds `localStorage` with the shifted
// `profile`/`doses`/`entries` and returns a summary.
//
// The actual date-shift/re-derivation logic lives in ../../_shared/shift-fixture.mjs (shared with
// shift-fixture-into-android's equivalent script) — see that file for why `createdAt` is
// re-derived from the shifted `startDate` and why `lockEnabled` is forced off. This script only
// adds the web-specific parts: embedding that shared function's source (via `.toString()`) so it
// runs *inside the browser's JS realm* — required, because `todayIso` must come from the
// browser's own clock, not this Node process's — and writing the result into `localStorage`.
//
// Usage:
//   node .claude/skills/shift-fixture-into-web/scripts/generate-seed-script.mjs \
//     lib/__fixtures__/reports/long-multimonth.backup.json
//
// Prints the function body to stdout. Pipe it to pbcopy, paste it into the running web app's
// DevTools console (as an IIFE, i.e. wrap in parens and call it), or pass it as the `function`
// argument to the chrome-devtools MCP tool's evaluate_script.

import { readFileSync } from 'node:fs';
import { shiftFixture } from '../../_shared/shift-fixture.mjs';

const fixturePath = process.argv[2];
if (fixturePath === undefined) {
  console.error('Usage: node generate-seed-script.mjs <path-to-fixture.backup.json>');
  process.exit(1);
}

const backup = JSON.parse(readFileSync(fixturePath, 'utf8'));
const { profile, doses, entries } = backup;

const fn = `() => {
  const profile = ${JSON.stringify(profile)};
  const doses = ${JSON.stringify(doses)};
  const entries = ${JSON.stringify(entries)};

  const shiftFixture = ${shiftFixture.toString()};

  function todayLocal() {
    const d = new Date();
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return \`\${yy}-\${mm}-\${dd}\`;
  }

  const result = shiftFixture(profile, doses, entries, todayLocal());

  localStorage.setItem('profile', JSON.stringify(result.profile));
  localStorage.setItem('doses', JSON.stringify(result.doses));
  localStorage.setItem('entries', JSON.stringify(result.entries));

  return {
    shiftDays: result.shiftDays,
    today: result.today,
    firstEntryDate: result.firstEntryDate,
    lastEntryDate: result.lastEntryDate,
    doseDates: result.doseDates,
    startDate: result.startDate,
    createdAt: result.createdAt,
  };
}`;

console.log(fn);
