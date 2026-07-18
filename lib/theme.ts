import { useColorScheme } from 'react-native';
import type { Rating, ScaleDirection } from './types';

export interface Theme {
  readonly background: string;
  readonly surface: string;
  readonly text: string;
  readonly textMuted: string;
  readonly border: string;
  readonly accent: string;
  readonly good: string;
  readonly bad: string;
  readonly neutral: string;
}

const light: Theme = {
  background: '#F7F7F5',
  surface: '#FFFFFF',
  text: '#1C1B1A',
  textMuted: '#6B6862',
  border: '#E4E1DC',
  accent: '#3E6259',
  good: '#3E8E5B',
  bad: '#C1502E',
  neutral: '#8A6D3B',
};

const dark: Theme = {
  background: '#15140F',
  surface: '#1F1E19',
  text: '#F2F0EB',
  textMuted: '#A8A399',
  border: '#33322B',
  accent: '#7FB6A6',
  good: '#6FBF8B',
  bad: '#E08160',
  neutral: '#D6B168',
};

export function useTheme(): Theme {
  const scheme = useColorScheme();
  return scheme === 'dark' ? dark : light;
}

/** Color for one day's rating bar: green toward the metric's good end, red away from it. */
export function ratingColor(theme: Theme, rating: Rating, direction: ScaleDirection): string {
  if (direction === 'neutral') return theme.neutral;
  const better = direction === 'higher-better' ? rating >= 4 : rating <= 2;
  const worse = direction === 'higher-better' ? rating <= 2 : rating >= 4;
  if (better) return theme.good;
  if (worse) return theme.bad;
  return theme.neutral;
}
