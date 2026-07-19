import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Directory, File, Paths } from 'expo-file-system';
import {
  EVENING_METRICS,
  MORNING_METRICS,
  REPORT_RATING_ORDER,
  SIDE_EFFECT_LABELS,
  SIDE_EFFECT_SEVERITY_LABELS,
} from './schema';
import { palette } from './tokens';
import {
  addDays,
  datesInRange,
  doseActiveOn,
  firstOnsetDates,
  isDoseChangeList,
  isEveningRatingKey,
  isIsoTimestamp,
  isMorningRatingKey,
  isoTimestampNow,
  parseEntries,
  parseIsoDate,
  parseProfile,
} from './storage';
import { EVENING_RATING_KEYS, MORNING_RATING_KEYS, SIDE_EFFECTS, assertNever } from './types';
import type {
  DayEntry,
  Dose,
  DoseChange,
  EveningRatingKey,
  IsoDate,
  IsoTimestamp,
  Metric,
  MorningRatingKey,
  Parsed,
  Profile,
  Rating,
  RatingKey,
  ScaleDirection,
  Session,
  SideEffect,
  SideEffectSeverity,
  TrendDirection,
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

/**
 * A computed average is either a real mean over >=1 sample, or explicitly empty. No NaN, no magic
 * -1: the empty case is a distinct variant, so `noUncheckedIndexedAccess` concerns vanish and a
 * missing average can never be read as a number. This is the single canonical "maybe a mean" the
 * whole report module uses.
 */
export type MetricAverage =
  | { readonly kind: 'value'; readonly mean: number; readonly n: number }
  | { readonly kind: 'empty' };

/**
 * A trend is the descriptive comparison of two halves. `flat` still carries the halves and delta,
 * so the renderer never recomputes or branches on missing data; `insufficient` is a distinct
 * variant, never `direction: 'flat'` masquerading as a measured comparison.
 */
export type MetricTrend =
  | { readonly kind: 'insufficient' } // empty half, or < MIN_HALF_SAMPLES in either half
  | {
      readonly kind: 'measured';
      readonly direction: TrendDirection;
      readonly firstHalf: number;
      readonly secondHalf: number;
      readonly delta: number;
    };

// Neutral deadband: |delta| below this renders 'flat'. Chosen at 0.3 of a 1..5 point so a
// rounding-level wobble never reads as a direction.
const TREND_DEADBAND = 0.3;

// Minimum samples per half before a delta is presented as a measured trend. Below this,
// day-to-day Likert noise clears the deadband, so we return 'insufficient' instead of a
// confident-looking arrow.
const MIN_HALF_SAMPLES = 3;

/** The single adapter from a legacy `number | null` mean to the canonical union. */
export function toMetricAverage(mean: number | null, n: number): MetricAverage {
  return mean === null || n === 0 ? { kind: 'empty' } : { kind: 'value', mean, n };
}

/** Canonical average producer: counts samples and means them, yielding a `MetricAverage`. */
export function metricAverage(
  rows: readonly DayEntry[],
  pick: (row: DayEntry) => Rating | undefined,
): MetricAverage {
  const values = rows.map(pick).filter((value): value is Rating => value !== undefined);
  if (values.length === 0) return { kind: 'empty' };
  return {
    kind: 'value',
    mean: values.reduce((sum, v) => sum + v, 0) / values.length,
    n: values.length,
  };
}

/**
 * Descriptive comparison of two halves. Consumes two `MetricAverage`s (one absence idiom, not
 * three) and enforces both the deadband and the minimum-sample floor, so a short range returns
 * `insufficient` rather than a noise-driven arrow.
 */
export function computeTrend(first: MetricAverage, second: MetricAverage): MetricTrend {
  if (
    first.kind === 'empty' ||
    second.kind === 'empty' ||
    first.n < MIN_HALF_SAMPLES ||
    second.n < MIN_HALF_SAMPLES
  ) {
    return { kind: 'insufficient' };
  }
  const delta = second.mean - first.mean;
  const direction: TrendDirection =
    Math.abs(delta) < TREND_DEADBAND ? 'flat' : delta > 0 ? 'up' : 'down';
  return { kind: 'measured', direction, firstHalf: first.mean, secondHalf: second.mean, delta };
}

/**
 * One averaging period in the report. Keys are narrowed to their own session's union so the
 * morning map cannot admit an evening-only key like `libido`. Values are `MetricAverage`, so
 * `Map.get`'s `T | undefined` is the only absence idiom and empty buckets render as `—`.
 */
export interface PeriodBucket {
  readonly label: string; // e.g. "Week 1 (Jul 1–7)" or "40mg (Jul 1–14)"
  readonly startDate: IsoDate;
  readonly endDate: IsoDate;
  readonly morning: ReadonlyMap<MorningRatingKey, MetricAverage>;
  readonly evening: ReadonlyMap<EveningRatingKey, MetricAverage>;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** "Jul 7" — a compact month-day label for bucket titles. */
function shortDate(date: IsoDate): string {
  const parsed = parseIsoDate(date);
  const month = MONTHS[parsed.getMonth()];
  return `${month ?? ''} ${String(parsed.getDate())}`;
}

/** Averages every rating key over a bucket's rows into the narrowed morning/evening maps. */
function makeBucket(
  label: string,
  startDate: IsoDate,
  endDate: IsoDate,
  bucketRows: readonly DayEntry[],
): PeriodBucket {
  const morning = new Map<MorningRatingKey, MetricAverage>();
  for (const key of MORNING_RATING_KEYS) {
    morning.set(key, metricAverage(bucketRows, ratingAccessor('morning', key)));
  }
  const evening = new Map<EveningRatingKey, MetricAverage>();
  for (const key of EVENING_RATING_KEYS) {
    evening.set(key, metricAverage(bucketRows, ratingAccessor('evening', key)));
  }
  return { label, startDate, endDate, morning, evening };
}

/** 7-day calendar buckets over the (gap-filled, oldest-first) display rows. */
export function bucketByWeek(rows: readonly DayEntry[]): readonly PeriodBucket[] {
  const buckets: PeriodBucket[] = [];
  for (let i = 0; i < rows.length; i += 7) {
    const chunk = rows.slice(i, i + 7);
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    if (first === undefined || last === undefined) continue;
    // Bare "Week N" — the date range is dropped to keep these headers narrow, since a long range
    // can produce many weekly columns.
    const label = `Week ${String(i / 7 + 1)}`;
    buckets.push(makeBucket(label, first.date, last.date, chunk));
  }
  return buckets;
}

/** The dose change in effect on `date` — the last one on/before it. `sorted` is ascending. */
function lastChangeOnOrBefore(
  sorted: readonly DoseChange[],
  date: IsoDate,
): DoseChange | undefined {
  let active: DoseChange | undefined;
  for (const change of sorted) {
    if (change.date.localeCompare(date) <= 0) active = change;
    else break;
  }
  return active;
}

/**
 * Buckets bounded by `DoseChange.date`. Cuts the range at each dose change inside it; the first
 * period reaches *back* to the change date that began the active dose (which may predate
 * `rangeStart`) and reads from the full `entries` map, so a period that started weeks before the
 * display window still averages its real data rather than reporting empty.
 */
export function bucketByDosePeriod(
  entries: Readonly<Record<IsoDate, DayEntry>>,
  doses: readonly DoseChange[],
  rangeStart: IsoDate,
  rangeEnd: IsoDate,
): readonly PeriodBucket[] {
  const sorted = [...doses].sort((a, b) => a.date.localeCompare(b.date));
  const cuts = sorted
    .map((change) => change.date)
    .filter((date) => date.localeCompare(rangeStart) > 0 && date.localeCompare(rangeEnd) <= 0);
  const segmentStarts: readonly IsoDate[] = [rangeStart, ...cuts];
  const buckets: PeriodBucket[] = [];
  for (let i = 0; i < segmentStarts.length; i += 1) {
    const dispStart = segmentStarts[i];
    if (dispStart === undefined) continue;
    const nextStart = segmentStarts[i + 1];
    const dispEnd = nextStart === undefined ? rangeEnd : addDays(nextStart, -1);
    const active = lastChangeOnOrBefore(sorted, dispStart);
    const dataStart =
      active !== undefined && active.date.localeCompare(dispStart) < 0 ? active.date : dispStart;
    const doseLabel = active === undefined ? 'No dose recorded' : formatDose(active.dose);
    const label = `${doseLabel} (${shortDate(dataStart)}–${shortDate(dispEnd)})`;
    const bucketRows = rowsInRange(entries, datesInRange(dataStart, dispEnd));
    buckets.push(makeBucket(label, dataStart, dispEnd, bucketRows));
  }
  return buckets;
}

/**
 * The `windowDays` before a dose change vs the `windowDays` on/after it — a descriptive
 * dose-response view. Reads the full `entries` map, so the windows reach outside the display
 * range (a 7-day report can still surface the 14-day before/after around a change).
 */
export interface BeforeAfter {
  readonly change: DoseChange;
  readonly windowDays: number;
  readonly before: ReadonlyMap<RatingKey, MetricAverage>;
  readonly after: ReadonlyMap<RatingKey, MetricAverage>;
}

export function beforeAfterDose(
  entries: Readonly<Record<IsoDate, DayEntry>>,
  change: DoseChange,
  windowDays: number,
): BeforeAfter {
  const beforeRows = rowsInRange(
    entries,
    datesInRange(addDays(change.date, -windowDays), addDays(change.date, -1)),
  );
  const afterRows = rowsInRange(
    entries,
    datesInRange(change.date, addDays(change.date, windowDays - 1)),
  );
  const before = new Map<RatingKey, MetricAverage>();
  const after = new Map<RatingKey, MetricAverage>();
  for (const key of REPORT_RATING_ORDER) {
    const pick = ratingAccessor(isMorningRatingKey(key) ? 'morning' : 'evening', key);
    before.set(key, metricAverage(beforeRows, pick));
    after.set(key, metricAverage(afterRows, pick));
  }
  return { change, windowDays, before, after };
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

/**
 * Adherence as a taken / not-taken / no-entry split over the display rows. `totalDays` is NOT
 * stored — it is the sum of the three counts, derived at render, so they can never disagree.
 * The date lists back the de-emphasized appendix; the language stays neutral ("no entry
 * recorded", never "missed").
 */
export interface AdherenceSummary {
  readonly takenCount: number; // logged morning, doseTaken === true
  readonly notTakenCount: number; // logged morning, doseTaken === false
  readonly noEntryCount: number; // no morning checkin for that date
  readonly notTakenDates: readonly IsoDate[];
  readonly noEntryDates: readonly IsoDate[];
}

export function computeAdherence(rows: readonly DayEntry[]): AdherenceSummary {
  let takenCount = 0;
  let notTakenCount = 0;
  const notTakenDates: IsoDate[] = [];
  const noEntryDates: IsoDate[] = [];
  for (const row of rows) {
    const morning = row.morning;
    if (morning === undefined) {
      noEntryDates.push(row.date);
      continue;
    }
    if (morning.doseTaken) {
      takenCount += 1;
    } else {
      notTakenCount += 1;
      notTakenDates.push(row.date);
    }
  }
  return {
    takenCount,
    notTakenCount,
    noEntryCount: noEntryDates.length,
    notTakenDates,
    noEntryDates,
  };
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
