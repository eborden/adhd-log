import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Directory, File, Paths } from 'expo-file-system';
import {
  EVENING_METRICS,
  MORNING_METRICS,
  SIDE_EFFECT_LABELS,
  SIDE_EFFECT_SEVERITY_LABELS,
} from './schema';
import { palette } from './tokens';
import {
  datesInRange,
  doseActiveOn,
  firstOnsetDates,
  isDoseChangeList,
  isEveningRatingKey,
  isIsoTimestamp,
  isMorningRatingKey,
  isoTimestampNow,
  parseEntries,
  parseProfile,
} from './storage';
import { SIDE_EFFECTS } from './types';
import type {
  DayEntry,
  Dose,
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
  SideEffect,
  SideEffectSeverity,
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
    return (row) => row.morning?.ratings[key];
  }
  if (!isEveningRatingKey(key)) return () => undefined;
  return (row) => row.evening?.ratings[key];
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

function formatDose(dose: Dose | undefined): string {
  return dose === undefined ? '—' : `${String(dose.amount)}${dose.unit}`;
}

export interface SideEffectSummaryRow {
  readonly effect: SideEffect;
  readonly label: string;
  readonly onsetDate: IsoDate; // true first-appearance (firstOnsetDates, FULL log)
  readonly onsetDose: Dose | undefined; // dose active on onsetDate (doseActiveOn)
  readonly onsetBeforeRange: boolean; // onset predates this export's window
  readonly firstInRange: IsoDate; // first reported within the export range
  readonly lastInRange: IsoDate; // last reported within the export range
  readonly ongoingAtRangeEnd: boolean; // reported on the latest logged evening in range
  readonly daysReported: number;
  readonly loggedEveningsInRange: number; // denominator: "X of Y logged evenings"
  readonly severityRun: string; // run-length trajectory, e.g. "Mild×3, Moderate×2"
  readonly latestSeverity: SideEffectSeverity;
  readonly hasMigratedDays: boolean; // any reported day sourced from a migrated default
}

/**
 * Compact run-length trajectory so the first shipped report shows the shape of the sequence,
 * not just its endpoints — a cheap interim before a future sparkline doc.
 */
export function severityRunLength(severities: readonly SideEffectSeverity[]): string {
  const parts: string[] = [];
  let run: SideEffectSeverity | undefined;
  let count = 0;
  for (const s of severities) {
    if (s === run) {
      count += 1;
      continue;
    }
    if (run !== undefined) parts.push(`${SIDE_EFFECT_SEVERITY_LABELS[run]}×${String(count)}`);
    run = s;
    count = 1;
  }
  if (run !== undefined) parts.push(`${SIDE_EFFECT_SEVERITY_LABELS[run]}×${String(count)}`);
  return parts.join(', ');
}

export interface AdherenceSummary {
  readonly dosesTaken: number;
  readonly loggedMornings: number;
}

export function adherenceInRange(rows: readonly DayEntry[]): AdherenceSummary {
  let taken = 0;
  let logged = 0;
  for (const row of rows) {
    const morning = row.morning;
    if (morning === undefined) continue;
    logged += 1;
    if (morning.doseTaken) taken += 1;
  }
  return { dosesTaken: taken, loggedMornings: logged };
}

export function sideEffectSummary(
  rows: readonly DayEntry[], // rowsInRange output: oldest-first, gap-filled
  onset: ReadonlyMap<SideEffect, IsoDate>, // firstOnsetDates over the FULL log
  doses: readonly DoseChange[],
): readonly SideEffectSummaryRow[] {
  const rangeStart = rows[0]?.date;
  let loggedEvenings = 0;
  let latestEveningDate: IsoDate | undefined;
  for (const row of rows) {
    if (row.evening !== undefined) {
      loggedEvenings += 1;
      latestEveningDate = row.date; // oldest-first, so last assignment wins
    }
  }
  const acc = new Map<
    SideEffect,
    {
      firstInRange: IsoDate;
      lastInRange: IsoDate;
      days: number;
      sev: SideEffectSeverity[];
      migrated: boolean;
    }
  >();
  for (const row of rows) {
    const evening = row.evening;
    if (evening === undefined) continue;
    for (const effect of SIDE_EFFECTS) {
      const detail = evening.sideEffects[effect];
      if (detail === undefined) continue;
      const migrated = detail.origin === 'migrated';
      const cur = acc.get(effect);
      if (cur === undefined) {
        acc.set(effect, {
          firstInRange: row.date,
          lastInRange: row.date,
          days: 1,
          sev: [detail.severity],
          migrated,
        });
      } else {
        cur.lastInRange = row.date;
        cur.days += 1;
        cur.sev.push(detail.severity);
        if (migrated) cur.migrated = true;
      }
    }
  }
  const out: SideEffectSummaryRow[] = [];
  for (const [effect, d] of acc) {
    const latest = d.sev[d.sev.length - 1];
    if (latest === undefined) continue; // unreachable: seeded with one
    const onsetDate = onset.get(effect) ?? d.firstInRange;
    out.push({
      effect,
      label: SIDE_EFFECT_LABELS[effect],
      onsetDate,
      onsetDose: doseActiveOn(doses, onsetDate),
      onsetBeforeRange: rangeStart !== undefined && onsetDate.localeCompare(rangeStart) < 0,
      firstInRange: d.firstInRange,
      lastInRange: d.lastInRange,
      ongoingAtRangeEnd: latestEveningDate !== undefined && d.lastInRange === latestEveningDate,
      daysReported: d.days,
      loggedEveningsInRange: loggedEvenings,
      severityRun: severityRunLength(d.sev),
      latestSeverity: latest,
      hasMigratedDays: d.migrated,
    });
  }
  return out;
}

