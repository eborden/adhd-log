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
  type RatingKey,
  type SideEffect,
  type SideEffectDetail,
  type SideEffectReports,
  type SideEffectSeverity,
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

// A ratings sub-object: a record whose present keys (restricted to `keys`) each hold a Rating.
function isRatingsRecord(value: unknown, keys: readonly RatingKey[]): boolean {
  if (!isRecord(value)) return false;
  for (const key of keys) {
    const rating = value[key];
    if (!(rating === undefined || isRating(rating))) return false;
  }
  return true;
}

export function isMorningCheckin(value: unknown): value is MorningCheckin {
  if (!isRecord(value)) return false;
  if (!isRatingsRecord(value['ratings'], MORNING_RATING_KEYS)) return false;
  if (typeof value['doseTaken'] !== 'boolean') return false;
  if (!isIsoTimestamp(value['completedAt'])) return false;
  const sleepHours = value['sleepHours'];
  return sleepHours === undefined || typeof sleepHours === 'number';
}

export function isSideEffectSeverity(value: unknown): value is SideEffectSeverity {
  return value === 'mild' || value === 'moderate' || value === 'severe';
}

function isSideEffectDetail(value: unknown): value is SideEffectDetail {
  if (!isRecord(value)) return false;
  if (!isSideEffectSeverity(value['severity'])) return false;
  const origin = value['origin'];
  return origin === undefined || origin === 'migrated';
}

/** Legacy chips stored a bare SideEffect[]; migrate-on-read to a labeled, marked default. */
const LEGACY_SIDE_EFFECT_SEVERITY: SideEffectSeverity = 'moderate';

/** Accepts legacy SideEffect[] AND the new keyed record; always returns the new shape. */
function parseSideEffectReports(value: unknown): SideEffectReports | undefined {
  const out: Partial<Record<SideEffect, SideEffectDetail>> = {};
  if (isUnknownArray(value)) {
    for (const item of value) {
      if (!isSideEffect(item)) return undefined; // reject genuinely malformed items
      if (out[item] !== undefined) continue; // dedupe any legacy repeats, first wins
      out[item] = { severity: LEGACY_SIDE_EFFECT_SEVERITY, origin: 'migrated' };
    }
    return out;
  }
  if (isRecord(value)) {
    for (const [key, detail] of Object.entries(value)) {
      if (!isSideEffect(key)) return undefined;
      if (!isSideEffectDetail(detail)) return undefined;
      out[key] = detail; // object keys are unique → duplicate-effect impossible
    }
    return out;
  }
  return undefined;
}

/**
 * Validates AND normalizes — the returned object is always the new keyed-record shape, even
 * for a legacy `sideEffects: string[]` value.
 */
export function parseEveningCheckin(value: unknown): EveningCheckin | undefined {
  if (!isRecord(value)) return undefined;
  const ratingsRaw = value['ratings'];
  if (!isRecord(ratingsRaw)) return undefined;
  const ratings: Partial<Record<EveningRatingKey, Rating>> = {};
  for (const key of EVENING_RATING_KEYS) {
    const rating = ratingsRaw[key];
    if (rating === undefined) continue;
    if (!isRating(rating)) return undefined;
    ratings[key] = rating;
  }
  const sideEffects = parseSideEffectReports(value['sideEffects']);
  if (sideEffects === undefined) return undefined;
  const completedAt = value['completedAt'];
  if (!isIsoTimestamp(completedAt)) return undefined;
  const notes = value['notes'];
  if (!(notes === undefined || typeof notes === 'string')) return undefined;
  return {
    ratings,
    sideEffects,
    completedAt,
    ...(notes !== undefined ? { notes } : {}),
  };
}

/**
 * Validity check ONLY. A `true` result does NOT mean `value` already has the new shape
 * (legacy string[] side effects also validate). Never narrow-and-return the raw value; only
 * `parseEveningCheckin` mints an `EveningCheckin`. Returns boolean by design — a
 * `value is EveningCheckin` predicate would be a lie for legacy input.
 */
