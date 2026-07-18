# ADHD Med Daily Log — Design Plan (v0)

> Permanent v0 design record. This is the committed copy of the approved planning
> document; it captures the decisions and rationale the project is built on. Keep it as
> a historical record — evolve the app via new docs/decisions rather than rewriting this.

## Context

The user is starting a non-stimulant ADHD medication (the "accumulates over weeks"
class — e.g. atomoxetine/viloxazine/guanfacine). Unlike stimulants, effects emerge
gradually, so the clinically useful signal is a **trend over time**, not any single day.
They want a private, on-device mobile app that makes a daily check-in fast enough to
actually do every day, sends reminders, and can produce something to bring back to their
provider.

This is a greenfield project (`/Users/evanborden/Code/adhd-log`, empty, not yet a repo).
The app is a personal tool, not medical advice — all framing is "log this and discuss
with your provider."

### Confirmed decisions
- **Stack:** Expo (React Native) + expo-router, **TypeScript in maximum-strict mode with
  enforced guardrails** that block `any`, `@ts-ignore`/`@ts-expect-error`, non-null `!`,
  and inline lint-disabling. Run on-device via Expo Go.
- **Storage:** 100% local (AsyncStorage). Nothing leaves the phone except user-initiated exports.
- **Tracked fields:** morning (dose, sleep quality, sleep hours, waking mood); evening
  (mood, focus, impulsivity, anxiety, energy, appetite, libido, side effects, notes).
- **Reminders:** twice daily (morning + evening), times configurable.
- **Med model:** full profile (name, dose, start date) + dose-change log, marked on trends.
- **Privacy:** Face ID / passcode lock on open (expo-local-authentication).
- **Export:** PDF summary report for the provider. (+ JSON backup/restore as a data-safety net.)
- **Answer style:** tap 1–5 buttons with word labels at the ends.

## Tech Stack & Dependencies

- `expo` ~52, `react-native` 0.76, `react` 18.3, TypeScript
- `expo-router` ~4 — file-based navigation, bottom tabs
- `expo-notifications` ~0.29 + `expo-device` — scheduled daily local notifications
- `expo-local-authentication` ~15 — biometric / passcode app lock
- `expo-print` ~14 + `expo-sharing` ~13 + `expo-file-system` ~18 — PDF generation & share sheet
- `@react-native-async-storage/async-storage` — local persistence
- `react-native-safe-area-context`, `react-native-screens` — expo-router peers

Dev/tooling deps for the strict-TS guardrails:
- `typescript` ~5.3, `eslint` ~8, `@typescript-eslint/{parser,eslint-plugin}`
- `eslint-plugin-eslint-comments` — block disabling lint/type rules inline
- `prettier`, `eslint-config-prettier` — formatting, enforced separately (checked, not just fixed)
- `vitest`, `@vitest/coverage-v8` — unit tests for the pure logic layer, enforced
- `type-coverage` + `typescript-coverage-report` — enforce ~100% typed identifiers
- `husky` + `lint-staged` — pre-commit gate (once the repo is initialized)

No charting library: trends render as lightweight bars/sparklines built from plain
`View`s (data volume is ~1 entry/day, so this stays simple and dependency-light).

## TypeScript Strictness & Guardrails

The goal: it is not just hard but *lint-fails-the-build* to weaken the type system.

**`tsconfig.json` — every strictness flag on:**
```jsonc
{
  "compilerOptions": {
    "strict": true,                          // implies noImplicitAny, strictNullChecks, etc.
    "noUncheckedIndexedAccess": true,        // entries[date] is T | undefined
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitOverride": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noPropertyAccessFromIndexSignature": true,
    "allowUnreachableCode": false,
    "allowUnusedLabels": false,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": false
  }
}
```

**ESLint (`.eslintrc.cjs`) — bans the escape hatches:**
- `plugin:@typescript-eslint/strict-type-checked` + `stylistic-type-checked` (type-aware).
- `@typescript-eslint/no-explicit-any: error` — no `any`.
- `@typescript-eslint/ban-ts-comment: error` (`ts-ignore`/`ts-nocheck`/`ts-expect-error`
  all disallowed, no description escape).
