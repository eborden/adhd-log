import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../lib/theme';

export interface StepperProps {
  readonly label: string;
  readonly value: number | undefined;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly onChange: (value: number) => void;
}

export function Stepper({ label, value, min, max, step, onChange }: StepperProps) {
  const theme = useTheme();
  const current = value ?? min;

  const clamp = (next: number): number => Math.min(max, Math.max(min, next));

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label}`}
          onPress={() => {
            onChange(clamp(current - step));
          }}
          style={[styles.stepButton, { borderColor: theme.border, backgroundColor: theme.surface }]}
        >
          <Text style={[styles.stepButtonText, { color: theme.text }]}>−</Text>
        </Pressable>
        <Text style={[styles.value, { color: theme.text }]}>{current}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Increase ${label}`}
          onPress={() => {
            onChange(clamp(current + step));
          }}
          style={[styles.stepButton, { borderColor: theme.border, backgroundColor: theme.surface }]}
        >
          <Text style={[styles.stepButtonText, { color: theme.text }]}>+</Text>
        </Pressable>
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
    alignItems: 'center',
    gap: 20,
  },
  stepButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepButtonText: {
    fontSize: 22,
    fontWeight: '700',
  },
  value: {
    fontSize: 18,
    fontWeight: '600',
    minWidth: 40,
    textAlign: 'center',
  },
});
