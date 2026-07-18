import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SideEffect } from '../lib/types';
import { SIDE_EFFECT_LABELS } from '../lib/schema';
import { radius, space, typography, useTheme } from '../lib/theme';

export interface ChipsProps {
  readonly label: string;
  readonly options: readonly SideEffect[];
  readonly selected: readonly SideEffect[];
  readonly onChange: (next: readonly SideEffect[]) => void;
}

export function Chips({ label, options, selected, onChange }: ChipsProps) {
  const theme = useTheme();

  const toggle = (option: SideEffect): void => {
    if (selected.includes(option)) {
      onChange(selected.filter((entry) => entry !== option));
    } else {
      onChange([...selected, option]);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={[typography.bodyStrong, styles.label, { color: theme.text }]}>{label}</Text>
      <View style={styles.row}>
        {options.map((option) => {
          const active = selected.includes(option);
          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => {
                toggle(option);
              }}
              style={[
                styles.chip,
                { backgroundColor: active ? theme.accentSoft : theme.surfaceMuted },
              ]}
            >
              <Text style={[typography.caption, { color: active ? theme.accent : theme.text }]}>
                {SIDE_EFFECT_LABELS[option]}
              </Text>
            </Pressable>
          );
        })}
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
    flexWrap: 'wrap',
    gap: space.sm,
  },
  chip: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
  },
});
