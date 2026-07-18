import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '../components/Button';
import { Stepper } from '../components/Stepper';
import { Toggle } from '../components/Toggle';
import { requestNotificationPermissions, scheduleReminders } from '../lib/notifications';
import {
  addDays,
  isHour,
  isMedName,
  isoTimestampNow,
  saveProfile,
  todayIsoDate,
} from '../lib/storage';
import { radius, space, typography, useTheme } from '../lib/theme';
import type { DoseUnit, Profile } from '../lib/types';

const DOSE_UNITS: readonly DoseUnit[] = ['mg', 'mcg', 'mL'];

export default function Onboarding() {
  const theme = useTheme();
  const [medName, setMedName] = useState('');
  const [amountText, setAmountText] = useState('');
  const [unit, setUnit] = useState<DoseUnit>('mg');
  const [daysAgo, setDaysAgo] = useState(0);
  const [morningHour, setMorningHour] = useState(8);
  const [eveningHour, setEveningHour] = useState(20);
  const [lockEnabled, setLockEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const amount = Number(amountText);
  const canSubmit = isMedName(medName.trim()) && Number.isFinite(amount) && amount > 0;

  const handleSubmit = async (): Promise<void> => {
    const trimmedName = medName.trim();
    if (!isMedName(trimmedName) || !Number.isFinite(amount) || amount <= 0) {
      setError('Enter a medication name and a dose amount above 0.');
      return;
    }
    if (!isHour(morningHour) || !isHour(eveningHour)) {
      setError('Reminder hours must be between 0 and 23.');
      return;
    }
    setError(null);

    const profile: Profile = {
      medName: trimmedName,
      startDate: addDays(todayIsoDate(), -daysAgo),
      currentDose: { amount, unit },
      morningReminder: { hour: morningHour, minute: 0 },
      eveningReminder: { hour: eveningHour, minute: 0 },
      lockEnabled,
      createdAt: isoTimestampNow(),
    };

    await saveProfile(profile);
    const granted = await requestNotificationPermissions();
    if (granted) {
      await scheduleReminders(profile);
    }
    router.replace('/(tabs)');
  };

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
    >
      <Text style={[typography.title, styles.title, { color: theme.text }]}>
        Let's set things up
      </Text>
      <Text style={[typography.caption, styles.subtitle, { color: theme.textMuted }]}>
        Everything stays on this device. This isn't medical advice — it's a log to bring to your
        provider.
      </Text>

      <Text style={[typography.bodyStrong, styles.label, { color: theme.text }]}>
        Medication name
      </Text>
      <TextInput
        value={medName}
        onChangeText={setMedName}
        placeholder="e.g. Atomoxetine"
        placeholderTextColor={theme.textMuted}
        style={[
          typography.body,
          styles.input,
          { color: theme.text, backgroundColor: theme.surfaceMuted },
        ]}
      />

      <Text style={[typography.bodyStrong, styles.label, { color: theme.text }]}>Current dose</Text>
      <View style={styles.doseRow}>
        <TextInput
          value={amountText}
          onChangeText={setAmountText}
          placeholder="Amount"
          placeholderTextColor={theme.textMuted}
          keyboardType="decimal-pad"
          style={[
            typography.body,
            styles.input,
            styles.amountInput,
            { color: theme.text, backgroundColor: theme.surfaceMuted },
          ]}
        />
        <View style={styles.unitRow}>
          {DOSE_UNITS.map((option) => {
            const active = option === unit;
            return (
              <Pressable
                key={option}
                accessibilityRole="button"
                onPress={() => {
                  setUnit(option);
                }}
                style={[
                  styles.unitChip,
                  { backgroundColor: active ? theme.accentSoft : theme.surfaceMuted },
                ]}
              >
                <Text style={[typography.body, { color: active ? theme.accent : theme.text }]}>
                  {option}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Stepper
        label="Days since starting (0 = today)"
        value={daysAgo}
        min={0}
        max={90}
        step={1}
        onChange={setDaysAgo}
      />
      <Stepper
        label="Morning reminder (hour, 24h)"
        value={morningHour}
        min={0}
        max={23}
        step={1}
        onChange={setMorningHour}
      />
      <Stepper
        label="Evening reminder (hour, 24h)"
        value={eveningHour}
        min={0}
        max={23}
        step={1}
        onChange={setEveningHour}
      />
      <Toggle
        label="Require Face ID / passcode to open"
        value={lockEnabled}
        onChange={setLockEnabled}
      />

      {error !== null ? (
        <Text style={[typography.body, styles.error, { color: theme.bad }]}>{error}</Text>
      ) : null}

      <Button
        label="Get started"
        disabled={!canSubmit}
        style={styles.submit}
        onPress={() => {
          handleSubmit().catch(() => {
            setError('Something went wrong saving your profile.');
          });
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: space.xxl,
    paddingTop: 64,
  },
  title: {
    marginBottom: space.sm,
  },
  subtitle: {
    marginBottom: space.xxl,
  },
  label: {
    marginBottom: space.sm,
  },
  input: {
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    marginBottom: space.xl,
  },
  doseRow: {
    flexDirection: 'row',
    gap: space.md,
    alignItems: 'flex-start',
  },
  amountInput: {
    flex: 1,
  },
  unitRow: {
    flexDirection: 'row',
    gap: space.sm,
  },
  unitChip: {
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    marginBottom: space.md,
  },
  submit: {
    marginTop: space.md,
  },
});
