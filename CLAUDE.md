# CLAUDE.md — adhd-log

Working contract for this repo. These rules are non-negotiable; the full rationale lives in
[`docs/PLANNING-v0.md`](docs/PLANNING-v0.md). `PLANNING-v0.md` is frozen — decisions made
since are logged in [`docs/DECISIONS.md`](docs/DECISIONS.md).

## What this is

A private, **local-only** daily check-in app for someone starting a non-stimulant ADHD
medication (effects accumulate over weeks — the useful signal is the _trend_, not a single
day). Expo (React Native) + expo-router + TypeScript. Data lives on-device in AsyncStorage
and **never leaves the phone** except through user-initiated exports (PDF for a provider,
JSON for backup).

This is a personal tracking tool, **not medical advice**. Keep all copy framed as "log this
and discuss with your provider." Never present interpretations as clinical guidance.

## Type system — non-negotiable

TypeScript runs in maximum-strict mode and the following are **banned** (ESLint fails the
build, husky blocks the commit):

- `any` (`@typescript-eslint/no-explicit-any`) and the unsafe-`any` family.
- `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` (`ban-ts-comment`).
- Non-null assertions `!` (`no-non-null-assertion`).
- Inline `// eslint-disable*` to escape any of the above (`eslint-comments/no-use`).

`noUncheckedIndexedAccess` is on: indexing (e.g. `entries[date]`) yields `T | undefined` —
**narrow it**, don't assert it. If the type system is in your way, model the data better;
do not reach for an escape hatch.

One deliberate exception: `skipLibCheck` is `true`, not `false`. `react-native`'s and
`@types/node`'s global `.d.ts` files declare `fetch`/`URL`/`AbortController`/etc. with
incompatible signatures — an upstream conflict between two third-party type packages, not
our code. `skipLibCheck` only skips checking `.d.ts` files' internal consistency; every
strictness flag above still applies in full to our own source.

## Domain modeling

- No raw `number`/`string` for meaningful values. Use the aliases, branded types, literal
  unions, and discriminated unions in `lib/types.ts` (`IsoDate`, `IsoTimestamp`, `MedName`,
  `Rating` = `1|2|3|4|5`, `Session`, `SideEffect`, `TimeOfDay`, `Dose`, …).
- Model so **illegal states are unrepresentable** (unions over optional-flag soup).
- `switch` on a discriminant must be **exhaustive** — end with a `never` default assertion so
  adding a variant fails to compile until every consumer handles it.

## Boundaries

- External / persisted JSON enters the typed world **only** through `lib/storage.ts` guards
  returning `Parsed<T>` (`{ ok: true; value } | { ok: false; reason }`). Parse-don't-validate;
  never cast untrusted data.
- Keep testable logic in **RN-free** `lib/` modules so Vitest can run it without native
  shims. Components stay thin and presentational.
- `type-coverage` runs with `--ignore-as-assertion`: it flags every `as T`, including the
  branded-type constructors this codebase deliberately relies on (`lib/storage.ts`'s
  `formatIsoDate`/`isoTimestampNow` still guard-and-throw instead of asserting) and known-valid
  literals in test fixtures. The flag exempts intentional assertions of compatible types, not
  `any` — `no-unsafe-*` and `no-explicit-any` still catch that regardless.

## Gates (must pass before commit)

`npm run check` runs all of, and husky `pre-commit` enforces via `lint-staged`:

- `typecheck` — `tsc --noEmit` (strict)
- `lint` — `eslint . --max-warnings 0`
- `format:check` — `prettier --check .` (Prettier is the **sole** formatter; never hand-format)
- `test` — `vitest run --coverage` (meets thresholds)
- `type-coverage` — `--at-least 100`

## Layout

- `app/` — expo-router routes (tabs: Today / Trends / History / Settings; plus `checkin`,
  `entry/[date]`, onboarding).
- `components/` — thin, presentational (ScaleSelector, Chips, Toggle, Stepper, LockScreen).
- `lib/` — `types`, `schema` (metric discriminated union — single source of truth for
  check-in fields), `checkin` (RN-free `Draft` state + session construction from the schema),
  `storage`, `notifications`, `export`, `tokens` (design primitives) → `theme` (semantic
  layer), `__tests__/`.

Add or rename a tracked metric in `lib/schema.ts` only; both check-in sessions render
generically from it.
