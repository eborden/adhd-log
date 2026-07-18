import { describe, expect, it } from 'vitest';
import {
  EMPTY_DRAFT,
  draftFromEvening,
  draftFromMorning,
  parseDoseAmount,
  ratingsFromDraft,
} from '../checkin';
import { isoTimestampNow } from '../storage';
import { EVENING_RATING_KEYS, MORNING_RATING_KEYS } from '../types';
import type { EveningCheckin, MorningCheckin, Rating, RatingKey } from '../types';

describe('ratingsFromDraft', () => {
  it('carries every evening rating key through', () => {
    for (const key of EVENING_RATING_KEYS) {
      const ratings: Partial<Record<RatingKey, Rating>> = {};
      ratings[key] = 3;
      expect(ratingsFromDraft(EVENING_RATING_KEYS, ratings)[key]).toBe(3);
    }
  });

  it('omits undefined keys and ignores keys outside the given list', () => {
    const ratings: Partial<Record<RatingKey, Rating>> = { sleepQuality: 5, mood: 4 };
    const out = ratingsFromDraft(EVENING_RATING_KEYS, ratings);
    expect(out).toEqual({ mood: 4 });
    expect(Object.keys(out)).toEqual(['mood']);
  });

  it('carries every morning rating key through', () => {
    const ratings: Partial<Record<RatingKey, Rating>> = { sleepQuality: 5, wakingMood: 2 };
    expect(ratingsFromDraft(MORNING_RATING_KEYS, ratings)).toEqual({
      sleepQuality: 5,
      wakingMood: 2,
    });
  });
});

describe('draft <-> checkin conversion', () => {
  it('round-trips every evening rating key (draft -> checkin -> draft)', () => {
    for (const key of EVENING_RATING_KEYS) {
      const ratings: Partial<Record<RatingKey, Rating>> = {};
      ratings[key] = 4;
      const checkin: EveningCheckin = {
        ratings: ratingsFromDraft(EVENING_RATING_KEYS, ratings),
        sideEffects: [],
        completedAt: isoTimestampNow(),
      };
      expect(draftFromEvening(checkin).ratings[key]).toBe(4);
    }
  });

  it('draftFromEvening keeps side effects and notes', () => {
    const checkin: EveningCheckin = {
      ratings: { mood: 3 },
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
      ratings: { sleepQuality: 4, wakingMood: 2 },
      doseTaken: true,
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

describe('parseDoseAmount', () => {
  it('returns the number for a valid positive amount', () => {
    expect(parseDoseAmount('10')).toBe(10);
    expect(parseDoseAmount('2.5')).toBe(2.5);
  });

  it('rejects zero, negatives, blanks, and non-numeric input', () => {
    expect(parseDoseAmount('0')).toBeUndefined();
    expect(parseDoseAmount('-5')).toBeUndefined();
    expect(parseDoseAmount('')).toBeUndefined();
    expect(parseDoseAmount('abc')).toBeUndefined();
    expect(parseDoseAmount('x1')).toBeUndefined();
  });
});
