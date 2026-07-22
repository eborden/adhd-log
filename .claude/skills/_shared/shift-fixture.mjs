// Shared date-shift transform for lib/__fixtures__/reports/*.backup.json fixtures
// (shape: { exportedAt, profile, doses, entries }).
//
// Shifts every date in a fixture by a constant number of days so the most recent entry lands
// on `todayIso`, preserving the fixture's original day-to-day spacing exactly (a pure
// translation, not a rescale — e.g. "every 3rd day" stays "every 3rd day").
//
// Two skills reuse this exact function, each for a different seeding target:
//   - shift-fixture-into-web:     runs it *inside the browser*, via its `.toString()` source
//                                  spliced into a generated function (so `todayIso` comes from
//                                  the browser's own clock, not this shell's — see that skill's
//                                  SKILL.md for why that distinction matters).
//   - shift-fixture-into-android: imports and calls it directly in this Node process, with
//                                  `todayIso` read from the emulator's own clock via
//                                  `adb shell date` (same "use the target's clock" principle,
//                                  different mechanism since there's no in-app JS to run this in).
//
// Kept as a single exported function (not a class/module with hidden state) specifically so
// `shiftFixture.toString()` is a valid, self-contained function body that can be embedded
// verbatim into browser-eval'd code — don't add closures over module-level state here, or the
// web skill's embedding breaks.
//
// Why the shift touches `profile.createdAt`, not just entries: lib/export.ts's
// `coverage()`/`loggingStartDate()` floors the Trends "logged X of Y days" denominator at
// `profile.createdAt`. Fixtures freeze `createdAt` to their report-generation timestamp. If a
// shift moves entries/doses but leaves `createdAt` where it was, the coverage floor lands
// *after* the shifted entries, Trends clips its window to almost nothing, and everything renders
// as a gap even though real data now exists. Always re-derive `createdAt` from the shifted
// `startDate`, never leave it stale.
//
// Why `lockEnabled` is forced to `false`, regardless of the fixture's own value: several
// fixtures (e.g. `titration-journey`, `short-week`) set `lockEnabled: true`. Neither seeding
// target can get past a real lock screen — on web, `expo-local-authentication`'s
// `authenticateAsync()` isn't implemented; on the Android emulator, there's no enrolled
// biometric/PIN to satisfy it non-interactively either. Seeding a lock-enabled profile strands
// the tester on `This is private, on this device.` with no way forward short of clearing storage
// and reseeding.
export function shiftFixture(profile, doses, entries, todayIso) {
  function shiftDate(dateStr, days) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  }
  function utcMs(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  }

  const entryDates = Object.keys(entries).sort();
  const lastOriginalDate = entryDates[entryDates.length - 1];
  const shiftDays = Math.round((utcMs(todayIso) - utcMs(lastOriginalDate)) / 86400000);

  const newProfile = {
    ...profile,
    startDate: shiftDate(profile.startDate, shiftDays),
    createdAt: shiftDate(profile.startDate, shiftDays) + 'T00:00:00.000Z',
    lockEnabled: false,
  };

  const newDoses = doses.map((change) => ({ ...change, date: shiftDate(change.date, shiftDays) }));

  const newEntries = {};
  for (const [date, entry] of Object.entries(entries)) {
    const newDate = shiftDate(date, shiftDays);
    const newEntry = { ...entry, date: newDate };
    if (newEntry.morning)
      newEntry.morning = { ...newEntry.morning, completedAt: newDate + 'T08:05:00.000Z' };
    if (newEntry.evening)
      newEntry.evening = { ...newEntry.evening, completedAt: newDate + 'T20:35:00.000Z' };
    newEntries[newDate] = newEntry;
  }

  return {
    profile: newProfile,
    doses: newDoses,
    entries: newEntries,
    shiftDays,
    today: todayIso,
    firstEntryDate: Object.keys(newEntries).sort()[0],
    lastEntryDate: Object.keys(newEntries).sort().slice(-1)[0],
    doseDates: newDoses.map((c) => c.date),
    startDate: newProfile.startDate,
    createdAt: newProfile.createdAt,
  };
}
