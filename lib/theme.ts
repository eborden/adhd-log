import { useColorScheme } from 'react-native';
import type { TextStyle, ViewStyle } from 'react-native';
import {
  fontFamily,
  fontSize,
  fontWeight,
  letterSpacing,
  lineHeight,
  palette,
  shadowPrimitive,
} from './tokens';
import type { Rating, ScaleDirection } from './types';

/**
 * Layer 2 — semantic tokens. Every value references a Layer-1 primitive from
 * `./tokens`; nothing here is a raw literal. `useTheme()` resolves these per
 * color scheme. Components consume only this layer (plus `typography`,
 * `shadows`, `space`, `radius`) — never `palette` directly.
 */
export interface Theme {
  readonly background: string;
  readonly surface: string;
  /** Sunken/tinted fill for inputs, unselected chips, grouped rows. */
  readonly surfaceMuted: string;
  readonly text: string;
  readonly textMuted: string;
  readonly border: string;
  readonly accent: string;
  /** Tinted-accent fill for selected chips/toggles (softer than a full accent fill). */
  readonly accentSoft: string;
  /** Text/icon color that sits on a strong `accent` fill. */
  readonly onAccent: string;
  /** Raised knob for switches — light in both modes so it reads on any track. */
  readonly controlKnob: string;
  readonly good: string;
  readonly bad: string;
  readonly neutral: string;
  /**
   * For a metric with no better/worse axis at all (`ScaleDirection: 'neutral'`, e.g. Appetite,
   * Libido) — every value renders in this one color regardless of rating. Deliberately a
   * grayscale tone, not a hue from the good/bad/`neutral` spectrum: painting an unbiased metric
   * in the same ochre used for a directional scale's *midpoint* would read as "trending
   * mediocre" even though no such judgment is being made.
   */
  readonly unbiased: string;
  /**
   * For a line/mark drawn *over* a `good`/`bad`/`neutral`-colored bar (e.g. the Trends
   * smoothing overlay) — a hue outside that rating spectrum, so it never blends into a
   * same-colored bar underneath it. Deliberately not `accent`: `accent`'s pine green sits too
   * close in hue/lightness to `good`'s green to read reliably on top of it.
   */
  readonly trendLine: string;
}

const light: Theme = {
  background: palette.warm100,
  surface: palette.warm50,
  surfaceMuted: palette.warm200,
  text: palette.warm900,
  textMuted: palette.warm500,
  border: palette.warm300,
  accent: palette.pineStrong,
  accentSoft: palette.pineSoftLight,
  onAccent: palette.onLight,
  controlKnob: palette.warm50,
  good: palette.greenStrong,
  bad: palette.clayStrong,
  neutral: palette.ochreStrong,
  unbiased: palette.warm500,
  trendLine: palette.indigoStrong,
};

const dark: Theme = {
  background: palette.bark900,
  surface: palette.bark800,
  surfaceMuted: palette.bark700,
  text: palette.barkText,
  textMuted: palette.barkMuted,
  border: palette.bark600,
  accent: palette.pineLight,
  accentSoft: palette.pineSoftDark,
  onAccent: palette.onDark,
  controlKnob: palette.barkText,
  good: palette.greenLight,
  bad: palette.clayLight,
  neutral: palette.ochreLight,
  unbiased: palette.barkMuted,
  trendLine: palette.indigoLight,
};

export function useTheme(): Theme {
  const scheme = useColorScheme();
  return scheme === 'dark' ? dark : light;
}

/** Named text-style roles — the only type styling components apply. */
export const typography = {
  display: {
    fontFamily: fontFamily.serifHeavy,
    fontSize: fontSize.display,
    lineHeight: lineHeight.display,
    letterSpacing: letterSpacing.tight,
  },
  title: {
    fontFamily: fontFamily.serifBold,
    fontSize: fontSize.xxl,
    lineHeight: lineHeight.xxl,
    letterSpacing: letterSpacing.snug,
  },
  sectionLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    letterSpacing: letterSpacing.label,
    textTransform: 'uppercase',
  },
  cardTitle: {
    fontFamily: fontFamily.serifBold,
    fontSize: fontSize.xl,
    lineHeight: lineHeight.xl,
    letterSpacing: letterSpacing.snug,
  },
  body: {
    fontSize: fontSize.md,
    lineHeight: lineHeight.md,
    fontWeight: fontWeight.medium,
  },
  bodyStrong: {
    fontSize: fontSize.md,
    lineHeight: lineHeight.md,
    fontWeight: fontWeight.semibold,
  },
  caption: {
    fontSize: fontSize.sm,
    lineHeight: lineHeight.sm,
    fontWeight: fontWeight.medium,
  },
  button: {
    fontSize: fontSize.lg,
    lineHeight: lineHeight.lg,
    fontWeight: fontWeight.bold,
    letterSpacing: letterSpacing.wide,
  },
} satisfies Record<string, TextStyle>;

/** Resolved soft elevation. Light cards use this; dark cards lean on a border. */
export const shadows = {
  card: {
    shadowColor: shadowPrimitive.color,
    shadowOpacity: shadowPrimitive.opacity,
    shadowRadius: shadowPrimitive.radius,
    shadowOffset: { width: 0, height: shadowPrimitive.offsetY },
    elevation: shadowPrimitive.elevation,
  },
} satisfies Record<string, ViewStyle>;

export { space, radius } from './tokens';

/** Color for one day's rating bar: green toward the metric's good end, red away from it. */
export function ratingColor(theme: Theme, rating: Rating, direction: ScaleDirection): string {
  if (direction === 'neutral') return theme.unbiased;
  const better = direction === 'higher-better' ? rating >= 4 : rating <= 2;
  const worse = direction === 'higher-better' ? rating <= 2 : rating >= 4;
  if (better) return theme.good;
  if (worse) return theme.bad;
  return theme.neutral;
}
