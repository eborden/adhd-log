import { StyleSheet, Switch, Text, View } from 'react-native';
import { space, typography, useTheme } from '../lib/theme';

export interface ToggleProps {
  readonly label: string;
  readonly value: boolean;
  readonly onChange: (value: boolean) => void;
}

export function Toggle({ label, value, onChange }: ToggleProps) {
  const theme = useTheme();

  return (
    <View style={styles.row}>
      <Text style={[typography.bodyStrong, styles.label, { color: theme.text }]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: theme.surfaceMuted, true: theme.accent }}
        thumbColor={theme.controlKnob}
        ios_backgroundColor={theme.surfaceMuted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.xl,
  },
  label: {
    flex: 1,
    marginRight: space.md,
  },
});
