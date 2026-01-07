/**
 * Stock Analysis Cache API
 *
 * GET /api/analysis/cache?symbol=XYZ - Get cached Tier 2 analysis for a stock
 */

import type { APIRoute } from "astro";
import { db, schema } from "../../../lib/db";
import { eq } from "drizzle-orm";

export const GET: APIRoute = async ({ url }) => {
  const symbol = url.searchParams.get("symbol");

  if (!symbol) {
    return new Response(
      JSON.stringify({ error: "Symbol parameter required" }),
      { status: 400 }
    );
  }

  try {
    const cached = await db
      .select()
      .from(schema.stockAnalysisCache)
      .where(eq(schema.stockAnalysisCache.symbol, symbol))
      .limit(1);

    if (cached.length === 0) {
      return new Response(JSON.stringify({ found: false, analysis: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const analysis = cached[0];

    // Parse the full analysis JSON if available
    let fullAnalysis = null;
    if (analysis.analysisJson) {
      try {
        fullAnalysis = JSON.parse(analysis.analysisJson);
      } catch {
        // Ignore parse errors
      }
    }

    return new Response(
      JSON.stringify({
        found: true,
        analysis: {
          symbol: analysis.symbol,
          opportunityScore: analysis.opportunityScore,
          thesisSummary: analysis.thesisSummary,
          risksSummary: analysis.risksSummary,
          timingSignal: analysis.timingSignal,
          newsAlert: analysis.newsAlert,
          newsAlertReason: analysis.newsAlertReason,
          analyzedAt: analysis.analyzedAt,
          expiresAt: analysis.expiresAt,
          // Include source data timestamps
          vrsDataAt: analysis.vrsDataAt,
          financialsAt: analysis.financialsAt,
          valuepickrAt: analysis.valuepickrAt,
          newsAt: analysis.newsAt,
          // Full LLM reasoning if available
          fullAnalysis,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[Analysis Cache] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500 }
    );
  }
};
