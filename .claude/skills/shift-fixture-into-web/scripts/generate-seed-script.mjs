// Reads a lib/__fixtures__/reports/*.backup.json fixture (shape: { exportedAt, profile, doses,
// entries }) and prints a self-contained JS function that, when run *in the browser page*
// (not in this Node process), shifts every date in the fixture by a constant number of days so
// the most recent entry lands on "today" — computed from the browser's own `new Date()`, so it's
// correct regardless of clock drift between this shell and the page — then seeds `localStorage`
// with the shifted `profile`/`doses`/`entries` and returns a summary.
//
// The shift is a pure translation, not a rescale: every date moves by the same number of days,
// so the fixture's original cadence/spacing (e.g. "every 3rd day") is preserved exactly.
//
// Why the shift touches `profile.createdAt`: lib/export.ts's `coverage()`/`loggingStartDate()`
// floors the Trends "logged X of Y days" denominator at `profile.createdAt`. Fixtures freeze
// `createdAt` to their report-generation timestamp, which after a shift is no longer close to
// the (now-shifted) earliest entry date. Left unshifted, Trends clips its window to almost
// nothing and everything renders as a gap even though real data exists. This script always
// re-derives `createdAt` from the shifted `startDate`, never leaves it stale.
//
// Why `lockEnabled` is forced to false: on web, expo-local-authentication's authenticateAsync()
// isn't implemented (only its hardware/enrollment-check stubs are), so a fixture with
// lockEnabled: true strands the tester on the app's lock screen with no way to unlock it.
//
// Usage:
//   node .claude/skills/shift-fixture-into-web/scripts/generate-seed-script.mjs \
//     lib/__fixtures__/reports/long-multimonth.backup.json
//
// Prints the function body to stdout. Pipe it to pbcopy, paste it into the running web app's
// DevTools console (as an IIFE, i.e. wrap in parens and call it), or pass it as the `function`
// argument to the chrome-devtools MCP tool's evaluate_script.

import { readFileSync } from 'node:fs';

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

  function shiftDate(dateStr, days) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    return \`\${yy}-\${mm}-\${dd}\`;
  }
  function todayLocal() {
    const d = new Date();
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return \`\${yy}-\${mm}-\${dd}\`;
  }
  function utcMs(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  }

  const entryDates = Object.keys(entries).sort();
  const lastOriginalDate = entryDates[entryDates.length - 1];
  const today = todayLocal();
  const shiftDays = Math.round((utcMs(today) - utcMs(lastOriginalDate)) / 86400000);

  const newProfile = {
    ...profile,
    startDate: shiftDate(profile.startDate, shiftDays),
    createdAt: shiftDate(profile.startDate, shiftDays) + 'T00:00:00.000Z',
    // Forced off: on web, expo-local-authentication's authenticateAsync() isn't implemented
    // (its web shim only stubs the hardware/enrollment checks), so LockScreen's unlock attempt
    // always throws and there is no way to get past it. A fixture with lockEnabled: true would
    // otherwise strand the tester on the lock screen with no bypass.
    lockEnabled: false,
  };

  const newDoses = doses.map((change) => ({ ...change, date: shiftDate(change.date, shiftDays) }));

  const newEntries = {};
  for (const [date, entry] of Object.entries(entries)) {
    const newDate = shiftDate(date, shiftDays);
    const newEntry = { ...entry, date: newDate };
    if (newEntry.morning) newEntry.morning = { ...newEntry.morning, completedAt: newDate + 'T08:05:00.000Z' };
    if (newEntry.evening) newEntry.evening = { ...newEntry.evening, completedAt: newDate + 'T20:35:00.000Z' };
    newEntries[newDate] = newEntry;
  }

  localStorage.setItem('profile', JSON.stringify(newProfile));
  localStorage.setItem('doses', JSON.stringify(newDoses));
  localStorage.setItem('entries', JSON.stringify(newEntries));

  return {
    shiftDays,
    today,
    firstEntryDate: Object.keys(newEntries).sort()[0],
    lastEntryDate: Object.keys(newEntries).sort().slice(-1)[0],
    doseDates: newDoses.map((c) => c.date),
    startDate: newProfile.startDate,
    createdAt: newProfile.createdAt,
  };
}`;

console.log(fn);
