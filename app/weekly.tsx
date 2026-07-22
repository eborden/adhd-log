import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { router } from 'expo-router';
import { Button } from '../components/Button';
import { WeeklyImpressionPicker } from '../components/WeeklyImpressionPicker';
import {
  addDays,
  isoTimestampNow,
  lastCompletedWeekStart,
  loadWeekly,
  parseIsoDate,
  saveWeeklyCheckin,
  todayIsoDate,
} from '../lib/storage';
import { radius, space, typography, useTheme } from '../lib/theme';
import type { IsoDate, WeeklyImpression } from '../lib/types';

const WEEK_RANGE_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

/** "Jul 14–Jul 20" — the concrete Monday–Sunday span the rating covers. */
function formatWeekRange(weekOf: IsoDate): string {
  const start = WEEK_RANGE_FORMAT.format(parseIsoDate(weekOf));
  const end = WEEK_RANGE_FORMAT.format(parseIsoDate(addDays(weekOf, 6)));
  return `${start}–${end}`;
}

export default function Weekly() {
  const theme = useTheme();
  const weekOf = lastCompletedWeekStart(todayIsoDate());
  const [overall, setOverall] = useState<WeeklyImpression | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadWeekly()
      .then((weekly) => {
        const existing = weekly[weekOf];
        if (existing === undefined) return;
        setOverall(existing.overall);
        setNote(existing.note ?? '');
      })
      .catch(() => undefined);
  }, [weekOf]);

  const handleSave = async (): Promise<void> => {
    if (overall === null) return;
    const trimmedNote = note.trim();
    await saveWeeklyCheckin({
      weekOf,
      overall,
      completedAt: isoTimestampNow(),
      ...(trimmedNote.length > 0 ? { note: trimmedNote } : {}),
    });
    router.back();
  };

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[typography.title, { color: theme.text }]}>
        How was last week ({formatWeekRange(weekOf)})?
      </Text>
      <Text style={[typography.caption, styles.subtitle, { color: theme.textMuted }]}>
        Compared with the week before — not your starting point.
      </Text>

      <WeeklyImpressionPicker
        value={overall}
        onChange={(value) => {
          setOverall(value);
        }}
      />

      <Text style={[typography.bodyStrong, styles.noteLabel, { color: theme.text }]}>
        Anything else about last week (optional)
      </Text>
      <TextInput
        value={note}
        onChangeText={setNote}
        multiline
        placeholder="Optional"
        placeholderTextColor={theme.textMuted}
        style={[
          typography.body,
          styles.textInput,
          { color: theme.text, backgroundColor: theme.surfaceMuted },
        ]}
      />
      <Text style={[typography.caption, styles.crisisNote, { color: theme.textMuted }]}>
        If you&apos;re in crisis, please contact a local crisis line or emergency services — this
        note isn&apos;t monitored.
      </Text>

      <Button
        label="Save"
        disabled={overall === null || saving}
        style={styles.saveButton}
        onPress={() => {
          setSaving(true);
          handleSave()
            .catch(() => undefined)
            .finally(() => {
              setSaving(false);
            });
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: space.xl,
    paddingBottom: space.xxxl,
  },
  subtitle: {
    marginTop: space.sm,
    marginBottom: space.xl,
  },
  noteLabel: {
    marginTop: space.xl,
    marginBottom: space.md,
  },
  textInput: {
    borderRadius: radius.sm,
    padding: space.md,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  crisisNote: {
    marginTop: space.sm,
  },
  saveButton: {
    marginTop: space.xl,
  },
});
