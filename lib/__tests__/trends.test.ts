import { describe, expect, it } from 'vitest';
import {
  defaultWindowForRange,
  dosePeriodBoundaries,
  recentWindowDates,
  rollingAverage,
} from '../trends';
import type { DoseChange, IsoDate, Rating } from '../types';

const D = (n: number): IsoDate => `2026-07-${String(n).padStart(2, '0')}` as IsoDate;

function doseChange(date: IsoDate): DoseChange {
  return { date, dose: { amount: 20, unit: 'mg' } };
}

describe('rollingAverage (no boundaries)', () => {
  it('averages all-present values over a window', () => {
    expect(rollingAverage([3, 4, 5] as readonly Rating[], 3)).toEqual([3, 3.5, 4]);
  });

  it('behaves as a growing prefix mean when window exceeds data length', () => {
    expect(rollingAverage([3, 4, 5] as readonly Rating[], 7)).toEqual([3, 3.5, 4]);
  });

  it('ignores gaps (undefined days)', () => {
    const values: readonly (Rating | undefined)[] = [5, undefined, 3];
    expect(rollingAverage(values, 3)).toEqual([5, 5, 4]);
  });

  it('returns null for a window with no logged values', () => {
    const values: readonly (Rating | undefined)[] = [undefined, undefined];
    expect(rollingAverage(values, 2)).toEqual([null, null]);
  });

  it('renders leading nulls before data arrives', () => {
    const values: readonly (Rating | undefined)[] = [undefined, 4];
    expect(rollingAverage(values, 2)).toEqual([null, 4]);
  });

  it('always returns output the same length as the input', () => {
    const inputs: readonly (readonly (Rating | undefined)[])[] = [
      [],
      [3],
      [3, undefined, 5, 2, undefined],
    ];
    for (const values of inputs) {
      expect(rollingAverage(values, 3)).toHaveLength(values.length);
    }
  });

  it('throws RangeError for window < 1', () => {
    expect(() => rollingAverage([], 0)).toThrow(RangeError);
  });
});

describe('rollingAverage (with boundaries — dose-period reset)', () => {
  it('truncates the trailing window at a mid-series boundary', () => {
    const values: readonly Rating[] = [2, 2, 2, 5, 5];
    const boundaries = [false, false, false, true, false];
    const result = rollingAverage(values, 5, boundaries);
    expect(result).toEqual([2, 2, 2, 5, 5]);
  });

  it('behaves identically to no boundaries when the boundary is at index 0', () => {
    const values: readonly Rating[] = [3, 4, 5];
    const boundaries = [true, false, false];
    expect(rollingAverage(values, 3, boundaries)).toEqual(rollingAverage(values, 3));
  });

  it('interacts correctly with undefined at a boundary column', () => {
    const values: readonly (Rating | undefined)[] = [undefined, 4];
    const boundaries = [false, true];
    expect(rollingAverage(values, 2, boundaries)).toEqual([null, 4]);
  });
});

describe('dosePeriodBoundaries', () => {
  it('marks exactly the interior dose-change date', () => {
    const dates = [D(1), D(2), D(3), D(4)];
    const doses = [doseChange(D(3))];
    expect(dosePeriodBoundaries(dates, doses)).toEqual([false, false, true, false]);
  });

  it('is all-false with no doses', () => {
    const dates = [D(1), D(2), D(3)];
    expect(dosePeriodBoundaries(dates, [])).toEqual([false, false, false]);
  });

  it('matches dates.length', () => {
    const dates = [D(1), D(2), D(3), D(4), D(5)];
    expect(dosePeriodBoundaries(dates, [])).toHaveLength(dates.length);
  });
});

describe('recentWindowDates', () => {
  it('returns the last `window` dates when there are no doses', () => {
    const dates = [D(1), D(2), D(3), D(4), D(5)];
    expect(recentWindowDates(dates, [], 3)).toEqual([D(3), D(4), D(5)]);
  });

  it('starts at the dose date when a change falls inside the window', () => {
    const dates = [D(1), D(2), D(3), D(4), D(5)];
    const doses = [doseChange(D(4))];
    expect(recentWindowDates(dates, doses, 3)).toEqual([D(4), D(5)]);
  });

  it('is unaffected by a dose change outside the window', () => {
    const dates = [D(1), D(2), D(3), D(4), D(5)];
    const doses = [doseChange(D(1))];
    expect(recentWindowDates(dates, doses, 3)).toEqual([D(3), D(4), D(5)]);
  });

  it('throws RangeError for window < 1', () => {
    expect(() => recentWindowDates([], [], 0)).toThrow(RangeError);
  });
});

describe('defaultWindowForRange', () => {
  it('picks 3 for a 7-day range', () => {
    expect(defaultWindowForRange(7)).toBe(3);
  });

  it('picks 7 for a 14-day range', () => {
    expect(defaultWindowForRange(14)).toBe(7);
  });

  it('picks 7 for a 30-day range', () => {
    expect(defaultWindowForRange(30)).toBe(7);
  });
});
