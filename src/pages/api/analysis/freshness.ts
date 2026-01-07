/**
 * Portfolio Freshness Status API
 *
 * GET: Returns overall data freshness status for all holdings
 *
 * Used by UI to:
 * - Show proactive warnings on Dashboard
 * - Pre-flight check before Tier 3 runs
 * - Identify stocks needing Tier 2 refresh
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../../lib/middleware/requireAuth";
import { checkPortfolioDataFreshness } from "../../../lib/data-freshness";
import { getHoldings } from "../../../lib/db";

export const GET: APIRoute = async ({ request }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    // Get all holdings
    const holdings = await getHoldings();

    if (holdings.length === 0) {
      return new Response(
        JSON.stringify({
          overall_status: "fresh",
          summary: {
            total_stocks: 0,
            fresh: 0,
            aging: 0,
            stale: 0,
            missing_analysis: 0,
          },
          can_run_tier3: true,
          warnings: [],
          recommendation: "No holdings to analyze",
          stocks_needing_refresh: [],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const symbols = holdings.map((h) => h.symbol);

    // Run portfolio freshness check
    const report = await checkPortfolioDataFreshness(symbols);

    // Extract stocks needing refresh (aging or stale)
    const stocksNeedingRefresh = report.stock_reports
      .filter(
        (r) =>
          r.overall_status === "stale" ||
          r.overall_status === "aging" ||
          r.overall_status === "missing"
      )
      .map((r) => ({
        symbol: r.symbol,
        status: r.overall_status,
        reason: r.recommendation,
      }));

    // Build user-friendly response
    const response = {
      overall_status: report.overall_status,
      summary: report.summary,
      can_run_tier3: report.can_proceed,
      warnings: report.warnings.slice(0, 10), // Top 10 warnings
      recommendation: report.recommendation,
      stocks_needing_refresh: stocksNeedingRefresh,
      last_checked: new Date().toISOString(),
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[Freshness API] Error:", error);
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
