/**
 * Golden provider-report scenarios — 10 hand-authored, deterministic datasets that each exercise
 * a distinct slice of `buildReportHtml`. RN-free: only type-only imports plus a local pure
 * `addDays`, so this module carries no native dependency and can be imported anywhere.
 *
 * Values are deliberately hand-authored (no PRNG) and shaped to match real non-stimulant clinical
 * behavior — FDA-label titration schedules, the slow multi-week onset that lags each dose
 * increase, and per-drug side-effect fingerprints (atomoxetine: early nausea/GI + persistent
 * appetite loss; guanfacine ER: early sedation → recovering energy, calming anxiety, better
 * sleep; viloxazine ER: insomnia, mild fatigue, appetite loss). This is realistic *sample* data,
 * not medical advice.
 *
 * Every `completedAt`/`createdAt`/`exportedAt` reuses one frozen timestamp so the rendered report
 * and the exported backup JSON are byte-reproducible; those fields are not shown in the report
 * anyway. See `lib/__tests__/scenarios.test.ts`, which pins each scenario's HTML + backup JSON.
 */
import type { Backup } from '../backup';
import type { ReportOptions } from '../report-html';
import type {
  DayEntry,
  Dose,
  DoseChange,
  EveningCheckin,
  EveningRatingKey,
  IsoDate,
  IsoTimestamp,
  MedName,
  MorningCheckin,
  MorningRatingKey,
  Profile,
  Rating,
  SideEffectReports,
} from '../types';

// ---------------------------------------------------------------------------
// Branded-value + date helpers (pure, no native deps).
// ---------------------------------------------------------------------------

/** One frozen instant reused everywhere so backups/HTML are byte-reproducible. */
const FIXED_TS = '2026-07-19T12:00:00.000Z' as IsoTimestamp;

function iso(value: string): IsoDate {
  return value as IsoDate;
}
function med(value: string): MedName {
  return value as MedName;
}

function pad2(n: number): string {
  return n < 10 ? `0${String(n)}` : String(n);
}

/** `date + delta` days, staying on the UTC calendar so results are locale-independent. */
function addDays(date: IsoDate, delta: number): IsoDate {
  const base = Date.parse(`${date}T00:00:00.000Z`);
  const shifted = new Date(base + delta * 86_400_000);
  return iso(
    `${String(shifted.getUTCFullYear())}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`,
  );
}

// ---------------------------------------------------------------------------
// Day-entry builders — explicit values in, correctly-shaped records out. Optional fields are
// omitted (never set to `undefined`) to satisfy `exactOptionalPropertyTypes`.
// ---------------------------------------------------------------------------

interface MorningInput {
  readonly doseTaken: boolean;
  readonly sleepQuality?: Rating;
  readonly wakingMood?: Rating;
  readonly sleepHours?: number;
}

function morning(input: MorningInput): MorningCheckin {
  const ratings: Partial<Record<MorningRatingKey, Rating>> = {};
  if (input.sleepQuality !== undefined) ratings.sleepQuality = input.sleepQuality;
  if (input.wakingMood !== undefined) ratings.wakingMood = input.wakingMood;
  return {
    ratings,
    doseTaken: input.doseTaken,
    completedAt: FIXED_TS,
    ...(input.sleepHours !== undefined ? { sleepHours: input.sleepHours } : {}),
  };
}

interface EveningInput {
  readonly ratings: Partial<Record<EveningRatingKey, Rating>>;
  readonly sideEffects?: SideEffectReports;
  readonly notes?: string;
}

function evening(input: EveningInput): EveningCheckin {
  return {
    ratings: input.ratings,
    sideEffects: input.sideEffects ?? {},
    completedAt: FIXED_TS,
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  };
}

/** One logged day, addressed by its offset (in days) from the scenario start. */
interface DaySpec {
  readonly offset: number;
  readonly morning?: MorningInput;
  readonly evening?: EveningInput;
}

function build(start: IsoDate, specs: readonly DaySpec[]): Record<IsoDate, DayEntry> {
  const entries: Record<IsoDate, DayEntry> = {};
  for (const spec of specs) {
    const date = addDays(start, spec.offset);
    entries[date] = {
      date,
      ...(spec.morning !== undefined ? { morning: morning(spec.morning) } : {}),
      ...(spec.evening !== undefined ? { evening: evening(spec.evening) } : {}),
    };
  }
  return entries;
}

function dose(amount: number, unit: Dose['unit'] = 'mg'): Dose {
  return { amount, unit };
}

// ---------------------------------------------------------------------------
// Scenario shape.
// ---------------------------------------------------------------------------

export interface ReportScenario {
  /** Kebab slug — drives the golden file names. */
  readonly name: string;
  /** Human title for the gallery. */
  readonly title: string;
  /** One line: what report behavior this scenario exercises. */
  readonly summary: string;
  readonly profile: Profile | null;
  readonly doses: readonly DoseChange[];
  readonly entries: Readonly<Record<IsoDate, DayEntry>>;
  readonly rangeStart: IsoDate;
  readonly rangeEnd: IsoDate;
  /** Omitted → the report's `DEFAULT_REPORT_OPTIONS`. */
  readonly options?: ReportOptions;
}

/** A `Backup`-shaped export of a scenario — importable by the app's JSON-restore flow. */
export function scenarioBackup(scenario: ReportScenario): Backup {
  return {
    exportedAt: FIXED_TS,
    profile: scenario.profile,
    doses: scenario.doses,
    entries: scenario.entries,
  };
}

const reminderMorning = { hour: 8, minute: 0 } as const;
const reminderEvening = { hour: 20, minute: 30 } as const;

// ===========================================================================
// 1. clean-responder — Atomoxetine 40→80mg, textbook slow responder.
// ===========================================================================

