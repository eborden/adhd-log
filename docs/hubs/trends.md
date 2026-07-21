# Trends visualization

Map of the Trends tab — the in-app chart that smooths daily ratings into a readable
trend line over a selectable range, honestly breaking the line across unlogged gaps
and resetting the smoothing window at each dose change.

## View-time transforms

- [[lib/trends.ts]] — pure, RN-free: `rollingAverage` (trailing moving average, window
  clamped at dose-period boundaries), `dosePeriodBoundaries`, `recentWindowDates`,
  `smoothedLineSegments` (SVG-free line geometry as rotated `View` rects),
  `defaultWindowForRange` and the `SMOOTHING_WINDOWS` literal union

## Screen

- [[app/(tabs)/trends.tsx]] — range selector (7/14/30), raw daily bars dimmed under the
  smoothed line, dose-change markers; shares the exact row height / column gap constants
  with `smoothedLineSegments` so bars and line agree pixel-for-pixel

## Data it reads

- [[lib/metrics.ts]] — `rowsInRange`, `ratingAccessor`, `coverage`, `loggingStartDate`
- [[lib/storage.ts]] — `loadEntries` / `loadDoseChanges` / `loadProfile`,
  `doseChangeMarkers`, `lastNDates`, `todayIsoDate`
- [[lib/schema.ts]] — `MORNING_METRICS` / `EVENING_METRICS` (which metrics to chart)
- [[lib/types.ts]] — `Rating`, `DayEntry`, `DoseChange`, `Metric`, `Session`;
  note `SmoothedValue` (a real number in [1,5], deliberately NOT a `Rating`)

## Color

- [[lib/theme.ts]] — `ratingColor` (hue per rating, respecting scale direction)

## Tests

- [[lib/__tests__/trends.test.ts]]
