import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useColorScheme } from 'react-native';
import { radius, shadows, space, useTheme } from '../lib/theme';

export interface CardProps {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
}

/**
 * Raised surface: soft shadow in light mode; a hairline border in dark mode
 * (shadows read as ~nothing on dark). The component-token layer for "a card".
 */
export function Card({ children, style }: CardProps) {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface },
        isDark
          ? { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border }
          : shadows.card,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    padding: space.lg,
  },
});
