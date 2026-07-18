import { Pressable, StyleSheet, Text } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { radius, space, typography, useTheme } from '../lib/theme';

export interface ButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: 'primary' | 'secondary';
  readonly disabled?: boolean;
  readonly style?: StyleProp<ViewStyle>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  style,
}: ButtonProps) {
  const theme = useTheme();
  const isPrimary = variant === 'primary';

  const backgroundColor = disabled
    ? theme.surfaceMuted
    : isPrimary
      ? theme.accent
      : theme.surfaceMuted;
  const color = disabled ? theme.textMuted : isPrimary ? theme.onAccent : theme.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, { backgroundColor }, style]}
    >
      <Text style={[typography.button, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: space.lg,
    paddingHorizontal: space.xl,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
