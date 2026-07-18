import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Chips } from '../components/Chips';
import { ScaleSelector } from '../components/ScaleSelector';
import { Stepper } from '../components/Stepper';
import { Toggle } from '../components/Toggle';
import { EVENING_METRICS, MORNING_METRICS, enabledEveningMetricKeys } from '../lib/schema';
import {
  isEveningRatingKey,
  isIsoDate,
  isoTimestampNow,
  loadEntries,
  loadProfile,
  saveCheckin,
  todayIsoDate,
} from '../lib/storage';
import { useTheme } from '../lib/theme';
import { assertNever } from '../lib/types';
import type {
  EveningCheckin,
  IsoDate,
  Metric,
  MorningCheckin,
  Profile,
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

// A typical night, not the stepper's floor — starting at 0 meant a normal
// 7-8 hour night took a dozen-plus taps to reach.
const DEFAULT_SLEEP_HOURS = 7;

const EMPTY_DRAFT: Draft = {
  doseTaken: false,
  ratings: {},
  sleepHours: DEFAULT_SLEEP_HOURS,
  sideEffects: [],
  notes: '',
};

function draftFromMorning(checkin: MorningCheckin): Draft {
  return {
    doseTaken: checkin.doseTaken,
    ratings: { sleepQuality: checkin.sleepQuality, wakingMood: checkin.wakingMood },
    sleepHours: checkin.sleepHours ?? DEFAULT_SLEEP_HOURS,
    sideEffects: [],
    notes: '',
  };
}

function draftFromEvening(checkin: EveningCheckin): Draft {
  return {
    doseTaken: false,
    ratings: {
      ...(checkin.mood !== undefined ? { mood: checkin.mood } : {}),
      ...(checkin.focus !== undefined ? { focus: checkin.focus } : {}),
      ...(checkin.impulsivity !== undefined ? { impulsivity: checkin.impulsivity } : {}),
      ...(checkin.anxiety !== undefined ? { anxiety: checkin.anxiety } : {}),
      ...(checkin.energy !== undefined ? { energy: checkin.energy } : {}),
      ...(checkin.appetite !== undefined ? { appetite: checkin.appetite } : {}),
      ...(checkin.libido !== undefined ? { libido: checkin.libido } : {}),
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

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);

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

  useEffect(() => {
    loadProfile()
      .then(setProfile)
      .catch(() => undefined);
  }, []);

  const enabledKeys = enabledEveningMetricKeys(profile);
  const metrics =
    session === 'morning'
      ? MORNING_METRICS
      : EVENING_METRICS.filter(
          (metric) =>
            metric.kind !== 'scale' ||
            !isEveningRatingKey(metric.key) ||
            enabledKeys.includes(metric.key),
        );

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
      if (!isComplete) return;
      const trimmedNotes = draft.notes.trim();
      const checkin: EveningCheckin = {
        sideEffects: draft.sideEffects,
        completedAt: isoTimestampNow(),
        ...(draft.ratings.mood !== undefined ? { mood: draft.ratings.mood } : {}),
        ...(draft.ratings.focus !== undefined ? { focus: draft.ratings.focus } : {}),
        ...(draft.ratings.impulsivity !== undefined
          ? { impulsivity: draft.ratings.impulsivity }
          : {}),
        ...(draft.ratings.anxiety !== undefined ? { anxiety: draft.ratings.anxiety } : {}),
        ...(draft.ratings.energy !== undefined ? { energy: draft.ratings.energy } : {}),
        ...(draft.ratings.appetite !== undefined ? { appetite: draft.ratings.appetite } : {}),
        ...(draft.ratings.libido !== undefined ? { libido: draft.ratings.libido } : {}),
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
