The repo checks confirm the reviewers' claims. Writing the final doc now.

> **Status:** Approved — pending implementation · **Priority:** P1 · Ref: analysis #1 · Panel-reviewed (4 lenses; must-fixes applied)

# Confounder / context tags

## Problem / Context

The whole point of this app is the multi-week _trend_: a non-stimulant's signal only emerges as an accumulating slope across many daily ratings. But a single confounded day injects noise that looks like signal. A lone `mood: 2` is ambiguous to the provider — was that the medication wearing thin, or did the person sleep three hours, fly across two time zones, and drink at dinner? Today the evening check-in captures _what_ was felt (`mood`, `focus`, side effects) but nothing about the _circumstances_ that would let a reader discount a day.

Without cheap, structured context the user either (a) leaves it out and the provider over-reads a bad day, or (b) buries it in the free-text `notes`, where it never reaches the report (notes are not currently rendered in `buildReportHtml`). We want a one-tap way, at evening check-in, to mark "this day had a known confounder," surfaced back in the exported log so the provider can weight it. Descriptive only — we tag the day, we never re-score or auto-exclude it.

A second, related gap surfaced in clinical review and is folded into this doc: **adherence — the single most load-bearing confound for a titration decision — is captured (`MorningCheckin.doseTaken`) but never rendered in the exported report.** A flat trend from under-dosing looks identical to a flat trend from an ineffective dose, and a provider reading the current report has no way to tell them apart. This doc therefore surfaces the _existing_ adherence field in the report alongside the new Context column (see Export / report). This is why the originally-proposed `skippedDose` tag is dropped: it would ship a second, differently-scoped, PM-flavored adherence flag while the authoritative morning field stayed invisible — actively misleading a provider who sees "no Context tag" and assumes adherence was fine.

## Goals / Non-goals

**Goals**

- Add optional, multi-select **context tags** to the evening check-in (one-tap chips, same interaction weight as side effects), rendered **collapsed by default** so the common "nothing unusual" night stays near-zero-cost.
- Render tags in the exported provider report (a Context column in the daily log) and in the read-only day detail.
- Surface the existing `MorningCheckin.doseTaken` adherence signal in the report's daily-log table (an Adherence column), so it sits next to Context and is no longer invisible.
- Zero disruption to existing data: old entries without tags parse and display unchanged; no re-onboarding.
- Introduce the second chips group **without weakening any type** — no widening of `SideEffect` chips to `string`.

**Non-goals**

- No trend visualization of tags (no bars, no "tagged-day" filtering in `trends.tsx`) in this pass — see Alternatives.
- No interpretation: no "we excluded this day," no correlation, no risk flag, no adherence scoring. Tags and the doseTaken column are shown; meaning is deferred to the provider.
- No per-tag severity, timing, or free text beyond the existing `notes` field.
- No `'other'` tag this pass (see Data model — it would be a contentless dead-end until notes reach the report).
- No new PM/second-dose ("BID") adherence model — the data model has one daily dose; we will not fake a second one via a tag.

## Mission fit & guardrails

Stays inside collect → log → provider. Tags are pure user-entered facts about the day; the app never derives anything from them. The report _displays_ which days carried which tags — and now whether the dose was taken — and stops there; the provider decides whether a flagged `mood: 2` counts. Nothing leaves the device: tags live in `EveningCheckin`, persisted in the existing `"entries"` AsyncStorage key, and exit only through the same user-initiated PDF/JSON exports. The Adherence column reads a field already collected and already exported inside the JSON backup; this only makes it visible in the human-readable PDF. Report copy stays descriptive ("Context — discuss relevance with your provider").

## Data model

Add a const-array + union + (in schema) a labels map, mirroring the exact `SIDE_EFFECTS` idiom in `lib/types.ts`.

```ts
// lib/types.ts
export const CONTEXT_TAGS = [
  'poorSleep',
  'sick',
  'stressfulDay',
  'traveled',
  'alcohol',
  'extraCaffeine',
] as const;
export type ContextTag = (typeof CONTEXT_TAGS)[number];
```

