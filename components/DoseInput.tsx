import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { radius, space, typography, useTheme } from '../lib/theme';
import type { DoseUnit } from '../lib/types';

const DOSE_UNITS: readonly DoseUnit[] = ['mg', 'mcg', 'mL'];

export interface DoseInputProps {
  readonly amount: string; // raw text; the parent parses with Number(...)
  readonly unit: DoseUnit;
  readonly onAmountChange: (text: string) => void;
  readonly onUnitChange: (unit: DoseUnit) => void;
  readonly amountPlaceholder?: string;
}

/** Amount field + unit-chip picker. Controlled and presentational, like the other primitives. */
export function DoseInput({
  amount,
  unit,
  onAmountChange,
  onUnitChange,
  amountPlaceholder = 'Amount',
}: DoseInputProps) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <TextInput
        value={amount}
        onChangeText={onAmountChange}
        placeholder={amountPlaceholder}
        placeholderTextColor={theme.textMuted}
        keyboardType="decimal-pad"
        style={[
          typography.body,
          styles.input,
          styles.amountInput,
          { color: theme.text, backgroundColor: theme.surfaceMuted },
        ]}
      />
      <View style={styles.unitRow}>
        {DOSE_UNITS.map((option) => {
          const active = option === unit;
          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              onPress={() => {
                onUnitChange(option);
              }}
              style={[
                styles.unitChip,
                { backgroundColor: active ? theme.accentSoft : theme.surfaceMuted },
              ]}
            >
              <Text style={[typography.body, { color: active ? theme.accent : theme.text }]}>
                {option}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: space.md,
    alignItems: 'flex-start',
  },
  input: {
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  amountInput: {
    flex: 1,
  },
  unitRow: {
    flexDirection: 'row',
    gap: space.sm,
  },
  unitChip: {
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
