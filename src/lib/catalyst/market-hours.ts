/**
 * Market Hours Utility
 *
 * Provides functions to check if Indian stock markets (NSE/BSE) are open.
 * Used by Catalyst Catcher to adjust behavior during market close.
 */

// NSE/BSE trading hours in IST
const MARKET_OPEN_HOUR = 9;
const MARKET_OPEN_MINUTE = 15;
const MARKET_CLOSE_HOUR = 15;
const MARKET_CLOSE_MINUTE = 30;
const POST_CLOSE_END_HOUR = 20;
const PRE_OPEN_START_HOUR = 8;
const IST_OFFSET_MINUTES = 330;
const IST_OFFSET_MS = IST_OFFSET_MINUTES * 60 * 1000;

export type MarketMode = "OPEN" | "POST_CLOSE" | "OVERNIGHT" | "PRE_OPEN";

// NSE holidays for 2026 (extend this list as needed)
// Source: NSE website - https://www.nseindia.com/
const NSE_HOLIDAYS_2026: string[] = [
  "2026-01-26", // Republic Day
  "2026-03-17", // Holi
  "2026-04-06", // Ram Navami
  "2026-04-10", // Good Friday
  "2026-04-14", // Dr. Ambedkar Jayanti
  "2026-04-21", // Mahavir Jayanti
  "2026-05-01", // May Day
  "2026-07-17", // Muharram
  "2026-08-15", // Independence Day
  "2026-08-26", // Janmashtami
  "2026-09-25", // Milad un-Nabi
  "2026-10-02", // Gandhi Jayanti
  "2026-10-20", // Dussehra
  "2026-10-21", // Dussehra (cont.)
  "2026-11-09", // Diwali (Laxmi Puja)
  "2026-11-10", // Diwali Balipratipada
  "2026-11-27", // Guru Nanak Jayanti
  "2026-12-25", // Christmas
];

/**
 * Check if a given date is a trading holiday.
 */
function isHoliday(date: Date): boolean {
  const dateStr = date.toISOString().split("T")[0];
  return NSE_HOLIDAYS_2026.includes(dateStr);
}

function getIstDateParts(date: Date) {
  const istDate = new Date(date.getTime() + IST_OFFSET_MS);
  const istHour = istDate.getUTCHours();
  const istMinute = istDate.getUTCMinutes();
  const currentTimeMinutes = istHour * 60 + istMinute;

  return { istDate, istHour, istMinute, currentTimeMinutes };
}

/**
 * Check if the Indian stock market (NSE/BSE) is currently open.
 *
 * Market hours: 9:15 AM - 3:30 PM IST, Monday to Friday
 * Excludes national holidays.
 *
 * @param now - Optional date to check (defaults to current time)
 * @returns true if market is open, false otherwise
 */
export function isIndianMarketOpen(now?: Date): boolean {
  const date = now || new Date();
  const { istDate, currentTimeMinutes } = getIstDateParts(date);
  const dayOfWeek = istDate.getUTCDay();

  // Weekend check
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return false;
  }

  // Holiday check
  if (isHoliday(istDate)) {
    return false;
  }

  // Time check
  const openTimeMinutes = MARKET_OPEN_HOUR * 60 + MARKET_OPEN_MINUTE;
  const closeTimeMinutes = MARKET_CLOSE_HOUR * 60 + MARKET_CLOSE_MINUTE;

  return (
    currentTimeMinutes >= openTimeMinutes &&
    currentTimeMinutes < closeTimeMinutes
  );
}

/**
 * Returns the current market mode for Catalyst Catcher orchestration.
 */
export function getMarketMode(now?: Date): MarketMode {
  const date = now || new Date();
  const { istDate, currentTimeMinutes } = getIstDateParts(date);
  const openTimeMinutes = MARKET_OPEN_HOUR * 60 + MARKET_OPEN_MINUTE;
  const closeTimeMinutes = MARKET_CLOSE_HOUR * 60 + MARKET_CLOSE_MINUTE;
  const postCloseEndMinutes = POST_CLOSE_END_HOUR * 60;
  const preOpenStartMinutes = PRE_OPEN_START_HOUR * 60;

  if (!isTradingDay(istDate)) {
    return "OVERNIGHT";
  }

  if (
    currentTimeMinutes >= openTimeMinutes &&
    currentTimeMinutes < closeTimeMinutes
  ) {
    return "OPEN";
  }

  if (
    currentTimeMinutes >= closeTimeMinutes &&
    currentTimeMinutes < postCloseEndMinutes
  ) {
    return "POST_CLOSE";
  }

  if (
    currentTimeMinutes >= preOpenStartMinutes &&
    currentTimeMinutes < openTimeMinutes
  ) {
    return "PRE_OPEN";
  }

  return "OVERNIGHT";
}