const CLEAN_START = iso('2026-05-01');
const cleanResponder: ReportScenario = {
  name: 'clean-responder',
  title: 'Clean responder (atomoxetine 40→80mg)',
  summary:
    'Textbook slow non-stimulant response: mood/focus/energy climb over 3 weeks after the 40→80mg increase, anxiety settles, early nausea fades, appetite dips modestly. High adherence, one before/after.',
  profile: {
    medName: med('Atomoxetine'),
    startDate: CLEAN_START,
    currentDose: dose(80),
    morningReminder: reminderMorning,
    eveningReminder: reminderEvening,
    lockEnabled: false,
    createdAt: FIXED_TS,
  },
  doses: [
    { date: CLEAN_START, dose: dose(40) },
    { date: addDays(CLEAN_START, 3), dose: dose(80), note: 'increase to target' },
  ],
  rangeStart: CLEAN_START,
  rangeEnd: addDays(CLEAN_START, 20),
  entries: build(CLEAN_START, [
    // Week 1 — baseline, early nausea, little effect yet.
    {
      offset: 0,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 2, sleepHours: 7 },
      evening: {
        ratings: { mood: 2, focus: 2, energy: 3, anxiety: 4, appetite: 3 },
        sideEffects: { nausea: { severity: 'mild' } },
      },
    },
    {
      offset: 1,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 2 },
      evening: {
        ratings: { mood: 2, focus: 2, energy: 2, anxiety: 4, appetite: 3 },
        sideEffects: { nausea: { severity: 'mild' } },
      },
    },
    {
      offset: 2,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 3 },
      evening: {
        ratings: { mood: 3, focus: 2, energy: 3, anxiety: 3, appetite: 2 },
        sideEffects: { nausea: { severity: 'mild' } },
      },
    },
    {
      offset: 3,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: {
        ratings: { mood: 2, focus: 3, energy: 3, anxiety: 4, appetite: 2 },
        sideEffects: { nausea: { severity: 'mild' } },
      },
    },
    {
      offset: 4,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 3, sleepHours: 7 },
      evening: {
        ratings: { mood: 3, focus: 2, energy: 3, anxiety: 3, appetite: 3 },
        sideEffects: { nausea: { severity: 'mild' } },
      },
    },
    {
      offset: 5,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 3, energy: 4, anxiety: 3, appetite: 2 } },
    },
    {
      offset: 6,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 3, energy: 3, anxiety: 3, appetite: 2 } },
    },
    // Week 2 — effect building.
    {
      offset: 7,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 3, sleepHours: 8 },
      evening: { ratings: { mood: 3, focus: 3, energy: 3, anxiety: 3, appetite: 2 } },
    },
    {
      offset: 8,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 3, energy: 4, anxiety: 3, appetite: 2 } },
    },
    {
      offset: 9,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 3, energy: 4, anxiety: 2, appetite: 2 } },
    },
    {
      offset: 10,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 4, energy: 3, anxiety: 3, appetite: 3 } },
    },
    {
      offset: 11,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 4, energy: 4, anxiety: 2, appetite: 2 } },
    },
    {
      offset: 12,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 3, energy: 4, anxiety: 3, appetite: 2 } },
    },
    {
      offset: 13,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4, sleepHours: 8 },
      evening: { ratings: { mood: 4, focus: 4, energy: 4, anxiety: 2, appetite: 2 } },
    },
    // Week 3 — consolidated response.
    {
      offset: 14,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 4, energy: 4, anxiety: 2, appetite: 2 } },
    },
    {
      offset: 15,
      morning: { doseTaken: true, sleepQuality: 5, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 5, energy: 4, anxiety: 2, appetite: 3 } },
    },
    {
      offset: 16,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 5, focus: 4, energy: 5, anxiety: 2, appetite: 2 } },
    },
    {
      offset: 17,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 5 },
      evening: { ratings: { mood: 4, focus: 4, energy: 4, anxiety: 2, appetite: 2 } },
    },
    {
      offset: 18,
      morning: { doseTaken: true, sleepQuality: 5, wakingMood: 4, sleepHours: 8 },
      evening: { ratings: { mood: 4, focus: 5, energy: 4, anxiety: 1, appetite: 2 } },
    },
    {
      offset: 19,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 5, focus: 4, energy: 5, anxiety: 2, appetite: 3 } },
    },
    {
      offset: 20,
      morning: { doseTaken: true, sleepQuality: 5, wakingMood: 5 },
      evening: { ratings: { mood: 5, focus: 5, energy: 4, anxiety: 2, appetite: 2 } },
    },
  ]),
};

// ===========================================================================
// 2. titration-journey — Guanfacine ER 1→2→3mg, multi-period + before/after.
// ===========================================================================

