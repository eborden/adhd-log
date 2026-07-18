import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Rating, ScaleDirection } from '../lib/types';
import { radius, ratingColor, space, typography, useTheme } from '../lib/theme';

const RATINGS: readonly Rating[] = [1, 2, 3, 4, 5];

export interface ScaleSelectorProps {
  readonly label: string;
  readonly low: string;
  readonly high: string;
  readonly direction: ScaleDirection;
  readonly value: Rating | undefined;
  readonly onChange: (value: Rating) => void;
}

export function ScaleSelector({
  label,
  low,
  high,
  direction,
  value,
  onChange,
}: ScaleSelectorProps) {
  const theme = useTheme();

  return (
    <View style={styles.container}>
      <Text style={[typography.bodyStrong, styles.label, { color: theme.text }]}>{label}</Text>
      <View style={styles.row}>
        {RATINGS.map((rating) => {
          const selected = value === rating;
          const background = selected ? ratingColor(theme, rating, direction) : theme.surfaceMuted;
          return (
            <Pressable
              key={rating}
              accessibilityRole="button"
              accessibilityLabel={`${label}: ${String(rating)}`}
              accessibilityState={{ selected }}
              onPress={() => {
                onChange(rating);
              }}
              style={[styles.button, { backgroundColor: background }]}
            >
              <Text
                style={[typography.cardTitle, { color: selected ? theme.onAccent : theme.text }]}
              >
                {rating}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.endsRow}>
        <Text style={[typography.caption, { color: theme.textMuted }]}>{low}</Text>
        <Text style={[typography.caption, { color: theme.textMuted }]}>{high}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: space.xl,
  },
  label: {
    marginBottom: space.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  button: {
    flex: 1,
    // Wider than tall so the row isn't so chunky, while staying well above the
    // 44pt minimum tap target at any phone width.
    aspectRatio: 1.3,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  endsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: space.sm,
  },
});
