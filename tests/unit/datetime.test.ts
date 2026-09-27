import { describe, expect, it } from 'vitest';
import { addDays, isValidDateOnly, isValidTime, rangeForPreset, todayLocal, weekdayOf } from '../../src/shared/datetime';

describe('datetime helpers', () => {
  it('todayLocal is YYYY-MM-DD', () => {
    expect(todayLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('validates dates strictly', () => {
    expect(isValidDateOnly('2026-02-28')).toBe(true);
    expect(isValidDateOnly('2026-02-30')).toBe(false);
    expect(isValidDateOnly('2026-13-01')).toBe(false);
    expect(isValidDateOnly('26-01-01')).toBe(false);
  });

  it('validates times strictly', () => {
    expect(isValidTime('09:30')).toBe(true);
    expect(isValidTime('23:59')).toBe(true);
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('9:3')).toBe(false);
  });

  it('adds days across month boundaries', () => {
    expect(addDays('2026-01-30', 3)).toBe('2026-02-02');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('computes weekdays', () => {
    // 2026-09-27 is a Sunday
    expect(weekdayOf('2026-09-27')).toBe('sun');
    expect(weekdayOf('2026-09-28')).toBe('mon');
  });

  it('range presets produce ISO bounds', () => {
    const r = rangeForPreset('7d')!;
    expect(new Date(r.from).getTime()).toBeLessThan(new Date(r.to).getTime());
    const days = (new Date(r.to).getTime() - new Date(r.from).getTime()) / 86400_000;
    expect(days).toBeCloseTo(7, 1);
    expect(rangeForPreset('all')!.from).toBe('1970-01-01T00:00:00.000Z');
    expect(rangeForPreset('custom')).toBeNull();
    const c = rangeForPreset('custom', { from: '2026-01-01', to: '2026-01-31' })!;
    expect(c.from).toBe('2026-01-01T00:00:00.000Z');
    expect(c.to).toBe('2026-01-31T23:59:59.999Z');
  });
});