export function getMarketModeDescriptor(now?: Date): {
  mode: MarketMode;
  botMode: "Active Hunter" | "Post-Game Review" | "Signal Collector" | "Strategist";
  outputType: string;
} {
  const mode = getMarketMode(now);
  switch (mode) {
    case "OPEN":
      return {
        mode,
        botMode: "Active Hunter",
        outputType: "High-velocity alerts / Immediate action.",
      };
    case "POST_CLOSE":
      return {
        mode,
        botMode: "Post-Game Review",
        outputType: "Performance analysis and lessons learned.",
      };
    case "PRE_OPEN":
      return {
        mode,
        botMode: "Strategist",
        outputType: "Top watchlist for the opening bell.",
      };
    default:
      return {
        mode,
        botMode: "Signal Collector",
        outputType: "Silent queueing of overnight catalysts.",
      };
  }
}

function isTradingDay(istDate: Date): boolean {
  const dayOfWeek = istDate.getUTCDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return false;
  }
  return !isHoliday(istDate);
}

function getMarketOpenUtcDate(istDate: Date): Date {
  const istMidnightUtc = new Date(
    Date.UTC(
      istDate.getUTCFullYear(),
      istDate.getUTCMonth(),
      istDate.getUTCDate(),
      0,
      0,
      0,
      0
    )
  );
  const openMinutesFromUtcMidnight =
    MARKET_OPEN_HOUR * 60 + MARKET_OPEN_MINUTE - IST_OFFSET_MINUTES;

  return new Date(
    istMidnightUtc.getTime() + openMinutesFromUtcMidnight * 60 * 1000
  );
}

/**
 * Get the next market open time.
 * Useful for logging and display purposes.
 *
 * @param now - Optional date to calculate from (defaults to current time)
 * @returns Date object representing next market open
 */
export function getNextMarketOpen(now?: Date): Date {
  const date = now || new Date();

  const istDateNow = new Date(date.getTime() + IST_OFFSET_MS);
  const currentTimeMinutes =
    istDateNow.getUTCHours() * 60 + istDateNow.getUTCMinutes();
  const openTimeMinutes = MARKET_OPEN_HOUR * 60 + MARKET_OPEN_MINUTE;
  const closeTimeMinutes = MARKET_CLOSE_HOUR * 60 + MARKET_CLOSE_MINUTE;
  let checkDate = new Date(date.getTime());

  if (isTradingDay(istDateNow) && currentTimeMinutes < openTimeMinutes) {
    return getMarketOpenUtcDate(istDateNow);
  }

  // If we're past market close or not a trading day, start checking from tomorrow
  if (!isTradingDay(istDateNow) || currentTimeMinutes >= closeTimeMinutes) {
    checkDate = new Date(checkDate.getTime() + 24 * 60 * 60 * 1000);
  } else {
    // Market hours or just closed: next open is the next trading day
    checkDate = new Date(checkDate.getTime() + 24 * 60 * 60 * 1000);
  }

  // Find next trading day
  for (let i = 0; i < 10; i++) {
    const istDate = new Date(checkDate.getTime() + IST_OFFSET_MS);
    if (isTradingDay(istDate)) {
      return getMarketOpenUtcDate(istDate);
    }

    checkDate = new Date(checkDate.getTime() + 24 * 60 * 60 * 1000);
  }

  // Fallback (shouldn't reach here)
  return new Date(date.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * Format market status for logging.
 *
 * @returns Human-readable market status string
 */
export function getMarketStatusMessage(): string {
  if (isIndianMarketOpen()) {
    return "🟢 Market is OPEN";
  }

  const nextOpen = getNextMarketOpen();
  const now = new Date();
  const hoursUntil = Math.round(
    (nextOpen.getTime() - now.getTime()) / (1000 * 60 * 60)
  );

  if (hoursUntil < 24) {
    return `📴 Market is CLOSED (opens in ~${hoursUntil}h)`;
  } else {
    return `📴 Market is CLOSED (opens ${nextOpen.toLocaleDateString("en-IN", {
      weekday: "short",
      month: "short",
      day: "numeric",
    })})`;
  }
}