**Why no `'other'`.** An `'other'` chip carries no text of its own, and this doc's own Problem section notes free-text `notes` are not rendered in `buildReportHtml`. A day tagged only "Other" would show the provider a bare, contentless flag on precisely the day that may hold the real explanation — the "data a provider cannot act on" case. Rather than take a hard cross-doc dependency on an as-yet-unscheduled evening-notes-in-report change, we drop `'other'` for this pass. It can be reintroduced trivially (one array entry + one label) once notes reach the report, at which point "Other" gains somewhere to say _what_.

`EveningCheckin` gains one optional readonly field. Optional (not required `readonly contextTags: readonly ContextTag[]`) so historical entries remain valid without migration:

```ts
export interface EveningCheckin {
  readonly mood?: Rating;
  readonly focus?: Rating;
  readonly impulsivity?: Rating;
  readonly anxiety?: Rating;
  readonly energy?: Rating;
  readonly appetite?: Rating;
  readonly libido?: Rating;
  readonly sideEffects: readonly SideEffect[];
  readonly contextTags?: readonly ContextTag[]; // new — absence === "none recorded"
  readonly notes?: string;
  readonly completedAt: IsoTimestamp;
}
```

**The chips-variant decision.** The `Metric` `chips` variant is hard-coded to `key: 'sideEffects'; options: readonly SideEffect[]`. Three ways to admit a second chips group:

- **(a) Discriminated chips pair** — split the one chips member into two members sharing `kind: 'chips'` but distinguished by their `key` literal, each with a correspondingly-typed `options`. The renderMetric `case 'chips'` then narrows on `metric.key`.
- **(b) A distinct metric kind** (`kind: 'contextChips'`) — trips `assertNever` on add (good), but duplicates the entire chips rendering path and the Chips component for no type benefit; two kinds that render identically is soup.
- **(c) Generic `Metric<T>`** — a parameterized union can't live in a plain `readonly Metric[]` array without existential gymnastics; it fights `noUncheckedIndexedAccess` and the schema's single-array model.

**Recommendation: (a).** It is the minimal, fully type-safe change and keeps both chips groups schema-driven. The variant becomes:

```ts
// lib/types.ts — replace the single chips member of the Metric union with:
  | { kind: 'chips'; key: 'sideEffects'; label: string; options: readonly SideEffect[] }
  | { kind: 'chips'; key: 'contextTags'; label: string; options: readonly ContextTag[] }
```

The pair keeps `options` exactly typed per key — `sideEffects` can never be handed `ContextTag[]` and vice versa. To make the shared UI component honor that, generalize `components/Chips.tsx` to be generic over a string-literal option union with an injected labels map (it currently closes over `SideEffect`/`SIDE_EFFECT_LABELS`):

```ts
// components/Chips.tsx
export interface ChipsProps<T extends string> {
  readonly label: string;
  readonly options: readonly T[];
  readonly selected: readonly T[];
  readonly labels: Readonly<Record<T, string>>;
  readonly onChange: (next: readonly T[]) => void;
}
export function Chips<T extends string>({
  label,
  options,
  selected,
  labels,
  onChange,
}: ChipsProps<T>) {
  /* toggle logic unchanged; render labels[option] */
}
```

Illegal states stay unrepresentable: `selected`/`onChange` are `T`-typed, so a context group cannot round-trip a `SideEffect`.

## Schema

`lib/schema.ts` gains the labels map and one new entry in `EVENING_METRICS` (append after the existing side-effects chips, before `notes`). No default-enable list is needed — context tags are always available at evening check-in and are not gated by `enabledEveningMetricKeys` (that gate only governs `'scale'` metrics whose key is an `EveningRatingKey`).

```ts
// lib/schema.ts
export const CONTEXT_TAG_LABELS: Readonly<Record<ContextTag, string>> = {
  poorSleep: 'Poor sleep',
  sick: 'Sick / unwell',
  stressfulDay: 'Stressful day',
  traveled: 'Traveled',
  alcohol: 'Alcohol',
  extraCaffeine: 'Extra caffeine',
};

// EVENING_METRICS, appended (rendered collapsed by default — see UI touch points):
{ kind: 'chips', key: 'contextTags', label: 'Anything unusual today?', options: CONTEXT_TAGS },
```

## Storage & guards

Add `isContextTag` and extend `isEveningCheckin` in `lib/storage.ts`. Parse-don't-validate; the field is optional, so `undefined` is valid and a present value must be an array of known tags.