- `@typescript-eslint/no-non-null-assertion: error` — no `!`.
- `@typescript-eslint/no-unsafe-{assignment,call,member-access,return,argument}: error`.
- `eslint-comments/no-use: error` with a narrow allowlist (effectively: you cannot
  `// eslint-disable` a rule to sneak past the above), plus `no-unlimited-disable` and
  `no-unused-disable`.

**Formatting — Prettier, enforced (not just auto-fixed):**
- `.prettierrc` committed as the single style source; `eslint-config-prettier` turns off
  ESLint's stylistic rules so the two never fight.
- `format`: `prettier --write .`  /  `format:check`: `prettier --check .` (the CI/commit gate
  uses `--check`, so unformatted code *fails* rather than being silently reformatted).

**Testing — Vitest, enforced:**
- `vitest.config.ts` with the node environment, targeting the pure-logic layer where the
  type-heavy correctness lives: `lib/schema`, `lib/storage` (guards + narrowing),
  `lib/export` (HTML/CSV assembly), and date/streak/dose-timeline helpers. These modules
  are deliberately free of React Native imports so they run under Vitest with no native
  shims. (RN component rendering isn't Vitest-friendly; components stay thin and logic-free
  so the meaningful behavior is all unit-testable.)
- `test`: `vitest run --coverage`; coverage thresholds set in config so undertested logic
  fails the run. Tests cover: storage guards rejecting malformed JSON, streak calc,
  dose-timeline marker placement, rating-union validation, and export row/average math.

**Enforcement (npm scripts + pre-commit):**
- `typecheck`: `tsc --noEmit`
- `lint`: `eslint . --max-warnings 0`
- `format:check`: `prettier --check .`
- `test`: `vitest run --coverage`
- `type-coverage`: `type-coverage --strict --at-least 100 --ignore-files "**/*.d.ts"`
- `check`: runs all five; husky `pre-commit` runs `lint-staged` → typecheck + lint +
  format:check + type-coverage + related tests, so a commit that subverts the type system,
  formatting, or breaks a logic test is rejected before it lands.

**Code conventions that reduce the temptation to reach for `any`:**
- Parse-don't-validate at the storage boundary: `storage.ts` reads untyped JSON and
  narrows it through explicit type guards (`isDayEntry`, `isProfile`) returning typed
  values or defaults — the only place untrusted shapes enter, handled with guards not casts.
- All metric keys are a discriminated union derived from `schema.ts` `as const`, so the
  check-in renderer is exhaustively typed (no string-keyed `any` access).

## Domain Types (`lib/types.ts`) — no raw `number`/`string`

Alias and branded types give every value context; literal unions and discriminated unions
make illegal states unrepresentable.

```ts
// Branded primitives — a plain string can't be passed where these are expected.
type Brand<T, B> = T & { readonly __brand: B };
type IsoDate      = Brand<string, 'IsoDate'>;       // "YYYY-MM-DD" (local calendar day)
type IsoTimestamp = Brand<string, 'IsoTimestamp'>;  // full ISO instant
type MedName      = Brand<string, 'MedName'>;

// Literal unions — the only legal values.
type Rating   = 1 | 2 | 3 | 4 | 5;                  // every scale metric
type Session  = 'morning' | 'evening';
type Hour     = 0 | 1 | ... | 23;                   // generated as-const tuple
type Minute   = 0 | 1 | ... | 59;
type SideEffect =
  | 'nausea' | 'headache' | 'dizziness' | 'dryMouth' | 'giUpset'
  | 'insomnia' | 'sweating' | 'racingHeart' | 'other';

// Structured aliases instead of bare strings/numbers.
type TimeOfDay = { readonly hour: Hour; readonly minute: Minute };
type Dose      = { readonly amount: number; readonly unit: DoseUnit }; // DoseUnit = 'mg' | 'mcg' | 'mL'
```

**Storage keys (AsyncStorage), all JSON:**
```
"profile"  -> Profile
"doses"    -> readonly DoseChange[]              // titration log, appended over time
"entries"  -> Readonly<Record<IsoDate, DayEntry>>
```

