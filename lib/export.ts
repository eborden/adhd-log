import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Directory, File, Paths } from 'expo-file-system';
import { buildBackup, parseBackup, type Backup } from './backup';
import {
  averageOf,
  computeTrend,
  metricAverage,
  ratingAccessor,
  rowsInRange,
  type MetricAverage,
} from './metrics';
import {
  adherenceInWindow,
  bucketByDosePeriod,
  bucketByWeek,
  beforeAfterDose,
  collectNotes,
  computeAdherence,
  formatDose,
  sideEffectSummary,
  type BeforeAfter,
  type PeriodBucket,
  type ScaleAverage,
} from './report-metrics';
import {
  EVENING_METRICS,
  MORNING_METRICS,
  REPORT_RATING_ORDER,
  SIDE_EFFECT_LABELS,
  SIDE_EFFECT_SEVERITY_LABELS,
} from './schema';
import { palette } from './tokens';
import { datesInRange, firstOnsetDates, isEveningRatingKey, isMorningRatingKey } from './storage';
import { recentWindowDates, type SmoothingWindow } from './trends';
import { SIDE_EFFECTS, assertNever } from './types';
import type {
  DayEntry,
  DoseChange,
  IsoDate,
  Metric,
  Parsed,
  Profile,
  Rating,
  RatingKey,
  ScaleDirection,
  SideEffectSeverity,
  TrendDirection,
} from './types';

export { buildBackup, parseBackup, type Backup };
export {
  averageOf,
  computeTrend,
  coverage,
  loggingStartDate,
  metricAverage,
  ratingAccessor,
  rowsInRange,
  type Coverage,
  type MetricAverage,
  type MetricTrend,
} from './metrics';
export {
  adherenceInWindow,
  bucketByDosePeriod,
  bucketByWeek,
  beforeAfterDose,
  collectNotes,
  computeAdherence,
  severityRunLength,
  sideEffectSummary,
  type AdherenceSummary,
  type BeforeAfter,
  type DatedNote,
  type PeriodBucket,
  type ScaleAverage,
  type SideEffectSummaryRow,
} from './report-metrics';

// ---------------------------------------------------------------------------
// Pure assembly logic — no I/O, unit tested.
// ---------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatRating(rating: Rating | undefined): string {
  return rating === undefined ? '—' : String(rating);
}

/** Shared null-safe formatter for a mean: '—' for no data, one decimal place otherwise. */
function formatAverage(value: number | null): string {
  return value === null ? '—' : value.toFixed(1);
}

/**
 * The default "recent" window for the report's Recent column — matches the on-screen
 * smoothing overlay's long-range default (see `defaultWindowForRange` in lib/trends.ts).
 */
export const REPORT_RECENT_WINDOW: SmoothingWindow = 7;

/**
 * The Recent-trend section: one row per scale metric with data in range, showing the grand
 * average alongside a dose-period-clamped recent average, plus an adherence count and a plain
 * caveat sentence for that identical window — so a precise-looking figure can never be read out
 * of context. Omitted entirely when there is no recent window to describe (empty range).
 */