export interface DatedNote {
  readonly date: IsoDate;
  readonly text: string; // escaped at render time, never before
}

/**
 * Evening free-text notes as a dated list, oldest first (rows arrive oldest-first). Blank/
 * whitespace-only notes are skipped. Text is returned raw and escaped only at render time.
 */
export function collectNotes(rows: readonly DayEntry[]): readonly DatedNote[] {
  const notes: DatedNote[] = [];
  for (const row of rows) {
    const text = row.evening?.notes;
    if (text === undefined) continue;
    const trimmed = text.trim();
    if (trimmed === '') continue;
    notes.push({ date: row.date, text: trimmed });
  }
  return notes;
}

/** Severity badge color for the report — reuses the app's rating hues (no new hex). */
function severityColor(severity: SideEffectSeverity): string {
  switch (severity) {
    case 'mild':
      return palette.greenStrong;
    case 'moderate':
      return palette.ochreStrong;
    case 'severe':
      return palette.clayStrong;
  }
}

/**
 * Options for a report render. Range is resolved before this call (via `datesInRange` /
 * `lastNDates`) and arrives as explicit `rangeStart`/`rangeEnd` params, so it is deliberately
 * not a field here.
 */
export interface ReportOptions {
  readonly beforeAfterWindowDays: number; // default 14
  readonly includeNotes: boolean; // default true; Settings toggle can exclude free-text notes
}

export const DEFAULT_REPORT_OPTIONS: ReportOptions = {
  beforeAfterWindowDays: 14,
  includeNotes: true,
};

/**
 * Builds the printable HTML report: header, dose timeline, averages, side effects, daily table.
 *
 * Takes the full `entries` map plus an explicit range rather than pre-clipped rows: the
 * dose-period and before/after sections must reach outside the display window (a 7-day report
 * can still need a 14-day "before" window around a dose change weeks prior). Display rows are
 * derived internally from `datesInRange(rangeStart, rangeEnd)`.
 */
export function buildReportHtml(
  profile: Profile | null,
  doses: readonly DoseChange[],
  entries: Readonly<Record<IsoDate, DayEntry>>,
  rangeStart: IsoDate,
  rangeEnd: IsoDate,
  options: ReportOptions = DEFAULT_REPORT_OPTIONS,
): string {
  const rows = rowsInRange(entries, datesInRange(rangeStart, rangeEnd));
  const onset = firstOnsetDates(entries);
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

  const sideEffectsCell = (row: DayEntry): string => {
    const evening = row.evening;
    if (evening === undefined) return '—';
    const parts = SIDE_EFFECTS.flatMap((effect) => {
      const detail = evening.sideEffects[effect];
      return detail === undefined
        ? []
        : [`${SIDE_EFFECT_LABELS[effect]} (${SIDE_EFFECT_SEVERITY_LABELS[detail.severity]})`];
    });
    return parts.length === 0 ? '—' : escapeHtml(parts.join(', '));
  };

  const dailyRows = rows
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.date)}</td>
        <td>${formatRating(row.morning?.ratings.sleepQuality)}</td>
        <td>${formatRating(row.morning?.ratings.wakingMood)}</td>
        <td>${formatRating(row.evening?.ratings.mood)}</td>
        <td>${formatRating(row.evening?.ratings.focus)}</td>
        <td>${sideEffectsCell(row)}</td>
      </tr>`,
    )
    .join('');

  const summary = sideEffectSummary(rows, onset, doses);
  const adherence = adherenceInRange(rows);
  const anyMigrated = summary.some((row) => row.hasMigratedDays);
  const sideEffectsSection =
    summary.length === 0
      ? ''
      : `<h2>Side effects</h2>
         <p>Dose taken on ${String(adherence.dosesTaken)} of ${String(adherence.loggedMornings)} logged mornings in this range.</p>
         <table>
           <tr>
             <th>Side effect</th><th>Onset</th><th>In range</th><th>Ongoing?</th>
             <th>Days reported</th><th>Severity trajectory</th>
           </tr>
           ${summary
             .map(
               (row) => `<tr>
                 <td>${escapeHtml(row.label)}${row.hasMigratedDays ? ' *' : ''}</td>
                 <td>${escapeHtml(row.onsetDate)} — ${escapeHtml(formatDose(row.onsetDose))}${
                   row.onsetBeforeRange ? ' (before this range)' : ''
                 }</td>
                 <td>${escapeHtml(row.firstInRange)} → ${escapeHtml(row.lastInRange)}</td>
                 <td>${row.ongoingAtRangeEnd ? 'Yes' : 'No'}</td>
                 <td>${String(row.daysReported)} of ${String(row.loggedEveningsInRange)} logged evenings</td>
                 <td style="color: ${severityColor(row.latestSeverity)}">${escapeHtml(row.severityRun)}</td>
               </tr>`,
             )
             .join('')}
         </table>
         ${
           anyMigrated
             ? `<p>* Some or all severities for this effect were defaulted when migrating older entries and were not entered by hand.</p>`
             : ''
         }`;

  const notes = options.includeNotes ? collectNotes(rows) : [];
  const notesSection =
    notes.length === 0
      ? ''
      : `<h2>Notes</h2>
         ${notes
           .map(
             (note) =>
               `<p><strong>${escapeHtml(note.date)}</strong> — ${escapeHtml(note.text)}</p>`,
           )
           .join('')}`;

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
      ${sideEffectsSection}
      ${notesSection}
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
  const parsedEntries = parseEntries(raw['entries']);
  if (!parsedEntries.ok) {
    return { ok: false, reason: 'Malformed backup: invalid entries' };
  }
  return {
    ok: true,
    value: { exportedAt: raw['exportedAt'], profile, doses, entries: parsedEntries.value },
  };
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