const TITR_START = iso('2026-03-02');
const titrationJourney: ReportScenario = {
  name: 'titration-journey',
  title: 'Titration journey (guanfacine ER 1→2→3mg)',
  summary:
    'Weekly step-ups across 6 weeks. Signature early sedation drags energy down then it recovers; anxiety calms and sleep improves; focus/impulsivity gains lag each increase. Multiple dose periods and before/after tables, multi-dose caveat.',
  profile: {
    medName: med('Guanfacine ER'),
    startDate: TITR_START,
    currentDose: dose(3),
    morningReminder: reminderMorning,
    eveningReminder: reminderEvening,
    lockEnabled: true,
    enabledEveningMetrics: ['mood', 'focus', 'impulsivity', 'anxiety', 'energy'],
    createdAt: FIXED_TS,
  },
  doses: [
    { date: TITR_START, dose: dose(1) },
    { date: addDays(TITR_START, 14), dose: dose(2), note: 'up to 2mg' },
    { date: addDays(TITR_START, 28), dose: dose(3), note: 'up to 3mg' },
  ],
  rangeStart: TITR_START,
  rangeEnd: addDays(TITR_START, 41),
  entries: build(TITR_START, [
    // Period 1 (1mg): sedation hits, energy dips, some calming.
    {
      offset: 0,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: {
        ratings: { mood: 3, focus: 2, impulsivity: 4, anxiety: 4, energy: 3 },
        sideEffects: { insomnia: { severity: 'mild' } },
      },
    },
    {
      offset: 2,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 2 },
      evening: {
        ratings: { mood: 3, focus: 2, impulsivity: 4, anxiety: 4, energy: 2 },
        sideEffects: { dizziness: { severity: 'mild' } },
      },
    },
    {
      offset: 4,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 2 },
      evening: {
        ratings: { mood: 3, focus: 3, impulsivity: 4, anxiety: 3, energy: 2 },
        sideEffects: { dizziness: { severity: 'mild' } },
      },
    },
    {
      offset: 6,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 3, impulsivity: 3, anxiety: 3, energy: 2 } },
    },
    {
      offset: 8,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 3, impulsivity: 4, anxiety: 3, energy: 3 } },
    },
    {
      offset: 10,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 3, impulsivity: 3, anxiety: 3, energy: 3 } },
    },
    {
      offset: 12,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 3 },
      evening: { ratings: { mood: 4, focus: 3, impulsivity: 3, anxiety: 2, energy: 3 } },
    },
    // Period 2 (2mg): renewed sedation at the step, then recovery + better focus.
    {
      offset: 14,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 3 },
      evening: {
        ratings: { mood: 3, focus: 3, impulsivity: 3, anxiety: 3, energy: 2 },
        sideEffects: { dizziness: { severity: 'mild' } },
      },
    },
    {
      offset: 16,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 3 },
      evening: { ratings: { mood: 4, focus: 3, impulsivity: 3, anxiety: 2, energy: 3 } },
    },
    {
      offset: 18,
      morning: { doseTaken: true, sleepQuality: 5, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 4, impulsivity: 3, anxiety: 2, energy: 3 } },
    },
    {
      offset: 20,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 4, impulsivity: 2, anxiety: 2, energy: 3 } },
    },
    {
      offset: 22,
      morning: { doseTaken: true, sleepQuality: 5, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 4, impulsivity: 3, anxiety: 2, energy: 4 } },
    },
    {
      offset: 24,
      morning: { doseTaken: true, sleepQuality: 5, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 4, impulsivity: 2, anxiety: 2, energy: 4 } },
    },
    {
      offset: 26,
      morning: { doseTaken: true, sleepQuality: 5, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 4, impulsivity: 2, anxiety: 2, energy: 4 } },
    },
    // Period 3 (3mg): best focus/impulsivity control, energy fully recovered.
    {
      offset: 28,
      morning: { doseTaken: true, sleepQuality: 5, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 4, impulsivity: 2, anxiety: 2, energy: 3 } },
    },
    {
      offset: 30,
      morning: { doseTaken: true, sleepQuality: 5, wakingMood: 4 },
      evening: { ratings: { mood: 5, focus: 5, impulsivity: 2, anxiety: 2, energy: 4 } },
    },
    {
      offset: 32,
      morning: { doseTaken: true, sleepQuality: 5, wakingMood: 5 },
      evening: { ratings: { mood: 4, focus: 5, impulsivity: 2, anxiety: 1, energy: 4 } },
    },
    {
      offset: 34,
      morning: { doseTaken: true, sleepQuality: 5, wakingMood: 4 },
      evening: { ratings: { mood: 5, focus: 5, impulsivity: 1, anxiety: 2, energy: 4 } },
    },
    {
      offset: 36,
      morning: { doseTaken: true, sleepQuality: 5, wakingMood: 5 },
      evening: { ratings: { mood: 5, focus: 4, impulsivity: 2, anxiety: 1, energy: 5 } },
    },
    {
      offset: 38,
      morning: { doseTaken: true, sleepQuality: 5, wakingMood: 5 },
      evening: { ratings: { mood: 5, focus: 5, impulsivity: 2, anxiety: 1, energy: 4 } },
    },
    {
      offset: 40,
      morning: { doseTaken: true, sleepQuality: 5, wakingMood: 5 },
      evening: { ratings: { mood: 5, focus: 5, impulsivity: 1, anxiety: 1, energy: 5 } },
    },
  ]),
};

// ===========================================================================
// 3. side-effect-heavy — Viloxazine ER 200→400mg, prominent side effects.
// ===========================================================================