```ts
interface Profile {
  readonly medName: MedName;
  readonly startDate: IsoDate;
  readonly currentDose: Dose;
  readonly morningReminder: TimeOfDay;
  readonly eveningReminder: TimeOfDay;
  readonly lockEnabled: boolean;
  readonly createdAt: IsoTimestamp;
}

interface DoseChange {
  readonly date: IsoDate;
  readonly dose: Dose;
  readonly note?: string;
}

interface DayEntry {
  readonly date: IsoDate;
  readonly morning?: MorningCheckin;
  readonly evening?: EveningCheckin;
}
interface MorningCheckin {
  readonly doseTaken: boolean;
  readonly sleepQuality: Rating;
  readonly sleepHours?: number;         // the one genuinely-continuous field
  readonly wakingMood: Rating;
  readonly completedAt: IsoTimestamp;
}
interface EveningCheckin {
  readonly mood: Rating; readonly focus: Rating; readonly impulsivity: Rating;
  readonly anxiety: Rating; readonly energy: Rating; readonly appetite: Rating;
  readonly libido: Rating;
  readonly sideEffects: readonly SideEffect[];
  readonly notes?: string;
  readonly completedAt: IsoTimestamp;
}
```

A day's morning/evening are separate optional sub-objects so either session fills and
re-edits independently without clobbering the other.

**Discriminated union for the metric schema** (drives generic, exhaustive rendering):
```ts
type Metric =
  | { kind: 'scale';   key: RatingKey;  label: string; low: string; high: string; direction: 'higher-better' | 'lower-better' | 'neutral' }
  | { kind: 'toggle';  key: 'doseTaken'; label: string }
  | { kind: 'stepper'; key: 'sleepHours'; label: string; min: number; max: number; step: number }
  | { kind: 'chips';   key: 'sideEffects'; label: string; options: readonly SideEffect[] }
  | { kind: 'text';    key: 'notes'; label: string };
```
`switch (metric.kind)` in the renderer is exhaustively checked (a `never` default asserts
completeness), so adding a metric kind forces every consumer to handle it.

