/** YYYY-MM-DD for the Asia/Hong_Kong calendar date of instant `d`. */
export function formatDateHKYmd(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * JS weekday 0=Sun … 6=Sat for the Hong Kong calendar day of `d`.
 * Do not use `Date#getDay()` on server-local time — it drifts from HKT on non-HK hosts.
 */
export function getHKTJsWeekday(d: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Hong_Kong',
    weekday: 'short',
  }).formatToParts(d);
  const w = parts.find((p) => p.type === 'weekday')?.value;
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return w !== undefined && w in map ? map[w] : d.getDay();
}

/** Add `delta` Gregorian days to `ymd` (YYYY-MM-DD). Month/year roll correctly. */
export function addCalendarDaysHKT(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + delta));
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
}

/**
 * "Today" as a stable instant for HK calendar math: noon HKT on today's HK date.
 * Avoids `new Date(toLocaleString(...))` which parses in the host timezone and breaks getDay().
 */
export function getHKTToday(): Date {
  const ymd = formatDateHKYmd(new Date());
  return new Date(`${ymd}T12:00:00+08:00`);
}
