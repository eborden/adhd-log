/**
 * Layer 1 — design primitives. Raw, mode-agnostic scales with no dependencies.
 * These are never consumed directly by components; the semantic layer in
 * `lib/theme.ts` maps them to meaning (and picks per color scheme). This is the
 * only file where raw color hexes and raw size numbers live.
 */

/** Warm-paper / warm-ink neutral ramp, pine accent ramp, and rating hues. */
export const palette = {
  // Warm neutral ramp — light end.
  warm50: '#F4EFE5', // light surface (raised card)
  warm100: '#E8E1D3', // light background (paper)
  warm200: '#DFD8C8', // light sunken/tinted fill
  warm300: '#D4CBB9', // light border
  warm500: '#726A5C', // light muted text
  warm900: '#2A251E', // light primary text (ink)

  // Warm neutral ramp — dark end.
  bark600: '#37312A', // dark border
  bark700: '#332D22', // dark sunken/tinted fill (kept distinct from surface for contrast)
  bark800: '#221E17', // dark surface
  bark900: '#17140F', // dark background
  barkText: '#F1EBDF', // dark primary text
  barkMuted: '#A69C8A', // dark muted text

  // Text/icon color that sits on strong accent fills.
  onLight: '#F5F1E8', // warm off-white (on light-mode accent)
  onDark: '#14110C', // warm near-black (on dark-mode accent)

  // Pine accent ramp.
  pineStrong: '#2E6B4F', // light accent
  pineLight: '#6FB495', // dark accent
  pineSoftLight: '#CFE0D3', // light tinted-accent fill
  pineSoftDark: '#2A3A31', // dark tinted-accent fill

  // Semantic rating hues (good / bad / neutral), per mode.
  greenStrong: '#2F8455',
  greenLight: '#6FBF8B',
  clayStrong: '#B8472A',
  clayLight: '#E08160',
  ochreStrong: '#94762F',
  ochreLight: '#D6B168',
} as const;

/** 4-based spacing scale. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

/** Corner-radius scale. `pill` is effectively fully rounded. */
export const radius = {
  xs: 4,
  sm: 10,
  md: 14,
  lg: 18,
  pill: 999,
} as const;

export const fontSize = {
  xs: 12,
  sm: 13,
  md: 15,
  lg: 16,
  xl: 17,
  xxl: 22,
  display: 34,
} as const;

/** String literals so they satisfy React Native's `fontWeight` without importing RN. */
export const fontWeight = {
  medium: '500',
  semibold: '600',
  bold: '700',
  heavy: '800',
} as const;

export const letterSpacing = {
  tight: -0.5,
  snug: -0.3,
  wide: 0.2,
  label: 1.2,
} as const;

/** Raw elevation numbers; the semantic layer composes these into a shadow style. */
export const shadowPrimitive = {
  color: '#2A2016', // warm shadow, softer than pure black
  opacity: 0.1,
  radius: 14,
  offsetY: 6,
  elevation: 3,
} as const;
