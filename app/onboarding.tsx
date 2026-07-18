import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
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
import { useTheme } from '../lib/theme';
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
      <Text style={[styles.title, { color: theme.text }]}>Let's set things up</Text>
      <Text style={[styles.subtitle, { color: theme.textMuted }]}>
        Everything stays on this device. This isn't medical advice — it's a log to bring to your
        provider.
      </Text>

      <Text style={[styles.label, { color: theme.text }]}>Medication name</Text>
      <TextInput
        value={medName}
        onChangeText={setMedName}
        placeholder="e.g. Atomoxetine"
        placeholderTextColor={theme.textMuted}
        style={[styles.input, { color: theme.text, borderColor: theme.border }]}
      />

      <Text style={[styles.label, { color: theme.text }]}>Current dose</Text>
      <View style={styles.doseRow}>
        <TextInput
          value={amountText}
          onChangeText={setAmountText}
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

      {error !== null ? <Text style={{ color: theme.bad, marginBottom: 12 }}>{error}</Text> : null}

      <Pressable
        accessibilityRole="button"
        disabled={!canSubmit}
        onPress={() => {
          handleSubmit().catch(() => {
            setError('Something went wrong saving your profile.');
          });
        }}
        style={[styles.submit, { backgroundColor: canSubmit ? theme.accent : theme.border }]}
      >
        <Text style={styles.submitText}>Get started</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 24,
    paddingTop: 64,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    marginBottom: 24,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 20,
  },
  doseRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
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
  submit: {
    marginTop: 12,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  submitText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
