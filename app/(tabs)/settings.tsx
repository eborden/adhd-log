import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DoseInput } from '../../components/DoseInput';
import { Stepper } from '../../components/Stepper';
import { Toggle } from '../../components/Toggle';
import {
  buildBackup,
  buildReportHtml,
  exportJsonBackup,
  exportPdfReport,
  importJsonBackup,
  rowsInRange,
} from '../../lib/export';
import { requestNotificationPermissions, scheduleReminders } from '../../lib/notifications';
import {
  EVENING_METRICS,
  enabledEveningMetricKeys,
  withEveningMetricToggled,
} from '../../lib/schema';
import {
  appendDoseChange,
  isEveningRatingKey,
  isHour,
  lastNDates,
  loadDoseChanges,
  loadEntries,
  loadProfile,
  restoreBackup,
  saveProfile,
  todayIsoDate,
} from '../../lib/storage';
import { radius, space, typography, useTheme } from '../../lib/theme';
import type { DoseChange, DoseUnit, Profile } from '../../lib/types';

function SectionLabel({ children }: { readonly children: string }) {
  const theme = useTheme();
  return (
    <Text style={[typography.sectionLabel, styles.sectionLabel, { color: theme.textMuted }]}>
      {children}
    </Text>
  );
}

export default function Settings() {
  const theme = useTheme();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [doses, setDoses] = useState<readonly DoseChange[]>([]);
  const [newAmount, setNewAmount] = useState('');
  const [newUnit, setNewUnit] = useState<DoseUnit>('mg');
  const [newNote, setNewNote] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback((): void => {
    Promise.all([loadProfile(), loadDoseChanges()])
      .then(([loadedProfile, loadedDoses]) => {
        setProfile(loadedProfile);
        setDoses(loadedDoses);
      })
      .catch(() => undefined);
  }, []);

  useFocusEffect(refresh);

  if (profile === null) {
    return <View style={[styles.container, { backgroundColor: theme.background }]} />;
  }
  const currentProfile = profile;

  const updateProfile = (next: Profile): void => {
    setProfile(next);
    saveProfile(next).catch(() => undefined);
  };

  const handleLogDoseChange = async (): Promise<void> => {
    const amount = Number(newAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert('Enter a dose amount above 0.');
      return;
    }
    const trimmedNote = newNote.trim();
    const change: DoseChange = {
      date: todayIsoDate(),
      dose: { amount, unit: newUnit },
      ...(trimmedNote !== '' ? { note: trimmedNote } : {}),
    };
    const nextDoses = await appendDoseChange(change);
    setDoses(nextDoses);
    updateProfile({ ...currentProfile, currentDose: change.dose });
    setNewAmount('');
    setNewNote('');
  };

  const handleReminderChange = (session: 'morning' | 'evening', hour: number): void => {
    if (!isHour(hour)) return;
    const next: Profile = {
      ...currentProfile,
      ...(session === 'morning'
        ? { morningReminder: { hour, minute: 0 } }
        : { eveningReminder: { hour, minute: 0 } }),
    };
    updateProfile(next);
    requestNotificationPermissions()
      .then((granted) => (granted ? scheduleReminders(next) : Promise.resolve()))
      .catch(() => undefined);
  };

  const handleExportPdf = async (): Promise<void> => {
    setBusy(true);
    try {
      const [entries, currentDoses] = await Promise.all([loadEntries(), loadDoseChanges()]);
      const dates = lastNDates(30, todayIsoDate());
      const rows = rowsInRange(entries, dates);
      const html = buildReportHtml(currentProfile, currentDoses, rows);
      await exportPdfReport(html);
    } catch {
      Alert.alert('Could not export the PDF report.');
    } finally {
      setBusy(false);
    }
  };

  const handleExportJson = async (): Promise<void> => {
    setBusy(true);
    try {
      const [entries, currentDoses] = await Promise.all([loadEntries(), loadDoseChanges()]);
      const backup = buildBackup(currentProfile, currentDoses, entries);
      await exportJsonBackup(backup);
    } catch {
      Alert.alert('Could not export the JSON backup.');
    } finally {
      setBusy(false);
    }
  };

  const handleImportJson = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await importJsonBackup();
      if (!result.ok) {
        Alert.alert('Import failed', result.reason);
        return;
      }
      await restoreBackup(result.value);
      refresh(); // reflect what was actually persisted, not hand-set state
      Alert.alert('Backup restored');
    } catch {
      Alert.alert('Could not import the backup.');
    } finally {
      setBusy(false);
    }
  };

  const enabledKeys = enabledEveningMetricKeys(currentProfile);

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
    >
      <SectionLabel>Medication</SectionLabel>
      <Card style={styles.section}>
        <Text style={[typography.cardTitle, { color: theme.text }]}>{currentProfile.medName}</Text>
        <Text style={[typography.caption, styles.caption, { color: theme.textMuted }]}>
          Current dose: {currentProfile.currentDose.amount}
          {currentProfile.currentDose.unit} · started {currentProfile.startDate}
        </Text>

        <Text style={[typography.bodyStrong, styles.fieldLabel, { color: theme.text }]}>
          Log a dose change
        </Text>
        <View style={styles.doseField}>
          <DoseInput
            amount={newAmount}
            unit={newUnit}
            onAmountChange={setNewAmount}
            onUnitChange={setNewUnit}
          />
        </View>
        <TextInput
          value={newNote}
          onChangeText={setNewNote}
          placeholder="Note (optional)"
          placeholderTextColor={theme.textMuted}
          style={[
            typography.body,
            styles.input,
            styles.noteInput,
            { color: theme.text, backgroundColor: theme.surfaceMuted },
          ]}
        />
        <Button
          label="Save dose change"
          variant="secondary"
          onPress={() => {
            handleLogDoseChange().catch(() => undefined);
          }}
        />

        {doses.length > 0 ? (
          <View style={styles.doseLog}>
            {doses
              .slice()
              .reverse()
              .map((change) => (
                <Text
                  key={`${change.date}-${String(change.dose.amount)}`}
                  style={[typography.caption, { color: theme.textMuted }]}
                >
                  {change.date}: {change.dose.amount}
                  {change.dose.unit}
                  {change.note !== undefined ? ` — ${change.note}` : ''}
                </Text>
              ))}
          </View>
        ) : null}
      </Card>

      <SectionLabel>Reminders</SectionLabel>
      <Card style={styles.section}>
        <Stepper
          label="Morning (hour, 24h)"
          value={currentProfile.morningReminder.hour}
          min={0}
          max={23}
          step={1}
          onChange={(hour) => {
            handleReminderChange('morning', hour);
          }}
        />
        <Stepper
          label="Evening (hour, 24h)"
          value={currentProfile.eveningReminder.hour}
          min={0}
          max={23}
          step={1}
          onChange={(hour) => {
            handleReminderChange('evening', hour);
          }}
        />
      </Card>

      <SectionLabel>Evening check-in</SectionLabel>
      <Card style={styles.section}>
        <Text style={[typography.caption, styles.caption, { color: theme.textMuted }]}>
          Choose which ratings show up in your evening check-in.
        </Text>
        {EVENING_METRICS.map((metric) => {
          if (metric.kind !== 'scale' || !isEveningRatingKey(metric.key)) return null;
          const key = metric.key;
          return (
            <Toggle
              key={key}
              label={metric.label}
              value={enabledKeys.includes(key)}
              onChange={(isEnabled) => {
                updateProfile({
                  ...currentProfile,
                  enabledEveningMetrics: withEveningMetricToggled(enabledKeys, key, isEnabled),
                });
              }}
            />
          );
        })}
      </Card>

      <SectionLabel>Privacy</SectionLabel>
      <Card style={styles.section}>
        <Toggle
          label="Require Face ID / passcode to open"
          value={currentProfile.lockEnabled}
          onChange={(lockEnabled) => {
            updateProfile({ ...currentProfile, lockEnabled });
          }}
        />
      </Card>

      <SectionLabel>Export</SectionLabel>
      <Card style={[styles.section, styles.exportGroup]}>
        <Button
          label="Export PDF report (30 days)"
          variant="secondary"
          disabled={busy}
          onPress={() => {
            handleExportPdf().catch(() => undefined);
          }}
        />
        <Button
          label="Export JSON backup"
          variant="secondary"
          disabled={busy}
          onPress={() => {
            handleExportJson().catch(() => undefined);
          }}
        />
        <Button
          label="Import JSON backup"
          variant="secondary"
          disabled={busy}
          onPress={() => {
            handleImportJson().catch(() => undefined);
          }}
        />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: space.xl,
  },
  sectionLabel: {
    marginTop: space.xl,
    marginBottom: space.sm,
  },
  section: {
    marginBottom: space.xs,
  },
  caption: {
    marginTop: space.xs,
    marginBottom: space.md,
  },
  fieldLabel: {
    marginTop: space.md,
    marginBottom: space.sm,
  },
  input: {
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  noteInput: {
    marginBottom: space.md,
  },
  doseField: {
    marginBottom: space.md,
  },
  doseLog: {
    marginTop: space.md,
    gap: space.xs,
  },
  exportGroup: {
    gap: space.sm,
  },
});
