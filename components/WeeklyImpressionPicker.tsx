import { Pressable, StyleSheet, Text, View } from 'react-native';
import { WEEKLY_IMPRESSION_LABELS } from '../lib/schema';
import { radius, space, typography, useTheme } from '../lib/theme';
import { WEEKLY_IMPRESSIONS } from '../lib/types';
import type { WeeklyImpression } from '../lib/types';

export interface WeeklyImpressionPickerProps {
  readonly value: WeeklyImpression | null;
  readonly onChange: (value: WeeklyImpression) => void;
}

export function WeeklyImpressionPicker({ value, onChange }: WeeklyImpressionPickerProps) {
  const theme = useTheme();

  return (
    <View style={styles.column}>
      {WEEKLY_IMPRESSIONS.map((impression) => {
        const selected = value === impression;
        return (
          <Pressable
            key={impression}
            accessibilityRole="button"
            accessibilityLabel={WEEKLY_IMPRESSION_LABELS[impression]}
            accessibilityState={{ selected }}
            onPress={() => {
              onChange(impression);
            }}
            style={[
              styles.option,
              {
                backgroundColor: selected ? theme.accentSoft : theme.surfaceMuted,
                borderColor: selected ? theme.accent : theme.border,
              },
            ]}
          >
            <Text style={[typography.bodyStrong, { color: selected ? theme.accent : theme.text }]}>
              {WEEKLY_IMPRESSION_LABELS[impression]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    gap: space.sm,
  },
  option: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: space.lg,
    paddingHorizontal: space.lg,
    alignItems: 'center',
  },
});
