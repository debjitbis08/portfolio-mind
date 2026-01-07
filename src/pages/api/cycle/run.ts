/**
 * Discovery Cycle API
 * POST: Run a discovery cycle to analyze holdings and generate suggestions
 * GET: Get cycle history
 *
 * Query params:
 * - useCachedAnalysis=true (default): Uses Tier 3 with pre-analyzed stock summaries
 * - useCachedAnalysis=false: Uses original Tier 2 with agentic tool calling
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../../lib/middleware/requireAuth";
import { db, getHoldings, schema } from "../../../lib/db";
import { eq, desc } from "drizzle-orm";
import { GeminiService, type HoldingForAnalysis } from "../../../lib/gemini";

export const POST: APIRoute = async ({ request, url }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  // Check if using Tier 3 (cached analysis) - default is true
  const useCachedAnalysis =
    url.searchParams.get("useCachedAnalysis") !== "false";

  let cycleId: string | null = null;
  try {
    // Check if AI is enabled in settings
    const settings = await db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.id, 1))
      .limit(1);

    if (settings[0] && settings[0].aiEnabled === false) {
      return new Response(
        JSON.stringify({
          error:
            "AI is disabled in settings. Enable it to run discovery cycles.",
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Create cycle run record
    const [cycleRun] = await db.insert(schema.cycleRuns).values({}).returning();

    cycleId = cycleRun.id;

    try {
      // Get holdings
      const dbHoldings = await getHoldings();

      if (dbHoldings.length === 0) {
        throw new Error("No holdings found");
      }

      // Fetch technical data
      const technicalData = await db.select().from(schema.technicalData);

      const techMap = new Map<string, (typeof technicalData)[0]>();
      for (const t of technicalData) {
        techMap.set(t.symbol, t);
      }

      // Get available funds from settings
      const availableFunds = settings[0]?.availableFunds ?? 0;

      // Build holdings with tech data for Gemini
      const holdings: HoldingForAnalysis[] = dbHoldings.map((h) => {
        const tech =
          techMap.get(h.symbol) ||
          techMap.get(`${h.symbol}.NS`) ||
          techMap.get(`${h.symbol}.BO`);

        const priceVsSma50 = tech?.priceVsSma50 ?? null;
        const priceVsSma200 = tech?.priceVsSma200 ?? null;
        const rsi14 = tech?.rsi14 ?? null;

        // Build wait reasons
        const waitReasons: string[] = [];
        if (rsi14 && rsi14 > 40) waitReasons.push(`RSI ${rsi14.toFixed(0)}`);
        if (priceVsSma50 && priceVsSma50 > 15)
          waitReasons.push(`+${priceVsSma50.toFixed(0)}% SMA50`);
        if (priceVsSma200 && priceVsSma200 > 15)
          waitReasons.push(`+${priceVsSma200.toFixed(0)}% SMA200`);
        if (
          tech?.sma200 &&
          tech?.currentPrice &&
          tech.currentPrice < tech.sma200
        ) {
          waitReasons.push("Below SMA200");
        }

        return {
          symbol: h.symbol,
          stock_name: h.stockName,
          quantity: h.quantity,
          avg_buy_price: h.avgBuyPrice,
          current_price: tech?.currentPrice || 0,
          returns_percent:
            h.avgBuyPrice > 0 && tech?.currentPrice
              ? ((tech.currentPrice - h.avgBuyPrice) / h.avgBuyPrice) * 100
              : 0,
          rsi_14: rsi14,
          price_vs_sma50: priceVsSma50,
          price_vs_sma200: priceVsSma200,
          is_wait_zone: waitReasons.length > 0,
          wait_reasons: waitReasons,
        };
      });

      // Run Gemini analysis - Tier 3 (cached) or original agentic
      console.log(
        `[Cycle] Running ${
          useCachedAnalysis ? "Tier 3 (cached)" : "Tier 2 (agentic)"
        } analysis...`
      );

      const suggestions = useCachedAnalysis
        ? await GeminiService.analyzeWithCachedData(holdings, availableFunds)
        : await GeminiService.analyzePortfolio(holdings, availableFunds);

      // Store suggestions
      for (const s of suggestions) {
        await db.insert(schema.suggestions).values({
          cycleId: cycleRun.id,
          symbol: s.symbol,
          stockName: s.stock_name,
          action: s.action as "BUY" | "SELL" | "HOLD" | "WATCH" | "RAISE_CASH",
          rationale: s.rationale || s.reason,
          technicalScore: s.technical_score,
          currentPrice: holdings.find((h) => h.symbol === s.symbol)
            ?.current_price,
          citations: s.citations ? JSON.stringify(s.citations) : null,
          portfolioRole: s.portfolio_role as
            | "VALUE"
            | "MOMENTUM"
            | "CORE"
            | "SPECULATIVE"
            | "INCOME"
            | undefined,
        });
      }

      // Update cycle as completed
      await db
        .update(schema.cycleRuns)
        .set({
          completedAt: new Date().toISOString(),
          symbolsAnalyzed: holdings.length,
          suggestionsCount: suggestions.length,
          status: "completed",
        })
        .where(eq(schema.cycleRuns.id, cycleRun.id));

      return new Response(
        JSON.stringify({
          success: true,
          cycle_id: cycleRun.id,
          analyzed: holdings.length,
          suggestions: suggestions,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (err) {
      // Mark cycle as failed
      if (cycleId) {
        await db
          .update(schema.cycleRuns)
          .set({
            completedAt: new Date().toISOString(),
            status: "failed",
            errorMessage: err instanceof Error ? err.message : "Unknown error",
          })
          .where(eq(schema.cycleRuns.id, cycleId));
      }

      throw err;
    }
  } catch (error) {
    console.error("Cycle error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Cycle failed",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};

export const GET: APIRoute = async ({ request }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const cycles = await db
      .select()
      .from(schema.cycleRuns)
      .orderBy(desc(schema.cycleRuns.startedAt))
      .limit(10);

    // Convert to snake_case
    const formatted = cycles.map((c) => ({
      id: c.id,
      started_at: c.startedAt,
      completed_at: c.completedAt,
      symbols_analyzed: c.symbolsAnalyzed,
      suggestions_count: c.suggestionsCount,
      status: c.status,
      error_message: c.errorMessage,
    }));

    return new Response(JSON.stringify({ cycles: formatted }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Cycles GET error:", error);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