const SE_START = iso('2026-04-06');
const sideEffectHeavy: ReportScenario = {
  name: 'side-effect-heavy',
  title: 'Side-effect heavy (viloxazine ER 200→400mg)',
  summary:
    'Modest focus gains bought with cost: persistent insomnia drags sleep down, nausea eases severe→moderate→mild, headache comes and goes. Exercises the side-effects section, run-length severity trajectories, and the migrated-default footnote.',
  profile: {
    medName: med('Viloxazine ER'),
    startDate: SE_START,
    currentDose: dose(400),
    morningReminder: reminderMorning,
    eveningReminder: reminderEvening,
    lockEnabled: false,
    createdAt: FIXED_TS,
  },
  doses: [
    { date: SE_START, dose: dose(200) },
    { date: addDays(SE_START, 7), dose: dose(400), note: 'up to 400mg' },
  ],
  rangeStart: SE_START,
  rangeEnd: addDays(SE_START, 23),
  entries: build(SE_START, [
    {
      offset: 0,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: {
        ratings: { mood: 3, focus: 2, energy: 3, anxiety: 3, appetite: 3 },
        sideEffects: {
          nausea: { severity: 'severe' },
          insomnia: { severity: 'moderate', origin: 'migrated' },
        },
      },
    },
    {
      offset: 1,
      morning: { doseTaken: true, sleepQuality: 2, wakingMood: 2 },
      evening: {
        ratings: { mood: 2, focus: 2, energy: 2, anxiety: 3, appetite: 2 },
        sideEffects: {
          nausea: { severity: 'severe' },
          insomnia: { severity: 'moderate' },
          headache: { severity: 'mild' },
        },
      },
    },
    {
      offset: 2,
      morning: { doseTaken: true, sleepQuality: 2, wakingMood: 2 },
      evening: {
        ratings: { mood: 2, focus: 3, energy: 2, anxiety: 3, appetite: 2 },
        sideEffects: { nausea: { severity: 'severe' }, insomnia: { severity: 'moderate' } },
      },
    },
    {
      offset: 3,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: {
        ratings: { mood: 3, focus: 3, energy: 3, anxiety: 3, appetite: 2 },
        sideEffects: { nausea: { severity: 'moderate' }, insomnia: { severity: 'moderate' } },
      },
    },
    {
      offset: 4,
      morning: { doseTaken: true, sleepQuality: 2, wakingMood: 2 },
      evening: {
        ratings: { mood: 3, focus: 3, energy: 2, anxiety: 3, appetite: 3 },
        sideEffects: {
          nausea: { severity: 'moderate' },
          insomnia: { severity: 'severe' },
          headache: { severity: 'mild' },
        },
      },
    },
    {
      offset: 5,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: {
        ratings: { mood: 3, focus: 3, energy: 3, anxiety: 3, appetite: 2 },
        sideEffects: { nausea: { severity: 'moderate' }, insomnia: { severity: 'moderate' } },
      },
    },
    {
      offset: 6,
      morning: { doseTaken: true, sleepQuality: 2, wakingMood: 3 },
      evening: {
        ratings: { mood: 3, focus: 3, energy: 3, anxiety: 2, appetite: 3 },
        sideEffects: { nausea: { severity: 'moderate' }, insomnia: { severity: 'moderate' } },
      },
    },
    {
      offset: 7,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: {
        ratings: { mood: 3, focus: 4, energy: 3, anxiety: 2, appetite: 2 },
        sideEffects: { nausea: { severity: 'moderate' }, insomnia: { severity: 'severe' } },
      },
    },
    {
      offset: 8,
      morning: { doseTaken: true, sleepQuality: 2, wakingMood: 2 },
      evening: {
        ratings: { mood: 3, focus: 3, energy: 2, anxiety: 3, appetite: 2 },
        sideEffects: {
          nausea: { severity: 'mild' },
          insomnia: { severity: 'severe' },
          headache: { severity: 'moderate' },
        },
      },
    },
    {
      offset: 9,
      morning: { doseTaken: true, sleepQuality: 2, wakingMood: 3 },
      evening: {
        ratings: { mood: 3, focus: 4, energy: 3, anxiety: 2, appetite: 2 },
        sideEffects: { nausea: { severity: 'mild' }, insomnia: { severity: 'moderate' } },
      },
    },
    {
      offset: 10,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: {
        ratings: { mood: 4, focus: 4, energy: 3, anxiety: 2, appetite: 3 },
        sideEffects: { insomnia: { severity: 'moderate' } },
      },
    },
    {
      offset: 11,
      morning: { doseTaken: true, sleepQuality: 2, wakingMood: 2 },
      evening: {
        ratings: { mood: 3, focus: 4, energy: 2, anxiety: 3, appetite: 2 },
        sideEffects: { insomnia: { severity: 'severe' }, headache: { severity: 'mild' } },
      },
    },
    {
      offset: 12,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: {
        ratings: { mood: 4, focus: 4, energy: 3, anxiety: 2, appetite: 2 },
        sideEffects: { insomnia: { severity: 'moderate' } },
      },
    },
    {
      offset: 13,
      morning: { doseTaken: true, sleepQuality: 2, wakingMood: 3 },
      evening: {
        ratings: { mood: 4, focus: 4, energy: 3, anxiety: 2, appetite: 3 },
        sideEffects: { insomnia: { severity: 'moderate' } },
      },
    },
    {
      offset: 14,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: {
        ratings: { mood: 4, focus: 4, energy: 3, anxiety: 2, appetite: 2 },
        sideEffects: { insomnia: { severity: 'moderate' } },
      },
    },
    {
      offset: 15,
      morning: { doseTaken: true, sleepQuality: 2, wakingMood: 2 },
      evening: {
        ratings: { mood: 3, focus: 4, energy: 2, anxiety: 3, appetite: 2 },
        sideEffects: { insomnia: { severity: 'severe' } },
      },
    },
    {
      offset: 16,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: {
        ratings: { mood: 4, focus: 5, energy: 3, anxiety: 2, appetite: 3 },
        sideEffects: { insomnia: { severity: 'moderate' } },
      },
    },
    {
      offset: 17,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: {
        ratings: { mood: 4, focus: 4, energy: 3, anxiety: 2, appetite: 2 },
        sideEffects: { insomnia: { severity: 'moderate' } },
      },
    },
    {
      offset: 18,
      morning: { doseTaken: true, sleepQuality: 2, wakingMood: 3 },
      evening: {
        ratings: { mood: 4, focus: 4, energy: 3, anxiety: 2, appetite: 2 },
        sideEffects: { insomnia: { severity: 'moderate' } },
      },
    },
    {
      offset: 19,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: {
        ratings: { mood: 4, focus: 5, energy: 4, anxiety: 2, appetite: 3 },
        sideEffects: { insomnia: { severity: 'mild' } },
      },
    },
    {
      offset: 20,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: {
        ratings: { mood: 4, focus: 4, energy: 3, anxiety: 2, appetite: 2 },
        sideEffects: { insomnia: { severity: 'mild' } },
      },
    },
    {
      offset: 21,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 4 },
      evening: {
        ratings: { mood: 4, focus: 5, energy: 4, anxiety: 2, appetite: 3 },
        sideEffects: { insomnia: { severity: 'moderate' } },
      },
    },
    {
      offset: 22,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: {
        ratings: { mood: 5, focus: 4, energy: 3, anxiety: 2, appetite: 2 },
        sideEffects: { insomnia: { severity: 'mild' } },
      },
    },
    {
      offset: 23,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 4 },
      evening: {
        ratings: { mood: 4, focus: 5, energy: 4, anxiety: 2, appetite: 3 },
        sideEffects: { insomnia: { severity: 'mild' } },
      },
    },
  ]),
};

