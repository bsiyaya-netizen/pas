/** Helpers for ISO calendar dates (YYYY-MM-DD), computed in UTC so time zones never shift a day. */

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

/** Same calendar day n years later; 29 February rolls to 1 March in a non-leap year. */
export function addYears(iso: string, years: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return isoDate(d);
}
