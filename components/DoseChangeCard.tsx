import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from './Card';
import { space, typography, useTheme } from '../lib/theme';

/**
 * One metric's before/after row inside a dose-change card — purely display strings/colors.
 * `beforeCaption`/`afterCaption` are the muted "n=<n>" (plus "few logged days" when it applies)
 * text under each mean; the caller composes them so this component holds no threshold logic.
 */
export interface DoseChangeCardRow {
  readonly key: string;
  readonly label: string;
  readonly beforeText: string;
  readonly beforeColor: string;
  readonly beforeCaption: string;
  readonly afterText: string;
  readonly afterColor: string;
  readonly afterCaption: string;
}

export interface DoseChangeCardProps {
  readonly title: string;
  readonly windowLabel: string;
  readonly rows: readonly DoseChangeCardRow[];
  readonly adherenceCaption: string;
  readonly defaultExpanded: boolean;
}

/**
 * Presentational collapsible card for one `DoseChange` in the Trends "Around dose changes"
 * section. Holds only its own expand/collapse `useState` — every mean, color, and count is
 * computed by the caller so this component carries no domain logic.
 */
export function DoseChangeCard({
  title,
  windowLabel,
  rows,
  adherenceCaption,
  defaultExpanded,
}: DoseChangeCardProps) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState<boolean>(defaultExpanded);

  return (
    <Card style={styles.card}>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          setExpanded((prev) => !prev);
        }}
        style={styles.header}
      >
        <View style={styles.headerText}>
          <Text style={[typography.bodyStrong, { color: theme.text }]}>{title}</Text>
          <Text style={[typography.caption, { color: theme.textMuted }]}>{windowLabel}</Text>
        </View>
        <Text style={[typography.caption, { color: theme.textMuted }]}>{expanded ? '▾' : '▸'}</Text>
      </Pressable>

      {expanded ? (
        <View style={styles.body}>
          {rows.map((row) => (
            <View key={row.key} style={styles.row}>
              <Text style={[typography.body, styles.rowLabel, { color: theme.text }]}>
                {row.label}
              </Text>
              <View style={styles.rowSide}>
                <Text style={[typography.bodyStrong, { color: row.beforeColor }]}>
                  {row.beforeText}
                </Text>
                <Text style={[typography.caption, { color: theme.textMuted }]}>
                  {row.beforeCaption}
                </Text>
              </View>
              <Text style={[typography.caption, { color: theme.textMuted }]}>→</Text>
              <View style={styles.rowSide}>
                <Text style={[typography.bodyStrong, { color: row.afterColor }]}>
                  {row.afterText}
                </Text>
                <Text style={[typography.caption, { color: theme.textMuted }]}>
                  {row.afterCaption}
                </Text>
              </View>
            </View>
          ))}
          <Text style={[typography.caption, styles.adherence, { color: theme.textMuted }]}>
            {adherenceCaption}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: space.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerText: {
    flex: 1,
  },
  body: {
    marginTop: space.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginBottom: space.sm,
  },
  rowLabel: {
    flex: 1,
  },
  rowSide: {
    alignItems: 'center',
    minWidth: 72,
  },
  adherence: {
    marginTop: space.xs,
  },
});
