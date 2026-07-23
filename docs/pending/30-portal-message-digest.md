> **Status:** Proposed (2026-07-23) · **Priority:** P2 · Ref: innovation batch, round 2

# Portable "portal message" text digest

## Problem / Context

The PDF report (doc 06, landed) is built for an in-person or attached-document read: multi-page,
formatted tables, sparklines. But a lot of real patient-provider contact happens between visits
through a patient-portal message box (MyChart-style systems, secure messaging) — a plain-text
field with no attachment, often character-conscious, meant for a quick update, not a document.
Today the only way to get this app's data into that channel is to manually reread the PDF and
retype a summary by hand, which is exactly the kind of friction this app exists to remove
elsewhere (doc 15's friction reducers) but has never addressed for this specific, common
between-visit communication path.

This doc adds a second, much shorter export format: a plain-text digest sized for pasting
directly into a portal message, built entirely from data and helpers the PDF report already
uses. It is not a replacement for the PDF — the two serve different moments (a scheduled visit
vs. a quick between-visit note) and this doc is explicit that the PDF remains the record for an
actual appointment.

## Goals / Non-goals

**Goals**

1. A pure function producing a short, plain-text (not HTML) digest over a date range, reusing the
   same landed helpers `buildReportHtml`/Trends already call (`adherenceInWindow`, `metricAverage`,
   `formatDose`, `sideEffectSummary`) rather than reimplementing any of their logic.
2. A "Copy summary for a portal message" action in Settings' export section, alongside the
   existing PDF/JSON export buttons — copies the digest to the clipboard for pasting.
3. The digest text itself carries the app's own "not medical advice" framing as a literal
   trailing line, since it may be read outside any in-app context once pasted elsewhere.

**Non-goals**

- **Not a PDF/report replacement.** The doc explicitly recommends the PDF for an actual
  appointment; this format is scoped to the shorter, informal between-visit channel.
- **No portal integration of any kind.** No API, no EHR connection, no "send" button — the
  feature ends at the OS clipboard. The user pastes it wherever they choose; this stays inside
  the local-only, user-initiated-export contract every other export in this app already follows.
- **No new data or metrics.** Every figure in the digest is one the PDF report already computes
  and renders; this is a different renderer over the same inputs, not a new capability to
  collect or derive data.
- **No configurable template/wording.** One fixed, reviewed format — avoids turning this into a
  small templating feature with its own surface to maintain.

## Core logic (`lib/portal-digest.ts`, new, RN-free)

```ts
/**
 * Builds a short, plain-text summary for pasting into a patient-portal message. Reuses the same
 * pure helpers buildReportHtml calls — this is a different renderer over identical inputs, never
 * a parallel computation that could drift from the PDF's numbers.
 */
export function buildPortalDigest(
  profile: Profile | null,
  doses: readonly DoseChange[],
  entries: Readonly<Record<IsoDate, DayEntry>>,
  rangeStart: IsoDate,
  rangeEnd: IsoDate,
): string {
  const rows = rowsInRange(entries, datesInRange(rangeStart, rangeEnd));
  const lines: string[] = [];
  lines.push(`ADHD med check-in summary (${rangeStart} to ${rangeEnd})`);
  if (profile !== null) {
    lines.push(`Medication: ${profile.medName} ${formatDose(profile.currentDose)}`);
  }
  // adherenceInWindow (not computeAdherence — that returns takenCount/notTakenCount/noEntryCount,
  // the richer shape the full report's dedicated adherence block needs) is the exact `{taken,
  // logged}` one-liner shape this compact digest wants, and is the same helper Trends' "Recent"
  // column and the report's own Recent-average section already use for this identical phrasing.
  const adherence = adherenceInWindow(rows);
  lines.push(`Doses taken: ${adherence.taken} of ${adherence.logged} logged mornings`);
  // scaleMetricFor (lib/report-html.ts) is NOT exported — a self-contained lookup over the real
  // schema exports instead, matching the same array-plus-find idiom buildReportHtml's own module
  // uses internally (panel — TS lens must-fix: the private-symbol import would not compile).
  const allScaleMetrics = [...MORNING_METRICS, ...EVENING_METRICS].filter(
    (m): m is Extract<Metric, { kind: 'scale' }> => m.kind === 'scale',
  );
  for (const key of REPORT_RATING_ORDER) {
    const metric = allScaleMetrics.find((m) => m.key === key);
    if (metric === undefined) continue;
    const pick = ratingAccessor(isMorningRatingKey(key) ? 'morning' : 'evening', key);
    const average = metricAverage(rows, pick);
    if (average.kind === 'empty') continue;
    // Sample size included (panel — clinical lens must-fix): a bare mean reads identically
    // whether it rests on 2 days or 30, and this text is explicitly meant to be read outside
    // any in-app context once pasted — it needs the denominator more than the report does, not
    // less (mirrors the adherence line's own "of N logged mornings" denominator, above).
    lines.push(
      `${metric.label}: averaging ${average.mean.toFixed(1)}/5 (over ${String(average.n)} days)`,
    );
  }
  // One-line side-effect mention (panel — clinical lens must-fix): a new or ongoing side effect
  // is often the single most decision-relevant reason a patient messages a provider between
  // visits — more so than a mood/focus mean — so omitting it entirely (an earlier draft did)
  // left out the digest's most clinically load-bearing fact.
  const onset = firstOnsetDates(entries);
  const activeSideEffects = sideEffectSummary(rows, onset, doses).filter(
    (s) => s.ongoingAtRangeEnd,
  );
  if (activeSideEffects.length > 0) {
    const summary = activeSideEffects.map((s) => `${s.label} (${s.latestSeverity})`).join(', ');
    lines.push(`Ongoing side effects: ${summary}`);
  }
  const doseChangesInRange = doses.filter((d) => d.date >= rangeStart && d.date <= rangeEnd);
  if (doseChangesInRange.length > 0) {
    lines.push(`Dose changes logged: ${doseChangesInRange.length}`);
  }
  lines.push('');
  lines.push('This is a personal log, not medical advice.');
  return lines.join('\n');
}
```

Every function called here (`adherenceInWindow`, `ratingAccessor`, `metricAverage`, `formatDose`,
`rowsInRange`, `datesInRange`, `firstOnsetDates`, `sideEffectSummary`, and the schema arrays
`MORNING_METRICS`/`EVENING_METRICS`) is an existing, landed, unmodified export — this file adds
zero new statistics, only a different, shorter text layout over them. `sideEffectSummary`'s
`SideEffectSummaryRow` (`lib/report-metrics.ts:176-190`) carries `label`, `ongoingAtRangeEnd`, and
`latestSeverity` exactly as used above.

## UI (`app/(tabs)/settings.tsx`, export section)

One new button, "Copy summary for a portal message," beside the existing PDF/JSON export
actions, using the same selected date range those already use. On tap: `buildPortalDigest(...)`
then `Clipboard.setStringAsync(...)`, with a brief confirmation toast/label matching the existing
"Backup restored"-style inline confirmation pattern already used elsewhere in Settings — no new
confirmation-UI primitive.

**New dependency, stated plainly:** requires `expo-clipboard`. Unlike doc 26's HealthKit/Health
Connect situation (two native modules, a config plugin, a real permission prompt), this is a
single, well-supported Expo SDK package with no platform-permission prompt and no config-plugin
requirement beyond the standard autolinking every other Expo module here already goes through —
a materially smaller dependency cost, worth naming so it isn't waved through without comparison
to how seriously this repo has scrutinized every other new dependency (doc 05, doc 26).

## Test plan (`lib/__tests__/portal-digest.test.ts`)

1. `buildPortalDigest` — output contains the medication name/dose when a profile is present and
   omits that line when `profile` is `null`; adherence line matches `adherenceInWindow` called
   directly on the same rows (an agreement check); a metric with no data in range is omitted
   (matches the report's own "data present, not Settings toggle" rule); **every rendered metric
   line includes its sample size** (`(over N days)`), asserted against `metricAverage`'s own `n`
   for that metric — an agreement check, not a hand-typed expectation; a fixture with an ongoing
   side effect produces the "Ongoing side effects" line with the correct label/severity, and a
   fixture with none omits the line entirely; the trailing "not medical advice" line is always
   present, verified by exact substring match since it must never be accidentally dropped by a
   future edit.
2. No HTML escaping test needed — this is plain text with no markup to escape; verify instead
   that no HTML entities/tags leak in from any reused helper (a fast sanity check, given every
   reused helper was written for an HTML renderer).

## Gate compliance

No `any`/`!`/`@ts-*`/eslint-disable. No new persisted type, no new `Backup`/`STORAGE_KEYS`
change — this doc reads existing state and produces a string. `npm run check` must pass before
commit.

## Dependencies & sequencing

Independent of every other doc in this batch and the prior round. Builds only on landed code
(`lib/report-metrics.ts`, `lib/metrics.ts`, `lib/schema.ts`). The one external dependency is the
new `expo-clipboard` package, unrelated to any other pending doc's dependency needs.

## Alternatives considered

- **Route through the OS share sheet (`expo-sharing`, already a dependency) instead of the
  clipboard:** rejected — `expo-sharing`'s `Sharing.shareAsync` is file-based (used here for the
  PDF), and forcing a plain-text string through a file-share flow is more roundabout than a
  direct clipboard copy for something the user is about to paste into a text box.
- **Let the user edit the digest before copying:** rejected for v1 — a fixed, reviewed format
  keeps this a one-tap action; an editable draft would need its own state and UI, disproportionate
  to what is meant to be a quick between-visit note.
- **Match the PDF's full level of detail (side effects, dose-period buckets, etc.) in text
  form:** rejected — the entire point is a short, portal-message-sized digest; a text dump of
  everything the PDF shows would defeat the purpose and just be a worse PDF.

## Privacy note

The OS clipboard is readable by other apps on the device and, on platforms with a shared-
clipboard feature (e.g. Universal Clipboard), may sync to other devices signed into the same
account — a marginally wider exposure window than the existing PDF/JSON file-share flow. This
is still consistent with the local-only, user-initiated-export contract every other export in
this app follows (nothing is pushed anywhere by the app itself; the user chooses to copy, and
where the OS or the user takes it from there is outside the app's control, same as a shared PDF
file) — named here so it isn't silently assumed identical to a file share.

## Panel review

Run through the 4-lens panel (2026-07-23): approve (UX, scope), approve-with-changes (clinical,
strict-TS). Must-fixes applied above.

- **Clinical — approve-with-changes.** _Must-fixes (applied):_ metric-average lines omitted
  sample size despite this text being explicitly designed to be read outside any in-app context
  — added `(over N days)` to every line, mirroring the adherence line's own denominator; the
  digest omitted side effects entirely despite `sideEffectSummary` being listed among the reused
  helpers — added a one-line "Ongoing side effects" summary, since a new/worsening side effect is
  often the most decision-relevant reason a patient messages a provider between visits. The
  trailing "not medical advice" line and its dedicated substring test were confirmed correct.
- **Strict-TypeScript architect — approve-with-changes.** _Must-fix (applied):_ `scaleMetricFor`
  is a private, unexported function in `lib/report-html.ts` (as is its return type alias) — the
  original snippet's import would not compile. Replaced with a self-contained lookup over the
  real exported `MORNING_METRICS`/`EVENING_METRICS` schema arrays, filtered to `kind: 'scale'`
  via a type-narrowing predicate, matching the idiom the report module already uses internally
  rather than depending on one of its private helpers. Confirmed every other reused symbol
  (`adherenceInWindow`, `ratingAccessor`, `metricAverage`, `formatDose`, `rowsInRange`,
  `datesInRange`, and now `firstOnsetDates`/`sideEffectSummary`) is a real, exported symbol with
  the signature the doc assumes.
- **Mobile UX / friction — approve.** Off the daily flow entirely (Settings-only); the specified
  post-copy confirmation label avoids the classic silent-copy confusion case. No must-fix.
  _Noted:_ confirm the confirmation fires on actual copy success, not optimistically before it.
- **Data-model / migration + privacy + scope — approve.** No new persisted type, a second text
  renderer over identical landed inputs. The `expo-clipboard` dependency-cost comparison to doc
  26 holds up: one Expo SDK package, standard autolinking, no permission prompt, no config
  plugin — materially smaller than doc 26's two native modules. No must-fix. _Added above:_ a
  privacy note that OS clipboard contents are readable by other apps and may sync across devices
  via platform clipboard-sharing features — a marginally wider exposure than a file share, still
  within the existing user-initiated-export contract.
