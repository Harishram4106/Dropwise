export const HALF_LIFE_DAYS = 730;
export const STALE_BELOW = 0.5;

const DAY_MS = 86_400_000;

// Month- or year-precision dates resolve to the first day of the period, so they read slightly older.
export function parseSourceDate(date: string): Date {
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(date);
  if (!match) throw new Error(`Invalid source_date "${date}" (expected YYYY, YYYY-MM or YYYY-MM-DD)`);
  const [, year, month = "01", day = "01"] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

export function freshnessScore(sourceDate: string, now = new Date(), halfLifeDays = HALF_LIFE_DAYS): number {
  const ageDays = Math.max(0, (now.getTime() - parseSourceDate(sourceDate).getTime()) / DAY_MS);
  return Math.round(0.5 ** (ageDays / halfLifeDays) * 100) / 100;
}

export function isNewer(a: string, b: string): boolean {
  return parseSourceDate(a).getTime() > parseSourceDate(b).getTime();
}

export function today(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
