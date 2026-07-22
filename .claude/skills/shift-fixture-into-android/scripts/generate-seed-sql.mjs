// Reads a lib/__fixtures__/reports/*.backup.json fixture (shape: { exportedAt, profile, doses,
// entries }) and prints SQL statements that seed the Android emulator's AsyncStorage-backed
// SQLite database directly — the emulator-side equivalent of shift-fixture-into-web's
// localStorage injection.
//
// The actual date-shift/re-derivation logic lives in ../../_shared/shift-fixture.mjs (shared
// with shift-fixture-into-web's equivalent script) — see that file for why `createdAt` is
// re-derived from the shifted `startDate` and why `lockEnabled` is forced off.
//
// Unlike the web script, this one shifts dates in *this* Node process rather than embedding the
// transform for in-browser execution — there's no equivalent of "eval this in the app's JS
// realm" for a compiled Android build, so `todayIso` must be supplied by the caller instead of
// being computed in-process. Always source it from the emulator's own clock
// (`adb -s <serial> shell date +%Y-%m-%d`), not this shell's — same "use the target's clock, not
// the host's" principle as the web script, different mechanism.
//
// Usage:
//   TODAY=$(adb -s emulator-5554 shell date +%Y-%m-%d | tr -d '\r')
//   node .claude/skills/shift-fixture-into-android/scripts/generate-seed-sql.mjs \
//     lib/__fixtures__/reports/clean-responder.backup.json "$TODAY" \
//     > /tmp/seed.sql
//
// Prints SQL to stdout (pipe straight into
// `adb shell "run-as <package> sqlite3 databases/RKStorage"`) and a JSON summary to stderr for
// sanity-checking (shiftDays, today, firstEntryDate, lastEntryDate, doseDates, startDate,
// createdAt) — same shape shift-fixture-into-web's browser-side function returns.

import { readFileSync } from 'node:fs';
import { shiftFixture } from '../../_shared/shift-fixture.mjs';

const [fixturePath, todayIso] = process.argv.slice(2);
if (fixturePath === undefined || todayIso === undefined) {
  console.error(
    'Usage: node generate-seed-sql.mjs <path-to-fixture.backup.json> <today-YYYY-MM-DD>',
  );
  process.exit(1);
}

const backup = JSON.parse(readFileSync(fixturePath, 'utf8'));
const { profile, doses, entries } = backup;

const result = shiftFixture(profile, doses, entries, todayIso);

function sqlEscape(value) {
  return value.replace(/'/g, "''");
}

function upsert(key, value) {
  return `INSERT OR REPLACE INTO catalystLocalStorage (key, value) VALUES ('${key}', '${sqlEscape(JSON.stringify(value))}');`;
}

console.log(upsert('profile', result.profile));
console.log(upsert('doses', result.doses));
console.log(upsert('entries', result.entries));

console.error(
  JSON.stringify(
    {
      shiftDays: result.shiftDays,
      today: result.today,
      firstEntryDate: result.firstEntryDate,
      lastEntryDate: result.lastEntryDate,
      doseDates: result.doseDates,
      startDate: result.startDate,
      createdAt: result.createdAt,
    },
    null,
    2,
  ),
);