// ===========================================================================
// 4. non-responder — flat metrics, deltas inside the deadband.
// ===========================================================================

const NR_START = iso('2026-02-02');
const nonResponder: ReportScenario = {
  name: 'non-responder',
  title: 'Non-responder (flat trends)',
  summary:
    'Three weeks of atomoxetine with no meaningful change — every metric wobbles within the trend deadband, so the cover shows flat arrows despite complete, high-adherence data.',
  profile: {
    medName: med('Atomoxetine'),
    startDate: NR_START,
    currentDose: dose(80),
    morningReminder: reminderMorning,
    eveningReminder: reminderEvening,
    lockEnabled: false,
    createdAt: FIXED_TS,
  },
  doses: [{ date: NR_START, dose: dose(80) }],
  rangeStart: NR_START,
  rangeEnd: addDays(NR_START, 20),
  entries: build(NR_START, [
    {
      offset: 0,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 3, energy: 3, anxiety: 3 } },
    },
    {
      offset: 1,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 2, energy: 3, anxiety: 3 } },
    },
    {
      offset: 2,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 3, energy: 3, anxiety: 4 } },
    },
    {
      offset: 3,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 2 },
      evening: { ratings: { mood: 2, focus: 3, energy: 3, anxiety: 3 } },
    },
    {
      offset: 4,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 3, energy: 2, anxiety: 3 } },
    },
    {
      offset: 5,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 3, energy: 3, anxiety: 3 } },
    },
    {
      offset: 6,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 2, energy: 3, anxiety: 4 } },
    },
    {
      offset: 7,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 4 },
      evening: { ratings: { mood: 3, focus: 3, energy: 3, anxiety: 3 } },
    },
    {
      offset: 8,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 4, focus: 3, energy: 3, anxiety: 3 } },
    },
    {
      offset: 9,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 3, energy: 3, anxiety: 3 } },
    },
    {
      offset: 10,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 3, energy: 4, anxiety: 3 } },
    },
    {
      offset: 11,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 3, energy: 3, anxiety: 3 } },
    },
    {
      offset: 12,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 3 },
      evening: { ratings: { mood: 2, focus: 3, energy: 3, anxiety: 4 } },
    },
    {
      offset: 13,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 3, energy: 2, anxiety: 3 } },
    },
    {
      offset: 14,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 3, energy: 3, anxiety: 3 } },
    },
    {
      offset: 15,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 3, focus: 3, energy: 3, anxiety: 3 } },
    },
    {
      offset: 16,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 2, energy: 3, anxiety: 4 } },
    },
    {
      offset: 17,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 3, energy: 3, anxiety: 3 } },
    },
    {
      offset: 18,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 3 },
      evening: { ratings: { mood: 4, focus: 3, energy: 3, anxiety: 3 } },
    },
    {
      offset: 19,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 3, energy: 3, anxiety: 3 } },
    },
    {
      offset: 20,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 3, energy: 3, anxiety: 3 } },
    },
  ]),
};

// ===========================================================================
// 5. poor-adherence — frequent skipped doses and unlogged days.
// ===========================================================================

const PA_START = iso('2026-06-01');
const poorAdherence: ReportScenario = {
  name: 'poor-adherence',
  title: 'Poor adherence (gaps and skipped doses)',
  summary:
    'A 28-day window where doses are frequently skipped and several days go unlogged. Foregrounds the adherence block — taken / not-taken / no-entry counts and the neutral de-emphasized appendix.',
  profile: {
    medName: med('Atomoxetine'),
    startDate: PA_START,
    currentDose: dose(40),
    morningReminder: reminderMorning,
    eveningReminder: reminderEvening,
    lockEnabled: false,
    createdAt: FIXED_TS,
  },
  doses: [{ date: PA_START, dose: dose(40) }],
  rangeStart: PA_START,
  rangeEnd: addDays(PA_START, 27),
  entries: build(PA_START, [
    {
      offset: 0,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 2, energy: 3, anxiety: 3 } },
    },
    {
      offset: 1,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 2 },
      evening: { ratings: { mood: 2, focus: 2, energy: 2, anxiety: 4 } },
    },
    {
      offset: 2,
      morning: { doseTaken: false, sleepQuality: 3, wakingMood: 2 },
      evening: { ratings: { mood: 2, focus: 2, energy: 2, anxiety: 4 } },
    },
    // offset 3 — no entry
    {
      offset: 4,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 3, energy: 3, anxiety: 3 } },
    },
    {
      offset: 5,
      morning: { doseTaken: false, sleepQuality: 2, wakingMood: 2 },
      evening: { ratings: { mood: 2, focus: 2, energy: 2, anxiety: 4 } },
    },
    // offset 6, 7 — no entry
    {
      offset: 8,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 3, energy: 3, anxiety: 3 } },
    },
    {
      offset: 9,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 2, energy: 3, anxiety: 3 } },
    },
    { offset: 10, morning: { doseTaken: false, sleepQuality: 3, wakingMood: 2 } },
    {
      offset: 11,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 3, energy: 3, anxiety: 3 } },
    },
    // offset 12, 13 — no entry
    {
      offset: 14,
      morning: { doseTaken: false, sleepQuality: 2, wakingMood: 2 },
      evening: { ratings: { mood: 2, focus: 2, energy: 2, anxiety: 4 } },
    },
    {
      offset: 15,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 3, energy: 3, anxiety: 3 } },
    },
    {
      offset: 16,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 3, energy: 3, anxiety: 3 } },
    },
    // offset 17 — no entry
    { offset: 18, morning: { doseTaken: false, sleepQuality: 3, wakingMood: 3 } },
    {
      offset: 19,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 3, energy: 3, anxiety: 3 } },
    },
    {
      offset: 20,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 3, energy: 3, anxiety: 2 } },
    },
    // offset 21, 22 — no entry
    {
      offset: 23,
      morning: { doseTaken: false, sleepQuality: 2, wakingMood: 2 },
      evening: { ratings: { mood: 2, focus: 2, energy: 2, anxiety: 4 } },
    },
    {
      offset: 24,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 3, energy: 3, anxiety: 3 } },
    },
    {
      offset: 25,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 3, energy: 3, anxiety: 3 } },
    },
    // offset 26 — no entry
    {
      offset: 27,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 3, energy: 3, anxiety: 3 } },
    },
  ]),
};

