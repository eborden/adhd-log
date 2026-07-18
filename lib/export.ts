import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Directory, File, Paths } from 'expo-file-system';
import { EVENING_METRICS, MORNING_METRICS, SIDE_EFFECT_LABELS } from './schema';
import { palette } from './tokens';
import {
  isDoseChangeList,
  isEntries,
  isEveningRatingKey,
  isIsoTimestamp,
  isMorningRatingKey,
  isoTimestampNow,
  parseProfile,
} from './storage';
import type {
  DayEntry,
  DoseChange,
  IsoDate,
  IsoTimestamp,
  Metric,
  Parsed,
  Profile,
  Rating,
  RatingKey,
  ScaleDirection,
  Session,
} from './types';

// ---------------------------------------------------------------------------
// Pure assembly logic — no I/O, unit tested.
// ---------------------------------------------------------------------------

/**
 * The accessor for a scale metric's value, keyed by which session it belongs to. Under
 * `noUncheckedIndexedAccess` a keyed read is already `Rating | undefined`, so a single generic
 * accessor replaces the hand-written per-key maps. The session/key pairing is narrowed through
 * the schema key guards (a key that doesn't belong to the session always reads `undefined`).
 */
export function ratingAccessor(
  session: Session,
  key: RatingKey,
): (row: DayEntry) => Rating | undefined {
  if (session === 'morning') {
    if (!isMorningRatingKey(key)) return () => undefined;
    return (row) => row.morning?.[key];
  }
  if (!isEveningRatingKey(key)) return () => undefined;
  return (row) => row.evening?.[key];
}

export function averageOf(
  rows: readonly DayEntry[],
  pick: (row: DayEntry) => Rating | undefined,
): number | null {
  const values = rows.map(pick).filter((value): value is Rating => value !== undefined);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export interface ScaleAverage {
  readonly label: string;
  readonly direction: ScaleDirection;
  readonly average: number | null;
}

function computeScaleAverages(
  metrics: readonly Metric[],
  session: Session,
  rows: readonly DayEntry[],
): readonly ScaleAverage[] {
  const result: ScaleAverage[] = [];
  for (const metric of metrics) {
    if (metric.kind !== 'scale') continue;
    result.push({
      label: metric.label,
      direction: metric.direction,
      average: averageOf(rows, ratingAccessor(session, metric.key)),
    });
  }
  return result;
}

/** Rows for a date range, oldest first, filling gaps with empty (unlogged) days. */
export function rowsInRange(
  entries: Readonly<Record<IsoDate, DayEntry>>,
  dates: readonly IsoDate[],
): readonly DayEntry[] {
  return dates.map((date) => entries[date] ?? { date });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatAverage(average: number | null): string {
  return average === null ? '—' : average.toFixed(1);
}

function formatRating(rating: Rating | undefined): string {
  return rating === undefined ? '—' : String(rating);
}

/** Builds the printable HTML report: header, dose timeline, averages, daily table. */
export function buildReportHtml(
  profile: Profile | null,
  doses: readonly DoseChange[],
  rows: readonly DayEntry[],
): string {
  const morningAverages = computeScaleAverages(MORNING_METRICS, 'morning', rows);
  const eveningAverages = computeScaleAverages(EVENING_METRICS, 'evening', rows).filter(
    (average) => average.average !== null,
  );

  const header = profile
    ? `<h1>${escapeHtml(profile.medName)}</h1>
       <p>Current dose: ${String(profile.currentDose.amount)}${escapeHtml(profile.currentDose.unit)} · started ${escapeHtml(profile.startDate)}</p>`
    : '<h1>ADHD check-in report</h1>';

  const doseTimeline =
    doses.length === 0
      ? ''
      : `<h2>Dose changes</h2><ul>${doses
          .map(
            (change) =>
              `<li>${escapeHtml(change.date)} — ${String(change.dose.amount)}${escapeHtml(change.dose.unit)}${
                change.note !== undefined ? ` (${escapeHtml(change.note)})` : ''
              }</li>`,
          )
          .join('')}</ul>`;

  const averagesTable = (title: string, averages: readonly ScaleAverage[]): string =>
    averages.length === 0
      ? ''
      : `<h2>${escapeHtml(title)}</h2>
         <table>
           <tr><th>Metric</th><th>Average</th></tr>
           ${averages
             .map(
               (row) =>
                 `<tr><td>${escapeHtml(row.label)}</td><td>${formatAverage(row.average)}</td></tr>`,
             )
             .join('')}
         </table>`;

  const dailyRows = rows
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.date)}</td>
        <td>${formatRating(row.morning?.sleepQuality)}</td>
        <td>${formatRating(row.morning?.wakingMood)}</td>
        <td>${formatRating(row.evening?.mood)}</td>
        <td>${formatRating(row.evening?.focus)}</td>
        <td>${
          row.evening?.sideEffects.length
            ? escapeHtml(
                row.evening.sideEffects.map((effect) => SIDE_EFFECT_LABELS[effect]).join(', '),
              )
            : '—'
        }</td>
      </tr>`,
    )
    .join('');

  return `<html>
    <head><meta charset="utf-8" />
    <style>
      body { font-family: -apple-system, sans-serif; padding: 24px; color: ${palette.warm900}; background: ${palette.warm50}; }
      table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
      th, td { border: 1px solid ${palette.warm300}; padding: 6px 10px; text-align: left; font-size: 13px; }
      h1 { margin-top: 24px; }
      h2 { margin-top: 24px; color: ${palette.pineStrong}; }
      p { color: ${palette.warm500}; }
    </style>
    </head>
    <body>
      ${header}
      ${doseTimeline}
      ${averagesTable('Morning averages', morningAverages)}
      ${averagesTable('Evening averages', eveningAverages)}
      <h2>Daily log</h2>
      <table>
        <tr><th>Date</th><th>Sleep</th><th>Waking mood</th><th>Mood</th><th>Focus</th><th>Side effects</th></tr>
        ${dailyRows}
      </table>
    </body>
  </html>`;
}

export interface Backup {
  readonly exportedAt: IsoTimestamp;
  readonly profile: Profile | null;
  readonly doses: readonly DoseChange[];
  readonly entries: Readonly<Record<IsoDate, DayEntry>>;
}

export function buildBackup(
  profile: Profile | null,
  doses: readonly DoseChange[],
  entries: Readonly<Record<IsoDate, DayEntry>>,
): Backup {
  return { exportedAt: isoTimestampNow(), profile, doses, entries };
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
  const entries = raw['entries'];
  if (!isEntries(entries)) {
    return { ok: false, reason: 'Malformed backup: invalid entries' };
  }
  return { ok: true, value: { exportedAt: raw['exportedAt'], profile, doses, entries } };
}

// ---------------------------------------------------------------------------
// Native I/O — PDF print/share and JSON backup export/import.
// ---------------------------------------------------------------------------

export async function exportPdfReport(html: string): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html });
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: 'Share check-in report',
  });
}

export async function exportJsonBackup(backup: Backup): Promise<void> {
  const file = new File(new Directory(Paths.cache), `adhd-log-backup-${backup.exportedAt}.json`);
  if (file.exists) {
    file.delete();
  }
  file.create();
  file.write(JSON.stringify(backup, null, 2));
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Share backup' });
}

export async function importJsonBackup(): Promise<Parsed<Backup>> {
  const picked = await File.pickFileAsync({ mimeTypes: ['application/json'] });
  if (picked.canceled) {
    return { ok: false, reason: 'Import canceled' };
  }
  const text = await picked.result.text();
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'Selected file is not valid JSON' };
  }
  return parseBackup(parsedJson);
}
