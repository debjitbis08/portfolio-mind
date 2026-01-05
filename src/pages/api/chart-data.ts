/**
 * Chart Data API
 *
 * Returns historical OHLCV data with moving averages for charting.
 * Uses toolCache to avoid Yahoo Finance rate limits.
 */

import type { APIRoute } from "astro";
import YahooFinance from "yahoo-finance2";
import { getCached, setCache } from "../../lib/tools/cache";

const yahooFinance = new YahooFinance();

interface ChartQuote {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface MAPoint {
  time: string;
  value: number;
}

// Calculate moving average for given period
function calculateMA(data: ChartQuote[], period: number): MAPoint[] {
  const result: MAPoint[] = [];

  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - j].close;
    }
    result.push({
      time: data[i].time,
      value: Math.round((sum / period) * 100) / 100,
    });
  }

  return result;
}

// Get days for range
function getDaysForRange(range: string): number {
  switch (range) {
    case "1m":
      return 30;
    case "6m":
      return 180;
    case "1y":
    default:
      return 365;
  }
}

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol");
  const range = url.searchParams.get("range") || "1y";

  if (!symbol) {
    return new Response(JSON.stringify({ error: "Symbol required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const cacheKey = { symbol, range };

  // Check cache first
  const cached = await getCached("yahoo_chart", cacheKey);
  if (cached.hit && cached.data) {
    return new Response(JSON.stringify(cached.data), {
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const days = getDaysForRange(range);
    // Fetch extra days to have enough data for 200 DMA
    const fetchDays = days + 220;

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - fetchDays);

    // Try NSE first, then BSE
    let yahooSymbol = `${symbol}.NS`;
    let result;

    try {
      result = await yahooFinance.chart(yahooSymbol, {
        period1: startDate,
        period2: endDate,
        interval: "1d",
      });
    } catch {
      yahooSymbol = `${symbol}.BO`;
      result = await yahooFinance.chart(yahooSymbol, {
        period1: startDate,
        period2: endDate,
        interval: "1d",
      });
    }

    if (!result.quotes || result.quotes.length === 0) {
      return new Response(
        JSON.stringify({ error: "No data available for symbol" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Convert to chart format
    const allData: ChartQuote[] = result.quotes
      .filter(
        (q) =>
          q.close !== null &&
          q.open !== null &&
          q.high !== null &&
          q.low !== null
      )
      .map((q) => ({
        time: new Date(q.date).toISOString().split("T")[0],
        open: Math.round((q.open as number) * 100) / 100,
        high: Math.round((q.high as number) * 100) / 100,
        low: Math.round((q.low as number) * 100) / 100,
        close: Math.round((q.close as number) * 100) / 100,
        volume: q.volume || 0,
      }));

    // Calculate MAs on full data
    const sma50 = calculateMA(allData, 50);
    const sma200 = calculateMA(allData, 200);

    // Trim data to requested range (last N days)
    const trimmedData = allData.slice(-days);

    // Trim MAs to match the range
    const cutoffDate = trimmedData[0]?.time;
    const trimmedSma50 = sma50.filter((p) => p.time >= cutoffDate);
    const trimmedSma200 = sma200.filter((p) => p.time >= cutoffDate);

    const responseData = {
      symbol,
      range,
      data: trimmedData,
      sma50: trimmedSma50,
      sma200: trimmedSma200,
    };

    // Cache the response
    await setCache("yahoo_chart", cacheKey, responseData);

    return new Response(JSON.stringify(responseData), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Chart data fetch error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Failed to fetch data",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