// ===========================================================================
// 6. sparse-logging — few scattered entries, no profile.
// ===========================================================================

const SP_START = iso('2026-01-05');
const sparseLogging: ReportScenario = {
  name: 'sparse-logging',
  title: 'Sparse logging (no profile set)',
  summary:
    'Only a handful of entries scattered across a month, and no profile — the report falls back to a generic header, shows insufficient-data trend cells (fewer than three logged days per half), and a gap-filled daily log.',
  profile: null,
  doses: [{ date: SP_START, dose: dose(2) }],
  rangeStart: SP_START,
  rangeEnd: addDays(SP_START, 27),
  entries: build(SP_START, [
    {
      offset: 0,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 2, energy: 3, anxiety: 3 } },
    },
    { offset: 3, morning: { doseTaken: true, sleepQuality: 4, wakingMood: 3 } },
    {
      offset: 7,
      evening: {
        ratings: { mood: 3, focus: 3, energy: 3, anxiety: 3 },
        notes: 'Felt a bit calmer this week.',
      },
    },
    {
      offset: 12,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 3, energy: 4, anxiety: 2 } },
    },
    { offset: 15, morning: { doseTaken: false, sleepQuality: 3, wakingMood: 3 } },
    { offset: 21, evening: { ratings: { mood: 4, focus: 4, energy: 4, anxiety: 2 } } },
    {
      offset: 24,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 4, energy: 4, anxiety: 2 } },
    },
    { offset: 27, morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 } },
  ]),
};

// ===========================================================================
// 7. short-week — a 7-day export with notes.
// ===========================================================================

const SW_START = iso('2026-07-06');
const shortWeek: ReportScenario = {
  name: 'short-week',
  title: 'Short week (7-day export)',
  summary:
    'A tight one-week export on a stable dose — a single weekly bucket, and two dated free-text notes rendered in the notes section.',
  profile: {
    medName: med('Guanfacine ER'),
    startDate: iso('2026-06-01'),
    currentDose: dose(3),
    morningReminder: reminderMorning,
    eveningReminder: reminderEvening,
    lockEnabled: true,
    createdAt: FIXED_TS,
  },
  doses: [{ date: iso('2026-06-01'), dose: dose(3) }],
  rangeStart: SW_START,
  rangeEnd: addDays(SW_START, 6),
  entries: build(SW_START, [
    {
      offset: 0,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4, sleepHours: 8 },
      evening: {
        ratings: { mood: 4, focus: 4, energy: 4, anxiety: 2 },
        notes: 'Good day at work, stayed on task through the afternoon.',
      },
    },
    {
      offset: 1,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 3 },
      evening: { ratings: { mood: 4, focus: 3, energy: 4, anxiety: 2 } },
    },
    {
      offset: 2,
      morning: { doseTaken: true, sleepQuality: 5, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 4, energy: 4, anxiety: 2 } },
    },
    {
      offset: 3,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: {
        ratings: { mood: 3, focus: 4, energy: 3, anxiety: 3 },
        notes: 'Bit drowsy mid-morning, wore off by lunch.',
      },
    },
    {
      offset: 4,
      morning: { doseTaken: true, sleepQuality: 5, wakingMood: 4, sleepHours: 9 },
      evening: { ratings: { mood: 4, focus: 4, energy: 4, anxiety: 2 } },
    },
    {
      offset: 5,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 5, focus: 4, energy: 4, anxiety: 2 } },
    },
    {
      offset: 6,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 5 },
      evening: { ratings: { mood: 4, focus: 5, energy: 4, anxiety: 1 } },
    },
  ]),
};

// ===========================================================================
// 8. long-multimonth — >56 days so weekly buckets drop out.
// ===========================================================================

