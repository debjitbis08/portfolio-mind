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
 * Determine the zone status based on technical indicators and portfolio role.
 *
 * Strategy-based logic:
 * - VALUE: Inverted logic - buy weakness, avoid strength (contrarian)
 * - MOMENTUM: Buy strength, strict uptrend required
 * - CORE/INCOME/SPECULATIVE: Standard "Goldilocks" logic (default)
 *
 * @param tech Technical indicator data
 * @param role Portfolio role (strategy context) - defaults to CORE
 */
export function getZoneStatus(
  tech: {
    rsi14: number | null;
    priceVsSma50: number | null;
    priceVsSma200: number | null;
    currentPrice: number | null;
    sma200: number | null;
  },
  role: PortfolioRole = PortfolioRole.CORE
): ZoneStatus {
  // ---------------------------------------------------------
  // STRATEGY 1: DEEP VALUE (e.g., Tinna Rubber, MGL)
  // Goal: Catch falling knives safely.
  // ---------------------------------------------------------
  if (role === PortfolioRole.VALUE) {
    // Value stocks are often "BUY" when they are mathematically "COLD"
    // We INVERT the standard logic here.

    // If it's oversold, it's a screaming buy for Value
    if (tech.rsi14 !== null && tech.rsi14 < 40) {
      return ZoneStatus.BUY_ZONE;
    }

    // If it's too hot (RSI > 60), the "deep value" bargain is gone.
    if (tech.rsi14 !== null && tech.rsi14 > 60) {
      return ZoneStatus.OVERHEATED;
    }

    // If it is significantly below SMA200, it is in the "Value Zone"
    if (
      tech.currentPrice !== null &&
      tech.sma200 !== null &&
      tech.currentPrice < tech.sma200
    ) {
      return ZoneStatus.BUY_ZONE;
    }

    // Default for Value
    return ZoneStatus.BUY_ZONE;
  }

  // ---------------------------------------------------------
  // STRATEGY 2: MOMENTUM (e.g., Waaree, Bondada, Aether)
  // Goal: Buy strength, avoid weakness.
  // ---------------------------------------------------------
  if (role === PortfolioRole.MOMENTUM) {
    // 1. Strict Floor: Momentum MUST be in an uptrend.
    // If below SMA200, the trend is broken.
    if (
      tech.currentPrice !== null &&
      tech.sma200 !== null &&
      tech.currentPrice < tech.sma200
    ) {
      return ZoneStatus.DOWNTREND; // Hard Reject
    }

    // 2. Tolerance: We allow RSI to go higher (up to 80) for momentum.
    // Standard "75" is too strict for a breakout stock.
    const isClimaxTop = tech.rsi14 !== null && tech.rsi14 > 82; // Raised threshold
    const isSuperExtended = tech.priceVsSma50 !== null && tech.priceVsSma50 > 30; // Raised threshold

    if (isClimaxTop || isSuperExtended) {
      return ZoneStatus.OVERHEATED;
    }

    return ZoneStatus.BUY_ZONE;
  }

  // ---------------------------------------------------------
  // STRATEGY 3: CORE / INCOME / SPECULATIVE (Standard Logic)
  // Goal: Buy Quality on Dips (The "Goldilocks" Standard)
  // ---------------------------------------------------------

  // 1. Check for Downtrend (Core stocks should generally be healthy)
  if (
    tech.currentPrice !== null &&
    tech.sma200 !== null &&
    tech.currentPrice < tech.sma200
  ) {
    return ZoneStatus.DOWNTREND;
  }

  // 2. Standard Overheating Checks (Conservative)
  const isOverbought = tech.rsi14 !== null && tech.rsi14 > 75;
  const isExtended50 = tech.priceVsSma50 !== null && tech.priceVsSma50 > 20;
  const isExtended200 = tech.priceVsSma200 !== null && tech.priceVsSma200 > 40;

  if (isOverbought || isExtended50 || isExtended200) {
    return ZoneStatus.OVERHEATED;
  }

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
