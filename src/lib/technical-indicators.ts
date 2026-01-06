/**
 * Technical Indicators Service
 * Calculates RSI(14), SMA(50), SMA(200) using trading-signals library
 */

import { RSI, SMA } from "trading-signals";
import YahooFinance from "yahoo-finance2";
import { ZoneStatus, getZoneStatus, getZoneReasons } from "./zone-status";

const yahooFinance = new YahooFinance();

export interface TechnicalData {
  symbol: string;
  currentPrice: number;
  rsi14: number | null;
  sma50: number | null;
  sma200: number | null;
  priceVsSma50: number | null; // % difference
  priceVsSma200: number | null; // % difference
  zoneStatus: ZoneStatus;
  isWaitZone: boolean; // Backward compatibility
  waitReasons: string[];
}

export interface HistoricalPrice {
  date: Date;
  close: number;
}

/**
 * Fetch historical prices from Yahoo Finance
 */
export async function fetchHistoricalPrices(
  symbol: string,
  days: number = 365
): Promise<HistoricalPrice[]> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Determine if symbol is a BSE numeric code (try BSE first)
  const isBseCode = /^\d{5,6}$/.test(symbol);

  const tryFetch = async (suffix: string) => {
    const yahooSymbol = `${symbol}${suffix}`;
    const result = await yahooFinance.chart(yahooSymbol, {
      period1: startDate,
      period2: endDate,
      interval: "1d",
    });
    if (!result.quotes || result.quotes.length < 50) {
      throw new Error("Insufficient data");
    }
    return result.quotes
      .filter((q) => q.close !== null && q.close !== undefined)
      .map((q) => ({
        date: new Date(q.date),
        close: q.close as number,
      }));
  };

  // Try primary exchange first, then fallback
  const [primary, fallback] = isBseCode ? [".BO", ".NS"] : [".NS", ".BO"];

  try {
    return await tryFetch(primary);
  } catch {
    // Primary failed, try fallback
    try {
      return await tryFetch(fallback);
    } catch (error) {
      console.error(`Failed to fetch history for ${symbol}:`, error);
      return [];
    }
  }
}

/**
 * Calculate technical indicators for a symbol
 */
export function calculateIndicators(prices: HistoricalPrice[]): {
  rsi14: number | null;
  sma50: number | null;
  sma200: number | null;
  currentPrice: number | null;
} {
  if (prices.length < 14) {
    return { rsi14: null, sma50: null, sma200: null, currentPrice: null };
  }

  // Sort by date ascending
  const sorted = [...prices].sort(
    (a, b) => a.date.getTime() - b.date.getTime()
  );

  const rsi = new RSI(14);
  const sma50 = new SMA(50);
  const sma200 = new SMA(200);

  for (const { close } of sorted) {
    rsi.update(close, false);
    sma50.update(close, false);
    sma200.update(close, false);
  }

  const currentPrice = sorted[sorted.length - 1]?.close || null;

  // Get results with null checks
  const rsiResult = rsi.isStable ? rsi.getResult() : null;
  const sma50Result = sma50.isStable ? sma50.getResult() : null;
  const sma200Result = sma200.isStable ? sma200.getResult() : null;

  return {
    rsi14: rsiResult ? Number(Number(rsiResult).toFixed(2)) : null,
    sma50: sma50Result ? Number(Number(sma50Result).toFixed(2)) : null,
    sma200: sma200Result ? Number(Number(sma200Result).toFixed(2)) : null,
    currentPrice,
  };
}

/**
 * Determine if stock is in "wait zone" (don't buy)
 * Uses the new ZoneStatus for richer context.
 */
export function checkWaitZone(data: {
  currentPrice: number | null;
  rsi14: number | null;
  sma50: number | null;
  sma200: number | null;
}): { zoneStatus: ZoneStatus; isWaitZone: boolean; reasons: string[] } {
  // Calculate price vs SMA percentages for zone status calculation
  const priceVsSma50 =
    data.currentPrice && data.sma50
      ? ((data.currentPrice - data.sma50) / data.sma50) * 100
      : null;
  const priceVsSma200 =
    data.currentPrice && data.sma200
      ? ((data.currentPrice - data.sma200) / data.sma200) * 100
      : null;

  const techData = {
    rsi14: data.rsi14,
    priceVsSma50,
    priceVsSma200,
    currentPrice: data.currentPrice,
    sma200: data.sma200,
  };

  const zoneStatus = getZoneStatus(techData);
  const reasons = getZoneReasons(techData);

  return {
    zoneStatus,
    isWaitZone: zoneStatus !== ZoneStatus.BUY_ZONE,
    reasons,
  };
}

/**
 * Get full technical data for a symbol
 * Falls back to Google Finance for current price if Yahoo fails
 */
export async function getTechnicalData(
  symbol: string
): Promise<TechnicalData | null> {
  const prices = await fetchHistoricalPrices(symbol);

  // If we have enough historical data from Yahoo, calculate full technicals
  if (prices.length >= 50) {
    const indicators = calculateIndicators(prices);
    const waitCheck = checkWaitZone(indicators);

    const priceVsSma50 =
      indicators.currentPrice && indicators.sma50
        ? ((indicators.currentPrice - indicators.sma50) / indicators.sma50) *
          100
        : null;

    const priceVsSma200 =
      indicators.currentPrice && indicators.sma200
        ? ((indicators.currentPrice - indicators.sma200) / indicators.sma200) *
          100
        : null;

    return {
      symbol,
      currentPrice: indicators.currentPrice || 0,
      rsi14: indicators.rsi14,
      sma50: indicators.sma50,
      sma200: indicators.sma200,
      priceVsSma50: priceVsSma50 ? Number(priceVsSma50.toFixed(2)) : null,
      priceVsSma200: priceVsSma200 ? Number(priceVsSma200.toFixed(2)) : null,
      zoneStatus: waitCheck.zoneStatus,
      isWaitZone: waitCheck.isWaitZone,
      waitReasons: waitCheck.reasons,
    };
  }

  // Fallback: Try Google Finance for at least current price
  try {
    const { getGoogleFinanceQuote } = await import("./scrapers/google-finance");
    const gfQuote = await getGoogleFinanceQuote(symbol);

    if (gfQuote) {
      console.log(
        `[TechnicalData] Using Google Finance fallback for ${symbol}: ₹${gfQuote.price}`
      );
      return {
        symbol,
        currentPrice: gfQuote.price,
        rsi14: null, // No historical data for technicals
        sma50: null,
        sma200: null,
        priceVsSma50: null,
        priceVsSma200: null,
        zoneStatus: ZoneStatus.BUY_ZONE, // Default when no data
        isWaitZone: false,
        waitReasons: ["Insufficient historical data for technical analysis"],
      };
    }
  } catch (error) {
    console.error(
      `[TechnicalData] Google Finance fallback failed for ${symbol}:`,
      error
    );
  }

  return null;
}