export function isEveningCheckin(value: unknown): boolean {
  return parseEveningCheckin(value) !== undefined;
}

/** Validates AND normalizes a day entry — the sole minter of `DayEntry` alongside the callers below. */
export function parseDayEntry(value: unknown): DayEntry | undefined {
  if (!isRecord(value) || !isIsoDate(value['date'])) return undefined;
  const date = value['date'];
  const morningRaw = value['morning'];
  let morning: MorningCheckin | undefined;
  if (morningRaw !== undefined) {
    if (!isMorningCheckin(morningRaw)) return undefined;
    morning = morningRaw; // isMorningCheckin is a genuine, passthrough-safe predicate
  }
  const eveningRaw = value['evening'];
  let evening: EveningCheckin | undefined;
  if (eveningRaw !== undefined) {
    evening = parseEveningCheckin(eveningRaw);
    if (evening === undefined) return undefined;
  }
  return {
    date,
    ...(morning !== undefined ? { morning } : {}),
    ...(evening !== undefined ? { evening } : {}),
  };
}

/** Validity check ONLY — like `isEveningCheckin`, never the value path. */
export function isDayEntry(value: unknown): boolean {
  return parseDayEntry(value) !== undefined;
}

/** Validity check ONLY — never the value path (that's `parseEntries`/`parseEntriesTolerant`). */
export function isEntries(value: unknown): boolean {
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

/**
 * All-or-nothing normalizing parse (used by backup import): every day must parse, and each is
 * returned in the new keyed-record shape. Legacy `sideEffects: string[]` days are migrated.
 */
export function parseEntries(raw: unknown): Parsed<Readonly<Record<IsoDate, DayEntry>>> {
  if (!isRecord(raw)) return { ok: false, reason: 'Malformed entries JSON' };
  const out: Record<IsoDate, DayEntry> = {};
  for (const [key, entryRaw] of Object.entries(raw)) {
    if (!isIsoDate(key)) return { ok: false, reason: 'Malformed entries JSON' };
    const entry = parseDayEntry(entryRaw);
    if (entry === undefined) return { ok: false, reason: 'Malformed entries JSON' };
    out[key] = entry;
  }
  return { ok: true, value: out };
}

export interface EntriesParse {
  /** The days that parsed cleanly. */
  readonly entries: Readonly<Record<IsoDate, DayEntry>>;
  /** Keys that failed `isDayEntry` or weren't a valid `IsoDate` — quarantined, not merged. */
  readonly droppedKeys: readonly string[];
  /** The raw value wasn't even an object — a non-empty but unreadable store, not a fresh one. */
  readonly hardFailure: boolean;
}

/**
 * Parses the entries map day-by-day so a single corrupt record costs one day, not the whole
 * longitudinal history. `hardFailure` distinguishes "unreadable store" (don't clobber) from a
 * genuinely empty one.
 */
export function parseEntriesTolerant(raw: unknown): EntriesParse {
  if (!isRecord(raw)) return { entries: {}, droppedKeys: [], hardFailure: true };
  const entries: Record<IsoDate, DayEntry> = {};
  const droppedKeys: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    // parseDayEntry both validates and normalizes legacy shapes — the value path never
    // returns a raw blob, so migrate-on-read applies to every load.
    const entry = isIsoDate(key) ? parseDayEntry(value) : undefined;
    if (isIsoDate(key) && entry !== undefined) entries[key] = entry;
    else droppedKeys.push(key);
  }
  return { entries, droppedKeys, hardFailure: false };
}

/**
 * Each effect's first-appearance date across the FULL log (not any export range), so onset is
 * true first-seen. YYYY-MM-DD sorts chronologically. Pure — no I/O.
 */
