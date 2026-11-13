// Calendar dates in UTC as `YYYY-MM-DD` (D-012). Client-safe.
export function utcToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function addUtcDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
