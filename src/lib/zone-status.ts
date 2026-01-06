/**
 * Zone Status & Portfolio Role Types
 *
 * Provides richer context for technical analysis and AI agent reasoning.
 */

/**
 * Zone status for entry timing decisions.
 * More informative than a simple boolean is_wait_zone.
 */
export enum ZoneStatus {
  BUY_ZONE = "BUY", // Good accumulation timing
  OVERHEATED = "WAIT_TOO_HOT", // RSI high, extended above SMAs - wait for pullback
  DOWNTREND = "WAIT_TOO_COLD", // Below SMA200 - in a downtrend
}

/**
 * Portfolio role describes the investment strategy context for a stock.
 * Helps the AI agent reason about appropriate actions based on strategy.
 */
export enum PortfolioRole {
  VALUE = "VALUE", // Deep value, margin of safety plays
  MOMENTUM = "MOMENTUM", // Trend-following, riding strength
  CORE = "CORE", // Long-term compounders, buy-and-hold
  SPECULATIVE = "SPECULATIVE", // High-risk/reward bets
  INCOME = "INCOME", // Dividend/distribution focused
}

/**
 * Determine the zone status based on technical indicators.
 *
 * Priority:
 * 1. DOWNTREND: Price below SMA200 (fundamental concern)
 * 2. OVERHEATED: RSI > 75 OR >20% above SMA50 OR >40% above SMA200
 * 3. BUY_ZONE: Default if neither condition met
 */
export function getZoneStatus(tech: {
  rsi14: number | null;
  priceVsSma50: number | null;
  priceVsSma200: number | null;
  currentPrice: number | null;
  sma200: number | null;
}): ZoneStatus {
  // 1. Check for Downtrend (The "Cold" Check) - highest priority
  if (
    tech.currentPrice !== null &&
    tech.sma200 !== null &&
    tech.currentPrice < tech.sma200
  ) {
    return ZoneStatus.DOWNTREND;
  }

  // 2. Check for Overextension (The "Hot" Check)
  const isOverbought = tech.rsi14 !== null && tech.rsi14 > 75;
  const isExtended50 = tech.priceVsSma50 !== null && tech.priceVsSma50 > 20;
  const isExtended200 = tech.priceVsSma200 !== null && tech.priceVsSma200 > 40;

  if (isOverbought || isExtended50 || isExtended200) {
    return ZoneStatus.OVERHEATED;
  }

  // 3. Default: "Goldilocks" Buy Zone
  return ZoneStatus.BUY_ZONE;
}

/**
 * Get human-readable reasons for why a stock is in the current zone.
 */
export function getZoneReasons(tech: {
  rsi14: number | null;
  priceVsSma50: number | null;
  priceVsSma200: number | null;
  currentPrice: number | null;
  sma200: number | null;
}): string[] {
  const reasons: string[] = [];

  // Downtrend check
  if (
    tech.currentPrice !== null &&
    tech.sma200 !== null &&
    tech.currentPrice < tech.sma200
  ) {
    const pctBelow = ((tech.sma200 - tech.currentPrice) / tech.sma200) * 100;
    reasons.push(`${pctBelow.toFixed(0)}% below SMA200 (downtrend)`);
  }

  // Overbought RSI
  if (tech.rsi14 !== null && tech.rsi14 > 75) {
    reasons.push(`RSI ${tech.rsi14.toFixed(0)} > 75 (overbought)`);
  }

  // Extended above SMA50
  if (tech.priceVsSma50 !== null && tech.priceVsSma50 > 20) {
    reasons.push(`${tech.priceVsSma50.toFixed(0)}% above SMA50 (extended)`);
  }

  // Extended above SMA200
  if (tech.priceVsSma200 !== null && tech.priceVsSma200 > 40) {
    reasons.push(
      `${tech.priceVsSma200.toFixed(0)}% above SMA200 (very extended)`
    );
  }

  return reasons;
}
