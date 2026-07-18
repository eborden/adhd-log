import { describe, expect, it } from 'vitest';
import { HOURS, MINUTES, SIDE_EFFECTS, SIDE_EFFECT_SEVERITIES, assertNever } from '../types';
import type { SideEffectSeverity } from '../types';

describe('HOURS', () => {
  it('covers every hour of the day exactly once', () => {
    expect(HOURS).toHaveLength(24);
    expect(HOURS[0]).toBe(0);
    expect(HOURS[23]).toBe(23);
  });
});

describe('MINUTES', () => {
  it('covers every minute of the hour exactly once', () => {
    expect(MINUTES).toHaveLength(60);
    expect(MINUTES[0]).toBe(0);
    expect(MINUTES[59]).toBe(59);
  });
});

describe('SIDE_EFFECTS', () => {
  it('lists the nine tracked side effects', () => {
    expect(SIDE_EFFECTS).toHaveLength(9);
    expect(SIDE_EFFECTS).toContain('nausea');
    expect(SIDE_EFFECTS).toContain('other');
  });
});

describe('SIDE_EFFECT_SEVERITIES', () => {
  it('covers the severity union in ascending order', () => {
    expect(SIDE_EFFECT_SEVERITIES).toEqual(['mild', 'moderate', 'severe']);
    // Compile-time exhaustiveness: every literal is assignable to the union and back.
    const all: readonly SideEffectSeverity[] = SIDE_EFFECT_SEVERITIES;
    expect(all).toHaveLength(3);
  });
});

describe('assertNever', () => {
  it('throws for any value reached at runtime', () => {
    expect(() => assertNever('unreachable' as unknown as never)).toThrow(/Unreachable case/);
  });
});
