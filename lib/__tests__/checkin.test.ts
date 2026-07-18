import { describe, expect, it } from 'vitest';
import {
  EMPTY_DRAFT,
  draftFromEvening,
  draftFromMorning,
  eveningRatingsFromDraft,
} from '../checkin';
import { isoTimestampNow } from '../storage';
import { EVENING_RATING_KEYS } from '../types';
import type { EveningCheckin, MorningCheckin, Rating, RatingKey } from '../types';

describe('eveningRatingsFromDraft', () => {
  it('carries every evening rating key through', () => {
    for (const key of EVENING_RATING_KEYS) {
      const ratings: Partial<Record<RatingKey, Rating>> = {};
      ratings[key] = 3;
      expect(eveningRatingsFromDraft(ratings)[key]).toBe(3);
    }
  });

  it('omits undefined keys and ignores morning-only keys', () => {
    const ratings: Partial<Record<RatingKey, Rating>> = { sleepQuality: 5, mood: 4 };
    const out = eveningRatingsFromDraft(ratings);
    expect(out).toEqual({ mood: 4 });
    expect(Object.keys(out)).toEqual(['mood']);
  });
});

describe('draft <-> checkin conversion', () => {
  it('round-trips every evening rating key (draft -> checkin -> draft)', () => {
    for (const key of EVENING_RATING_KEYS) {
      const ratings: Partial<Record<RatingKey, Rating>> = {};
      ratings[key] = 4;
      const checkin: EveningCheckin = {
        ...eveningRatingsFromDraft(ratings),
        sideEffects: [],
        completedAt: isoTimestampNow(),
      };
      expect(draftFromEvening(checkin).ratings[key]).toBe(4);
    }
  });

  it('draftFromEvening keeps side effects and notes', () => {
    const checkin: EveningCheckin = {
      mood: 3,
      sideEffects: ['nausea'] as const,
      notes: 'rough afternoon',
      completedAt: isoTimestampNow(),
    };
    const draft = draftFromEvening(checkin);
    expect(draft.sideEffects).toEqual(['nausea']);
    expect(draft.notes).toBe('rough afternoon');
    expect(draft.doseTaken).toBe(false);
  });

  it('draftFromMorning reads ratings, dose, and hours', () => {
    const checkin: MorningCheckin = {
      doseTaken: true,
      sleepQuality: 4,
      wakingMood: 2,
      sleepHours: 6,
      completedAt: isoTimestampNow(),
    };
    const draft = draftFromMorning(checkin);
    expect(draft.ratings.sleepQuality).toBe(4);
    expect(draft.ratings.wakingMood).toBe(2);
    expect(draft.doseTaken).toBe(true);
    expect(draft.sleepHours).toBe(6);
  });

  it('EMPTY_DRAFT starts with dose taken and no ratings', () => {
    expect(EMPTY_DRAFT.doseTaken).toBe(true);
    expect(EMPTY_DRAFT.ratings).toEqual({});
  });
});
