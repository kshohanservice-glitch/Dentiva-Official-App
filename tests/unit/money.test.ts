import { describe, expect, it } from 'vitest';
import { formatBDT, formatPaisa, parseAmountToPaisa, percentOfPaisa, splitPaisa, sumPaisa } from '../../src/shared/money';

describe('money — fixed-point paisa arithmetic', () => {
  it('parses plain taka amounts', () => {
    expect(parseAmountToPaisa('100')).toBe(10000);
    expect(parseAmountToPaisa('0')).toBe(0);
    expect(parseAmountToPaisa('12345')).toBe(1234500);
  });

  it('parses decimal amounts exactly', () => {
    expect(parseAmountToPaisa('150.50')).toBe(15050);
    expect(parseAmountToPaisa('0.01')).toBe(1);
    expect(parseAmountToPaisa('0.1')).toBe(10);
    expect(parseAmountToPaisa('99999.99')).toBe(9999999);
  });

  it('accepts currency symbols, commas and spaces', () => {
    expect(parseAmountToPaisa('৳ 1,250.75')).toBe(125075);
    expect(parseAmountToPaisa('1,000')).toBe(100000);
  });

  it('rejects malformed input', () => {
    expect(parseAmountToPaisa('')).toBeNull();
    expect(parseAmountToPaisa('abc')).toBeNull();
    expect(parseAmountToPaisa('12.345')).toBeNull(); // more than 2 decimals
    expect(parseAmountToPaisa('--5')).toBeNull();
    expect(parseAmountToPaisa('1e5')).toBeNull();
  });

  it('never uses floating point drift', () => {
    // 0.1 + 0.2 style trap: 19.99 * 3 must equal 59.97 exactly
    const a = parseAmountToPaisa('19.99')!;
    expect(sumPaisa([a, a, a])).toBe(5997);
  });

  it('formats paisa with grouping and 2 decimals', () => {
    expect(formatPaisa(0)).toBe('0.00');
    expect(formatPaisa(1234567)).toBe('12,345.67');
    expect(formatPaisa(-50)).toBe('-0.50');
    expect(formatBDT(1234567)).toBe('৳ 12,345.67');
  });

  it('computes integer-safe percentages (half-up)', () => {
    expect(percentOfPaisa(10000, 10)).toBe(1000);
    expect(percentOfPaisa(10001, 10)).toBe(1000); // 1000.1 → rounds 1000
    expect(percentOfPaisa(10005, 10)).toBe(1001); // 1000.5 → 1001 half-up
    expect(percentOfPaisa(33333, 7.5)).toBe(2500);
  });

  it('splits amounts without losing remainder', () => {
    expect(splitPaisa(100, 3)).toEqual([34, 33, 33]);
    expect(sumPaisa(splitPaisa(10001, 7))).toBe(10001);
    expect(splitPaisa(10, 0)).toEqual([]);
  });

  it('invoice invariant: subtotal - discount + tax = grand total (integer math)', () => {
    const items = [parseAmountToPaisa('1250.00')!, parseAmountToPaisa('830.50')!, parseAmountToPaisa('99.99')!];
    const subtotal = sumPaisa(items);
    const discount = percentOfPaisa(subtotal, 5);
    const tax = 0;
    const grand = subtotal - discount + tax;
    expect(subtotal).toBe(218049);
    expect(discount).toBe(10902); // 10902.45 → 10902
    expect(grand).toBe(207147);
    expect(grand - 0).toBe(207147); // reconciliation sanity
  });
});
