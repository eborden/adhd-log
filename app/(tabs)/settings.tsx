import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DoseInput } from '../../components/DoseInput';
import { Stepper } from '../../components/Stepper';
import { Toggle } from '../../components/Toggle';
import { useFocusLoad } from '../../hooks/useFocusLoad';
import { buildBackup } from '../../lib/backup';
import { parseDoseAmount } from '../../lib/checkin';
import { exportJsonBackup, exportPdfReport, importJsonBackup } from '../../lib/export';
import { DEFAULT_REPORT_OPTIONS, buildReportHtml } from '../../lib/report-html';
import { formatDose } from '../../lib/report-metrics';
import { requestNotificationPermissions, scheduleReminders } from '../../lib/notifications';
import {
  EVENING_METRICS,
  enabledEveningMetricKeys,
  withEveningMetricToggled,
} from '../../lib/schema';
import {
  appendDoseChange,
  datesInRange,
  isEveningRatingKey,
  isHour,
  loadDoseChanges,
  loadEntries,
  loadProfile,
  loadWeekly,
  loggedDateRange,
  restoreBackup,
  saveProfile,
  todayIsoDate,
} from '../../lib/storage';
import { radius, space, typography, useTheme } from '../../lib/theme';
import type {
  DayEntry,
  DoseChange,
  DoseUnit,
  IsoDate,
  Profile,
  WeeklyCheckin,
} from '../../lib/types';

interface SettingsData {
  readonly profile: Profile | null;
  readonly doses: readonly DoseChange[];
  readonly entries: Readonly<Record<IsoDate, DayEntry>>;
  readonly weekly: Readonly<Record<IsoDate, WeeklyCheckin>>;
}

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
  const { data, setData, refresh } = useFocusLoad<SettingsData>(
    async () => {
      const [loadedProfile, loadedDoses, loadedEntries, loadedWeekly] = await Promise.all([
        loadProfile(),
        loadDoseChanges(),
        loadEntries(),
        loadWeekly(),
      ]);
      return {
        profile: loadedProfile,
        doses: loadedDoses,
        entries: loadedEntries,
        weekly: loadedWeekly,
      };
    },
    { profile: null, doses: [], entries: {}, weekly: {} },
  );
  const { profile, doses, entries, weekly } = data;
  const [newAmount, setNewAmount] = useState('');
  const [newUnit, setNewUnit] = useState<DoseUnit>('mg');
  const [newNote, setNewNote] = useState('');
  const [includeNotes, setIncludeNotes] = useState(true);
  const [busy, setBusy] = useState(false);

  if (profile === null) {
    return <View style={[styles.container, { backgroundColor: theme.background }]} />;
  }
  const currentProfile = profile;

  // The PDF window auto-fits to logged data; surface the resulting span on the button.
  const reportSpan = loggedDateRange(entries);
  const reportDayCount = reportSpan ? datesInRange(reportSpan.start, reportSpan.end).length : 0;

  const updateProfile = (next: Profile): void => {
    setData((s) => ({ ...s, profile: next }));
    saveProfile(next).catch(() => undefined);
  };

  const handleLogDoseChange = async (): Promise<void> => {
    const amount = parseDoseAmount(newAmount);
    if (amount === undefined) {
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
    setData((s) => ({ ...s, doses: nextDoses }));
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

  // Minute fixed at 30, distinct from the daily reminders' fixed :00 minute, so the weekly
  // trigger can never collide with either daily one even if the hours match.
  const applyWeeklyReminder = (next: Profile): void => {
    updateProfile(next);
    requestNotificationPermissions()
      .then((granted) => (granted ? scheduleReminders(next) : Promise.resolve()))
      .catch(() => undefined);
  };

  const handleWeeklyReminderToggle = (enabled: boolean): void => {
    const { weeklyReminder, ...withoutWeeklyReminder } = currentProfile;
    void weeklyReminder;
    applyWeeklyReminder(
      enabled
        ? { ...withoutWeeklyReminder, weeklyReminder: { hour: 9, minute: 30 } }
        : withoutWeeklyReminder,
    );
  };

  const handleWeeklyReminderHourChange = (hour: number): void => {
    if (!isHour(hour)) return;
    applyWeeklyReminder({ ...currentProfile, weeklyReminder: { hour, minute: 30 } });
  };

  const handleExportPdf = async (): Promise<void> => {
    setBusy(true);
    try {
      const today = todayIsoDate();
      // Auto-fit the window to the logged data (earliest → most recent check-in) so the report
      // covers exactly the titration so far — no empty scaffold when short, no cut-off when long.
      const span = loggedDateRange(entries);
      const rangeStart = span?.start ?? today;
      const rangeEnd = span?.end ?? today;
      const html = buildReportHtml(currentProfile, doses, entries, weekly, rangeStart, rangeEnd, {
        ...DEFAULT_REPORT_OPTIONS,
        includeNotes,
      });
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
      const [entries, currentDoses, currentWeekly] = await Promise.all([
        loadEntries(),
        loadDoseChanges(),
        loadWeekly(),
      ]);
      const backup = buildBackup(currentProfile, currentDoses, entries, currentWeekly);
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
          Current dose: {formatDose(currentProfile.currentDose)} · started{' '}
          {currentProfile.startDate}
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
                  {change.date}: {formatDose(change.dose)}
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
        <Toggle
          label="Weekly check-in reminder (Monday)"
          value={currentProfile.weeklyReminder !== undefined}
          onChange={handleWeeklyReminderToggle}
        />
        {currentProfile.weeklyReminder !== undefined ? (
          <Stepper
            label="Weekly (hour, 24h)"
            value={currentProfile.weeklyReminder.hour}
            min={0}
            max={23}
            step={1}
            onChange={handleWeeklyReminderHourChange}
          />
        ) : null}
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
        <Toggle label="Include notes in PDF" value={includeNotes} onChange={setIncludeNotes} />
        <Button
          label={
            reportSpan
              ? `Export PDF report (${reportDayCount.toString()} days)`
              : 'Export PDF report'
          }
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
