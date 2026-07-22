> **Status:** Proposed — pending implementation · **Priority:** P2 · Ref: clinical-lens alternative to #13 · Panel-reviewed (4 lenses, approve-with-changes; must-fixes applied)

> **Landing decision (panel — all four lenses):** doc **#13 (PGI-C) wins the weekly-_change_
> slot** for v1. Both the clinical and UX lenses concluded that ASRS-plotted-weekly is a weaker
> week-over-week signal than #13's coarse better/same/worse (see the recall-window defect below),
> and shipping both weekly features is redundant scope. This doc's durable contribution is its
> **architecture** — a verbatim-fidelity, license-guarded, safety-encoded instrument _registry_ —
> to be landed later at an **instrument-appropriate cadence**, not as the v1 weekly ask. The
> must-fixes below rewrite the v1 deliverable accordingly.

# Weekly validated self-report instrument (alternative to #13)

## Problem / Context

Doc 13 (now landed — see [`DECISIONS.md`](../DECISIONS.md#weekly-global-impression-check-in-2026-07-22))
fills a real gap — nothing captures a patient's
_week-over-week_ sense of change, the axis a provider titrates against — with a coarse 3-way
Patient Global Impression of Change (better / same / worse). That is cheap and honest, but from a
**clinical-measurement** standpoint it has three weaknesses:

1. **No independent evidence base as a monitoring score.** PGI-C is a single global-change item.
   It is a legitimate instrument, but its number carries no validated severity meaning; a provider
   can read the direction but not calibrate magnitude against anything.
2. **Relative-anchor-only.** Doc 13 itself flags this: a sequence of "compared with last week"
   deltas cannot reconstruct net position vs. baseline.
3. **No construct resolution.** "Overall better" cannot tell a prescriber _what_ got better —
   the exact thing they weigh when titrating a non-stimulant (symptoms vs. function vs.
   tolerability).

This doc proposes the alternative we would reach for as a clinician: capture a **validated,
verbatim self-report instrument** on a periodic cadence, store the **raw item responses**, and
render the **raw total as a descriptive trend** — no cutoffs, no severity bands, no screen verdict.
It ships with exactly one instrument and is architected so additional instruments are additive
(the "configurable scale options" the mission can grow into), the same way `lib/schema.ts` makes
daily metrics additive. (The draft assumed a _weekly_ cadence; the panel corrected that — see
"Cadence must match the instrument" — because the shipped instrument's recall window is far longer
than a week.)

This is deliberately framed as an _alternative_ to #13. The panel adjudicated it (below): the two
are **not** competitors on the same cadence — #13 keeps the weekly-change slot, and this doc's
instrument lands, if at all, on its own slower (monthly) axis.

## What "validated instrument" buys us (and its cost)

The clinical rationale, carried over from the design discussion that produced this doc:

- A **scale score** is a psychometric object: a fixed item set, a fixed recall window, a fixed
  summing rule, and a published validation base. The total is interpretable _because_ the whole
  instrument was validated — which is precisely the "stronger evidence rating" PGI-C lacks.
- These instruments are **self-report by design** (the "-S" forms exist for exactly this), and the
  app's context — a patient already under a provider's care, logging to bring the trend back — is
  the single most appropriate context for patient self-report. It is monitoring within care, **not**
  standalone screening or self-diagnosis.
- The cost is **fidelity discipline**: a validated instrument is only valid if reproduced verbatim
  (item wording, response options, recall window). Paraphrasing it, reordering it, or swapping its
  response set silently voids the validation. This constraint drives several must-haves below.
- **Fidelity extends to _administration cadence_** (panel — Clinical + UX must-fix). An
  instrument is validated at a specific administration interval matching its recall window;
  re-administering it more often than that is off-protocol and voids the "evidence-graded"
  advantage just as surely as paraphrasing does. This is the crux of the v1 rewrite below.

## Cadence must match the instrument (panel — Clinical + UX must-fix, the load-bearing correction)

The original draft proposed plotting **ASRS v1.1 on a weekly cadence**. Both the clinical and UX
lenses independently identified this as the doc's core defect, and it is fixed here:

- **ASRS v1.1's verbatim recall window is "over the past 6 months."** Re-administering a
  6-month-recall instrument weekly produces **overlapping recall windows that cannot move
  week-over-week** — so its raw total is structurally incapable of being the "weekly-change signal"
  the draft claimed, which is exactly the axis a provider titrates against. ASRS was never validated
  under weekly re-administration; doing so is off-protocol and forfeits the evidence-graded
  interpretability that was the whole argument for preferring an instrument over #13's PGI-C.
- **Consistency (Clinical must-fix).** The draft rejected the 6-item ASRS screener as "off-label…
  repurposing its score as a trend," yet committed the same off-label move with the 18-item
  checklist as a weekly longitudinal monitor. The standard is now applied consistently: **no
  instrument is administered off its validated interval.**

**Resolution.** The feature decouples "administration cadence" from the literal week:

1. **An instrument declares its own administration cadence** (`administer: 'weekly' | 'monthly'`,
   part of `InstrumentDefinition`), chosen to match its validated recall window. ASRS, with a
   6-month recall, is administered **monthly at most** — never weekly — and its total is plotted on
   that slower axis.
2. **The v1 weekly-_change_ signal is doc #13's PGI-C, not this doc.** This doc does not compete for
   the weekly cadence. If it lands, it lands as a periodic (e.g. monthly) validated-instrument
   snapshot alongside #13's weekly PGI-C, not instead of it.
3. **Capture chrome must state the instrument's own window verbatim** (Clinical must-fix): the
   screen shows "over the past 6 months" (the instrument's real window), never "How was last week,"
   so the respondent is never given two contradictory recall instructions on one screen.

The registry's real value, therefore, is enabling a validated instrument at _its own_ correct
cadence — not cramming any instrument into a weekly slot.

## Goals / Non-goals

**Goals**

- Add an opt-in, periodic capture of **one validated self-report instrument** _at the instrument's
  own validated administration cadence_ (see "Cadence must match the instrument"), storing the
  **raw per-item responses** (not a pre-scored band).
- Render the instrument's **raw total** as a descriptive timeline (on its own cadence axis) in the
  report and (later) Trends — a plain number over time, exactly as neutral as doc 13's chips.
- Reproduce the shipped instrument **verbatim** — items, response options, and recall window — and
  guard that fidelity with a test so future edits can't quietly void validity.
- Model instruments as a **registry / discriminated union** (mirroring the `Metric` union) so a
  second instrument is an additive change in one file — the "configurable scale options" seam.
- Reuse #13's period-anchoring machinery where it generalizes (`weekStart` / period-start helpers,
  the self-resolving Today card pattern, the opt-in reminder) so this doc adds a _payload_ at its
  own cadence, not a bespoke set of primitives. (Because the cadence is monthly-or-slower for ASRS,
  the period helper is a month/interval analog of `lastCompletedWeekStart`, not that function
  literally — see Storage.)

**Non-goals**

- **No scoring interpretation.** No cutoffs, severity bands ("moderate"), "clinically significant
  change" flags, screen-positive/negative logic, or the ASRS Part-A shaded-box screening rule. The
  app shows the raw total trend and defers all meaning to the provider. This is the hard line.
- **No battery / multi-instrument-per-week in v1.** Exactly one instrument ships. The registry
  makes _more_ instruments _possible_; it does not schedule several at once. A weekly battery is
  out of scope and would wreck completion.
- **No proprietary instruments.** Only public-domain / free-for-use instruments may be bundled
  (encoded as a `license` field). CAARS / Conners and any license-restricted scale are rejected at
  the data-model level.
- **No comorbidity-screening battery** (panel — scope must-fix). The registry is constrained to
  instruments measuring the **tracked medication's own effects** — its target symptoms, associated
  function, and its tolerability. **GAD-7 and PHQ-8 are explicitly _out of scope_** and removed from
  the roadmap: they screen for _other_ conditions (anxiety, depression) rather than this med's
  titration, which is exactly the "general clinical-assessment / screening battery" the pending
  README bars. This is a hard boundary, not a "deferred, individually reviewed" item.
- **No safety-sensitive item without an explicit safety path.** Any instrument containing a
  self-harm / suicidal-ideation item (e.g. PHQ-9 item 9) may not ship as-is; the PHQ variant, if
  ever added, ships as **PHQ-8** (item 9 omitted). Encoded so it cannot be bypassed silently.
- Does not touch daily check-in data shapes, `MORNING_METRICS`/`EVENING_METRICS`, or averaging.
- No back-fill UI for missed weeks in v1 (same scoping as #13).

## Which instrument ships in v1

**ASRS v1.1 Symptom Checklist (18-item), WHO, public domain.** It is the natural core for
ADHD-medication titration monitoring: symptom frequency across inattention and
hyperactivity/impulsivity, self-report, free to embed, and its per-item frequency response set is a
clean 5-option Likert that stores as a small literal union.

- **Fidelity note:** we bundle the 18-item **symptom checklist** used as a longitudinal
  frequency measure. We do **not** implement the 6-item Part-A **screener scoring** (the
  shaded-box "≥4 → likely ADHD" rule) — that is a diagnostic verdict and is an explicit non-goal.
  Items are reproduced verbatim; the total is a plain sum of response indices.
- **Friction acknowledgment (and why cadence fixes most of it):** 18 items is far heavier than
  #13's single tap. The panel weighed this (evidence-graded signal vs. completion) and concluded
  #13 owns the weekly slot; ASRS lands as a **monthly** snapshot, where an 18-item form once a
  month is a defensible ask rather than a weekly-abandonment risk. It is fully opt-in and off by
  default, lives on its own screen off the daily flow, and supports partial-save resume (see UI).
  The doc does **not** trim ASRS's item set to reduce friction — trimming a validated instrument
  voids it; choosing a _different, cadence-appropriate_ validated instrument is the only honest
  lever, and that is what the registry enables.

Future additive instruments the registry is designed to accept (not built here) — **constrained to
the tracked med's own effects** (panel — scope must-fix): **WFIRS-S** (function) and **FIBSER**
(side-effect burden). Each is a separate, later, individually-panel-reviewed addition. Comorbidity
screeners (GAD-7, PHQ-8, etc.) are **not** on this roadmap (see Non-goals).

## Mission fit & guardrails

- **Collect → log → provider.** A validated instrument's raw responses are still just _what the
  patient reported_. The report renders the verbatim total trend and defers meaning. No verdict is
  derived on-device.
- **No _on-device_ interpretation; the provider interprets using published norms** (panel — scope
  must-fix, stated honestly). The point of bundling a validated instrument is precisely that its
  total carries meaning _in the provider's hands_ against published norms — so "raw total, no
  interpretation" is not a claim that the number is inert, it is a claim about **where** the
  interpretation happens: never on-device, always with the provider. The app shows a bare number
  over time — the same category as the existing `Rating` trends — with no band, no
  color-as-judgment, and no "your ASRS is elevated." That is collect → log → provider, said
  precisely.
- **Local-only preserved.** New data lives under a new AsyncStorage key `"instruments"`; leaves the
  device only via the same user-initiated PDF/JSON export.
- **Never blocks the daily loop.** Reuses #13's self-resolving Today card and opt-in Monday
  reminder verbatim; the daily check-in is untouched.
- **Fidelity as a guardrail.** Verbatim reproduction is a mission constraint, not a nicety — a
  paraphrased instrument would misrepresent a "validated" measure to a provider.

## Data model

Add to `lib/types.ts`. The core idea: an **instrument definition** (static, verbatim, shipped in
code) and an **instrument response** (per-week, stored). Responses store raw item answers; the
total is _derived_, never persisted, so there is no stored-vs-derived desync.

```ts
/** Instruments we are licensed to bundle. Literal union → a new instrument is one edit here. */
export const INSTRUMENT_IDS = ['asrs-v1.1'] as const;
export type InstrumentId = (typeof INSTRUMENT_IDS)[number];

/** ASRS v1.1 per-item frequency response. Stored as the literal, scored via a fixed map. */
export const ASRS_RESPONSES = ['never', 'rarely', 'sometimes', 'often', 'veryOften'] as const;
export type AsrsResponse = (typeof ASRS_RESPONSES)[number];

/**
 * The 18 ASRS item ids, declared explicitly as an `as const` tuple in `types.ts` (panel — TS
 * must-fix). This is the SAME `SIDE_EFFECTS` pattern; it is NOT "generated from the definition"
 * — deriving `typeof ASRS_V1_1.items[number]['id']` is circular, because `ASRS_V1_1` is annotated
 * `: InstrumentDefinition` whose `items: readonly AsrsItem[]` already references `AsrsItemId`, so
 * the annotation widens each `id` back to `AsrsItemId` and erases the literals. The definition's
 * `items` are checked AGAINST this tuple instead.
 */
export const ASRS_ITEM_IDS = [
  'asrs-1',
  'asrs-2',
  'asrs-3',
  'asrs-4',
  'asrs-5',
  'asrs-6',
  'asrs-7',
  'asrs-8',
  'asrs-9',
  'asrs-10',
  'asrs-11',
  'asrs-12',
  'asrs-13',
  'asrs-14',
  'asrs-15',
  'asrs-16',
  'asrs-17',
  'asrs-18',
] as const;
export type AsrsItemId = (typeof ASRS_ITEM_IDS)[number];

/** Administration cadence — must match the instrument's validated recall window (see Cadence). */
export type InstrumentCadence = 'weekly' | 'monthly';

/**
 * One completed instrument for one fully-elapsed ISO week.
 * `answers` is keyed by item id; storing raw responses (not a total) keeps the score derived.
 * Discriminated by `instrumentId` so adding an instrument with a different response type is a
 * new variant that every consumer's exhaustive switch must handle.
 */
export type InstrumentResponse = {
  readonly instrumentId: 'asrs-v1.1';
  readonly weekOf: IsoDate;
  readonly answers: Readonly<Partial<Record<AsrsItemId, AsrsResponse>>>;
  readonly completedAt: IsoTimestamp;
};
// (future) | { instrumentId: 'gad-7'; …; answers: Record<Gad7ItemId, Gad7Response>; … }
```

`AsrsItemId` is the literal union declared by the explicit `ASRS_ITEM_IDS` tuple above (not derived
from the definition — see that comment), so `answers` can only be keyed by real items and a
partially-completed instrument (some items unanswered) is representable without an optional-flag
soup. `answers` is a
`Partial<Record<…>>` so an incomplete week is legal data, not a parse failure — but the report
labels completeness (below) rather than silently summing a partial instrument as if whole.

The **instrument definition** is static, code-only (never persisted), and holds the verbatim
strings + scoring:

```ts
export interface AsrsItem {
  readonly id: AsrsItemId;
  readonly text: string; // VERBATIM ASRS wording — never paraphrase
}
export interface InstrumentDefinition {
  readonly id: InstrumentId;
  readonly title: string; // e.g. "Adult ADHD Self-Report Scale (ASRS v1.1)"
  readonly license: 'public-domain'; // only free-to-bundle licenses are representable
  readonly administer: InstrumentCadence; // must match recallWindow; ASRS → 'monthly', never weekly
  readonly recallWindow: string; // VERBATIM, e.g. "over the past 6 months" — shown, never altered
  readonly responseLabels: Readonly<Record<AsrsResponse, string>>; // verbatim option labels
  readonly items: readonly AsrsItem[];
  /** True iff the instrument contains a self-harm/ideation item needing a safety path. */
  readonly hasSafetySensitiveItem: false;
}
```

`license` is a literal union with only free values, so a proprietary instrument is
**unrepresentable** — you cannot add CAARS without adding a license value, which is the deliberate
tripwire. `hasSafetySensitiveItem: false` is `false` for every shippable instrument; making it a
literal `false` (not `boolean`) means an instrument that _would_ need `true` fails to typecheck
until a safety path exists to satisfy a future `| { hasSafetySensitiveItem: true; safetyRoute: … }`
variant — encoding the PHQ-9 item-9 rule in the type system rather than a comment.

**Score is derived, not stored.** A pure `scoreAsrs(answers): { total: number; answered: number }`
lives in RN-free `lib/`. `total` sums the fixed response→index map over answered items; `answered`
is the count, so the report can show "total 24 (18/18 answered)" and never presents a partial
instrument as a complete score.

## Schema / registry

New RN-free `lib/instruments.ts` (peer of `lib/schema.ts`) is the **single source of truth** for
instrument definitions, mirroring how `schema.ts` is the single source for daily metrics:

```ts
export const ASRS_V1_1: InstrumentDefinition = { … }; // verbatim 18 items + labels
export const INSTRUMENTS: Readonly<Record<InstrumentId, InstrumentDefinition>> = { 'asrs-v1.1': ASRS_V1_1 };
export function scoreAsrs(answers: …): { total: number; answered: number } { … }
```

Adding an instrument = add its id to `INSTRUMENT_IDS`, its response union, an `InstrumentResponse`
variant, and its definition here — the exhaustive switches (below) then fail to compile until every
consumer handles it. That compile-time fan-out _is_ the "add a scale in one place" contract.

**Verbatim-fidelity test (mandatory).** `lib/__tests__/instruments.test.ts` asserts the shipped
ASRS definition against a checked-in verbatim fixture of the 18 item strings + 5 response labels +
recall window. Any accidental paraphrase fails the build. This is the mechanism that keeps
"validated" honest.

## Storage & guards

New key `"instruments"`, storing `Readonly<Record<IsoDate, InstrumentResponse>>` keyed by
`periodStart` — the canonical start of the instrument's administration period (a Monday for a
`weekly` instrument, a month-start for a `monthly` one). One response per period per instrument in
v1; a composite key (`${periodStart}:${instrumentId}`) is the seam if multiple instruments are ever
enabled (open question, not built). The period-start helper is an interval-parameterized analog of
#13's `weekStart` (whichever doc lands first contributes the shared week helper; the monthly analog
is additive).

Parse-don't-validate at the boundary. Guards narrow `unknown` via the existing `isRecord` /
`isIsoDate` / `isIsoTimestamp` pattern, and — critically — an **unknown `instrumentId` or an
unknown answer value must not nuke the store**:

```ts
export function isAsrsResponse(value: unknown): value is AsrsResponse { … }
export function isAsrsItemId(value: unknown): value is AsrsItemId { … } // (ASRS_ITEM_IDS as readonly string[]).includes(...)
export function isInstrumentResponse(value: unknown): value is InstrumentResponse { … } // switch on instrumentId; validates answer keys via isAsrsItemId, values via isAsrsResponse
```

`isAsrsItemId` is required (panel — TS must-fix): `isInstrumentResponse` must reject an unknown
`answers` key without an `as`, so the item-id guard exists alongside `isAsrsResponse`, both using
the sanctioned `SIDE_EFFECTS`-style `.includes` idiom.

**Return shape — one tolerant struct, not `Parsed<T>`** (panel — TS + scope must-fix; the draft's
`Parsed<T>` + "dropped and counted" was self-contradictory, since `Parsed<T>` has no count channel).
Mirror `parseEntriesTolerant` exactly:

```ts
export interface InstrumentsParse {
  readonly instruments: Readonly<Record<IsoDate, InstrumentResponse>>;
  readonly droppedKeys: readonly string[]; // per-period drops, surfaced not silently swallowed
  readonly hardFailure: boolean; // true when the blob is unreadable (not merely one bad period)
}
export function parseInstrumentsTolerant(raw: unknown): InstrumentsParse { … }
```

- A single unparseable period is dropped into `droppedKeys`; the rest survive — never a whole-store
  rejection (the scope lens's standing `raw.filter(guard)` / `list.every(guard)` data-loss concern).
- Answer-level tolerance: an unrecognized answer value for a known item is dropped to "unanswered"
  (the `Partial` makes that a legal state), a forward-compat seam if a response set is extended.
- Key invariant: map key must equal `entry.periodStart`.
- Canonical-period check at the boundary: `periodStart(periodOf, cadence) === key`.

**Save path must honor `hardFailure` — the clobber fix** (panel — scope must-fix). `saveInstrumentResponse`
is load→merge→save and has the identical hazard the #01/#03 fix closed for entries
(`lib/storage.ts:531`): if the `"instruments"` blob is present-but-unreadable, a tolerant parse
returns `{}`, and a naive merge-and-save would then **wipe every prior period**. So the save path
reuses the entries discipline: read raw, and if `parseInstrumentsTolerant` reports
`hardFailure: true`, **abort the save and quarantine the raw blob** (the `…​.corrupt.<ts>` pattern at
`lib/storage.ts:514`) rather than merging onto an empty map. A dropped _period_ (soft) is fine to
merge past; an unreadable _store_ (hard) must not be overwritten.

**Backup path stays `Parsed<T>`-shaped.** `parseBackup` uses `if (!parsed.ok)` uniformly, so the
backup entry point is a thin `parseInstruments(raw): Parsed<…>` wrapper over the tolerant core: it
returns `{ ok: true, value: instruments }` (soft per-period drops tolerated, matching the
missing-key tolerance below) and `{ ok: false, reason }` only on `hardFailure`. Note the deliberate
asymmetry the scope lens flagged: `instruments` is _more_ tolerant in the backup path (per-period
drop) than `entries` (still all-or-nothing via strict `parseEntries`) — a safe direction, called out
so it's an intentional choice, not drift.

**Full-wipe reference corrected** (panel — TS must-fix). There is **no existing `clearAllData` /
`multiRemove` caller** in `lib/storage.ts` (the only `multiRemove` is in the AsyncStorage test
mock). The draft (and #13) referenced a phantom symbol. If a user-initiated full wipe is in scope,
this work **introduces** `clearAllData` and it owns the complete key list (`profile`, `doses`,
`entries`, `weekly` if #13 landed, `instruments`); otherwise the reference is dropped. `loadInstruments`
returns `{}` on a missing key (no migration, no re-onboarding).

## UI touch points

Reuses #13's card/route pattern; the only new surface is the instrument screen itself.

- **`app/checkin.tsx` — untouched.** No `Metric` variant added; the daily `renderMetric` switch and
  `assertNever(metric)` arm stay intact.
- **New route `app/instrument.tsx`:** renders the selected `InstrumentDefinition` generically —
  its **verbatim `recallWindow` line as the only recall instruction on screen**, then one row per
  item with the instrument's response labels as a segmented choice, a progress affordance
  ("12/18"), and Save. Computes `periodStart` for the instrument's cadence; hydrates any existing
  period for edit-in-place. **Capture chrome must not contradict the instrument's window** (panel —
  clinical must-fix): the header names the _period being logged_ ("ASRS — July") but must **not**
  say "How was last week," because every ASRS item verbatim asks "over the past 6 months." Giving
  the respondent two contradictory recall windows on one screen is a data-quality defect (and a soft
  paraphrase by framing). The screen states this is a self-report tool **to share with your
  provider — not a self-assessment or diagnosis** (this line rides on every surface that shows the
  data; see Export).
- **Card self-resolution under partial save** (panel — UX must-fix). Because the task behind the
  card is long (18 items) and partial saves are legal, the card cannot use #13's "any save →
  resolved" rule — that would let a 3/18 bail flip the card to "logged" and degrade the trend to
  meaningless partial sums; nor can it only resolve at 18/18, which would leave a _heavy_ task
  sitting open on Today period after period. Resolution: the card reads the **`answered` count**.
  It shows (a) an unanswered period as a single quiet prompt row; (b) a **partially** answered
  period as a quiet "ASRS — July: 7/18, resume" row (still visibly incomplete, never "done"); (c) a
  complete period as a minimal one-line "ASRS — July: logged" summary with a small edit affordance.
  "Incomplete" reads as incomplete on the card, not only in the report — so there is no false
  "resolved," and equally no open-loop nag (a partial period is self-evidently a resume, not a
  reminder to start over). If #13 also lands, the two share one card slot and **must not stack**.
- **New `components/InstrumentItemPicker.tsx`** (thin, presentational): one item's segmented
  response buttons; `theme` tokens only, never raw hex.
- **`app/(tabs)/trends.tsx` / `history.tsx` / `entry/[date].tsx` — untouched in v1** (Trends
  categorical/total-line treatment deferred, as in #13).

## Export / report

`lib/report-html.ts` gains a descriptive **Instrument timeline** section; `Backup` grows one field.

- **Backup (`lib/backup.ts`):** extend `Backup` to `{ exportedAt; profile; doses; entries; instruments }`
  (additive alongside #13's `weekly` if both land). `buildBackup` serializes `loadInstruments()`
  output; `parseBackup` parses `instruments` through the thin `parseInstruments(raw): Parsed<…>`
  wrapper (over the tolerant core; `{ ok: false }` only on `hardFailure`) and treats a **missing**
  key as `{}` — a **new missing-key-tolerant branch neither #13 nor this doc has built yet**, since
  `parseBackup` (`lib/backup.ts:29`) currently hard-fails on missing/invalid `doses`/`entries`;
  whichever lands first implements it. `restoreBackup` writes via `saveInstruments`, extending its
  existing `Promise.all` over profile/doses/entries (`lib/storage.ts:567`, threading verified).
- **Report HTML:** `buildInstrumentTimelineHtml(instruments, entries, doses)` produces a table
  sorted by `periodStart` ascending: **Period** (the period being logged, e.g. "July 2026"),
  **Instrument** (verbatim title), **Score** (`scoreAsrs` → "24 (18/18 answered)", or "— (0/18)"
  when empty), **Adherence** and **Dose change** aggregated **over the instrument's period** (the
  monthly analog of #13's `weeklyAdherence` / `doseChangeInWeek`, generalized to the period span).
  Every dynamic value through `escapeHtml`. Section omitted entirely when empty.
- **No score interpretation in the report.** The score column is a bare number + answered-count.
  **No** severity word, **no** cutoff line, **no** good/bad hue — the same neutral treatment as #13's
  chips, plus a completeness label so a partial period isn't misread as a low score. Caption (and
  the same line must ride on **every** surface that ever shows the number — the Today card summary
  and any future Trends line, not just the report): "Self-reported [instrument title], asked over
  its own recall window. A total tracked over time to discuss with your provider — not a
  self-assessment or diagnostic score."
- **No valence arrow on a symptom total** (panel — clinical must-fix). Unlike #13, whose glyph
  reflects the patient's _own_ better/same/worse word, an app-derived direction arrow on a
  symptom-frequency total (higher = more symptoms) would be the app inferring "down = better" —
  an interpretation. So the definition carries **no `direction`/`ScaleDirection` field**, and the
  timeline shows the bare numbers only. If a purely value-free delta glyph is ever wanted, it may
  use `TrendDirection` (`up`/`down`/`flat`, already value-free in `types.ts`) with **no**
  improved/worsened semantics and no color — but the numbers over time are sufficient and are the
  default.
- Averaging machinery (`lib/metrics.ts`) untouched — instrument totals are summed by `scoreAsrs`,
  never fed to `averageOf`/`ratingAccessor`.

## Notifications

Same shape as #13's reminder, but on the **instrument's own cadence**, not weekly: one optional
`instrumentReminder?: TimeOfDay` on `Profile` (additive, back-compat via the `enabledEveningMetrics`
precedent), a `Calendar` trigger on the instrument's period boundary (for ASRS, **monthly**, not
Monday-weekly), offset from the daily reminders and from #13's weekly reminder if both land,
`data: { kind: 'instrument' }`, routed via a `notificationKindFromResponse` guard (no `as`). Because
this doc does not occupy the weekly slot (see Landing decision), its reminder is distinct from #13's
and fires far less often — no competition with the weekly PGI-C ask.

## Test plan

RN-free logic in coverage scope (`lib/{types,instruments,storage,backup,report-html}.ts`).

- **`lib/__tests__/instruments.test.ts`:** the **verbatim-fidelity** assertion (18 items + 5 labels
  - recall window match the fixture exactly); `scoreAsrs` (full 18 → known total; partial → correct
    `answered`; empty → `{ total: 0, answered: 0 }`); response→index map covers every `AsrsResponse`
    via an exhaustive switch (`assertNever`).
- **Guards:** `isAsrsResponse` accepts the five literals, rejects others; `isAsrsItemId` accepts the
  18 ids, rejects others; `isInstrumentResponse` accepts a valid ASRS period, rejects unknown
  `instrumentId`, an unknown `answers` key, non-canonical `periodStart`, bad `completedAt`;
  `parseInstrumentsTolerant` **drops one bad period into `droppedKeys` and keeps the rest**, sets
  `hardFailure: true` on an unreadable blob (not a mere bad period), rejects a non-record, and
  enforces key === `periodStart`.
- **Save-path clobber (the #01/#03 discipline):** `saveInstrumentResponse` **aborts and quarantines**
  when the raw store is unreadable (`hardFailure`), and does **not** overwrite prior periods with a
  lone new one — the regression test mirrors the entries clobber test.
- **Backup:** round-trips `instruments`; a legacy backup without the key → `{}`; a backup with one
  malformed period keeps the good periods (tolerant); an unreadable `instruments` blob → `parseInstruments`
  returns `{ ok: false }`.
- **Report:** `buildInstrumentTimelineHtml` emits the verbatim title, the "N (M/18 answered)" score,
  the reused adherence/dose-change columns, an escaped `<script>` note rendered inert; empty →
  section omitted.

Coverage: every new branch (each guard false-branch, the tolerant-drop path, partial-vs-full score,
empty-vs-nonempty section, the response→index switch arms) exercised to the repo's thresholds.

## Gate compliance

- **No `any`/unsafe-any:** guards take `unknown`, narrow via `isRecord` + bracket access; the
  `as readonly string[]` `.includes` idiom (exempt under `--ignore-as-assertion`) matches
  `isSideEffect`.
- **Discriminated union + exhaustive switch:** `isInstrumentResponse`, `scoreAsrs`'s response map,
  and the report renderer switch on `instrumentId` / response and end in `assertNever`, so a new
  instrument fails to compile until every consumer handles it.
- **Illegal states unrepresentable:** `license` literal union bars proprietary instruments;
  `hasSafetySensitiveItem: false` literal bars a safety-sensitive item without a safety-path
  variant; `answers` keyed by the item-id union bars unknown items; score derived (never stored)
  bars stored-vs-derived desync.
- **`noUncheckedIndexedAccess`:** `answers[itemId]`, `INSTRUMENTS[id]`, and map lookups yield
  `… | undefined`, narrowed explicitly, never `!`.
- **No `@ts-*`/eslint-disable/non-null `!`;** branded values only via existing guard-and-throw
  helpers; **type-coverage 100%.**
- **RN-free report:** colors from `palette` in `./tokens`, never `useTheme()`.

## Dependencies & sequencing

- **Landing order settled** (panel): **#13 lands first** as the v1 weekly-change surface. This doc,
  if pursued, lands after, on a monthly cadence, reusing #13's period-anchoring helper (generalized
  to an interval), the self-resolving card _pattern_, and the reminder plumbing — on a distinct
  cadence so the two never contend for the weekly slot.
- **Backup format:** shares the (still-to-be-built) missing-key-tolerant `parseBackup` branch; if
  both docs land, coordinate the `Backup` field additions and the `buildReportHtml` signature in one
  pass. `restoreBackup` threading verified against `lib/storage.ts:567`.
- **Enables:** additional _tracked-med-effect_ instruments (WFIRS-S, FIBSER) as additive registry
  entries, each individually panel-reviewed; a future Trends total-line view. Comorbidity screeners
  are out of scope (Non-goals).

## Alternatives considered / open questions

- **#13's PGI-C vs. this doc for the weekly-change slot — ADJUDICATED** (panel — scope + clinical +
  UX). Resolved, not left open: **#13 wins the weekly slot.** PGI-C is ~5 seconds, plausibly
  survives the weeks-to-months titration window, and — because it captures the patient's _own_
  better/same/worse — actually measures week-over-week change. ASRS cannot be re-administered weekly
  without going off-protocol (6-month recall), so its "evidence-graded" edge does not apply to a
  weekly-change signal. This doc's instrument, when it lands, is a **periodic (monthly) validated
  snapshot on a separate axis**, complementary to #13, not a competitor for the weekly cadence.
- **Ship both weekly (#13 PGI-C _and_ a weekly instrument).** Rejected: two weekly asks stack
  friction and compete for one Today card slot. The resolution above removes the conflict by putting
  the instrument on a slower cadence — they no longer both occupy the weekly slot.
- **6-item ASRS screener instead of the 18-item checklist.** Rejected — and now consistent with the
  18-item decision (panel — clinical): the screener is validated as a _screen_, not a longitudinal
  monitor, and neither the 6-item screener nor the 18-item checklist may be repurposed off its
  validated interval. The honest lever for lower friction is a _different, cadence-appropriate
  validated instrument_ via the registry, never off-protocol re-administration of ASRS.
- **Store the computed total, not raw answers.** Rejected: storing raw answers keeps the score
  derived (no desync), lets the answered-count label partial periods honestly, and future-proofs a
  scoring correction.
- **Open — multiple instruments per period:** v1 is one-per-period keyed by `periodStart`. A
  composite key (`${periodStart}:${instrumentId}`) is the seam if a battery is ever wanted (explicit
  non-goal now).
- **Open — Trends visualization** of a total line over periods: deferred, table-only in v1 (as #13).
- **Resolved — recall-window vs. cadence mismatch:** was an open question in the draft; the panel
  made it the central must-fix. Fixed in "Cadence must match the instrument" — an instrument is
  administered only at its validated interval (ASRS → monthly), the capture screen shows the
  instrument's verbatim window and never "last week," and the weekly-change signal is #13's job.

## Panel review

Run through the 4-lens panel (2026-07-22): all four **approve-with-changes** — no rejects, but a
unanimous, load-bearing correction. The clinical and UX lenses independently found that ASRS's
6-month recall window makes it structurally invalid on a weekly cadence, so the panel's cross-lens
verdict is that **#13's PGI-C wins the v1 weekly-change slot** and this doc's contribution is its
registry _architecture_, to land later at an instrument-appropriate (monthly) cadence. Must-fixes
applied above.

- **Clinical — approve-with-changes.** Applied: reframed ASRS from weekly to **monthly**
  administration (a 6-month-recall instrument cannot yield a weekly-change signal and re-administering
  it weekly is off-protocol, voiding its evidence-graded advantage); removed the capture-screen "last
  week" chrome that contradicted the verbatim recall window; made the off-label standard **consistent**
  (neither the 6-item screener nor the 18-item checklist is administered off its validated interval);
  **removed the `direction`/valence arrow** on a symptom total (an app-derived "down = better" is
  interpretation); and required the "self-report, not a diagnosis" line to ride on every surface that
  shows the number, not just the report.
- **Strict-TypeScript architect — approve-with-changes.** Applied: declared **`ASRS_ITEM_IDS` as an
  explicit `as const` tuple** in `types.ts` (the "generated from the definition" derivation was
  circular under the `: InstrumentDefinition` annotation); added the missing **`isAsrsItemId`** guard
  so `answers` keys are validated without an `as`; replaced the self-contradictory
  `Parsed<T>`-plus-count signature with a tolerant **`InstrumentsParse` struct**
  (`{ instruments; droppedKeys; hardFailure }`) mirroring `parseEntriesTolerant`, with a thin
  `Parsed<T>` wrapper for the `parseBackup` path; and **corrected the phantom `clearAllData`
  reference** (no such symbol exists in `lib/storage.ts` — this work introduces it or drops the
  reference). Confirmed the one-variant `assertNever` and the `license` / `hasSafetySensitiveItem:
false` literal tripwires all hold.
- **Mobile UX / friction — approve-with-changes.** Applied: pinned down the **card self-resolution
  threshold under partial save** (unanswered → prompt; partial → visibly-incomplete "N/18, resume";
  complete → one-line summary — so it neither false-resolves at 3/18 nor nags with a heavy open task);
  and resolved the recall-window mismatch as a completion hazard by moving to a monthly cadence and
  removing "last week" chrome. The lens's core recommendation — **land #13, not an 18-item weekly
  form** — is adopted as the landing decision.
- **Data-model / migration + privacy + scope — approve-with-changes.** Applied: **trimmed the
  roadmap** — dropped GAD-7/PHQ-8 (comorbidity screeners for _other_ conditions) and constrained the
  registry to the tracked med's own effects (ASRS, WFIRS-S, FIBSER); restated the guardrail honestly
  as **"no on-device interpretation; the provider interprets using published norms"** rather than
  implying the number is inert; carried the **`hardFailure`/quarantine clobber discipline** (#01/#03)
  into the save path; reconciled the `parseInstruments` return shape; and made the **#13-vs-#21
  landing decision explicit** (one weekly cadence, instrument on a separate monthly axis). Verified
  `restoreBackup` threading and flagged the (intentional) tolerance asymmetry vs. strict `parseEntries`.

All lenses approve-with-changes; must-fixes applied. Net: the v1 _deliverable_ is now a monthly
validated-instrument snapshot complementary to #13, and #13 remains the v1 weekly-change surface.