const LM_START = iso('2026-01-05');
function lmDay(
  offset: number,
  mood: Rating,
  focus: Rating,
  energy: Rating,
  anxiety: Rating,
): DaySpec {
  return {
    offset,
    morning: { doseTaken: true, sleepQuality: 4, wakingMood: focus },
    evening: { ratings: { mood, focus, energy, anxiety } },
  };
}
const longMultimonth: ReportScenario = {
  name: 'long-multimonth',
  title: 'Long multi-month (60-day export)',
  summary:
    'A two-month export logged every third day, with one mid-range dose increase. Past the 56-day cutoff the weekly-averages table is dropped and only the dose-period averages remain; the daily log is long.',
  profile: {
    medName: med('Atomoxetine'),
    startDate: LM_START,
    currentDose: dose(80),
    morningReminder: reminderMorning,
    eveningReminder: reminderEvening,
    lockEnabled: false,
    createdAt: FIXED_TS,
  },
  doses: [
    { date: LM_START, dose: dose(40) },
    { date: addDays(LM_START, 30), dose: dose(80), note: 'up to 80mg after slow start' },
  ],
  rangeStart: LM_START,
  rangeEnd: addDays(LM_START, 59),
  entries: build(LM_START, [
    // Period 1 (40mg, days 0–29): slow, partial.
    lmDay(0, 2, 2, 3, 4),
    lmDay(3, 3, 2, 3, 4),
    lmDay(6, 3, 3, 3, 3),
    lmDay(9, 3, 3, 3, 3),
    lmDay(12, 3, 3, 3, 3),
    lmDay(15, 3, 3, 4, 3),
    lmDay(18, 3, 3, 3, 3),
    lmDay(21, 4, 3, 3, 3),
    lmDay(24, 3, 4, 3, 2),
    lmDay(27, 4, 3, 4, 3),
    // Period 2 (80mg, days 30–59): stronger response.
    lmDay(30, 3, 3, 3, 3),
    lmDay(33, 4, 4, 4, 2),
    lmDay(36, 4, 4, 4, 2),
    lmDay(39, 4, 4, 4, 2),
    lmDay(42, 5, 4, 4, 2),
    lmDay(45, 4, 5, 4, 2),
    lmDay(48, 5, 4, 5, 1),
    lmDay(51, 5, 5, 4, 2),
    lmDay(54, 4, 5, 5, 1),
    lmDay(57, 5, 5, 5, 1),
  ]),
};

// ===========================================================================
// 9. plateau — improves then levels off.
// ===========================================================================

const PL_START = iso('2026-05-04');
const plateau: ReportScenario = {
  name: 'plateau',
  title: 'Plateau (early gains then level)',
  summary:
    'Clear improvement over the first two weeks that then levels off — a mix of trend arrows (the metrics that were still rising) and flat arrows (the ones that plateaued within the deadband).',
  profile: {
    medName: med('Viloxazine ER'),
    startDate: PL_START,
    currentDose: dose(400),
    morningReminder: reminderMorning,
    eveningReminder: reminderEvening,
    lockEnabled: false,
    createdAt: FIXED_TS,
  },
  doses: [{ date: PL_START, dose: dose(400) }],
  rangeStart: PL_START,
  rangeEnd: addDays(PL_START, 27),
  entries: build(PL_START, [
    // Weeks 1–2: rising.
    {
      offset: 0,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 2 },
      evening: { ratings: { mood: 2, focus: 2, energy: 2, anxiety: 4 } },
    },
    {
      offset: 1,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 2, energy: 3, anxiety: 4 } },
    },
    {
      offset: 2,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 3, energy: 3, anxiety: 3 } },
    },
    {
      offset: 3,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 3, energy: 3, anxiety: 3 } },
    },
    {
      offset: 4,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 3 },
      evening: { ratings: { mood: 4, focus: 3, energy: 4, anxiety: 3 } },
    },
    {
      offset: 5,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 4, energy: 4, anxiety: 2 } },
    },
    {
      offset: 6,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 4, energy: 4, anxiety: 2 } },
    },
    {
      offset: 7,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 4, energy: 4, anxiety: 2 } },
    },
    {
      offset: 8,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 4, energy: 5, anxiety: 2 } },
    },
    {
      offset: 9,
      morning: { doseTaken: true, sleepQuality: 5, wakingMood: 4 },
      evening: { ratings: { mood: 5, focus: 4, energy: 4, anxiety: 2 } },
    },
    {
      offset: 10,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 5, energy: 4, anxiety: 2 } },
    },
    {
      offset: 11,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 4, energy: 4, anxiety: 2 } },
    },
    {
      offset: 12,
      morning: { doseTaken: true, sleepQuality: 5, wakingMood: 4 },
      evening: { ratings: { mood: 5, focus: 4, energy: 5, anxiety: 2 } },
    },
    {
      offset: 13,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 5, energy: 4, anxiety: 2 } },
    },
    // Weeks 3–4: plateau — hovers where it landed.
    {
      offset: 14,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 4, energy: 4, anxiety: 2 } },
    },
    {
      offset: 15,
      morning: { doseTaken: true, sleepQuality: 5, wakingMood: 4 },
      evening: { ratings: { mood: 5, focus: 4, energy: 4, anxiety: 2 } },
    },
    {
      offset: 16,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 4, energy: 5, anxiety: 2 } },
    },
    {
      offset: 17,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 5, energy: 4, anxiety: 2 } },
    },
    {
      offset: 18,
      morning: { doseTaken: true, sleepQuality: 5, wakingMood: 4 },
      evening: { ratings: { mood: 5, focus: 4, energy: 4, anxiety: 2 } },
    },
    {
      offset: 19,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 4, energy: 5, anxiety: 2 } },
    },
    {
      offset: 20,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 5, energy: 4, anxiety: 2 } },
    },
    {
      offset: 21,
      morning: { doseTaken: true, sleepQuality: 5, wakingMood: 4 },
      evening: { ratings: { mood: 5, focus: 4, energy: 4, anxiety: 2 } },
    },
    {
      offset: 22,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 4, energy: 5, anxiety: 2 } },
    },
    {
      offset: 23,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 5, energy: 4, anxiety: 2 } },
    },
    {
      offset: 24,
      morning: { doseTaken: true, sleepQuality: 5, wakingMood: 4 },
      evening: { ratings: { mood: 5, focus: 4, energy: 4, anxiety: 2 } },
    },
    {
      offset: 25,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 4, energy: 5, anxiety: 2 } },
    },
    {
      offset: 26,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 5, energy: 4, anxiety: 2 } },
    },
    {
      offset: 27,
      morning: { doseTaken: true, sleepQuality: 5, wakingMood: 4 },
      evening: { ratings: { mood: 5, focus: 4, energy: 4, anxiety: 2 } },
    },
  ]),
};

// ===========================================================================
// 10. mixed-signals — benefit vs cost, ending in a dose reduction. Notes suppressed.
// ===========================================================================

