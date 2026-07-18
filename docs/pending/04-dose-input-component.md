# 04 — Extract a `<DoseInput>` component

**Priority:** 4
**Effort:** Small
**Risk / over-engineering:** Low

## Problem

The dose amount input + unit-chip picker is copy-pasted almost verbatim in two screens:

- `app/onboarding.tsx:93-130` (JSX) + `:200-218` (styles `doseRow`/`amountInput`/`unitRow`/`unitChip`)
- `app/(tabs)/settings.tsx:183-219` (JSX) + `:379-397` (same styles)

Plus **two** copies of `const DOSE_UNITS: readonly DoseUnit[] = ['mg', 'mcg', 'mL']`
(`onboarding.tsx:19`, `settings.tsx:37`). This is the only genuine verbatim cross-screen UI
duplication in the codebase — two style blocks and a constant to keep in sync by hand.

## Change

Add a thin, presentational `components/DoseInput.tsx` that owns the amount field, the unit chips,
`DOSE_UNITS`, and the shared styles. Keep it controlled and stateless (matches the other primitives
like `Toggle`/`Stepper`):

```ts
interface DoseInputProps {
  readonly amount: string; // raw text; parent parses with Number(...)
  readonly unit: DoseUnit;
  readonly onAmountChange: (text: string) => void;
  readonly onUnitChange: (unit: DoseUnit) => void;
  readonly amountPlaceholder?: string; // default "Amount"
}
```

- Move `DOSE_UNITS` into this component (or into `lib/types.ts` next to `DoseUnit` if you prefer a
  single source; component-local is fine since it's UI-only).
- Reproduce the existing chip visuals exactly (`accentSoft`/`surfaceMuted` background toggle,
  `radius.pill`, `useTheme`) so there's no visual change.
- Note the one cosmetic difference between the two current copies: onboarding uses `typography.body`
  for the chip label, settings uses `typography.caption`. Pick one (recommend `typography.body`) and
  standardize — call it out in the PR so the tiny visual change is intentional, not accidental.

Then replace both call sites:

- `onboarding.tsx`: drop local `DOSE_UNITS`, the `<View style={styles.doseRow}>…</View>` block, and
  the now-unused styles; render `<DoseInput amount={amountText} unit={unit} onAmountChange={setAmountText} onUnitChange={setUnit} />`.
- `settings.tsx`: same, wiring to `newAmount`/`newUnit`/`setNewAmount`/`setNewUnit`.

## Acceptance criteria

- Both screens render an identical dose picker with no behavioral change (amount still parsed by the
  parent via `Number(...)`, unit selection still drives the same state).
- `DOSE_UNITS` and the unit-chip styles exist in exactly one place.
- No leftover unused styles or imports in either screen (eslint `noUnusedLocals` will catch these).

## Non-goals

- **Do not** generalize into a full `<SegmentedControl>`/`<SegmentedPills>` abstraction unless the
  Trends range selector (`app/(tabs)/trends.tsx:65-86`) is folded in _in the same change_ and it's
  genuinely trivial. The panel rated a speculative generic segmented control as low-value; a focused
  `<DoseInput>` is the win. If you do fold in Trends, keep the primitive dumb (options + selected +
  onSelect) and let each screen own its labels.
- **Do not** reach for a UI-kit component — it would collide with the `tokens.ts → theme.ts` system.

## Gates

`npm run check` green. This is the one component extraction the panel endorsed; resist extracting
the single-use co-located helpers (`SessionCard`, `HistoryRow`, `RatingRow`, `DetailRow`) — they
correctly live where they're used.
