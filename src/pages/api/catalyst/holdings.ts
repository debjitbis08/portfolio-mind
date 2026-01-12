/**
 * Catalyst Holdings API
 *
 * Returns holdings specifically from the catalyst/short-term trading portfolio.
 * Mirrors the main holdings API but filters by portfolioType = "CATALYST".
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../../lib/middleware/requireAuth";
import { db, getCatalystHoldings, isPriceStale, schema } from "../../../lib/db";
import { inArray, eq } from "drizzle-orm";
import YahooFinance from "yahoo-finance2";
import { getZoneStatus, getZoneReasons } from "../../../lib/zone-status";
import { getSymbolMappings } from "../../../lib/mappings";

const yahooFinance = new YahooFinance();

/**
 * Retry helper for Yahoo Finance with timeout
 */
async function fetchQuoteWithRetry(
  symbols: string[],
  maxRetries = 2,
  timeoutMs = 8000
): Promise<any> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const promise = yahooFinance.quote(symbols);
      const result = await Promise.race([
        promise,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`Timeout after ${timeoutMs}ms`)),
            timeoutMs
          )
        ),
      ]);
      return result;
    } catch (error) {
      const isLastAttempt = attempt === maxRetries - 1;
      if (isLastAttempt) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
}

export const GET: APIRoute = async ({ request }) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    // Fetch catalyst holdings
    const holdings = await getCatalystHoldings();

    if (holdings.length === 0) {
      return new Response(
        JSON.stringify({
          holdings: [],
          summary: {
            current_value: 0,
            invested_value: 0,
            total_returns: 0,
            total_returns_percent: 0,
            holdings_count: 0,
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Get unique symbols and fetch current prices
    const symbols = holdings.map((h) => h.symbol);
    let quotes: Record<string, number> = {};

    // Fetch mappings once
    const mappings = await getSymbolMappings();
    const normalizeSymbol = (s: string) => s.replace(/\.NS$|\.BO$/i, "");
    const mapSymbol = (s: string) => {
      const normalized = normalizeSymbol(s);
      return mappings[normalized] || normalized;
    };

    // Build map of yahoo symbol -> holdings symbols
    const yahooToHoldings: Record<string, string[]> = {};
    for (const s of symbols) {
      const yahoo = mapSymbol(s);
      if (!yahooToHoldings[yahoo]) yahooToHoldings[yahoo] = [];
      yahooToHoldings[yahoo].push(s);
    }

    const uniqueYahooSymbols = [...new Set(symbols.map(mapSymbol))];

    // Check cache for fresh prices
    const cachedPrices = await db
      .select()
      .from(schema.priceCache)
      .where(inArray(schema.priceCache.symbol, uniqueYahooSymbols));

    const freshPrices: Record<string, number> = {};
    const staleSymbols: string[] = [];

    for (const yahoo of uniqueYahooSymbols) {
      const cached = cachedPrices.find((c) => c.symbol === yahoo);
      if (cached && !isPriceStale(cached.updatedAt)) {
        freshPrices[yahoo] = cached.price;
      } else {
        staleSymbols.push(yahoo);
      }
    }

    // Fetch stale/missing from Yahoo Finance
    if (staleSymbols.length > 0) {
      try {
        const nseSymbols = staleSymbols.map((s) => `${s}.NS`);
        const nseResults = await fetchQuoteWithRetry(nseSymbols);
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
            const bseResults = await fetchQuoteWithRetry(bseSymbols);
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
            console.error("[Catalyst Holdings] BSE fetch error:", bseErr);
          }
        }

        // Update cache
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
        console.error("[Catalyst Holdings] Yahoo Finance error:", err);
        // Use stale cache as fallback
        for (const yahoo of staleSymbols) {
          const cached = cachedPrices.find((c) => c.symbol === yahoo);
          if (cached && !freshPrices[yahoo]) {
            freshPrices[yahoo] = cached.price;
          }
        }
      }
    }

    // Map Yahoo symbols back to holdings symbols
    for (const [yahoo, price] of Object.entries(freshPrices)) {
      const holdingsSyms = yahooToHoldings[yahoo] || [yahoo];
      for (const hs of holdingsSyms) {
        quotes[hs] = price;
      }
    }

    // Fetch technical data
    const technicalData = await db.select().from(schema.technicalData);
    const techMap = new Map<string, (typeof technicalData)[0]>();
    for (const t of technicalData) {
      techMap.set(t.symbol, t);
    }

    // Enrich holdings with prices and technicals
    const enrichedHoldings = holdings.map((h) => {
      const currentPrice = quotes[h.symbol] || 0;
      const currentValue = currentPrice * h.quantity;
      const investedValue = h.investedValue;
      const returns = currentValue - investedValue;
      const returnsPercent =
        investedValue > 0 ? (returns / investedValue) * 100 : 0;

      const yahooSymbol = mapSymbol(h.symbol);
      const tech = techMap.get(yahooSymbol) || techMap.get(h.symbol);

      const techData = {
        rsi14: tech?.rsi14 ?? null,
        priceVsSma50: tech?.priceVsSma50 ?? null,
        priceVsSma200: tech?.priceVsSma200 ?? null,
        currentPrice: tech?.currentPrice ?? null,
        sma200: tech?.sma200 ?? null,
      };
      const zoneStatus = getZoneStatus(techData);
      const waitReasons = getZoneReasons(techData);

      return {
        symbol: h.symbol,
        stock_name: h.stockName,
        quantity: h.quantity,
        avg_buy_price: h.avgBuyPrice,
        invested_value: investedValue,
        current_price: currentPrice,
        current_value: currentValue,
        returns,
        returns_percent: returnsPercent,
        rsi_14: tech?.rsi14 ?? null,
        sma_50: tech?.sma50 ?? null,
        sma_200: tech?.sma200 ?? null,
        price_vs_sma50: tech?.priceVsSma50 ?? null,
        price_vs_sma200: tech?.priceVsSma200 ?? null,
        zone_status: zoneStatus,
        wait_reasons: waitReasons,
        technical_updated_at: tech?.updatedAt ?? null,
      };
    });

    // Sort by current value descending
    enrichedHoldings.sort((a, b) => b.current_value - a.current_value);

    // Calculate summary
    const totalCurrentValue = enrichedHoldings.reduce(
      (sum, h) => sum + h.current_value,
      0
    );
    const totalInvestedValue = enrichedHoldings.reduce(
      (sum, h) => sum + h.invested_value,
      0
    );
    const totalReturns = totalCurrentValue - totalInvestedValue;
    const totalReturnsPercent =
      totalInvestedValue > 0 ? (totalReturns / totalInvestedValue) * 100 : 0;

    return new Response(
      JSON.stringify({
        holdings: enrichedHoldings,
        summary: {
          current_value: totalCurrentValue,
          invested_value: totalInvestedValue,
          total_returns: totalReturns,
          total_returns_percent: totalReturnsPercent,
          holdings_count: enrichedHoldings.length,
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[Catalyst Holdings] API error:", error);
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
