# Decisions since v0

Running log of design decisions made after [`PLANNING-v0.md`](PLANNING-v0.md), which is
frozen. Newest first.

## Configurable evening check-in metrics (2026-07-18)

**Problem:** The evening check-in forced 7 required mood/symptom ratings (mood, focus,
impulsivity, anxiety, energy, appetite, libido) every evening. Too much friction —
heaviest exactly when someone's had a rough day and is least in the mood for a long form.

**Decision:** Which of the 7 evening ratings are _active_ is now a per-profile setting
(`Profile.enabledEveningMetrics?: readonly EveningRatingKey[]`), adjustable anytime in
Settings, defaulting to a small base set out of the box.

- Default base set: **mood, focus, energy, anxiety**. Impulsivity, appetite, libido
  default off.
- Scope: evening only. Morning's 2 ratings (sleepQuality, wakingMood) stay always-required
  — already short, not worth the same treatment.
- `lib/schema.ts`'s `EVENING_METRICS` stays the full universe of all 7 possible
  metrics, unchanged — the profile setting is a filter on top, not a schema change. This
  preserves schema.ts's role as the single source of truth for what's trackable.
- The new `Profile` field is optional so already-onboarded profiles keep working without
  a forced re-onboarding step; absent means "use the default base set."
- `EveningCheckin`'s 7 rating fields became optional (previously all required) — which
  fields get recorded is now runtime-dependent (what was enabled that day), not a
  compile-time invariant.
- Disabling a metric never retroactively deletes historical data for it — the check-in
  screen simply stops rendering/requiring it going forward.
- The PDF export report stays unfiltered: it reflects whatever data actually exists in
  the date range regardless of current on/off state. Trends hides a metric's sparkline
  entirely while it's disabled (no point showing a permanently-empty row).
- The read-only day-detail view (`app/entry/[date].tsx`) was left untouched — it already
  renders `'—'` gracefully for any unanswered/disabled metric.

Full implementation plan (types/guards/UI touch points, file-by-file): see the
session's plan file if still present, or `git log` around this date for the commits
implementing it.