The live `isEveningCheckin` (lib/storage.ts:125–136) is a sequence of early-return `if` statements ending in `return notes === undefined || typeof notes === 'string';`, and its narrowed parameter is named `value` (a `Record<string, unknown>` from `isRecord`). Under `noPropertyAccessFromIndexSignature: true` property access **must** use bracket notation, and array narrowing **must** use the file's own `isUnknownArray` helper — raw `Array.isArray` narrows the element type to `any[]` (per the comment above `isUnknownArray`) and would trip `no-unsafe-*` under the `strictTypeChecked` config. The snippet below mirrors the adjacent `sideEffects` check verbatim and slots in as an early return before the final `notes` return:

```ts
// lib/storage.ts
export function isContextTag(value: unknown): value is ContextTag {
  return typeof value === 'string' && (CONTEXT_TAGS as readonly string[]).includes(value);
}

// inside isEveningCheckin(value): change the tail so the new field is
// validated after notes, keeping the early-return house style:
const notes = value['notes'];
if (!(notes === undefined || typeof notes === 'string')) return false;
const contextTags = value['contextTags'];
return (
  contextTags === undefined || (isUnknownArray(contextTags) && contextTags.every(isContextTag))
);
```

**Backward compatibility.** No migration function is required: the field is optional, so every persisted `EveningCheckin` written before this feature passes the extended guard unchanged (`contextTags` absent → treated as "none recorded"). Historical entries are never mutated. No re-onboarding — `Profile` is untouched. Because `parseEntries → isDayEntry → isEveningCheckin` is the single chokepoint, extending that one guard covers both the live `"entries"` load and JSON restore.

**Backup.** `Backup.entries` is parsed by the same `parseEntries`/`isEntries` path, so `parseBackup` needs no change beyond the guard extension above; new exports serialize `contextTags` automatically via structural JSON, older backups restore fine (field absent).

## UI touch points

### `app/checkin.tsx` — the non-generic seam (four coordinated edits + a collapse wrapper)

1. **Draft field** — add `readonly contextTags: readonly ContextTag[]` to `interface Draft`; add `contextTags: []` to `EMPTY_DRAFT` and to `draftFromMorning` (morning has no tags → `[]`).
2. **renderMetric arm** — the `case 'chips':` now narrows on `metric.key`, and the `contextTags` arm renders inside a collapsed disclosure (see below):
   ```ts
   case 'chips':
     switch (metric.key) {
       case 'sideEffects':
         return (
           <Chips label={metric.label} options={metric.options}
             selected={draft.sideEffects} labels={SIDE_EFFECT_LABELS}
             onChange={(next) => { setDraft({ ...draft, sideEffects: next }); }} />
         );
       case 'contextTags':
         return (
           <ContextTagsField label={metric.label} options={metric.options}
             selected={draft.contextTags}
             onChange={(next) => { setDraft({ ...draft, contextTags: next }); }} />
         );
       default:
         return assertNever(metric);
     }
   ```
   The inner `assertNever(metric)` makes a future third chips key fail to compile.
3. **handleSave spread** — conditional spread so an empty selection stays _absent_ (required under `exactOptionalPropertyTypes` — never assign `undefined`):
   ```ts
   ...(draft.contextTags.length > 0 ? { contextTags: draft.contextTags } : {}),
   ```
4. **draftFromEvening hydration** — `contextTags: checkin.contextTags ?? [],`.

### Friction / completion: collapsed-by-default (Mobile-UX must-fix)

The evening check-in already renders up to seven scale rows plus a side-effects chips group; dropping a full eight-then-now-six-option chip surface open on every visit taxes the exact "nothing unusual happened" majority night, for an ADHD user base especially sensitive to always-visible decision surfaces, and risks pushing **Save** below the fold on iPhone-SE-class screens. So the context group ships **collapsed by default** behind a thin, presentational disclosure — a new `components/Disclosure.tsx` (or the small `ContextTagsField` wrapper above) that owns its own `open` boolean via `useState`:

- **Collapsed (default):** a single tappable row — `Anything unusual today?` — plus a count badge when tags are already selected (e.g. `Anything unusual today? · 2`) so a tagged day never silently hides its selection. One row of vertical chrome, not a chip grid.
- **Expanded (on tap):** renders the generic `Chips<ContextTag>` with `labels={CONTEXT_TAG_LABELS}`. Toggling chips calls the same `onChange` → `setDraft`; the open/closed state is **ephemeral view state**, never persisted and never part of the Draft or `EveningCheckin`.