**Result union for the storage boundary** (parse-don't-validate, no exceptions swallowed):
```ts
type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };
```
`storage.ts` reads untyped JSON and narrows via guards (`isProfile`, `isDayEntry`,
`isRating`) into these `Parsed<T>` results — the single place external shapes enter,
handled with guards, never casts.

## Metric Definitions (single source of truth: `lib/schema.ts`)

Both check-in screens render generically from this array — add/rename a metric in one place.

**Morning (fast, ~15s):**
| key | label | type | scale ends |
|---|---|---|---|
| doseTaken | Took today's dose | toggle | — |
| sleepQuality | Sleep quality | scale | Poor → Great |
| sleepHours | Hours slept | stepper | — |
| wakingMood | How you feel waking up | scale | Rough → Great |

**Evening (reflection):**
| key | label | type | scale ends | note |
|---|---|---|---|---|
| mood | Overall mood today | scale | Low → Great | |
| focus | Focus / attention | scale | Scattered → Sharp | |
| impulsivity | Impulsivity | scale | In control → Very impulsive | inverted (high = worse) |
| anxiety | Anxiety / irritability | scale | Calm → On edge | inverted |
| energy | Energy | scale | Drained → Energized | |
| appetite | Appetite | scale | None → Ravenous | neutral |
| libido | Libido | scale | Low → High | neutral |
| sideEffects | Side effects | chips | — | multi-select |
| notes | Anything else | text | — | optional |

Side-effect chips: Nausea, Headache, Dizziness, Dry mouth, Stomach/GI, Insomnia,
Sweating, Racing heart, Other.

`direction` (higher-better / lower-better / neutral) drives trend color coding
(green = better direction).

## App Structure (expo-router)

```
app/
  _layout.tsx          Root: notification handler, app-lock gate, tab navigator
  (tabs)/
    index.tsx          TODAY — today's status (morning/evening done?), quick-start buttons, streak
    trends.tsx         TRENDS — per-metric sparklines over 7/14/30 days, dose-change markers
    history.tsx        HISTORY — scrollable list of past days; tap to view/edit
    settings.tsx       SETTINGS — med profile, dose log, reminder times, lock toggle, export/backup
  checkin.tsx          Check-in flow (?session=morning|evening), renders from schema
  entry/[date].tsx     View/edit a single day
components/
  ScaleSelector.tsx    5 labeled tap buttons (the core fast input)
  Chips.tsx            multi-select side-effect chips
  Toggle.tsx, Stepper.tsx
  LockScreen.tsx       biometric prompt overlay
lib/
  types.ts             branded/alias/union domain types (above); single source of truth
  schema.ts            Metric[] discriminated-union definitions
  storage.ts           Parsed<T> guards + get/save profile, doses, entries; streak; date helpers
  notifications.ts     permission, schedule/cancel two daily reminders, deep-link routing
  export.ts            build HTML → PDF (expo-print) → share; JSON backup/restore
  theme.ts             colors, light/dark via useColorScheme
  __tests__/           Vitest specs for storage guards, streak, dose timeline, export math
```

Config files: `tsconfig.json`, `.eslintrc.cjs`, `.prettierrc`, `vitest.config.ts`,
`.husky/pre-commit`, `lint-staged` config in `package.json`.

## Key Features

1. **Onboarding (first launch):** if no `profile`, prompt for med name, start date,
   current dose, and reminder times; request notification + (optional) biometric permission.
2. **Check-in flow:** one scrollable screen driven by `schema.ts`; big `ScaleSelector`
   rows, pre-filled when editing; single Save writes the session sub-object and records
   `completedAt`. Fast path: tap-tap-tap-save.
3. **Med + dose-change log:** Settings shows current dose with "Log dose change" →
   appends `{date, dose, note}`. Trends overlay vertical markers at these dates.
4. **Reminders:** two daily `expo-notifications` calendar triggers at profile times;
   reschedule on change; tapping a notification deep-links to `checkin?session=...`.
5. **App lock:** on cold start / return to foreground, if `lockEnabled`, show
   `LockScreen` and call `LocalAuthentication.authenticateAsync()` before revealing data.
6. **PDF export:** date range → HTML (header with med + dose-change timeline, per-metric
   averages, daily table) → `Print.printToFileAsync` → `Sharing.shareAsync` (email/print/save).
7. **Trends:** per-metric bar sparklines for 7/14/30 days, colored by good direction,
   with dose-change markers so shifts are readable against titration.

## Design / UX Notes

- Calm, high-contrast, large tap targets; light + dark mode.
- "Today" tab is the home — shows at a glance whether each session is done and a gentle streak.
- Non-judgmental copy; no gamification pressure beyond a simple streak.
- Every screen reinforces "private, on this device."

## Open Items

- **JSON backup/restore:** not in the original export pick, but data is local-only so a
  lost/reset phone loses everything. Included as a minimal JSON export + import in Settings
  as a safety net.

## Verification

0. `npm run check` passes: tsc strict + eslint `--max-warnings 0` + `prettier --check` +
   `vitest run --coverage` (meets thresholds) + 100% type-coverage. Sanity-check the
   guardrails by temporarily adding an `any` / `@ts-ignore` / `!` (lint fails), a
   misformatted line (`prettier --check` fails), and a broken assertion (vitest fails),
   then reverting.
1. `npm install` then `npx expo start`; open in Expo Go on a physical phone (notifications
   + biometrics need a real device, not web).
2. Complete onboarding; confirm profile persists across app restarts.
3. Do a morning and an evening check-in; confirm the "Today" tab reflects completion and
   data survives a restart (proves local persistence).
4. Set reminder times a couple minutes out; confirm both notifications fire and tapping
   opens the right check-in.
5. Toggle app lock; background/foreground the app; confirm the biometric gate appears.
6. Log a dose change; confirm it appears as a marker on Trends.
7. Export PDF; confirm it opens in the share sheet with correct averages and daily table.
8. JSON export then import into a fresh install; confirm entries restore.
