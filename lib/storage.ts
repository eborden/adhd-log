import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Backup } from './export';
import {
  EVENING_RATING_KEYS,
  HOURS,
  MINUTES,
  MORNING_RATING_KEYS,
  SIDE_EFFECTS,
  type DayEntry,
  type Dose,
  type DoseChange,
  type DoseUnit,
  type EveningCheckin,
  type EveningRatingKey,
  type Hour,
  type IsoDate,
  type IsoTimestamp,
  type MedName,
  type Minute,
  type MorningCheckin,
  type MorningRatingKey,
  type Parsed,
  type Profile,
  type Rating,
  type SideEffect,
  type TimeOfDay,
} from './types';

// ---------------------------------------------------------------------------
// Guards — the only place untrusted JSON shapes are narrowed, never cast.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// `Array.isArray` narrows to `any[]`; this keeps element access at `unknown`.
function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

export function isIsoDate(value: unknown): value is IsoDate {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isIsoTimestamp(value: unknown): value is IsoTimestamp {
  return typeof value === 'string' && value !== '' && !Number.isNaN(Date.parse(value));
}

export function isMedName(value: unknown): value is MedName {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isRating(value: unknown): value is Rating {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

export function isHour(value: unknown): value is Hour {
  return typeof value === 'number' && (HOURS as readonly number[]).includes(value);
}

export function isMinute(value: unknown): value is Minute {
  return typeof value === 'number' && (MINUTES as readonly number[]).includes(value);
}

export function isDoseUnit(value: unknown): value is DoseUnit {
  return value === 'mg' || value === 'mcg' || value === 'mL';
}

export function isSideEffect(value: unknown): value is SideEffect {
  return typeof value === 'string' && (SIDE_EFFECTS as readonly string[]).includes(value);
}

export function isEveningRatingKey(value: unknown): value is EveningRatingKey {
  return typeof value === 'string' && (EVENING_RATING_KEYS as readonly string[]).includes(value);
}

export function isMorningRatingKey(value: unknown): value is MorningRatingKey {
  return typeof value === 'string' && (MORNING_RATING_KEYS as readonly string[]).includes(value);
}

export function isTimeOfDay(value: unknown): value is TimeOfDay {
  return isRecord(value) && isHour(value['hour']) && isMinute(value['minute']);
}

export function isDose(value: unknown): value is Dose {
  return isRecord(value) && typeof value['amount'] === 'number' && isDoseUnit(value['unit']);
}

export function isProfile(value: unknown): value is Profile {
  if (
    !isRecord(value) ||
    !isMedName(value['medName']) ||
    !isIsoDate(value['startDate']) ||
    !isDose(value['currentDose']) ||
    !isTimeOfDay(value['morningReminder']) ||
    !isTimeOfDay(value['eveningReminder']) ||
    typeof value['lockEnabled'] !== 'boolean' ||
    !isIsoTimestamp(value['createdAt'])
  ) {
    return false;
  }
  const enabledEveningMetrics = value['enabledEveningMetrics'];
  return (
    enabledEveningMetrics === undefined ||
    (isUnknownArray(enabledEveningMetrics) && enabledEveningMetrics.every(isEveningRatingKey))
  );
}

export function isDoseChange(value: unknown): value is DoseChange {
  if (!isRecord(value) || !isIsoDate(value['date']) || !isDose(value['dose'])) {
    return false;
  }
  const note = value['note'];
  return note === undefined || typeof note === 'string';
}

export function isDoseChangeList(value: unknown): value is readonly DoseChange[] {
  return isUnknownArray(value) && value.every(isDoseChange);
}

export function isMorningCheckin(value: unknown): value is MorningCheckin {
  if (!isRecord(value)) return false;
  if (typeof value['doseTaken'] !== 'boolean') return false;
  if (!isRating(value['sleepQuality'])) return false;
  if (!isRating(value['wakingMood'])) return false;
  if (!isIsoTimestamp(value['completedAt'])) return false;
  const sleepHours = value['sleepHours'];
  return sleepHours === undefined || typeof sleepHours === 'number';
}

export function isEveningCheckin(value: unknown): value is EveningCheckin {
  if (!isRecord(value)) return false;
  for (const key of EVENING_RATING_KEYS) {
    const rating = value[key];
    if (!(rating === undefined || isRating(rating))) return false;
  }
  const sideEffects = value['sideEffects'];
  if (!isUnknownArray(sideEffects) || !sideEffects.every(isSideEffect)) return false;
  if (!isIsoTimestamp(value['completedAt'])) return false;
  const notes = value['notes'];
  return notes === undefined || typeof notes === 'string';
}

export function isDayEntry(value: unknown): value is DayEntry {
  if (!isRecord(value) || !isIsoDate(value['date'])) return false;
  const morning = value['morning'];
  if (morning !== undefined && !isMorningCheckin(morning)) return false;
  const evening = value['evening'];
  if (evening !== undefined && !isEveningCheckin(evening)) return false;
  return true;
}

export function isEntries(value: unknown): value is Readonly<Record<IsoDate, DayEntry>> {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([key, entry]) => isIsoDate(key) && isDayEntry(entry));
}

// ---------------------------------------------------------------------------
// Parsed<T> — storage boundary. Callers get an explicit ok/reason, never a throw.
// ---------------------------------------------------------------------------

export function parseProfile(raw: unknown): Parsed<Profile> {
  if (isProfile(raw)) return { ok: true, value: raw };
  return { ok: false, reason: 'Malformed profile JSON' };
}

export function parseDoseChangeList(raw: unknown): Parsed<readonly DoseChange[]> {
  if (isDoseChangeList(raw)) return { ok: true, value: raw };
  return { ok: false, reason: 'Malformed dose-change JSON' };
}

export function parseEntries(raw: unknown): Parsed<Readonly<Record<IsoDate, DayEntry>>> {
  if (isEntries(raw)) return { ok: true, value: raw };
  return { ok: false, reason: 'Malformed entries JSON' };
}

// ---------------------------------------------------------------------------
// Date / streak / dose-timeline helpers — pure, no I/O.
// ---------------------------------------------------------------------------

function toDateParts(date: IsoDate): readonly [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) {
    throw new Error(`Invalid IsoDate: ${date}`);
  }
  const [, year, month, day] = match;
  return [Number(year), Number(month), Number(day)];
}

export function parseIsoDate(date: IsoDate): Date {
  const [year, month, day] = toDateParts(date);
  return new Date(year, month - 1, day);
}

// getFullYear() can exceed 4 digits (e.g. year 12026), which breaks the
// "YYYY-MM-DD" format — narrow through the guard rather than asserting.
export function formatIsoDate(date: Date): IsoDate {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const formatted = `${year}-${month}-${day}`;
  if (!isIsoDate(formatted)) {
    throw new Error(`Invalid IsoDate: ${formatted}`);
  }
  return formatted;
}

export function todayIsoDate(clock: Date = new Date()): IsoDate {
  return formatIsoDate(clock);
}

export function isoTimestampNow(clock: Date = new Date()): IsoTimestamp {
  const formatted = clock.toISOString();
  if (!isIsoTimestamp(formatted)) {
    throw new Error(`Invalid IsoTimestamp: ${formatted}`);
  }
  return formatted;
}

export function addDays(date: IsoDate, delta: number): IsoDate {
  const asDate = parseIsoDate(date);
  asDate.setDate(asDate.getDate() + delta);
  return formatIsoDate(asDate);
}

/** The `n` dates ending at (and including) `endDate`, oldest first. */
export function lastNDates(n: number, endDate: IsoDate): readonly IsoDate[] {
  const dates: IsoDate[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    dates.push(addDays(endDate, -i));
  }
  return dates;
}

/** Consecutive days ending at `today` with at least one completed session. */
export function computeStreak(
  entries: Readonly<Record<IsoDate, DayEntry>>,
  today: IsoDate,
): number {
  let streak = 0;
  let cursor = today;
  for (;;) {
    const entry = entries[cursor];
    const hasCheckin =
      entry !== undefined && (entry.morning !== undefined || entry.evening !== undefined);
    if (!hasCheckin) break;
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** Which of `dates` should render a dose-change marker on the trend chart. */
export function doseChangeMarkers(
  doses: readonly DoseChange[],
  dates: readonly IsoDate[],
): ReadonlySet<IsoDate> {
  const changeDates = new Set(doses.map((change) => change.date));
  return new Set(dates.filter((date) => changeDates.has(date)));
}

// ---------------------------------------------------------------------------
// Persistence — thin AsyncStorage-backed get/save, all local-only.
// ---------------------------------------------------------------------------

const STORAGE_KEYS = {
  profile: 'profile',
  doses: 'doses',
  entries: 'entries',
} as const;

async function readJson(key: string): Promise<unknown> {
  const raw = await AsyncStorage.getItem(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export async function loadProfile(): Promise<Profile | null> {
  const raw = await readJson(STORAGE_KEYS.profile);
  if (raw === null) return null;
  const parsed = parseProfile(raw);
  return parsed.ok ? parsed.value : null;
}

export async function saveProfile(profile: Profile): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.profile, JSON.stringify(profile));
}

export async function loadDoseChanges(): Promise<readonly DoseChange[]> {
  const raw = await readJson(STORAGE_KEYS.doses);
  if (raw === null) return [];
  const parsed = parseDoseChangeList(raw);
  return parsed.ok ? parsed.value : [];
}

export async function saveDoseChanges(doses: readonly DoseChange[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.doses, JSON.stringify(doses));
}

export async function appendDoseChange(change: DoseChange): Promise<readonly DoseChange[]> {
  const existing = await loadDoseChanges();
  const next = [...existing, change].sort((a, b) => a.date.localeCompare(b.date));
  await saveDoseChanges(next);
  return next;
}

export async function loadEntries(): Promise<Readonly<Record<IsoDate, DayEntry>>> {
  const raw = await readJson(STORAGE_KEYS.entries);
  if (raw === null) return {};
  const parsed = parseEntries(raw);
  return parsed.ok ? parsed.value : {};
}

export async function saveEntries(entries: Readonly<Record<IsoDate, DayEntry>>): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.entries, JSON.stringify(entries));
}

export type CheckinInput =
  | { readonly session: 'morning'; readonly checkin: MorningCheckin }
  | { readonly session: 'evening'; readonly checkin: EveningCheckin };

/** Writes one session's check-in for `date`, preserving the other session. */
export async function saveCheckin(date: IsoDate, input: CheckinInput): Promise<DayEntry> {
  const entries = await loadEntries();
  const existing = entries[date];
  const merged: DayEntry = {
    date,
    ...(input.session === 'morning'
      ? { morning: input.checkin }
      : existing?.morning !== undefined
        ? { morning: existing.morning }
        : {}),
    ...(input.session === 'evening'
      ? { evening: input.checkin }
      : existing?.evening !== undefined
        ? { evening: existing.evening }
        : {}),
  };
  await saveEntries({ ...entries, [date]: merged });
  return merged;
}

export async function clearAllData(): Promise<void> {
  await AsyncStorage.multiRemove([STORAGE_KEYS.profile, STORAGE_KEYS.doses, STORAGE_KEYS.entries]);
}

/**
 * Persists all three keys of a parsed backup together, so a restore can't silently drop one.
 * A `null` profile leaves the existing profile untouched (matches the import UI's contract).
 * AsyncStorage has no transactions; `Promise.all` gives consistency-on-success, which is enough
 * for a single-user, local-only app.
 */
export async function restoreBackup(backup: Backup): Promise<void> {
  await Promise.all([
    backup.profile !== null ? saveProfile(backup.profile) : Promise.resolve(),
    saveDoseChanges(backup.doses),
    saveEntries(backup.entries),
  ]);
}
