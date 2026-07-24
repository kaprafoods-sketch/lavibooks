/**
 * NYSE trading-calendar awareness. Regular hours 09:30–16:00 America/New_York.
 * Orders placed outside RTH (or on holidays/weekends) queue to the next open.
 *
 * Holidays are a maintained static table — update yearly. Early-close (half)
 * days end at 13:00 ET.
 */

// Full-day closures (YYYY-MM-DD, observed). Extend yearly.
const HOLIDAYS_2025_2026 = new Set<string>([
  "2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26",
  "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
]);

// Early-close days (close 13:00 ET).
const HALF_DAYS = new Set<string>([
  "2025-07-03", "2025-11-28", "2025-12-24",
  "2026-11-27", "2026-12-24",
]);

/** Parts of a Date expressed in America/New_York. */
function nyParts(d: Date): { ymd: string; minutes: number; dow: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const ymd = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = parts.hour === "24" ? 0 : Number(parts.hour);
  const minutes = hour * 60 + Number(parts.minute);
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { ymd, minutes, dow: dowMap[parts.weekday] ?? 0 };
}

const OPEN_MIN = 9 * 60 + 30; // 09:30
const CLOSE_MIN = 16 * 60; // 16:00
const HALF_CLOSE_MIN = 13 * 60; // 13:00

export function isTradingDay(d: Date): boolean {
  const { ymd, dow } = nyParts(d);
  if (dow === 0 || dow === 6) return false;
  if (HOLIDAYS_2025_2026.has(ymd)) return false;
  return true;
}

export function isMarketOpen(d: Date): boolean {
  if (!isTradingDay(d)) return false;
  const { ymd, minutes } = nyParts(d);
  const close = HALF_DAYS.has(ymd) ? HALF_CLOSE_MIN : CLOSE_MIN;
  return minutes >= OPEN_MIN && minutes < close;
}

/**
 * Whether an order placed at `d` should queue for the next open (i.e. market
 * is currently closed).
 */
export function shouldQueueForOpen(d: Date): boolean {
  return !isMarketOpen(d);
}
