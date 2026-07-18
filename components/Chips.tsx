import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SideEffect, SideEffectReports } from '../lib/types';
import {
  SIDE_EFFECT_LABELS,
  isSideEffectSelected,
  withSideEffectSeverity,
  withSideEffectToggled,
} from '../lib/schema';
import { radius, space, typography, useTheme } from '../lib/theme';
import { SeveritySelector } from './SeveritySelector';

export interface ChipsProps {
  readonly label: string;
  readonly options: readonly SideEffect[];
  readonly selected: SideEffectReports;
  readonly onChange: (next: SideEffectReports) => void;
}

export function Chips({ label, options, selected, onChange }: ChipsProps) {
  const theme = useTheme();
  const selectedOptions = options.filter((option) => isSideEffectSelected(selected, option));

  return (
    <View style={styles.container}>
      <Text style={[typography.bodyStrong, styles.label, { color: theme.text }]}>{label}</Text>
      <View style={styles.row}>
        {options.map((option) => {
          const active = isSideEffectSelected(selected, option);
          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => {
                onChange(withSideEffectToggled(selected, option));
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

      {selectedOptions.length > 0 ? (
        <View style={styles.severitySection}>
          <Text style={[typography.caption, styles.severityGuide, { color: theme.textMuted }]}>
            Mild — noticeable but doesn&apos;t interfere · Moderate — interferes but manageable ·
            Severe — hard to get through the day.
          </Text>
          {selectedOptions.map((option) => {
            const detail = selected[option];
            if (detail === undefined) return null;
            return (
              <SeveritySelector
                key={option}
                effect={option}
                severity={detail.severity}
                onChange={(severity) => {
                  onChange(withSideEffectSeverity(selected, option, severity));
                }}
              />
            );
          })}
        </View>
      ) : null}
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
  severitySection: {
    marginTop: space.lg,
    gap: space.sm,
  },
  severityGuide: {
    marginBottom: space.xs,
  },
});
