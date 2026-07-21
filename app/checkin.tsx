import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Button } from '../components/Button';
import { Chips } from '../components/Chips';
import { ScaleSelector } from '../components/ScaleSelector';
import { Stepper } from '../components/Stepper';
import { Toggle } from '../components/Toggle';
import {
  EMPTY_DRAFT,
  draftFromEvening,
  draftFromMorning,
  eveningFromDraft,
  morningFromDraft,
  type Draft,
} from '../lib/checkin';
import { EVENING_METRICS, MORNING_METRICS, enabledEveningMetricKeys } from '../lib/schema';
import {
  isEveningRatingKey,
  isIsoDate,
  isSession,
  isoTimestampNow,
  loadEntries,
  loadProfile,
  saveCheckin,
  todayIsoDate,
} from '../lib/storage';
import { radius, space, typography, useTheme } from '../lib/theme';
import { assertNever } from '../lib/types';
import type { IsoDate, Metric, Profile, Session } from '../lib/types';

export default function Checkin() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ session?: string; date?: string }>();
  const session: Session = isSession(params.session) ? params.session : 'morning';
  const date: IsoDate = isIsoDate(params.date) ? params.date : todayIsoDate();

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const insets = useSafeAreaInsets();
  // The check-in screen has a navigation header; KeyboardAvoidingView needs its
  // height as an offset or it under-adjusts and the keyboard covers lower fields.
  const headerOffset = insets.top + (Platform.OS === 'ios' ? 44 : 56);

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
    if (!isComplete) return;
    const completedAt = isoTimestampNow();
    if (session === 'morning') {
      await saveCheckin(date, {
        session: 'morning',
        checkin: morningFromDraft(draft, completedAt),
      });
    } else {
      await saveCheckin(date, {
        session: 'evening',
        checkin: eveningFromDraft(draft, completedAt),
      });
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
      case 'text': {
        const showNotes = notesExpanded || draft.notes !== '';
        if (!showNotes) {
          return (
            <Pressable
              key={metric.key}
              accessibilityRole="button"
              onPress={() => {
                setNotesExpanded(true);
              }}
              style={styles.addNotes}
            >
              <Ionicons name="add" size={20} color={theme.accent} />
              <Text style={[typography.bodyStrong, { color: theme.accent }]}>Add notes</Text>
            </Pressable>
          );
        }
        return (
          <View key={metric.key} style={styles.textField}>
            <Text style={[typography.bodyStrong, styles.textLabel, { color: theme.text }]}>
              {metric.label}
            </Text>
            <TextInput
              value={draft.notes}
              onChangeText={(text) => {
                setDraft({ ...draft, notes: text });
              }}
              multiline
              autoFocus={notesExpanded}
              placeholder="Optional"
              placeholderTextColor={theme.textMuted}
              style={[
                typography.body,
                styles.textInput,
                { color: theme.text, backgroundColor: theme.surfaceMuted },
              ]}
            />
          </View>
        );
      }
      default:
        return assertNever(metric);
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <View style={styles.headerTitle}>
              <Ionicons
                name={session === 'morning' ? 'sunny-outline' : 'moon-outline'}
                size={18}
                color={theme.accent}
              />
              <Text style={[typography.cardTitle, { color: theme.text }]}>
                {session === 'morning' ? 'Morning check-in' : 'Evening check-in'}
              </Text>
            </View>
          ),
        }}
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={headerOffset}
      >
        <ScrollView
          style={{ backgroundColor: theme.background }}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {metrics.map(renderMetric)}
          <Button
            label="Save"
            disabled={!isComplete || saving}
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
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  headerTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  content: {
    padding: space.xl,
    paddingBottom: space.xxxl,
  },
  textField: {
    marginBottom: space.xl,
  },
  addNotes: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingVertical: space.sm,
    marginBottom: space.xl,
  },
  textLabel: {
    marginBottom: space.md,
  },
  textInput: {
    borderRadius: radius.sm,
    padding: space.md,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  saveButton: {
    marginTop: space.sm,
  },
});
