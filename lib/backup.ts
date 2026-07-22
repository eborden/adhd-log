import {
  isDoseChangeList,
  isIsoTimestamp,
  isoTimestampNow,
  parseEntries,
  parseProfile,
  parseWeekly,
} from './storage';
import type {
  DayEntry,
  DoseChange,
  IsoDate,
  IsoTimestamp,
  Parsed,
  Profile,
  WeeklyCheckin,
} from './types';

export interface Backup {
  readonly exportedAt: IsoTimestamp;
  readonly profile: Profile | null;
  readonly doses: readonly DoseChange[];
  readonly entries: Readonly<Record<IsoDate, DayEntry>>;
  readonly weekly: Readonly<Record<IsoDate, WeeklyCheckin>>;
}

export function buildBackup(
  profile: Profile | null,
  doses: readonly DoseChange[],
  entries: Readonly<Record<IsoDate, DayEntry>>,
  weekly: Readonly<Record<IsoDate, WeeklyCheckin>>,
): Backup {
  return { exportedAt: isoTimestampNow(), profile, doses, entries, weekly };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseBackup(raw: unknown): Parsed<Backup> {
  if (!isRecord(raw) || !isIsoTimestamp(raw['exportedAt'])) {
    return { ok: false, reason: 'Malformed backup: missing exportedAt' };
  }
  const profileRaw = raw['profile'];
  let profile: Profile | null = null;
  if (profileRaw !== null) {
    const parsedProfile = parseProfile(profileRaw);
    if (!parsedProfile.ok)
      return { ok: false, reason: `Malformed backup: ${parsedProfile.reason}` };
    profile = parsedProfile.value;
  }
  const doses = raw['doses'];
  if (!isDoseChangeList(doses)) {
    return { ok: false, reason: 'Malformed backup: invalid doses' };
  }
  const parsedEntries = parseEntries(raw['entries']);
  if (!parsedEntries.ok) {
    return { ok: false, reason: 'Malformed backup: invalid entries' };
  }
  // Backward compatibility: a pre-#13 backup has no "weekly" key at all — that's a legacy
  // export, not corruption, so it parses to an empty map. A *present but malformed* value
  // still fails the parse, same as every other field.
  const weeklyRaw = raw['weekly'];
  let weekly: Readonly<Record<IsoDate, WeeklyCheckin>> = {};
  if (weeklyRaw !== undefined) {
    const parsedWeekly = parseWeekly(weeklyRaw);
    if (!parsedWeekly.ok) return { ok: false, reason: 'Malformed backup: invalid weekly' };
    weekly = parsedWeekly.value;
  }
  return {
    ok: true,
    value: { exportedAt: raw['exportedAt'], profile, doses, entries: parsedEntries.value, weekly },
  };
}
