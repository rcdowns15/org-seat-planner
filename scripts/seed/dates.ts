// Calendar-date helpers on ISO strings (YYYY-MM-DD), all in UTC. No clock access.
const MS_PER_DAY = 86_400_000;

export function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / MS_PER_DAY;
}

export function fromDayNumber(n: number): string {
  return new Date(n * MS_PER_DAY).toISOString().slice(0, 10);
}

// ISO date to the Workday-style MM/DD/YYYY.
export function toUsDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

export function fromUsDate(us: string): string {
  const [m, d, y] = us.split("/");
  return `${y}-${m}-${d}`;
}
