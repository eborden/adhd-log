import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Rating, ScaleDirection } from '../lib/types';
import { ratingColor, useTheme } from '../lib/theme';

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
      <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
      <View style={styles.row}>
        {RATINGS.map((rating) => {
          const selected = value === rating;
          const background = selected ? ratingColor(theme, rating, direction) : theme.surface;
          return (
            <Pressable
              key={rating}
              accessibilityRole="button"
              accessibilityLabel={`${label}: ${String(rating)}`}
              accessibilityState={{ selected }}
              onPress={() => {
                onChange(rating);
              }}
              style={[styles.button, { backgroundColor: background, borderColor: theme.border }]}
            >
              <Text style={[styles.buttonText, { color: selected ? '#FFFFFF' : theme.text }]}>
                {rating}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.endsRow}>
        <Text style={[styles.endLabel, { color: theme.textMuted }]}>{low}</Text>
        <Text style={[styles.endLabel, { color: theme.textMuted }]}>{high}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  button: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 18,
    fontWeight: '700',
  },
  endsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  endLabel: {
    fontSize: 12,
  },
});
