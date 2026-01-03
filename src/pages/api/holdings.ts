/**
 * Holdings API Endpoint
 *
 * Returns current holdings with live prices and technical data.
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../lib/middleware/requireAuth";
import { db, getHoldings, isPriceStale, schema } from "../../lib/db";
import { eq, inArray } from "drizzle-orm";
import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance();

// Symbol mapping utility
import { getSymbolMappings } from "../../lib/mappings";

export const GET: APIRoute = async ({ request }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    // Fetch holdings from computed view
    const holdings = await getHoldings();

    if (holdings.length === 0) {
      return new Response(JSON.stringify({ holdings: [], summary: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get unique symbols and fetch current prices
    const symbols = holdings.map((h) => h.symbol);
    let quotes: Record<string, number> = {};

    // Fetch mappings once
    const mappings = await getSymbolMappings();
    const mapSymbol = (s: string) => mappings[s] || s;

    // Build map of yahoo symbol -> all holdings symbols that map to it
    const yahooToHoldings: Record<string, string[]> = {};
    for (const s of symbols) {
      const yahoo = mapSymbol(s);
      if (!yahooToHoldings[yahoo]) yahooToHoldings[yahoo] = [];
      yahooToHoldings[yahoo].push(s);
    }

    const uniqueYahooSymbols = [...new Set(symbols.map(mapSymbol))];

    // Step 1: Check cache for fresh prices
    const cachedPrices = await db
      .select()
      .from(schema.priceCache)
      .where(inArray(schema.priceCache.symbol, uniqueYahooSymbols));

    const freshPrices: Record<string, number> = {};
    const staleSymbols: string[] = [];

    // Check which symbols have fresh cache vs need refresh
    for (const yahoo of uniqueYahooSymbols) {
      const cached = cachedPrices.find((c) => c.symbol === yahoo);
      if (cached && !isPriceStale(cached.updatedAt)) {
        freshPrices[yahoo] = cached.price;
      } else {
        staleSymbols.push(yahoo);
      }
    }

    // Step 2: Fetch stale/missing from Yahoo
    if (staleSymbols.length > 0) {
      try {
        // Try NSE first
        const nseSymbols = staleSymbols.map((s) => `${s}.NS`);
        const nseResults = await yahooFinance.quote(nseSymbols);
        const nseArray = Array.isArray(nseResults) ? nseResults : [nseResults];

        const pricesToCache: Array<{ symbol: string; price: number }> = [];

        for (const quote of nseArray) {
          if (quote?.symbol && quote.regularMarketPrice) {
            const yahoo = quote.symbol.replace(".NS", "");
            freshPrices[yahoo] = quote.regularMarketPrice;
            pricesToCache.push({
              symbol: yahoo,
              price: quote.regularMarketPrice,
            });
          }
        }

        // Try BSE for remaining
        const stillMissing = staleSymbols.filter((s) => !freshPrices[s]);
        if (stillMissing.length > 0) {
          try {
            const bseSymbols = stillMissing.map((s) => `${s}.BO`);
            const bseResults = await yahooFinance.quote(bseSymbols);
            const bseArray = Array.isArray(bseResults)
              ? bseResults
              : [bseResults];

            for (const quote of bseArray) {
              if (quote?.symbol && quote.regularMarketPrice) {
                const yahoo = quote.symbol.replace(".BO", "");
                freshPrices[yahoo] = quote.regularMarketPrice;
                pricesToCache.push({
                  symbol: yahoo,
                  price: quote.regularMarketPrice,
                });
              }
            }
          } catch (bseErr) {
            console.error("BSE fetch error:", bseErr);
          }
        }

        // Step 3: Update cache
        for (const p of pricesToCache) {
          await db
            .insert(schema.priceCache)
            .values({
              symbol: p.symbol,
              price: p.price,
              updatedAt: new Date().toISOString(),
            })
            .onConflictDoUpdate({
              target: schema.priceCache.symbol,
              set: {
                price: p.price,
                updatedAt: new Date().toISOString(),
              },
            });
        }
      } catch (err) {
        console.error("Yahoo Finance error:", err);
      }
    }

    // Map Yahoo symbols back to holdings symbols
    for (const [yahoo, price] of Object.entries(freshPrices)) {
      const holdingsSyms = yahooToHoldings[yahoo] || [yahoo];
      for (const hs of holdingsSyms) {
        quotes[hs] = price;
      }
    }

    // Enrich holdings with current prices and returns
    const enrichedHoldings = holdings.map((h) => {
      const currentPrice = quotes[h.symbol] || 0;
      const currentValue = currentPrice * h.quantity;
      const investedValue = h.investedValue;
      const returns = currentValue - investedValue;
      const returnsPercent =
        investedValue > 0 ? (returns / investedValue) * 100 : 0;

      return {
        isin: h.isin,
        symbol: h.symbol,
        stock_name: h.stockName,
        quantity: h.quantity,
        avg_buy_price: h.avgBuyPrice,
        invested_value: investedValue,
        current_price: currentPrice,
        current_value: currentValue,
        returns,
        returns_percent: returnsPercent,
      };
    });

    // Fetch technical data for all holdings
    const technicalData = await db.select().from(schema.technicalData);

    // Create lookup map for technical data
    const techMap = new Map<string, (typeof technicalData)[0]>();
    for (const t of technicalData) {
      techMap.set(t.symbol, t);
    }

    // Merge technical data into holdings
    const holdingsWithTech = enrichedHoldings.map((h) => {
      const yahooSymbol = mapSymbol(h.symbol);
      const tech = techMap.get(yahooSymbol) || techMap.get(h.symbol);

      // Determine wait zone reasons
      const waitReasons: string[] = [];
      if (tech) {
        if (tech.rsi14 && tech.rsi14 > 40) {
          waitReasons.push(`RSI ${tech.rsi14.toFixed(0)}`);
        }
        if (tech.priceVsSma50 && tech.priceVsSma50 > 15) {
          waitReasons.push(`+${tech.priceVsSma50.toFixed(0)}% SMA50`);
        }
        if (tech.priceVsSma200 && tech.priceVsSma200 > 15) {
          waitReasons.push(`+${tech.priceVsSma200.toFixed(0)}% SMA200`);
        }
        if (
          tech.sma200 &&
          tech.currentPrice &&
          tech.currentPrice < tech.sma200
        ) {
          waitReasons.push("Below SMA200");
        }
      }

      return {
        ...h,
        rsi_14: tech?.rsi14 ?? null,
        sma_50: tech?.sma50 ?? null,
        sma_200: tech?.sma200 ?? null,
        price_vs_sma50: tech?.priceVsSma50 ?? null,
        price_vs_sma200: tech?.priceVsSma200 ?? null,
        is_wait_zone: waitReasons.length > 0,
        wait_reasons: waitReasons,
      };
    });

    // Sort by current value descending
    holdingsWithTech.sort((a, b) => b.current_value - a.current_value);

    // Calculate summary
    const totalCurrentValue = holdingsWithTech.reduce(
      (sum, h) => sum + h.current_value,
      0
    );
    const totalInvestedValue = holdingsWithTech.reduce(
      (sum, h) => sum + h.invested_value,
      0
    );
    const totalReturns = totalCurrentValue - totalInvestedValue;
    const totalReturnsPercent =
      totalInvestedValue > 0 ? (totalReturns / totalInvestedValue) * 100 : 0;

    return new Response(
      JSON.stringify({
        holdings: holdingsWithTech,
        summary: {
          current_value: totalCurrentValue,
          invested_value: totalInvestedValue,
          total_returns: totalReturns,
          total_returns_percent: totalReturnsPercent,
          holdings_count: holdingsWithTech.length,
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Holdings API error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};
