import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Chips } from '../components/Chips';
import { ScaleSelector } from '../components/ScaleSelector';
import { Stepper } from '../components/Stepper';
import { Toggle } from '../components/Toggle';
import { EVENING_METRICS, MORNING_METRICS } from '../lib/schema';
import { isIsoDate, isoTimestampNow, loadEntries, saveCheckin, todayIsoDate } from '../lib/storage';
import { useTheme } from '../lib/theme';
import { assertNever } from '../lib/types';
import type {
  EveningCheckin,
  IsoDate,
  Metric,
  MorningCheckin,
  Rating,
  RatingKey,
  Session,
  SideEffect,
} from '../lib/types';

interface Draft {
  readonly doseTaken: boolean;
  readonly ratings: Readonly<Partial<Record<RatingKey, Rating>>>;
  readonly sleepHours: number | undefined;
  readonly sideEffects: readonly SideEffect[];
  readonly notes: string;
}

const EMPTY_DRAFT: Draft = {
  doseTaken: false,
  ratings: {},
  sleepHours: undefined,
  sideEffects: [],
  notes: '',
};

function draftFromMorning(checkin: MorningCheckin): Draft {
  return {
    doseTaken: checkin.doseTaken,
    ratings: { sleepQuality: checkin.sleepQuality, wakingMood: checkin.wakingMood },
    sleepHours: checkin.sleepHours,
    sideEffects: [],
    notes: '',
  };
}

function draftFromEvening(checkin: EveningCheckin): Draft {
  return {
    doseTaken: false,
    ratings: {
      mood: checkin.mood,
      focus: checkin.focus,
      impulsivity: checkin.impulsivity,
      anxiety: checkin.anxiety,
      energy: checkin.energy,
      appetite: checkin.appetite,
      libido: checkin.libido,
    },
    sleepHours: undefined,
    sideEffects: checkin.sideEffects,
    notes: checkin.notes ?? '',
  };
}

function isSession(value: string | undefined): value is Session {
  return value === 'morning' || value === 'evening';
}

export default function Checkin() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ session?: string; date?: string }>();
  const session: Session = isSession(params.session) ? params.session : 'morning';
  const date: IsoDate = isIsoDate(params.date) ? params.date : todayIsoDate();
  const metrics = session === 'morning' ? MORNING_METRICS : EVENING_METRICS;

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadEntries()
      .then((entries) => {
        const entry = entries[date];
        if (entry === undefined) return;
        if (session === 'morning' && entry.morning !== undefined) {
          setDraft(draftFromMorning(entry.morning));
        } else if (session === 'evening' && entry.evening !== undefined) {
          setDraft(draftFromEvening(entry.evening));
        }
      })
      .catch(() => undefined);
  }, [date, session]);

  const requiredKeys = metrics
    .filter((metric) => metric.kind === 'scale')
    .map((metric) => metric.key);
  const isComplete = requiredKeys.every((key) => draft.ratings[key] !== undefined);

  const handleSave = async (): Promise<void> => {
    if (session === 'morning') {
      const sleepQuality = draft.ratings.sleepQuality;
      const wakingMood = draft.ratings.wakingMood;
      if (sleepQuality === undefined || wakingMood === undefined) return;
      const checkin: MorningCheckin = {
        doseTaken: draft.doseTaken,
        sleepQuality,
        wakingMood,
        completedAt: isoTimestampNow(),
        ...(draft.sleepHours !== undefined ? { sleepHours: draft.sleepHours } : {}),
      };
      await saveCheckin(date, { session: 'morning', checkin });
    } else {
      const { mood, focus, impulsivity, anxiety, energy, appetite, libido } = draft.ratings;
      if (
        mood === undefined ||
        focus === undefined ||
        impulsivity === undefined ||
        anxiety === undefined ||
        energy === undefined ||
        appetite === undefined ||
        libido === undefined
      ) {
        return;
      }
      const trimmedNotes = draft.notes.trim();
      const checkin: EveningCheckin = {
        mood,
        focus,
        impulsivity,
        anxiety,
        energy,
        appetite,
        libido,
        sideEffects: draft.sideEffects,
        completedAt: isoTimestampNow(),
        ...(trimmedNotes !== '' ? { notes: trimmedNotes } : {}),
      };
      await saveCheckin(date, { session: 'evening', checkin });
    }
    router.back();
  };

  const renderMetric = (metric: Metric): ReactNode => {
    switch (metric.kind) {
      case 'toggle':
        return (
          <Toggle
            key={metric.key}
            label={metric.label}
            value={draft.doseTaken}
            onChange={(value) => {
              setDraft({ ...draft, doseTaken: value });
            }}
          />
        );
      case 'scale':
        return (
          <ScaleSelector
            key={metric.key}
            label={metric.label}
            low={metric.low}
            high={metric.high}
            direction={metric.direction}
            value={draft.ratings[metric.key]}
            onChange={(value) => {
              setDraft({ ...draft, ratings: { ...draft.ratings, [metric.key]: value } });
            }}
          />
        );
      case 'stepper':
        return (
          <Stepper
            key={metric.key}
            label={metric.label}
            value={draft.sleepHours}
            min={metric.min}
            max={metric.max}
            step={metric.step}
            onChange={(value) => {
              setDraft({ ...draft, sleepHours: value });
            }}
          />
        );
      case 'chips':
        return (
          <Chips
            key={metric.key}
            label={metric.label}
            options={metric.options}
            selected={draft.sideEffects}
            onChange={(next) => {
              setDraft({ ...draft, sideEffects: next });
            }}
          />
        );
      case 'text':
        return (
          <View key={metric.key} style={styles.textField}>
            <Text style={[styles.textLabel, { color: theme.text }]}>{metric.label}</Text>
            <TextInput
              value={draft.notes}
              onChangeText={(text) => {
                setDraft({ ...draft, notes: text });
              }}
              multiline
              placeholder="Optional"
              placeholderTextColor={theme.textMuted}
              style={[styles.textInput, { color: theme.text, borderColor: theme.border }]}
            />
          </View>
        );
      default:
        return assertNever(metric);
    }
  };

  return (
    <>
      <Stack.Screen
        options={{ title: session === 'morning' ? 'Morning check-in' : 'Evening check-in' }}
      />
      <ScrollView
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.content}
      >
        {metrics.map(renderMetric)}
        <Pressable
          accessibilityRole="button"
          disabled={!isComplete || saving}
          onPress={() => {
            setSaving(true);
            handleSave()
              .catch(() => undefined)
              .finally(() => {
                setSaving(false);
              });
          }}
          style={[
            styles.saveButton,
            { backgroundColor: isComplete && !saving ? theme.accent : theme.border },
          ]}
        >
          <Text style={styles.saveButtonText}>Save</Text>
        </Pressable>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
  },
  textField: {
    marginBottom: 20,
  },
  textLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 10,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  saveButton: {
    marginTop: 8,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
