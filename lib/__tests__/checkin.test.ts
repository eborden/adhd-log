import { describe, expect, it } from 'vitest';
import {
  EMPTY_DRAFT,
  draftFromEvening,
  draftFromMorning,
  eveningFromDraft,
  morningFromDraft,
  parseDoseAmount,
  ratingsFromDraft,
  type Draft,
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

  it('round-trips a morning draft (draft -> checkin -> draft)', () => {
    const ts = isoTimestampNow();
    const draft: Draft = {
      ...EMPTY_DRAFT,
      doseTaken: false,
      sleepHours: 6,
      ratings: { sleepQuality: 4, wakingMood: 2 },
    };
    const checkin = morningFromDraft(draft, ts);
    expect(checkin.completedAt).toBe(ts);
    expect(checkin.doseTaken).toBe(false);
    expect(checkin.sleepHours).toBe(6);
    const back = draftFromMorning(checkin);
    expect(back.ratings.sleepQuality).toBe(4);
    expect(back.ratings.wakingMood).toBe(2);
    expect(back.doseTaken).toBe(false);
    expect(back.sleepHours).toBe(6);
  });

  it('round-trips an evening draft, trimming and keeping notes/side effects', () => {
    const ts = isoTimestampNow();
    const draft: Draft = {
      ...EMPTY_DRAFT,
      sideEffects: ['nausea'],
      notes: '  rough afternoon  ',
      ratings: { mood: 3 },
    };
    const checkin = eveningFromDraft(draft, ts);
    expect(checkin.completedAt).toBe(ts);
    expect(checkin.notes).toBe('rough afternoon');
    expect(checkin.sideEffects).toEqual(['nausea']);
    const back = draftFromEvening(checkin);
    expect(back.ratings.mood).toBe(3);
    expect(back.notes).toBe('rough afternoon');
  });

  it('omits sleepHours (morning) and notes (evening) when empty/undefined', () => {
    const ts = isoTimestampNow();
    const morning = morningFromDraft({ ...EMPTY_DRAFT, sleepHours: undefined }, ts);
    expect('sleepHours' in morning).toBe(false);
    const evening = eveningFromDraft({ ...EMPTY_DRAFT, notes: '   ' }, ts);
    expect('notes' in evening).toBe(false);
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
