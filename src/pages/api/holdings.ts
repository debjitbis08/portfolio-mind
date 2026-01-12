/**
 * Holdings API Endpoint
 *
 * Returns current holdings with live prices and technical data.
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../lib/middleware/requireAuth";
import {
  db,
  getHoldings,
  isPriceStale,
  schema,
  type PortfolioType,
} from "../../lib/db";
import { and, eq, inArray } from "drizzle-orm";
import YahooFinance from "yahoo-finance2";
import {
  getZoneStatus,
  getZoneReasons,
  PortfolioRole,
} from "../../lib/zone-status";

const yahooFinance = new YahooFinance();

// Symbol mapping utility
import { getSymbolMappings } from "../../lib/mappings";

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
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      // Note: yahoo-finance2 doesn't support AbortSignal directly,
      // but we can catch the timeout error and retry
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

      clearTimeout(timeoutId);
      return result;
    } catch (error) {
      const isLastAttempt = attempt === maxRetries - 1;
      if (isLastAttempt) {
        throw error;
      }
      // Wait before retry (exponential backoff)
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
}

export const GET: APIRoute = async ({ request }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  const url = new URL(request.url);
  const requestedSymbol = url.searchParams.get("symbol")?.toUpperCase();
  const portfolioParam = url.searchParams.get("portfolio")?.toUpperCase();
  const portfolioType: PortfolioType =
    portfolioParam === "CATALYST" ? "CATALYST" : "LONGTERM";

  try {
    // Fetch holdings from computed view, filtered by portfolio type
    let holdings = await getHoldings(portfolioType);

    if (requestedSymbol) {
      holdings = holdings.filter((h) => h.symbol === requestedSymbol);
    }

    if (holdings.length > 0) {
      const delisted = await db
        .select({ symbol: schema.watchlist.symbol })
        .from(schema.watchlist)
        .where(
          and(
            inArray(
              schema.watchlist.symbol,
              holdings.map((h) => h.symbol)
            ),
            eq(schema.watchlist.delisted, true)
          )
        );
      const delistedSymbols = new Set(delisted.map((d) => d.symbol));
      holdings = holdings.filter((h) => !delistedSymbols.has(h.symbol));
    }

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
      // Separate BSE-only numeric symbols from regular symbols
      const bseOnlySymbols: string[] = [];
      const regularSymbols: string[] = [];

      for (const symbol of staleSymbols) {
        // Detect BSE scrip codes (5-6 digit numeric codes)
        if (/^\d{5,6}$/.test(symbol)) {
          bseOnlySymbols.push(symbol);
          console.log(
            `[Holdings] ${symbol} is BSE scrip code, using Google Finance only`
          );
        } else {
          regularSymbols.push(symbol);
        }
      }

      // Try Google Finance first for BSE-only symbols (skip Yahoo entirely)
      if (bseOnlySymbols.length > 0) {
        console.log(
          `[Holdings] Fetching ${bseOnlySymbols.length} BSE-only symbols via Google Finance...`
        );

        try {
          const { getGoogleFinanceQuote } = await import(
            "../../lib/scrapers/google-finance"
          );

          const pricesToCache: Array<{ symbol: string; price: number }> = [];

          for (const yahoo of bseOnlySymbols) {
            try {
              const gfQuote = await getGoogleFinanceQuote(yahoo);
              if (gfQuote) {
                freshPrices[yahoo] = gfQuote.price;
                pricesToCache.push({
                  symbol: yahoo,
                  price: gfQuote.price,
                });
                console.log(
                  `[Holdings] ✓ Google Finance (BSE-only): ${yahoo} = ₹${gfQuote.price.toFixed(
                    2
                  )}`
                );
              }
              // Small delay to avoid rate limiting
              await new Promise((r) => setTimeout(r, 200));
            } catch (gfErr) {
              console.warn(
                `[Holdings] Google Finance failed for BSE-only ${yahoo}:`,
                gfErr instanceof Error ? gfErr.message : "Unknown error"
              );
            }
          }

          // Update cache with Google Finance prices
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
        } catch (gfError) {
          console.error(
            "[Holdings] Google Finance for BSE-only symbols failed:",
            gfError
          );
        }
      }

      // Try Yahoo Finance for regular symbols only
      if (regularSymbols.length > 0) {
        try {
          // Try NSE first with retry
          const nseSymbols = regularSymbols.map((s) => `${s}.NS`);
          const nseResults = await fetchQuoteWithRetry(nseSymbols);
          const nseArray = Array.isArray(nseResults)
            ? nseResults
            : [nseResults];

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
          const stillMissing = regularSymbols.filter((s) => !freshPrices[s]);
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
              console.error("BSE fetch error:", bseErr);
            }
          }

          // Step 3: Update cache for Yahoo Finance results
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

          // Try Google Finance as fallback for regular symbols (BSE-only already handled)
          const remainingSymbols = regularSymbols.filter(
            (s) => !freshPrices[s]
          );
          if (remainingSymbols.length > 0) {
            console.log(
              `[Holdings] Yahoo Finance failed, trying Google Finance for ${remainingSymbols.length} symbols...`
            );

            try {
              const { getGoogleFinanceQuote } = await import(
                "../../lib/scrapers/google-finance"
              );

              const pricesToCache: Array<{ symbol: string; price: number }> =
                [];

              for (const yahoo of remainingSymbols) {
                try {
                  const gfQuote = await getGoogleFinanceQuote(yahoo);
                  if (gfQuote) {
                    freshPrices[yahoo] = gfQuote.price;
                    pricesToCache.push({
                      symbol: yahoo,
                      price: gfQuote.price,
                    });
                    console.log(
                      `[Holdings] ✓ Google Finance: ${yahoo} = ₹${gfQuote.price.toFixed(
                        2
                      )}`
                    );
                  }
                  // Small delay to avoid rate limiting
                  await new Promise((r) => setTimeout(r, 200));
                } catch (gfErr) {
                  console.warn(
                    `[Holdings] Google Finance failed for ${yahoo}:`,
                    gfErr instanceof Error ? gfErr.message : "Unknown error"
                  );
                }
              }

              // Update cache with Google Finance prices
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
            } catch (gfError) {
              console.error(
                "[Holdings] Google Finance fallback failed:",
                gfError
              );
            }
          }
        }

        // TRY TECHNICAL DATA TABLE: Use recently refreshed technical data
        console.log(
          `[Holdings] Checking technical_data table for ${
            staleSymbols.filter((s) => !freshPrices[s]).length
          } remaining symbols...`
        );
        const technicalData = await db
          .select()
          .from(schema.technicalData)
          .where(inArray(schema.technicalData.symbol, staleSymbols));

        for (const tech of technicalData) {
          if (tech.currentPrice && !freshPrices[tech.symbol]) {
            freshPrices[tech.symbol] = tech.currentPrice;
            console.log(
              `[Holdings] ✓ Using technical_data for ${
                tech.symbol
              }: ₹${tech.currentPrice.toFixed(2)} (updated: ${tech.updatedAt})`
            );

            // Also update price cache with this data
            await db
              .insert(schema.priceCache)
              .values({
                symbol: tech.symbol,
                price: tech.currentPrice,
                updatedAt: tech.updatedAt || new Date().toISOString(),
              })
              .onConflictDoUpdate({
                target: schema.priceCache.symbol,
                set: {
                  price: tech.currentPrice,
                  updatedAt: tech.updatedAt || new Date().toISOString(),
                },
              });
          }
        }

        // LAST RESORT: Use stale cache for any still missing
        // When all sources fail, use old cached data
        for (const yahoo of staleSymbols) {
          const cached = cachedPrices.find((c) => c.symbol === yahoo);
          if (cached && !freshPrices[yahoo]) {
            console.log(
              `Using stale cache for ${yahoo} (age: ${cached.updatedAt})`
            );
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

    // Fetch ETF-to-commodity mappings for commodity exposure detection
    const etfMappings = await db.select().from(schema.etfCommodityMappings);
    const commodityMap = new Map<string, string>();
    for (const m of etfMappings) {
      commodityMap.set(m.symbol.toUpperCase(), m.commodityType);
    }

    // Fetch portfolio roles for holdings symbols
    const portfolioRolesData = await db
      .select()
      .from(schema.portfolioRoles)
      .where(inArray(schema.portfolioRoles.symbol, symbols));

    // Create map of symbol to portfolio role
    const portfolioRoleMap = new Map<string, string>();
    for (const pr of portfolioRolesData) {
      portfolioRoleMap.set(pr.symbol, pr.role);
    }

    // Merge technical data into holdings
    const holdingsWithTech = enrichedHoldings.map((h) => {
      const yahooSymbol = mapSymbol(h.symbol);
      const tech = techMap.get(yahooSymbol) || techMap.get(h.symbol);

      // Get portfolio role from portfolio_roles table
      const portfolioRole = portfolioRoleMap.get(h.symbol) || null;

      // Parse portfolio role to enum (defaults to CORE if not set)
      const roleEnum =
        portfolioRole && portfolioRole in PortfolioRole
          ? (PortfolioRole as any)[portfolioRole]
          : PortfolioRole.CORE;

      // Compute zone status using role-aware logic
      const techData = {
        rsi14: tech?.rsi14 ?? null,
        priceVsSma50: tech?.priceVsSma50 ?? null,
        priceVsSma200: tech?.priceVsSma200 ?? null,
        currentPrice: tech?.currentPrice ?? null,
        sma200: tech?.sma200 ?? null,
      };
      const zoneStatus = getZoneStatus(techData, roleEnum);
      const waitReasons = getZoneReasons(techData);

      // Detect commodity exposure from ETF mappings
      const commodityExposure =
        commodityMap.get(h.symbol.toUpperCase()) || null;

      return {
        ...h,
        rsi_14: tech?.rsi14 ?? null,
        sma_50: tech?.sma50 ?? null,
        sma_200: tech?.sma200 ?? null,
        price_vs_sma50: tech?.priceVsSma50 ?? null,
        price_vs_sma200: tech?.priceVsSma200 ?? null,
        zone_status: zoneStatus, // New: BUY, WAIT_TOO_HOT, WAIT_TOO_COLD
        is_wait_zone: zoneStatus !== "BUY", // Backward compatibility
        wait_reasons: waitReasons,
        commodity_exposure: commodityExposure,
        portfolio_role: portfolioRole, // Investment strategy context
        technical_updated_at: tech?.updatedAt ?? null, // Include timestamp
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
