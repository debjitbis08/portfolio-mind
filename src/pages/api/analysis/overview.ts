/**
 * Analysis Overview API
 *
 * GET: Returns stocks eligible for Tier 3 analysis with statistics
 */

import type { APIRoute } from "astro";
import { db, schema, getHoldings } from "../../../lib/db";
import { desc } from "drizzle-orm";

export const GET: APIRoute = async () => {
  try {
    // Get current holdings (stocks with qty > 0)
    const holdingsList = await getHoldings();

    // Get watchlist stocks (for metadata and delisted status)
    const allWatchlistStocks = await db
      .select({
        symbol: schema.watchlist.symbol,
        name: schema.watchlist.name,
        interesting: schema.watchlist.interesting,
        delisted: schema.watchlist.delisted,
      })
      .from(schema.watchlist);

    // Create a map for quick lookups
    const watchlistMap = new Map(
      allWatchlistStocks.map((s) => [s.symbol, s])
    );

    // Filter out delisted holdings (handle null as not delisted)
    const activeHoldings = holdingsList.filter(
      (h) => watchlistMap.get(h.symbol)?.delisted !== true
    );
    const holdingSymbols = new Set(activeHoldings.map((h) => h.symbol));

    // Filter for interesting and not delisted
    const interestingStocks = allWatchlistStocks.filter(
      (s) => s.interesting === true && s.delisted !== true
    );

    const interestingSymbols = new Set(interestingStocks.map((s) => s.symbol));

    // Get all cached analyses
    const allCached = await db
      .select()
      .from(schema.stockAnalysisCache)
      .orderBy(desc(schema.stockAnalysisCache.opportunityScore));

    // Build eligible stocks list (holdings OR interesting)
    const eligibleSymbols = new Set([...holdingSymbols, ...interestingSymbols]);

    // Filter cached to only eligible
    const eligibleCached = allCached.filter((c) =>
      eligibleSymbols.has(c.symbol)
    );

    // Build response with holdings and watchlist sections
    const holdings = Array.from(holdingSymbols).map((symbol) => {
      const cached = eligibleCached.find((c) => c.symbol === symbol);
      const watchlistEntry = interestingStocks.find((s) => s.symbol === symbol);
      return {
        symbol,
        name: watchlistEntry?.name || symbol,
        isHolding: true,
        isInteresting: interestingSymbols.has(symbol),
        analysis: cached
          ? {
              opportunityScore: cached.opportunityScore,
              timingSignal: cached.timingSignal,
              thesisSummary: cached.thesisSummary,
              risksSummary: cached.risksSummary,
              newsAlert: cached.newsAlert,
              newsAlertReason: cached.newsAlertReason,
              analyzedAt: cached.analyzedAt,
              expiresAt: cached.expiresAt,
            }
          : null,
      };
    });

    const watchlist = interestingStocks
      .filter((s) => !holdingSymbols.has(s.symbol))
      .map((stock) => {
        const cached = eligibleCached.find((c) => c.symbol === stock.symbol);
        return {
          symbol: stock.symbol,
          name: stock.name || stock.symbol,
          isHolding: false,
          isInteresting: true,
          analysis: cached
            ? {
                opportunityScore: cached.opportunityScore,
                timingSignal: cached.timingSignal,
                thesisSummary: cached.thesisSummary,
                risksSummary: cached.risksSummary,
                newsAlert: cached.newsAlert,
                newsAlertReason: cached.newsAlertReason,
                analyzedAt: cached.analyzedAt,
                expiresAt: cached.expiresAt,
              }
            : null,
        };
      });

    // Calculate statistics
    const allEligible = [...holdings, ...watchlist];
    const analyzed = allEligible.filter((s) => s.analysis !== null);
    const withAlerts = analyzed.filter((s) => s.analysis?.newsAlert);
    const scores = analyzed
      .map((s) => s.analysis?.opportunityScore)
      .filter((s): s is number => s !== null && s !== undefined);

    const statistics = {
      totalEligible: allEligible.length,
      holdingsCount: holdings.length,
      watchlistCount: watchlist.length,
      analyzed: analyzed.length,
      pending: allEligible.length - analyzed.length,
      withAlerts: withAlerts.length,
      avgScore:
        scores.length > 0
          ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
          : null,
      accumulate: analyzed.filter(
        (s) => s.analysis?.timingSignal === "accumulate"
      ).length,
      wait: analyzed.filter((s) => s.analysis?.timingSignal === "wait").length,
      avoid: analyzed.filter((s) => s.analysis?.timingSignal === "avoid")
        .length,
    };

    return new Response(
      JSON.stringify({
        holdings,
        watchlist,
        statistics,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[Analysis Overview] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500 }
    );
  }
};