This keeps the common night to a single glance and zero taps, keeps the chips rendering fully generic (the wrapper differs only in the already-key-specific `contextTags` arm), and keeps Save reachable. Reducing the set from eight tags to six (dropping `other` and `skippedDose`) further shrinks the expanded footprint. Reachability, dark mode, and larger accessibility font sizes must be spot-checked on a small-screen viewport during implementation; because the surface is collapsed by default, wrapped-chip height at large type no longer threatens Save reachability in the common case.

### Other surfaces

- `components/Chips.tsx` — made generic (see Data model); update the existing side-effects call site to pass `labels={SIDE_EFFECT_LABELS}`.
- `app/entry/[date].tsx` — **hard-coded seam.** This file renders each field explicitly. Add a context-tags row (below side effects), mapping `evening.contextTags ?? []` through `CONTEXT_TAG_LABELS`; render a muted "None recorded" when empty. No `directionForRatingKey`/`ratingColor` involvement (tags aren't ratings).
- `app/(tabs)/settings.tsx` — **n/a.** Tags are always on; no enable/disable toggle (unlike evening rating metrics). No settings edit.
- `app/(tabs)/trends.tsx` — **n/a this pass.** Fully schema-driven for `'scale'` metrics only; chips are already skipped there (`=== 'scale'` guard). Out of scope (see Alternatives).

## Export / report

`lib/export.ts`. Two additions to the **Daily-log table** (currently `Date, Sleep, Waking mood, Mood, Focus, Side effects` — lib/export.ts:198), both pure display columns computing no adjustment:

- **Adherence column** (clinical must-fix) — insert a `Dose taken` column sourced from the existing `row.morning?.doseTaken`. Render `Taken` / `Missed` / empty cell (no morning check-in that day). This is the authoritative adherence signal; placing it in the same row as Context lets the provider read adherence and confounders together. Header/legend stay factual: `Dose taken` (AM), distinct from any context tag. Because `skippedDose` is dropped, there is no duplicate/conflicting adherence flag to reconcile — a single, morning-sourced truth.
- **Context column** — insert between `Side effects` and end. Import `CONTEXT_TAG_LABELS`; add a helper `contextTagsFor(row): readonly ContextTag[]` returning `row.evening?.contextTags ?? []` (mirrors how side effects are read; no `ratingAccessor` entry — tags aren't `Rating`-valued). Cell = `escapeHtml(tags.map((t) => CONTEXT_TAG_LABELS[t]).join(', '))`, empty when none. Column header caption stays descriptive: **"Context — discuss relevance with your provider."**

Do **not** add either field to the averages tables (neither is averaged) and do **not** compute any tag- or adherence-based adjustment. Keep every cell `escapeHtml`-wrapped. If tags are chip-styled in the PDF, use existing `palette` neutrals (`neutral`/`border`), never a raw hex.

## Notifications

n/a. Reminder scheduling (`scheduleReminders`, session payload) is unaffected; tags are entered within the existing evening flow.

## Test plan

All new logic sits in covered `lib/` modules (`types`/`schema`/`storage`/`export`); use the sanctioned `as IsoDate` / `as IsoTimestamp` literal idiom in fixtures.

`lib/__tests__/storage.test.ts`:

- `isContextTag` accepts each member of `CONTEXT_TAGS`, rejects `'nope'`, `'skippedDose'` (dropped), `'other'` (dropped), `''`, `42`, `null`.
- `isEveningCheckin`: (a) legacy object with **no** `contextTags` → `true` (back-compat); (b) `contextTags: ['alcohol','poorSleep']` → `true`; (c) `contextTags: ['bogus']` → `false`; (d) `contextTags: 'alcohol'` (non-array) → `false`.
- `parseEntries` round-trips an entry carrying tags; a stored entry missing the field parses with `evening.contextTags === undefined`.
- `parseBackup` accepts a backup whose entries include tags and one whose entries omit them.
- **Conditional-spread end-to-end:** build an `EveningCheckin` the way `handleSave` does from a draft with an empty `contextTags` selection, then assert `JSON.stringify(checkin)` contains no `"contextTags"` key at all — verifying `exactOptionalPropertyTypes` compliance survives into persisted storage, not just the type.

`lib/__tests__/schema.test.ts`:

- `CONTEXT_TAG_LABELS` has exactly one entry per `CONTEXT_TAGS` member (`Object.keys` length === `CONTEXT_TAGS.length` + every key present).
- `EVENING_METRICS` contains a `{ kind: 'chips', key: 'contextTags' }` entry whose `options` equals `CONTEXT_TAGS`.

`lib/__tests__/export.test.ts`:

- `buildReportHtml` output contains a `Context` column header and a `Dose taken` column header.
- A day with `contextTags: ['stressfulDay','alcohol']` renders the exact substring `Stressful day, Alcohol` (assert exact, escaped).
- A day with no tags renders an empty Context cell (assert the row still has the right column count / an empty `<td></td>`).
- A day with `morning.doseTaken === false` renders `Missed`; `true` renders `Taken`; a day with no morning check-in renders an empty Adherence cell.
- Averages tables are unchanged by presence of tags or the adherence column (existing assertions still pass — guards against accidental coupling).

Coverage stays ≥ thresholds: new branches (`?? []`, the optional-guard disjunction, the conditional spread, the `Taken`/`Missed`/empty adherence branch) are each hit by the cases above.

## Gate compliance

- **No `any`/unsafe-any**: `isContextTag` narrows from `unknown`; array narrowing goes through `isUnknownArray` (not raw `Array.isArray`), keeping element access at `unknown` before `.every(isContextTag)`. The `as readonly string[]` on the const array asserts a _compatible_ type on trusted in-repo data, exempt under `--ignore-as-assertion` (same pattern as the existing `SIDE_EFFECTS`/`isSideEffect` guard).
- **`noPropertyAccessFromIndexSignature`**: the guard reads `value['contextTags']` in bracket notation, matching every existing guard in the file.
- **No `!`**: `contextTags` is read via `?? []`, never asserted.
- **No `@ts-*` / `eslint-disable`**: none introduced.
- **No cast of untrusted data**: persisted JSON enters only through the extended `isEveningCheckin`; branded values untouched here.
- **Exhaustive switch**: the new inner `switch (metric.key)` in `renderMetric` ends in `default: return assertNever(metric)`, so a third chips key won't compile until handled. The outer metric-kind switch already terminates in `assertNever`.
- **`exactOptionalPropertyTypes`**: the conditional spread in `handleSave` guarantees the property is either present-with-value or absent — never `contextTags: undefined` (verified by the `JSON.stringify` test).
- **type-coverage 100%**: generic `Chips<T>` keeps `selected`/`onChange` fully typed; no implicit `any` at call sites; the `Disclosure`/`ContextTagsField` wrapper is a plain typed component with local `useState<boolean>`.

## Dependencies & sequencing

- **Depends on:** nothing structural — self-contained within the evening check-in and report. It does depend on the generic-ization of `components/Chips.tsx`; if another doc in this set also touches Chips, land that refactor first to avoid a merge conflict on the component signature.
- **Explicitly does NOT depend on** an evening-notes-in-report doc. The original draft leaned on that as "composes cleanly," which left `'other'` a dead-end signal. By dropping `'other'` this pass, this doc is complete on its own; `'other'` becomes a trivial follow-up _after_ notes reach the report.
- **Enables:** any later "weight/annotate confounded days in trends" work reads the `contextTags` field this doc introduces. The Adherence column also lays groundwork for a fuller adherence view without committing to one.

## Alternatives considered / open questions

- **`skippedDose` tag (rejected, resolved via Adherence column).** The original draft added a `skippedDose` context tag and left "is it redundant with `doseTaken`?" open with "both stay; the provider sees both." But the provider did _not_ see both — `doseTaken` was never in the report. Shipping a second, evening-self-reported, possibly-PM-scoped adherence flag while the authoritative morning field stayed invisible would mislead a provider reading "no Context tag" as "adherence fine." Resolution: drop the tag, surface the real field as a `Dose taken` column. Adherence is now visible and single-sourced.
- **`'other'` tag (deferred, not dropped forever).** A contentless flag on the very day that may hold the real explanation is data a provider can't act on, and notes aren't yet in the report. Reintroduce once an evening-notes-in-report change lands.
- **Trends surfacing (deferred).** A subtle dot row under the trend bars marking tagged days would help visually but risks reading as interpretation ("these days are different"). Kept out until the report-only surface is validated with a provider. Low-risk follow-up: a monochrome marker row analogous to `doseChangeMarkers`.
- **Widening chips to `string` (rejected).** Collapsing to `options: readonly string[]` would erase the `SideEffect`/`ContextTag` distinction and let a side-effect selection carry a context tag — the "illegal state" the contract forbids. The discriminated pair costs one union member and one inner `switch` and is strictly safer.
- **Distinct `kind: 'contextChips'` (rejected).** Duplicates rendering with no type gain; the discriminated pair reuses the generic `Chips` cleanly.
- **Collapsed vs. always-open chip surface.** Ships collapsed-by-default per the check-in-friction concern; only promote to always-open if completion rate proves it harmless — the same "validate before adding visual weight" caution the trends dot-row gets.
- **Open: coarse timing for `alcohol` / `extraCaffeine`?** Both chemically interact with the med class (alcohol/sedation; caffeine mimicking the already-tracked `racingHeart`/`insomnia`). A "same evening vs. unrelated" hint would be more actionable but adds a quantification step against the stated no-severity non-goal. Deferred; the binary flag with "discuss relevance with your provider" framing is a defensible v1.
- **Out of scope: a global-impression item.** A PGI-C/CGI-I-style "compared to last week, overall…" single question is arguably the highest-value missing measurement primitive for a titration app, but it is a rating, not a confounder, and deserves its own doc. Not addressed here.
- **Open: cap on simultaneous tags?** No cap — six chips wrap (`flexWrap`) and fit comfortably; a cap would be an interpretive judgment we don't want to make. Confirm wrapping height in dark mode / large accessibility type during implementation.

## Panel review

### Clinical / behavioral-health measurement — approve-with-changes

- **`'other'` dead-end (must-fix):** dropped `'other'` from `CONTEXT_TAGS` for this pass rather than taking a soft cross-doc dependency; documented reintroduction once notes reach the report. `'other'` can no longer show the provider a contentless flag.
- **`skippedDose` vs. invisible `doseTaken` (must-fix):** dropped the `skippedDose` tag and instead added a `Dose taken` (Adherence) column to the daily-log table sourced from `MorningCheckin.doseTaken`, so the load-bearing adherence confound is single-sourced and visible next to Context. No BID/PM-dose model was invented (the data model has one daily dose).
- Kept the confounder set and the "discuss relevance with your provider" caption as-is (flagged strengths). Timing hints for alcohol/caffeine and a global-impression item recorded as deferred/out-of-scope.

### Strict-TypeScript architect — approve-with-changes

- **Dot-notation on index signature (must-fix):** guard rewritten to `value['contextTags']` bracket notation, satisfying `noPropertyAccessFromIndexSignature`.
- **Raw `Array.isArray` any-leak (must-fix):** now uses the file's `isUnknownArray` helper, mirroring the adjacent `sideEffects` check verbatim.
- **Suggestions applied:** snippet rewritten in the actual early-return style (not an `&&` conjunction) and the parameter renamed from `record` to the real `value`, so the diff is copy-paste-precise.

### Mobile UX / friction & completion — approve-with-changes

- **Save reachability (must-fix):** the context group now ships collapsed by default behind a one-row disclosure; reachability, dark mode, and large-type layout called out for a small-screen spot-check. Reducing eight tags to six shrinks the expanded footprint.
- **"Nothing happened" near-zero-cost (must-fix):** collapsed-by-default `Anything unusual today?` disclosure with a selection-count badge; full chip grid renders only on tap. Ephemeral view state, not persisted.
- **Suggestions:** kept the schema-ordered placement (after side effects) since collapse, not reordering, removes the tax; deferred-promotion caution recorded in Alternatives.

### Data-model / migration + privacy + scope — approve

- No must-fixes. Applied the suggestions: guard snippet rewritten to early-return style; report now distinguishes AM `Dose taken` from evening Context so the provider can't misread them; added a test asserting `JSON.stringify` of an empty-selection `EveningCheckin` contains no `contextTags` key.

**Overall: all lenses approve (three approve-with-changes, one approve); every must-fix applied, none rejected.**
