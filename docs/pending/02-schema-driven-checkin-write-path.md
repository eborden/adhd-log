# 02 — Schema-drive the check-in write path (and the entry/export read paths)

**Priority:** 2
**Effort:** Small–Medium
**Risk / over-engineering:** Low (no persisted-shape change)

## Problem

The **render** path is schema-driven and exhaustive: `renderMetric` in `app/checkin.tsx:183-279`
switches over the `Metric` union and ends in `assertNever`. But the **persistence and detail-display**
paths hand-enumerate every evening rating key in four parallel places the compiler does _not_ keep
in sync:

1. `app/checkin.tsx:75-91` — `draftFromEvening` (re-hydrate on edit), 7 hand-listed keys.
2. `app/checkin.tsx:164-177` — `handleSave` evening branch, 7 hand-listed optional spreads.
3. `app/entry/[date].tsx:130-136` — 7 hand-written `<RatingRow>` elements.
4. `lib/export.ts:40-49` — `EVENING_ACCESSORS`, 7 hand-written accessors.

Because every `EveningCheckin` rating field is optional (`lib/types.ts:93-104`) and
`exactOptionalPropertyTypes` is on, a forgotten key produces **no compile error**. `CLAUDE.md` and
`lib/schema.ts:12-14` promise "add or rename a tracked metric in `lib/schema.ts` only" — that is
**false today**: add an evening scale metric and it renders and is editable, but `handleSave`
silently drops it on save. Highest-risk spot for a maintainer returning in 6 months.

The fix pattern already exists in the repo: `isEveningCheckin` (`lib/storage.ts:125-136`) already
iterates `EVENING_RATING_KEYS`. Copy that shape into the write path. `Trends` is the reference
implementation for the read path.

## Design decision (adjudicated by the panel)

Do **not** migrate `EveningCheckin` to a keyed `ratings: Partial<Record<EveningRatingKey, Rating>>`
record as a first move — that changes the persisted JSON shape and needs an AsyncStorage migration
of real on-device data. Keep the existing named-field shape and **derive** all four sites by looping
over `EVENING_RATING_KEYS`. This gets ~95% of the benefit with zero migration risk. Revisit the
record migration only if metrics start being added regularly.

## Change

### 1. New RN-free module `lib/checkin.ts` for `Draft ↔ Checkin` conversion

Move the pure conversion logic out of the screen so Vitest can cover it. Shape:

```ts
import {
  EVENING_RATING_KEYS,
  type EveningCheckin,
  type EveningRatingKey,
  type MorningCheckin,
  type Rating,
  type RatingKey,
} from './types';

export interface Draft {
  readonly doseTaken: boolean;
  readonly ratings: Readonly<Partial<Record<RatingKey, Rating>>>;
  readonly sleepHours: number | undefined;
  readonly sideEffects: readonly SideEffect[];
  readonly notes: string;
}

// build a persisted evening ratings object by iterating the schema key list
export function eveningRatingsFromDraft(
  ratings: Readonly<Partial<Record<RatingKey, Rating>>>,
): Partial<Record<EveningRatingKey, Rating>> {
  const out: Partial<Record<EveningRatingKey, Rating>> = {};
  for (const key of EVENING_RATING_KEYS) {
    const value = ratings[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export function draftFromEvening(checkin: EveningCheckin): Draft {
  /* loop, not 7 spreads */
}
export function draftFromMorning(checkin: MorningCheckin): Draft {
  /* as today */
}
```

- `handleSave`'s evening branch becomes: build `completedAt`, `sideEffects`, optional `notes`, then
  spread `...eveningRatingsFromDraft(draft.ratings)`. The 7 conditional spreads collapse to one call.
- `draftFromEvening` builds `ratings` by looping `EVENING_RATING_KEYS` and reading `checkin[key]`,
  rather than naming each field.
- `checkin.tsx` imports `Draft`, `draftFromMorning`, `draftFromEvening` from `lib/checkin.ts`.

Watch the `exactOptionalPropertyTypes` interaction: assign keys conditionally (only when defined)
rather than writing `out[key] = undefined`. The loop above already does this correctly.

### 2. Collapse `export.ts` accessors into one generic accessor

`ratingAccessor` already exists (`lib/export.ts:52-59`) and, under `noUncheckedIndexedAccess`,
`row.evening?.[key]` types as `Rating | undefined` for free. Replace `MORNING_ACCESSORS` /
`EVENING_ACCESSORS` (`lib/export.ts:34-49`) with direct keyed reads inside `ratingAccessor`:

```ts
export function ratingAccessor(session: Session, key: RatingKey) {
  return (row: DayEntry): Rating | undefined =>
    session === 'morning' ? row.morning?.[key] : row.evening?.[key];
}
```

Also define `MorningRatingKey` in `lib/types.ts` (next to `EveningRatingKey`) and derive
`RatingKey = MorningRatingKey | EveningRatingKey`, removing the local re-declaration at
`export.ts:32`. Update `computeScaleAverages` / `buildReportHtml` to consume the single accessor.

### 3. Render `entry/[date].tsx` evening (and morning) rows from the schema

Replace the hand-written `<RatingRow>` lists (`entry/[date].tsx:104-136`) with a map over
`MORNING_METRICS` / `EVENING_METRICS`, filtered to `kind === 'scale'` and, for evening, to
`enabledEveningMetricKeys(profile)` (load profile like `checkin.tsx` does). Read each value via
`ratingAccessor(session, metric.key)`. This deletes ~30 lines, removes the 4th parallel key list,
and fixes the current bug where disabled metrics still render as "—".

## Acceptance criteria

- Adding a new evening scale metric in `lib/schema.ts` + `EVENING_RATING_KEYS` + `RatingKey`
  makes it render, save, re-hydrate on edit, appear in the entry detail, and count in export
  averages — **with no other file edited**. This is the contract in `CLAUDE.md` made true.
- No change to the on-disk JSON shape of `EveningCheckin` (no migration needed).
- `entry/[date].tsx` shows only enabled evening metrics.

## Tests

- `lib/__tests__/checkin.test.ts` (new): for **every** key in `EVENING_RATING_KEYS`, a
  draft→save→load→draft round-trip preserves the value; `eveningRatingsFromDraft` omits undefined keys.
- Extend `lib/__tests__/export.test.ts`: `ratingAccessor` returns the right value for a morning key
  and an evening key, and `undefined` for an absent one.

## Non-goals

- The keyed-`ratings`-record persisted-shape migration (deferred; see Design decision).
- Type-level assertions tying metric arrays to interface required-fields (panel rated nit/low).

## Gates

`npm run check` green; `type-coverage` stays 100%. Confirm the `assertNever` switch in
`renderMetric` is untouched — it is the codebase's key asset.
