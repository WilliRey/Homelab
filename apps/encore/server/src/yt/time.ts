// Turn YouTube's relative dates ("3 days ago", "2y ago", "Streamed 1 week ago") into
// approximate epoch ms. Used when that's all we have (search results, channel pages).
const UNIT_MS: Record<string, number> = {
  s: 1000, sec: 1000, second: 1000,
  m: 60_000, min: 60_000, minute: 60_000,
  h: 3_600_000, hr: 3_600_000, hour: 3_600_000,
  d: 86_400_000, day: 86_400_000,
  w: 7 * 86_400_000, wk: 7 * 86_400_000, week: 7 * 86_400_000,
  mo: 30 * 86_400_000, month: 30 * 86_400_000,
  y: 365 * 86_400_000, yr: 365 * 86_400_000, year: 365 * 86_400_000,
};

export function parseRelativeTime(text: string | undefined, now = Date.now()): number | undefined {
  if (!text) return undefined;
  const m = /(\d+)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|wks?|w|months?|mo|years?|yrs?|y)\b\s*ago/i.exec(text);
  if (!m) return undefined;
  let unit = m[2]!.toLowerCase();
  if (unit !== 's' && unit.endsWith('s') && unit.length > 2) unit = unit.slice(0, -1);
  const ms = UNIT_MS[unit];
  return ms === undefined ? undefined : now - Number(m[1]) * ms;
}

/** "3:51" / "1:02:03" → seconds. */
export function parseClock(text: string | undefined): number | undefined {
  if (!text || !/^\d+(:\d{1,2}){1,2}$/.test(text.trim())) return undefined;
  return text.trim().split(':').reduce((acc, p) => acc * 60 + Number(p), 0);
}
