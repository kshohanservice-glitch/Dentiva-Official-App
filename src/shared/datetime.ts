/** Date/time helpers. Dates stored as ISO-8601 UTC strings or YYYY-MM-DD local dates. */

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function toDateOnly(iso: string): string {
  return iso.slice(0, 10);
}

export function addDays(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** Whether a YYYY-MM-DD date falls on one of the given weekday keys. */
export function weekdayOf(dateOnly: string): (typeof WEEKDAYS)[number] {
  const [y, m, d] = dateOnly.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** Compare two HH:MM times. */
export function compareHm(a: string, b: string): number {
  return a.localeCompare(b);
}

export function isValidDateOnly(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isValidTime(s: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(s)) return false;
  const [h, m] = s.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

/** Local midnight of today expressed as a UTC ISO string. */
export function localMidnightUtc(dateOnly: string): string {
  const [y, m, d] = dateOnly.split('-').map(Number);
  const local = new Date(y, m - 1, d, 0, 0, 0, 0);
  return local.toISOString();
}

/** Resolve a date-range preset to [startIso, endIso]. */
export function rangeForPreset(
  preset: 'today' | '7d' | '30d' | '90d' | '1y' | 'all' | 'custom',
  custom?: { from: string; to: string },
): { from: string; to: string } | null {
  const end = new Date();
  const endIso = end.toISOString();
  switch (preset) {
    case 'today':
      return { from: localMidnightUtc(todayLocal()), to: endIso };
    case '7d':
      return { from: isoDaysAgo(7), to: endIso };
    case '30d':
      return { from: isoDaysAgo(30), to: endIso };
    case '90d':
      return { from: isoDaysAgo(90), to: endIso };
    case '1y':
      return { from: isoDaysAgo(365), to: endIso };
    case 'all':
      return { from: '1970-01-01T00:00:00.000Z', to: endIso };
    case 'custom':
      if (!custom?.from || !custom?.to) return null;
      return { from: `${custom.from}T00:00:00.000Z`, to: `${custom.to}T23:59:59.999Z` };
  }
}