function recentAverageSectionHtml(
  scaleAverages: readonly ScaleAverage[],
  window: SmoothingWindow,
  fromDate: IsoDate | undefined,
  toDate: IsoDate | undefined,
  adherence: { readonly taken: number; readonly logged: number },
): string {
  if (scaleAverages.length === 0 || fromDate === undefined || toDate === undefined) return '';
  const rows = scaleAverages
    .map(
      (s) =>
        `<tr><td>${escapeHtml(s.label)}</td><td>${formatAverage(s.average)}</td><td>${formatAverage(s.recentAverage)}</td></tr>`,
    )
    .join('');
  const caveat = `Recent (${String(window)}-day avg) covers ${escapeHtml(fromDate)}–${escapeHtml(toDate)} (current dose period). Doses taken ${String(adherence.taken)} of ${String(adherence.logged)} logged mornings in this window. Average and Recent are arithmetic means of self-reported 1–5 ratings, not a validated clinical score, and do not otherwise account for adherence. Log this and discuss with your provider.`;
  return `<h2>Recent trend</h2>
     <table>
       <tr><th>Metric</th><th>Average</th><th>Recent (${String(window)}d avg)</th></tr>
       ${rows}
     </table>
     <p class="muted">${caveat}</p>`;
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

type ScaleMetric = Extract<Metric, { kind: 'scale' }>;

/** The scale metric for a rating key, or undefined for a non-scale/unknown key. Narrowed, never `!`. */
function scaleMetricFor(key: RatingKey): ScaleMetric | undefined {
  return [...MORNING_METRICS, ...EVENING_METRICS].find(
    (metric): metric is ScaleMetric => metric.kind === 'scale' && metric.key === key,
  );
}

/** Exhaustive over `TrendDirection` — adding a member fails to compile until handled here. */
function arrowGlyph(direction: TrendDirection): string {
  switch (direction) {
    case 'up':
      return '▲';
    case 'down':
      return '▼';
    case 'flat':
      return '▬';
    default:
      return assertNever(direction);
  }
}

/**
 * Value-free schema restatement of a scale, e.g. "1 = Calm, 5 = On edge". States what a higher
 * value *means* for that item so `anxiety ▲` can't be pattern-matched against `mood ▲` — never
 * "better/worse".
 */
function scaleAnchorCaption(metric: ScaleMetric): string {
  return `1 = ${metric.low}, 5 = ${metric.high}`;
}

/**
 * The sparkline bar color class for a value — same green/clay/ochre logic as `ratingColor`, but
 * as a class so the hues live in the stylesheet (see `.spark-*`) rather than inline. Only the
 * per-bar height stays inline, since it is the one truly per-datum value.
 */
function sparkBarClass(value: Rating | undefined, direction: ScaleDirection): string {
  if (value === undefined) return 'spark-none';
  if (direction === 'neutral') return 'spark-mid';
  const better = direction === 'higher-better' ? value >= 4 : value <= 2;
  const worse = direction === 'higher-better' ? value <= 2 : value >= 4;
  if (better) return 'spark-good';
  if (worse) return 'spark-bad';
  return 'spark-mid';
}

/**
 * The bar-width density class for a sparkline, chosen from how many weeks it spans. Wider bars
 * read well for a short range; narrower bars keep a long range (10–20 weeks) from ballooning the
 * Trend column. Kept as discrete classes (not an inline width) so the widths live in the
 * stylesheet — only each bar's height is truly per-datum and stays inline.
 */
function sparkDensityClass(dayCount: number): string {
  const weeks = Math.ceil(dayCount / 7);
  if (weeks <= 2) return 'spark-w5'; // ≤ 2 weeks — chunky 5px bars
  if (weeks <= 6) return 'spark-w3'; // ≤ 6 weeks
  if (weeks <= 12) return 'spark-w2'; // ≤ 12 weeks
  return 'spark-w1'; // longer — 1px bars
}

/** Inline `<span>` bar sparkline — same height formula as `trends.tsx`, no charting dependency. */
function sparklineHtml(values: readonly (Rating | undefined)[], direction: ScaleDirection): string {
  const bars = values
    .map((value) => {
      const height = value === undefined ? 4 : 8 + value * 8;
      return `<span class="spark ${sparkBarClass(value, direction)}" style="height:${String(height)}px"></span>`;
    })
    .join('');
  // Bars sit in a nowrap row; the density class scales bar width to the range length so the
  // sparkline stays compact for a long range and legible for a short one, without breaking the
  // table layout.
  return `<span class="spark-line ${sparkDensityClass(values.length)}">${bars}</span>`;
}

/**
 * A compact per-period averages table: one row per metric that has any data in range, a full-range
 * sparkline, then one mean column per bucket ('—' for an empty bucket). Returns '' when there are
 * no buckets or no metric with data. When `verticalHeaders` is set, the bucket headers switch to
 * vertical (writing-mode) text — used by the weekly table once there are enough weeks that upright
 * headers would stretch it too wide.
 */
function periodTableHtml(
  title: string,
  buckets: readonly PeriodBucket[],
  rows: readonly DayEntry[],
  verticalHeaders = false,
): string {
  if (buckets.length === 0) return '';
  const metricRows = REPORT_RATING_ORDER.flatMap((key) => {
    const metric = scaleMetricFor(key);
    if (metric === undefined) return [];
    const pick = ratingAccessor(isMorningRatingKey(key) ? 'morning' : 'evening', key);
    const values = rows.map(pick);
    if (values.every((value) => value === undefined)) return []; // no data in range → omit
    // Key narrowed inside the getter so the morning map is never queried with an evening key.
    const getAvg = (bucket: PeriodBucket): MetricAverage | undefined => {
      if (isMorningRatingKey(key)) return bucket.morning.get(key);
      if (isEveningRatingKey(key)) return bucket.evening.get(key);
      return undefined;
    };
    const cells = buckets
      .map((bucket) => {
        const avg = getAvg(bucket);
        return `<td>${avg === undefined || avg.kind === 'empty' ? '—' : avg.mean.toFixed(1)}</td>`;
      })
      .join('');
    return [
      `<tr><td>${escapeHtml(metric.label)}</td><td>${sparklineHtml(values, metric.direction)}</td>${cells}</tr>`,
    ];
  });
  if (metricRows.length === 0) return '';
  const headerClass = verticalHeaders ? ' class="vhead"' : '';
  const headers = buckets
    .map((bucket) => `<th${headerClass}>${escapeHtml(bucket.label)}</th>`)
    .join('');
  return `<h2>${escapeHtml(title)}</h2>
     <table>
       <tr><th>Metric</th><th>Trend</th>${headers}</tr>
       ${metricRows.join('')}
     </table>`;
}

/**
 * A before/after table per dose change: before-window mean, after-window mean, and a change arrow
 * routed through `computeTrend` (so the MIN_HALF_SAMPLES floor applies) with the metric's own
 * value-free scale-anchor caption. Metrics empty on both sides are omitted.
 */
function beforeAfterHtml(items: readonly BeforeAfter[]): string {
  const fmt = (average: MetricAverage): string =>
    average.kind === 'empty' ? '—' : average.mean.toFixed(1);
  const blocks = items.flatMap((item) => {
    const metricRows = REPORT_RATING_ORDER.flatMap((key) => {
      const metric = scaleMetricFor(key);
      if (metric === undefined) return [];
      const before = item.before.get(key) ?? { kind: 'empty' as const };
      const after = item.after.get(key) ?? { kind: 'empty' as const };
      if (before.kind === 'empty' && after.kind === 'empty') return [];
      const trend = computeTrend(before, after);
      const caption = escapeHtml(scaleAnchorCaption(metric));
      const changeCell =
        trend.kind === 'insufficient'
          ? `— <span class="muted">(${caption})</span>`
          : `${arrowGlyph(trend.direction)} <span class="muted">(${caption})</span>`;
      return [
        `<tr><td>${escapeHtml(metric.label)}</td><td>${fmt(before)}</td><td>${fmt(after)}</td><td>${changeCell}</td></tr>`,
      ];
    });
    if (metricRows.length === 0) return [];
    const title = `${formatDose(item.change.dose)} on ${escapeHtml(item.change.date)} (±${String(item.windowDays)} days)`;
    return [
      `<p><strong>${title}</strong></p>
       <table><tr><th>Metric</th><th>Before</th><th>After</th><th>Change</th></tr>${metricRows.join('')}</table>`,
    ];
  });
  return blocks.length === 0 ? '' : `<h2>Before / after dose changes</h2>${blocks.join('')}`;
}

/** The per-day side-effect cell: every reported effect with its severity, or an em dash. */
function sideEffectsCell(row: DayEntry): string {
  const evening = row.evening;
  if (evening === undefined) return '—';
  const parts = SIDE_EFFECTS.flatMap((effect) => {
    const detail = evening.sideEffects[effect];
    return detail === undefined
      ? []
      : [`${SIDE_EFFECT_LABELS[effect]} (${SIDE_EFFECT_SEVERITY_LABELS[detail.severity]})`];
  });
  return parts.length === 0 ? '—' : escapeHtml(parts.join(', '));
}

/**
 * The daily log renders one column per tracked metric, schema-driven — so adding a metric in
 * `lib/schema.ts` flows through automatically. Free-text notes are the one exclusion: they have a
 * dedicated dated section that honors the `includeNotes` toggle, so a raw column would both
 * duplicate them and bypass that toggle. Column order follows the check-in schema.
 */
const DAILY_LOG_METRICS: readonly Metric[] = [...MORNING_METRICS, ...EVENING_METRICS].filter(
  (metric) => metric.kind !== 'text',
);

/** Whether a metric has any captured value across these rows — drives which columns appear. */
export function dailyLogHasValue(metric: Metric, row: DayEntry): boolean {
  switch (metric.kind) {
    case 'toggle':
      return row.morning !== undefined;
    case 'scale': {
      const pick = ratingAccessor(
        isMorningRatingKey(metric.key) ? 'morning' : 'evening',
        metric.key,
      );
      return pick(row) !== undefined;
    }
    case 'stepper':
      return row.morning?.sleepHours !== undefined;
    case 'chips': {
      const evening = row.evening;
      return (
        evening !== undefined && SIDE_EFFECTS.some((e) => evening.sideEffects[e] !== undefined)
      );
    }
    case 'text':
      return false;
    default:
      return assertNever(metric);
  }
}

/** The metrics with data in range, in schema order — the daily log's columns. */
export function dailyLogColumns(rows: readonly DayEntry[]): readonly Metric[] {
  return DAILY_LOG_METRICS.filter((metric) => rows.some((row) => dailyLogHasValue(metric, row)));
}

/** One daily-log cell's text for a metric on a given day. */
export function dailyLogCell(metric: Metric, row: DayEntry): string {
  switch (metric.kind) {
    case 'toggle':
      return row.morning === undefined ? '—' : row.morning.doseTaken ? 'Yes' : 'No';
    case 'scale': {
      const pick = ratingAccessor(
        isMorningRatingKey(metric.key) ? 'morning' : 'evening',
        metric.key,
      );
      return formatRating(pick(row));
    }
    case 'stepper': {
      const hours = row.morning?.sleepHours;
      return hours === undefined ? '—' : String(hours);
    }
    case 'chips':
      return sideEffectsCell(row);
    case 'text':
      return '—';
    default:
      return assertNever(metric);
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

  // Cover summary: per-metric first-half-vs-second-half trend arrows with value-free scale-anchor
  // captions. Metrics with no data in range are omitted (matches the evening-averages behavior:
  // the report reflects data present, not the current Settings toggle).
  const spansMultipleDosePeriods = doses.some(
    (change) =>
      change.date.localeCompare(rangeStart) > 0 && change.date.localeCompare(rangeEnd) <= 0,
  );
  const midpoint = Math.floor(rows.length / 2);
  const firstHalfRows = rows.slice(0, midpoint);
  const secondHalfRows = rows.slice(rows.length - midpoint);
  const trendRows = REPORT_RATING_ORDER.flatMap((key) => {
    const metric = scaleMetricFor(key);
    if (metric === undefined) return [];
    const pick = ratingAccessor(isMorningRatingKey(key) ? 'morning' : 'evening', key);
    if (metricAverage(rows, pick).kind === 'empty') return []; // no data in range → omit
    const trend = computeTrend(
      metricAverage(firstHalfRows, pick),
      metricAverage(secondHalfRows, pick),
    );
    const caption = escapeHtml(scaleAnchorCaption(metric));
    const cell =
      trend.kind === 'insufficient'
        ? `— <span class="muted">(not enough logged days to compare halves; ${caption})</span>`
        : `${arrowGlyph(trend.direction)} <span class="muted">(first half ${trend.firstHalf.toFixed(1)} → second half ${trend.secondHalf.toFixed(1)}; ${caption})</span>`;
    return [`<tr><td>${escapeHtml(metric.label)}</td><td>${cell}</td></tr>`];
  });
  const coverSummary = `<h2>Summary</h2>
      <p>${escapeHtml(rangeStart)} → ${escapeHtml(rangeEnd)}</p>
      ${
        spansMultipleDosePeriods
          ? `<p>This range spans more than one dose. See the per-dose-period and before/after sections below for the split view.</p>`
          : ''
      }
      ${
        trendRows.length === 0
          ? `<p>Not enough logged data in this range to show trends.</p>`
          : `<table><tr><th>Metric</th><th>Trend</th></tr>${trendRows.join('')}</table>`
      }`;

  // Per-period averages replace the single grand mean, which flattened the titration story.
  // Weekly buckets are the natural cadence; dose-period buckets are what a titrating provider
  // reasons from. Weekly always renders (dropping it discarded the richest view for long ranges);
  // past 5 weeks its headers go vertical so a many-week table stays within the page width.
  const weeklyBuckets = bucketByWeek(rows);
  const weeklySection = periodTableHtml(
    'Weekly averages',
    weeklyBuckets,
    rows,
    weeklyBuckets.length > 5,
  );
  const dosePeriodSection = periodTableHtml(
    'Dose-period averages',
    bucketByDosePeriod(entries, doses, rangeStart, rangeEnd),
    rows,
  );

  // Recent trend: a dose-period-clamped tail average alongside the grand mean, so a precise-looking
  // "Recent" figure never straddles two regimens and is never printed without its date span and
  // adherence context (see docs/pending/08-rolling-average-trends.md).
  const dates = rows.map((r) => r.date);
  const recentDates = recentWindowDates(dates, doses, REPORT_RECENT_WINDOW);
  const recentDateSet = new Set<IsoDate>(recentDates);
  const recentRows = rows.filter((r) => recentDateSet.has(r.date));
  const recentFromDate = recentDates[0];
  const recentToDate = recentDates[recentDates.length - 1];
  const recentAdherence = adherenceInWindow(recentRows);
  const scaleAverages: readonly ScaleAverage[] = REPORT_RATING_ORDER.flatMap((key) => {
    const metric = scaleMetricFor(key);
    if (metric === undefined) return [];
    const pick = ratingAccessor(isMorningRatingKey(key) ? 'morning' : 'evening', key);
    const average = averageOf(rows, pick);
    if (average === null) return []; // no data in range → omit
    return [
      {
        label: metric.label,
        direction: metric.direction,
        average,
        recentAverage: averageOf(recentRows, pick),
      },
    ];
  });
  const recentTrendSection = recentAverageSectionHtml(
    scaleAverages,
    REPORT_RECENT_WINDOW,
    recentFromDate,
    recentToDate,
    recentAdherence,
  );

  // Before/after each dose change that falls inside the range; windows reach outside it via entries.
  const beforeAfterSection = beforeAfterHtml(
    doses
      .filter(
        (change) =>
          change.date.localeCompare(rangeStart) >= 0 && change.date.localeCompare(rangeEnd) <= 0,
      )
      .map((change) => beforeAfterDose(entries, change, options.beforeAfterWindowDays)),
  );

  // Adherence: counts foregrounded, per-date lists de-emphasized to an appendix, neutral language
  // ("no entry recorded", never "missed"). totalDays is derived so it can't disagree with the counts.
  const adherence = computeAdherence(rows);
  const totalDays = adherence.takenCount + adherence.notTakenCount + adherence.noEntryCount;
  const adherenceAppendix = [
    adherence.notTakenDates.length > 0
      ? `<p class="muted">Dose not taken: ${adherence.notTakenDates.map((date) => escapeHtml(date)).join(', ')}</p>`
      : '',
    adherence.noEntryDates.length > 0
      ? `<p class="muted">No entry recorded: ${adherence.noEntryDates.map((date) => escapeHtml(date)).join(', ')}</p>`
      : '',
  ].join('');
  const adherenceSection =
    totalDays === 0
      ? ''
      : `<h2>Adherence</h2>
         <p>Doses taken: ${String(adherence.takenCount)} · Not taken: ${String(adherence.notTakenCount)} · No entry: ${String(adherence.noEntryCount)} (of ${String(totalDays)} days)</p>
         <p class="muted">Each day is counted as dose taken, dose not taken, or no morning entry recorded. This carries no timing and does not distinguish an intentionally skipped dose from a forgotten one.</p>
         ${adherenceAppendix}`;

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

  // Daily log columns are schema-driven and pruned to metrics with data in range: show everything
  // captured, nothing that wasn't.
  const dailyColumns = dailyLogColumns(rows);
  const dailyHeader = `<tr><th>Date</th>${dailyColumns
    .map((metric) => `<th>${escapeHtml(metric.label)}</th>`)
    .join('')}</tr>`;
  const dailyRows = rows
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.date)}</td>${dailyColumns
          .map((metric) => `<td>${dailyLogCell(metric, row)}</td>`)
          .join('')}</tr>`,
    )
    .join('');

  const summary = sideEffectSummary(rows, onset, doses);
  const anyMigrated = summary.some((row) => row.hasMigratedDays);
  const sideEffectsSection =
    summary.length === 0
      ? ''
      : `<h2>Side effects</h2>
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
      .muted { color: ${palette.warm500}; font-size: 12px; }
      /* The trend sparklines are background-filled bars, which print engines drop by default; force
         just those to print. The page background is deliberately NOT forced, and is dropped entirely
         when printing, so a PDF export doesn't flood the page with ink. */
      .spark { display: inline-block; width: 3px; vertical-align: bottom; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .spark-good { background: ${palette.greenStrong}; }
      .spark-mid { background: ${palette.ochreStrong}; }
      .spark-bad { background: ${palette.clayStrong}; }
      .spark-none { background: ${palette.warm300}; }
      .spark-line { display: inline-block; white-space: nowrap; }
      /* Bar width scales to the range length (see sparkDensityClass) so a long range stays compact
         and a short one stays legible, without stretching the Trend column. */
      .spark-line.spark-w5 > .spark { width: 5px; }
      .spark-line.spark-w3 > .spark { width: 3px; }
      .spark-line.spark-w2 > .spark { width: 2px; }
      .spark-line.spark-w1 > .spark { width: 1px; }
      /* Weekly headers go vertical past 5 weeks so a many-week table stays within the page width. */
      th.vhead { writing-mode: vertical-lr; white-space: nowrap; vertical-align: bottom; }
      @media print {
        body { background: transparent; }
      }
    </style>
    </head>
    <body>
      ${header}
      ${coverSummary}
      ${doseTimeline}
      ${weeklySection}
      ${dosePeriodSection}
      ${recentTrendSection}
      ${beforeAfterSection}
      ${adherenceSection}
      ${sideEffectsSection}
      ${notesSection}
      <h2>Daily log</h2>
      <table class="grid">
        ${dailyHeader}
        ${dailyRows}
      </table>
    </body>
  </html>`;
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
