import { metricAverage, ratingAccessor, rowsInRange, type MetricAverage } from './metrics';
import { REPORT_RATING_ORDER, SIDE_EFFECT_LABELS, SIDE_EFFECT_SEVERITY_LABELS } from './schema';
import { addDays, datesInRange, doseActiveOn, isMorningRatingKey, parseIsoDate } from './storage';
import { EVENING_RATING_KEYS, MORNING_RATING_KEYS, SIDE_EFFECTS } from './types';
import type {
  DayEntry,
  Dose,
  DoseChange,
  EveningRatingKey,
  IsoDate,
  MorningRatingKey,
  RatingKey,
  ScaleDirection,
  SideEffect,
  SideEffectSeverity,
} from './types';

// ---------------------------------------------------------------------------
// Report-specific aggregation — produces data, never HTML. Consumed by
// report-html.ts to render the provider report.
// ---------------------------------------------------------------------------

export function formatDose(dose: Dose | undefined): string {
  return dose === undefined ? '—' : `${String(dose.amount)}${dose.unit}`;
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

const SHORT_DATE_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

/** "Jul 7" — a compact month-day label for bucket titles. */
function shortDate(date: IsoDate): string {
  return SHORT_DATE_FORMAT.format(parseIsoDate(date));
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
  // A trailing sentinel one day past rangeEnd means every segment's end is `addDays(next, -1)` —
  // the last segment's end folds out to rangeEnd itself, with no separate branch for it.
  const boundaries: readonly IsoDate[] = [rangeStart, ...cuts, addDays(rangeEnd, 1)];
  const buckets: PeriodBucket[] = [];
  let prevBoundary: IsoDate | undefined;
  for (const boundary of boundaries) {
    if (prevBoundary !== undefined) {
      const dispStart = prevBoundary;
      const dispEnd = addDays(boundary, -1);
      const active = lastChangeOnOrBefore(sorted, dispStart);
      const dataStart =
        active !== undefined && active.date.localeCompare(dispStart) < 0 ? active.date : dispStart;
      const doseLabel = active === undefined ? 'No dose recorded' : formatDose(active.dose);
      const label = `${doseLabel} (${shortDate(dataStart)}–${shortDate(dispEnd)})`;
      const bucketRows = rowsInRange(entries, datesInRange(dataStart, dispEnd));
      buckets.push(makeBucket(label, dataStart, dispEnd, bucketRows));
    }
    prevBoundary = boundary;
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

/**
 * A metric's grand average over the full report range, plus its dose-period-clamped recent
 * average — the two figures the report's "Recent" column prints side by side.
 */
export interface ScaleAverage {
  readonly label: string;
  readonly direction: ScaleDirection;
  readonly average: number | null; // grand mean over the whole range
  readonly recentAverage: number | null; // mean over recentWindowDates (dose-clamped)
}

/**
 * Doses taken vs. mornings logged in the recent window. `logged` excludes unlogged days,
 * so a day with no morning check-in is never counted as a missed dose.
 */
export function adherenceInWindow(rows: readonly DayEntry[]): {
  readonly taken: number;
  readonly logged: number;
} {
  let taken = 0;
  let logged = 0;
  for (const row of rows) {
    if (row.morning !== undefined) {
      logged += 1;
      if (row.morning.doseTaken) {
        taken += 1;
      }
    }
  }
  return { taken, logged };
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
      latestSeverity: SideEffectSeverity;
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
          latestSeverity: detail.severity,
          migrated,
        });
      } else {
        cur.lastInRange = row.date;
        cur.days += 1;
        cur.sev.push(detail.severity);
        cur.latestSeverity = detail.severity;
        if (migrated) cur.migrated = true;
      }
    }
  }
  const out: SideEffectSummaryRow[] = [];
  for (const [effect, d] of acc) {
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
      latestSeverity: d.latestSeverity,
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
