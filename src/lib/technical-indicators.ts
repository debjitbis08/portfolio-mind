/**
 * Technical Indicators Service
 * Calculates RSI(14), SMA(50), SMA(200) using trading-signals library
 */

import { RSI, SMA } from "trading-signals";
import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance();

export interface TechnicalData {
  symbol: string;
  currentPrice: number;
  rsi14: number | null;
  sma50: number | null;
  sma200: number | null;
  priceVsSma50: number | null; // % difference
  priceVsSma200: number | null; // % difference
  isWaitZone: boolean;
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

  try {
    // Try NSE first, then BSE
    let yahooSymbol = `${symbol}.NS`;
    let result = await yahooFinance.chart(yahooSymbol, {
      period1: startDate,
      period2: endDate,
      interval: "1d",
    });

    if (!result.quotes || result.quotes.length < 50) {
      // Try BSE
      yahooSymbol = `${symbol}.BO`;
      result = await yahooFinance.chart(yahooSymbol, {
        period1: startDate,
        period2: endDate,
        interval: "1d",
      });
    }

    if (!result.quotes) return [];

    return result.quotes
      .filter((q) => q.close !== null && q.close !== undefined)
      .map((q) => ({
        date: new Date(q.date),
        close: q.close as number,
      }));
  } catch (error) {
    console.error(`Failed to fetch history for ${symbol}:`, error);
    return [];
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
 * Stricter thresholds for value investing:
 * - RSI > 40 = getting expensive
 * - > 15% above SMA = extended
 * - Below SMA200 = downtrend
 */
export function checkWaitZone(data: {
  currentPrice: number | null;
  rsi14: number | null;
  sma50: number | null;
  sma200: number | null;
}): { isWaitZone: boolean; reasons: string[] } {
  const reasons: string[] = [];

  // RSI > 40 = stock is not in value territory
  if (data.rsi14 && data.rsi14 > 40) {
    reasons.push(`RSI ${data.rsi14.toFixed(0)} > 40 (not value)`);
  }

  // > 15% above SMA50 = short-term extended
  if (data.currentPrice && data.sma50) {
    const pctAbove = ((data.currentPrice - data.sma50) / data.sma50) * 100;
    if (pctAbove > 15) {
      reasons.push(`${pctAbove.toFixed(0)}% above SMA50 (extended)`);
    }
  }

  // > 15% above SMA200 = long-term extended
  if (data.currentPrice && data.sma200) {
    const pctAbove = ((data.currentPrice - data.sma200) / data.sma200) * 100;
    if (pctAbove > 15) {
      reasons.push(`${pctAbove.toFixed(0)}% above SMA200 (extended)`);
    }
    // Below SMA200 = downtrend (still a wait condition)
    if (data.currentPrice < data.sma200) {
      reasons.push("Below SMA200 (downtrend)");
    }
  }

  return {
    isWaitZone: reasons.length > 0,
    reasons,
  };
}

/**
 * Get full technical data for a symbol
 */
export async function getTechnicalData(
  symbol: string
): Promise<TechnicalData | null> {
  const prices = await fetchHistoricalPrices(symbol);

  if (prices.length < 50) {
    return null;
  }

  const indicators = calculateIndicators(prices);
  const waitCheck = checkWaitZone(indicators);

  const priceVsSma50 =
    indicators.currentPrice && indicators.sma50
      ? ((indicators.currentPrice - indicators.sma50) / indicators.sma50) * 100
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
    isWaitZone: waitCheck.isWaitZone,
    waitReasons: waitCheck.reasons,
  };
}
