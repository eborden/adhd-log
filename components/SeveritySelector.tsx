import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SideEffect, SideEffectSeverity } from '../lib/types';
import { SIDE_EFFECT_SEVERITIES } from '../lib/types';
import { SIDE_EFFECT_LABELS, SIDE_EFFECT_SEVERITY_LABELS } from '../lib/schema';
import { radius, space, typography, useTheme, type Theme } from '../lib/theme';

export interface SeveritySelectorProps {
  readonly effect: SideEffect;
  readonly severity: SideEffectSeverity;
  readonly onChange: (severity: SideEffectSeverity) => void;
}

/** At-a-glance fill cue: mild → good, moderate → neutral, severe → bad (the app's rating hues). */
function severityHue(theme: Theme, severity: SideEffectSeverity): string {
  switch (severity) {
    case 'mild':
      return theme.good;
    case 'moderate':
      return theme.neutral;
    case 'severe':
      return theme.bad;
  }
}

/**
 * The secondary severity control for one already-selected side effect: a compact 3-segment
 * Mild/Moderate/Severe control. Never gates Save — it only appears once an effect is selected.
 */
export function SeveritySelector({ effect, severity, onChange }: SeveritySelectorProps) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[typography.body, styles.label, { color: theme.text }]} numberOfLines={1}>
        {SIDE_EFFECT_LABELS[effect]}
      </Text>
      <View style={styles.segments}>
        {SIDE_EFFECT_SEVERITIES.map((option) => {
          const on = severity === option;
          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${SIDE_EFFECT_LABELS[effect]}: ${SIDE_EFFECT_SEVERITY_LABELS[option]}`}
              onPress={() => {
                onChange(option);
              }}
              style={[
                styles.segment,
                { backgroundColor: on ? severityHue(theme, option) : theme.surfaceMuted },
              ]}
            >
              <Text style={[typography.caption, { color: on ? theme.onAccent : theme.textMuted }]}>
                {SIDE_EFFECT_SEVERITY_LABELS[option]}
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
    alignItems: 'center',
    gap: space.md,
  },
  label: {
    flex: 1,
  },
  segments: {
    flexDirection: 'row',
    gap: space.xs,
  },
  segment: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
