/**
 * Monetary arithmetic for Dentiva Pro.
 *
 * All money is represented as INTEGER PAISA (1 BDT = 100 paisa) end-to-end.
 * Floating point is never used for monetary computation. Floating inputs from
 * the UI (e.g. "150.50") are parsed straight to paisa via string math.
 */

export type Paisa = number;

const PAISA_PER_TAKA = 100;

/** Parse a user-entered amount string/number into integer paisa. Returns null when invalid. */
export function parseAmountToPaisa(input: string | number): Paisa | null {
  let s = String(input).trim();
  if (s.length === 0) return null;
  s = s.replace(/,/g, '').replace(/\s/g, '').replace(/৳/g, '');
  let negative = false;
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, fracRaw = ''] = s.split('.');
  const frac = (fracRaw + '00').slice(0, 2);
  const paisa = parseInt(whole, 10) * PAISA_PER_TAKA + parseInt(frac, 10);
  if (!Number.isSafeInteger(paisa)) return null;
  return negative ? -paisa : paisa;
}

export function takaToPaisa(taka: number): Paisa {
  return parseAmountToPaisa(taka.toFixed(2)) ?? 0;
}

export function paisaToTakaNumber(p: Paisa): number {
  return p / PAISA_PER_TAKA;
}

/** Format paisa as display string, e.g. "12,345.50". */
export function formatPaisa(p: Paisa): string {
  const negative = p < 0;
  const abs = Math.abs(Math.round(p));
  const whole = Math.floor(abs / PAISA_PER_TAKA);
  const frac = abs % PAISA_PER_TAKA;
  const wholeStr = whole.toLocaleString('en-IN');
  return `${negative ? '-' : ''}${wholeStr}.${String(frac).padStart(2, '0')}`;
}

/** Format paisa as BDT display string with taka sign. */
export function formatBDT(p: Paisa): string {
  return `৳ ${formatPaisa(p)}`;
}

export function sumPaisa(values: Iterable<Paisa>): Paisa {
  let total = 0;
  for (const v of values) total += Math.round(v);
  return total;
}

/** Integer-safe percentage of an amount (rounds half up). */
export function percentOfPaisa(p: Paisa, percent: number): Paisa {
  const pct = Math.round(percent * 100);
  return Math.round((p * pct) / 10000);
}

/** Divide amount into n shares with no remainder lost (largest remainder method). */
export function splitPaisa(p: Paisa, parts: number): Paisa[] {
  if (parts <= 0) return [];
  const base = Math.floor(p / parts);
  let rem = p - base * parts;
  const out: Paisa[] = [];
  for (let i = 0; i < parts; i++) {
    out.push(base + (rem > 0 ? 1 : 0));
    if (rem > 0) rem--;
  }
  return out;
}
