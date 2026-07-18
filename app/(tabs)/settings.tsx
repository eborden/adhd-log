import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
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
  saveEntries,
  saveProfile,
  todayIsoDate,
} from '../../lib/storage';
import { useTheme } from '../../lib/theme';
import type { DoseChange, DoseUnit, Profile } from '../../lib/types';

const DOSE_UNITS: readonly DoseUnit[] = ['mg', 'mcg', 'mL'];

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
    updateProfile({ ...profile, currentDose: change.dose });
    setNewAmount('');
    setNewNote('');
  };

  const handleReminderChange = (session: 'morning' | 'evening', hour: number): void => {
    if (!isHour(hour)) return;
    const next: Profile = {
      ...profile,
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
      const html = buildReportHtml(profile, currentDoses, rows);
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
      const backup = buildBackup(profile, currentDoses, entries);
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
      const {
        profile: importedProfile,
        doses: importedDoses,
        entries: importedEntries,
      } = result.value;
      if (importedProfile !== null) {
        updateProfile(importedProfile);
      }
      setDoses(importedDoses);
      await saveEntries(importedEntries);
      Alert.alert('Backup restored');
    } catch {
      Alert.alert('Could not import the backup.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
    >
      <Text style={[styles.section, { color: theme.text }]}>Medication</Text>
      <Text style={[styles.body, { color: theme.text }]}>{profile.medName}</Text>
      <Text style={{ color: theme.textMuted, marginBottom: 16 }}>
        Current dose: {profile.currentDose.amount}
        {profile.currentDose.unit} · started {profile.startDate}
      </Text>

      <Text style={[styles.label, { color: theme.text }]}>Log a dose change</Text>
      <View style={styles.doseRow}>
        <TextInput
          value={newAmount}
          onChangeText={setNewAmount}
          placeholder="Amount"
          placeholderTextColor={theme.textMuted}
          keyboardType="decimal-pad"
          style={[
            styles.input,
            styles.amountInput,
            { color: theme.text, borderColor: theme.border },
          ]}
        />
        <View style={styles.unitRow}>
          {DOSE_UNITS.map((option) => {
            const active = option === newUnit;
            return (
              <Pressable
                key={option}
                accessibilityRole="button"
                onPress={() => {
                  setNewUnit(option);
                }}
                style={[
                  styles.unitChip,
                  {
                    backgroundColor: active ? theme.accent : theme.surface,
                    borderColor: theme.border,
                  },
                ]}
              >
                <Text style={{ color: active ? '#FFFFFF' : theme.text }}>{option}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <TextInput
        value={newNote}
        onChangeText={setNewNote}
        placeholder="Note (optional)"
        placeholderTextColor={theme.textMuted}
        style={[styles.input, { color: theme.text, borderColor: theme.border, marginBottom: 12 }]}
      />
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          handleLogDoseChange().catch(() => undefined);
        }}
        style={[styles.secondaryButton, { borderColor: theme.border }]}
      >
        <Text style={{ color: theme.text, fontWeight: '600' }}>Save dose change</Text>
      </Pressable>

      {doses.length > 0 ? (
        <View style={styles.doseLog}>
          {doses
            .slice()
            .reverse()
            .map((change) => (
              <Text
                key={`${change.date}-${String(change.dose.amount)}`}
                style={{ color: theme.textMuted }}
              >
                {change.date}: {change.dose.amount}
                {change.dose.unit}
                {change.note !== undefined ? ` — ${change.note}` : ''}
              </Text>
            ))}
        </View>
      ) : null}

      <Text style={[styles.section, { color: theme.text }]}>Reminders</Text>
      <Stepper
        label="Morning (hour, 24h)"
        value={profile.morningReminder.hour}
        min={0}
        max={23}
        step={1}
        onChange={(hour) => {
          handleReminderChange('morning', hour);
        }}
      />
      <Stepper
        label="Evening (hour, 24h)"
        value={profile.eveningReminder.hour}
        min={0}
        max={23}
        step={1}
        onChange={(hour) => {
          handleReminderChange('evening', hour);
        }}
      />

      <Text style={[styles.section, { color: theme.text }]}>Evening check-in</Text>
      <Text style={{ color: theme.textMuted, marginBottom: 12 }}>
        Choose which ratings show up in your evening check-in.
      </Text>
      {EVENING_METRICS.map((metric) => {
        if (metric.kind !== 'scale' || !isEveningRatingKey(metric.key)) return null;
        const key = metric.key;
        const enabledKeys = enabledEveningMetricKeys(profile);
        return (
          <Toggle
            key={key}
            label={metric.label}
            value={enabledKeys.includes(key)}
            onChange={(isEnabled) => {
              updateProfile({
                ...profile,
                enabledEveningMetrics: withEveningMetricToggled(enabledKeys, key, isEnabled),
              });
            }}
          />
        );
      })}

      <Text style={[styles.section, { color: theme.text }]}>Privacy</Text>
      <Toggle
        label="Require Face ID / passcode to open"
        value={profile.lockEnabled}
        onChange={(lockEnabled) => {
          updateProfile({ ...profile, lockEnabled });
        }}
      />

      <Text style={[styles.section, { color: theme.text }]}>Export</Text>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => {
          handleExportPdf().catch(() => undefined);
        }}
        style={[styles.secondaryButton, { borderColor: theme.border }]}
      >
        <Text style={{ color: theme.text, fontWeight: '600' }}>Export PDF report (30 days)</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => {
          handleExportJson().catch(() => undefined);
        }}
        style={[styles.secondaryButton, { borderColor: theme.border }]}
      >
        <Text style={{ color: theme.text, fontWeight: '600' }}>Export JSON backup</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => {
          handleImportJson().catch(() => undefined);
        }}
        style={[styles.secondaryButton, { borderColor: theme.border }]}
      >
        <Text style={{ color: theme.text, fontWeight: '600' }}>Import JSON backup</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 20,
  },
  section: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 24,
    marginBottom: 12,
  },
  body: {
    fontSize: 16,
    fontWeight: '600',
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  doseRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  amountInput: {
    flex: 1,
  },
  unitRow: {
    flexDirection: 'row',
    gap: 8,
  },
  unitChip: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  secondaryButton: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  doseLog: {
    marginTop: 12,
    gap: 4,
  },
});