export function firstOnsetDates(
  entries: Readonly<Record<IsoDate, DayEntry>>,
): ReadonlyMap<SideEffect, IsoDate> {
  const onset = new Map<SideEffect, IsoDate>();
  const dates = Object.keys(entries)
    .filter(isIsoDate)
    .sort((a, b) => a.localeCompare(b));
  for (const date of dates) {
    const evening = entries[date]?.evening;
    if (evening === undefined) continue;
    for (const effect of SIDE_EFFECTS) {
      if (evening.sideEffects[effect] === undefined) continue;
      if (!onset.has(effect)) onset.set(effect, date);
    }
  }
  return onset;
}

/** The dose active on `date` — the last change on/before it. `doses` is sorted ascending. */
export function doseActiveOn(doses: readonly DoseChange[], date: IsoDate): Dose | undefined {
  let active: Dose | undefined;
  for (const change of doses) {
    if (change.date.localeCompare(date) <= 0) active = change.dose;
    else break;
  }
  return active;
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

/**
 * Every calendar day from `start` to `end` inclusive, oldest first. Empty when `end` precedes
 * `start`. The report derives its display rows from this so a range arrives as two dates rather
 * than a count. Pure — no I/O.
 */
export function datesInRange(start: IsoDate, end: IsoDate): readonly IsoDate[] {
  const dates: IsoDate[] = [];
  let cursor = start;
  while (cursor.localeCompare(end) <= 0) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
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
  // Tolerant per-element parse: one malformed change drops that entry, not the whole timeline.
  if (!isUnknownArray(raw)) return [];
  return raw.filter(isDoseChange);
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

/**
 * Reads the entries store, returning both the tolerant parse and the original raw string (for
 * quarantine). Unparseable JSON is a hard failure — a non-empty but unreadable store — distinct
 * from a genuinely absent one (`rawString === null`).
 */
async function loadEntriesRaw(): Promise<{
  readonly rawString: string | null;
  readonly parse: EntriesParse;
}> {
  const rawString = await AsyncStorage.getItem(STORAGE_KEYS.entries);
  if (rawString === null) {
    return { rawString: null, parse: { entries: {}, droppedKeys: [], hardFailure: false } };
  }
  try {
    return { rawString, parse: parseEntriesTolerant(JSON.parse(rawString) as unknown) };
  } catch {
    return { rawString, parse: { entries: {}, droppedKeys: [], hardFailure: true } };
  }
}

/** Copies an unreadable/partially-bad raw blob to a timestamped key so it can be recovered. */
async function quarantineEntries(rawString: string | null): Promise<void> {
  if (rawString === null) return;
  await AsyncStorage.setItem(`${STORAGE_KEYS.entries}.corrupt.${isoTimestampNow()}`, rawString);
}

export async function loadEntries(): Promise<Readonly<Record<IsoDate, DayEntry>>> {
  return (await loadEntriesRaw()).parse.entries;
}

export async function saveEntries(entries: Readonly<Record<IsoDate, DayEntry>>): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.entries, JSON.stringify(entries));
}

export type CheckinInput =
  | { readonly session: 'morning'; readonly checkin: MorningCheckin }
  | { readonly session: 'evening'; readonly checkin: EveningCheckin };

/** Writes one session's check-in for `date`, preserving the other session. */
export async function saveCheckin(date: IsoDate, input: CheckinInput): Promise<DayEntry> {
  const { rawString, parse } = await loadEntriesRaw();
  // Refuse to merge onto an empty map when the store is merely unreadable — that would
  // overwrite recoverable history. Quarantine the raw blob and abort instead.
  if (parse.hardFailure) {
    await quarantineEntries(rawString);
    throw new Error('Entries store is unreadable; aborting save to avoid overwriting data.');
  }
  // A partial failure is safe to merge onto the survivors, but preserve the bad blob first.
  if (parse.droppedKeys.length > 0) {
    await quarantineEntries(rawString);
  }
  const entries = parse.entries;
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