const MS_START = iso('2026-04-13');
const mixedSignals: ReportScenario = {
  name: 'mixed-signals',
  title: 'Mixed signals (benefit vs cost, dose reduced)',
  summary:
    'Focus improves but anxiety climbs and appetite falls on 80mg, prompting a reduction to 40mg mid-window. Exercises down-arrows on lower-better metrics, a custom 7-day before/after window, an evening-metric subset, and includeNotes: false (notes captured but omitted).',
  profile: {
    medName: med('Atomoxetine'),
    startDate: MS_START,
    currentDose: dose(40),
    morningReminder: reminderMorning,
    eveningReminder: reminderEvening,
    lockEnabled: false,
    enabledEveningMetrics: ['mood', 'focus', 'anxiety', 'appetite'],
    createdAt: FIXED_TS,
  },
  doses: [
    { date: MS_START, dose: dose(80) },
    { date: addDays(MS_START, 14), dose: dose(40), note: 'reduced — anxiety and appetite loss' },
  ],
  options: { beforeAfterWindowDays: 7, includeNotes: false },
  rangeStart: MS_START,
  rangeEnd: addDays(MS_START, 27),
  entries: build(MS_START, [
    // On 80mg — focus up, anxiety up, appetite down.
    {
      offset: 0,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: {
        ratings: { mood: 3, focus: 3, anxiety: 3, appetite: 3 },
        notes: 'Sharper at work but jittery.',
      },
    },
    {
      offset: 1,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 3, anxiety: 3, appetite: 3 } },
    },
    {
      offset: 2,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 4, anxiety: 4, appetite: 2 } },
    },
    {
      offset: 3,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 2 },
      evening: { ratings: { mood: 3, focus: 4, anxiety: 4, appetite: 2 } },
    },
    {
      offset: 4,
      morning: { doseTaken: true, sleepQuality: 2, wakingMood: 3 },
      evening: {
        ratings: { mood: 3, focus: 4, anxiety: 4, appetite: 2 },
        sideEffects: { racingHeart: { severity: 'mild' } },
      },
    },
    {
      offset: 5,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 4, anxiety: 4, appetite: 2 } },
    },
    {
      offset: 6,
      morning: { doseTaken: true, sleepQuality: 2, wakingMood: 2 },
      evening: {
        ratings: { mood: 2, focus: 4, anxiety: 5, appetite: 2 },
        sideEffects: { racingHeart: { severity: 'mild' } },
      },
    },
    {
      offset: 7,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 5, anxiety: 4, appetite: 2 } },
    },
    {
      offset: 8,
      morning: { doseTaken: true, sleepQuality: 2, wakingMood: 2 },
      evening: { ratings: { mood: 2, focus: 4, anxiety: 5, appetite: 1 } },
    },
    {
      offset: 9,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 5, anxiety: 4, appetite: 2 } },
    },
    {
      offset: 10,
      morning: { doseTaken: true, sleepQuality: 2, wakingMood: 2 },
      evening: {
        ratings: { mood: 2, focus: 4, anxiety: 5, appetite: 2 },
        notes: 'Appetite really low, skipped lunch again.',
      },
    },
    {
      offset: 11,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 2 },
      evening: { ratings: { mood: 3, focus: 4, anxiety: 4, appetite: 2 } },
    },
    {
      offset: 12,
      morning: { doseTaken: true, sleepQuality: 2, wakingMood: 3 },
      evening: { ratings: { mood: 2, focus: 5, anxiety: 5, appetite: 1 } },
    },
    {
      offset: 13,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 2 },
      evening: { ratings: { mood: 3, focus: 4, anxiety: 4, appetite: 2 } },
    },
    // Reduced to 40mg — anxiety eases, appetite recovers, focus softens a touch.
    {
      offset: 14,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 4, anxiety: 4, appetite: 2 } },
    },
    {
      offset: 15,
      morning: { doseTaken: true, sleepQuality: 3, wakingMood: 3 },
      evening: { ratings: { mood: 3, focus: 4, anxiety: 3, appetite: 3 } },
    },
    {
      offset: 16,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 3 },
      evening: { ratings: { mood: 4, focus: 4, anxiety: 3, appetite: 3 } },
    },
    {
      offset: 17,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 3, anxiety: 3, appetite: 3 } },
    },
    {
      offset: 18,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 4, anxiety: 2, appetite: 3 } },
    },
    {
      offset: 19,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 3 },
      evening: { ratings: { mood: 4, focus: 3, anxiety: 3, appetite: 3 } },
    },
    {
      offset: 20,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 4, anxiety: 2, appetite: 4 } },
    },
    {
      offset: 21,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 4, anxiety: 2, appetite: 3 } },
    },
    {
      offset: 22,
      morning: { doseTaken: true, sleepQuality: 5, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 3, anxiety: 2, appetite: 3 } },
    },
    {
      offset: 23,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 4, anxiety: 2, appetite: 4 } },
    },
    {
      offset: 24,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 5, focus: 4, anxiety: 2, appetite: 3 } },
    },
    {
      offset: 25,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 4, anxiety: 2, appetite: 3 } },
    },
    {
      offset: 26,
      morning: { doseTaken: true, sleepQuality: 5, wakingMood: 4 },
      evening: { ratings: { mood: 4, focus: 4, anxiety: 2, appetite: 4 } },
    },
    {
      offset: 27,
      morning: { doseTaken: true, sleepQuality: 4, wakingMood: 4 },
      evening: { ratings: { mood: 5, focus: 4, anxiety: 2, appetite: 3 } },
    },
  ]),
};

/** The 10 golden scenarios, in gallery order. */
export const SCENARIOS: readonly ReportScenario[] = [
  cleanResponder,
  titrationJourney,
  sideEffectHeavy,
  nonResponder,
  poorAdherence,
  sparseLogging,
  shortWeek,
  longMultimonth,
  plateau,
  mixedSignals,
];
