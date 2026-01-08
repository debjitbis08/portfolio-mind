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
import { eq, desc, and } from "drizzle-orm";
import { GeminiService, type HoldingForAnalysis } from "../../../lib/gemini";
import { getTechnicalData } from "../../../lib/technical-indicators";
import { getSymbolMappings } from "../../../lib/mappings";
import { checkPortfolioDataFreshness } from "../../../lib/data-freshness";

export const POST: APIRoute = async ({ request, url }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  // Check if using Tier 3 (cached analysis) - default is true
  const useCachedAnalysis =
    url.searchParams.get("useCachedAnalysis") !== "false";

  // Allow forcing stale data (with warning)
  const forceStale = url.searchParams.get("force") === "true";

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

      // Get delisted stocks to skip
      const delistedStocks = await db
        .select({ symbol: schema.watchlist.symbol })
        .from(schema.watchlist)
        .where(eq(schema.watchlist.delisted, true));
      const delistedSymbols = new Set(delistedStocks.map((s) => s.symbol));

      // Filter out delisted holdings
      const activeHoldings = dbHoldings.filter(
        (h) => !delistedSymbols.has(h.symbol)
      );

      if (delistedSymbols.size > 0) {
        const skipped = dbHoldings.length - activeHoldings.length;
        console.log(`[Cycle] Skipping ${skipped} delisted stock(s)`);
      }

      // Check if existing technical data is fresh enough (within 5 minutes)
      const FRESHNESS_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
      const now = Date.now();

      const existingTechData = await db.select().from(schema.technicalData);
      const staleTechCount = existingTechData.filter((t) => {
        if (!t.updatedAt) return true;
        const age = now - new Date(t.updatedAt).getTime();
        return age > FRESHNESS_THRESHOLD_MS;
      }).length;

      if (
        staleTechCount > 0 ||
        existingTechData.length < activeHoldings.length
      ) {
        console.log(
          `[Cycle] Technical data is stale or incomplete (${staleTechCount} stale, ${existingTechData.length}/${activeHoldings.length} stocks). Refreshing...`
        );
      } else {
        console.log(
          `[Cycle] Technical data is fresh (updated within 5 minutes). Skipping refresh.`
        );
      }

      // Refresh technical data for all active holdings before analysis
      const shouldRefresh =
        staleTechCount > 0 || existingTechData.length < activeHoldings.length;

      if (shouldRefresh) {
        console.log(
          `[Cycle] Refreshing technical data for ${activeHoldings.length} holdings...`
        );
      }

      const mappings = await getSymbolMappings();
      const mapSymbol = (s: string) => mappings[s] || s;

      let refreshed = 0;
      let failed = 0;

      for (const holding of activeHoldings) {
        if (!shouldRefresh) {
          // Skip refresh if data is fresh
          continue;
        }

        try {
          const yahooSymbol = mapSymbol(holding.symbol);
          const data = await getTechnicalData(yahooSymbol);

          if (data) {
            // Update or insert technical data
            await db
              .insert(schema.technicalData)
              .values({
                symbol: yahooSymbol,
                currentPrice: data.currentPrice,
                rsi14: data.rsi14,
                sma50: data.sma50,
                sma200: data.sma200,
                priceVsSma50: data.priceVsSma50,
                priceVsSma200: data.priceVsSma200,
                updatedAt: new Date().toISOString(),
              })
              .onConflictDoUpdate({
                target: schema.technicalData.symbol,
                set: {
                  currentPrice: data.currentPrice,
                  rsi14: data.rsi14,
                  sma50: data.sma50,
                  sma200: data.sma200,
                  priceVsSma50: data.priceVsSma50,
                  priceVsSma200: data.priceVsSma200,
                  updatedAt: new Date().toISOString(),
                },
              });

            refreshed++;
          } else {
            console.warn(
              `[Cycle] No technical data available for ${holding.symbol}`
            );
            failed++;
          }

          // Small delay to avoid rate limiting
          await new Promise((r) => setTimeout(r, 500));
        } catch (err) {
          console.error(
            `[Cycle] Error refreshing technical data for ${holding.symbol}:`,
            err
          );
          failed++;
        }
      }

      if (shouldRefresh) {
        console.log(
          `[Cycle] Technical refresh complete: ${refreshed} succeeded, ${failed} failed`
        );
      }

      // Fetch technical data (now fresh or already fresh)
      const technicalData = await db.select().from(schema.technicalData);

      const techMap = new Map<string, (typeof technicalData)[0]>();
      for (const t of technicalData) {
        techMap.set(t.symbol, t);
      }

      // For Tier 3: Validate cached analysis freshness
      if (useCachedAnalysis) {
        console.log(`[Cycle] Validating data freshness for Tier 3 analysis...`);

        const holdingSymbols = activeHoldings.map((h) => h.symbol);
        const freshnessReport = await checkPortfolioDataFreshness(
          holdingSymbols
        );

        console.log(
          `[Cycle] Freshness check: ${freshnessReport.summary.fresh} fresh, ${freshnessReport.summary.aging} aging, ${freshnessReport.summary.stale} stale, ${freshnessReport.summary.missing_analysis} missing`
        );

        if (!freshnessReport.can_proceed && !forceStale) {
          // Block run if critical data is missing
          return new Response(
            JSON.stringify({
              error: "Data freshness check failed",
              recommendation: freshnessReport.recommendation,
              warnings: freshnessReport.warnings,
              summary: freshnessReport.summary,
              stock_reports: freshnessReport.stock_reports.map((r) => ({
                symbol: r.symbol,
                status: r.overall_status,
                recommendation: r.recommendation,
              })),
              hint: "Run Tier 2 analysis for missing stocks or use ?force=true to proceed anyway",
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        if (freshnessReport.overall_status === "stale" && !forceStale) {
          // Warn about stale data but allow proceeding with force
          return new Response(
            JSON.stringify({
              error: "Some cached analysis is stale",
              recommendation: freshnessReport.recommendation,
              warnings: freshnessReport.warnings,
              summary: freshnessReport.summary,
              stock_reports: freshnessReport.stock_reports
                .filter((r) => r.overall_status === "stale")
                .map((r) => ({
                  symbol: r.symbol,
                  status: r.overall_status,
                  recommendation: r.recommendation,
                  checks: r.checks,
                })),
              hint: "Re-run Tier 2 for stale stocks or use ?force=true to proceed with stale data",
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        if (freshnessReport.warnings.length > 0) {
          console.warn(
            `[Cycle] Data freshness warnings:`,
            freshnessReport.warnings
          );
        }

        if (forceStale) {
          console.warn(
            `[Cycle] Proceeding with stale data due to force=true flag`
          );
        }
      }

      // Get available funds from settings
      const availableFunds = settings[0]?.availableFunds ?? 0;

      // Build holdings with tech data for Gemini (using activeHoldings without delisted)
      const holdings: HoldingForAnalysis[] = activeHoldings.map((h) => {
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

      // Store suggestions with superseding logic
      for (const s of suggestions) {
        // Check for existing pending suggestions for this symbol
        const existingSuggestion = await db
          .select({ id: schema.suggestions.id })
          .from(schema.suggestions)
          .where(
            and(
              eq(schema.suggestions.symbol, s.symbol),
              eq(schema.suggestions.status, "pending")
            )
          )
          .limit(1);

        // Insert new suggestion
        const [newSuggestion] = await db
          .insert(schema.suggestions)
          .values({
            cycleId: cycleRun.id,
            symbol: s.symbol,
            stockName: s.stock_name,
            action: s.action as
              | "BUY"
              | "SELL"
              | "HOLD"
              | "WATCH"
              | "RAISE_CASH",
            rationale: s.rationale || s.reason,
            confidence: s.confidence,
            quantity: s.quantity,
            allocationAmount: s.allocation_amount,
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
          })
          .returning();

        // If there was a previous pending suggestion, supersede it
        if (existingSuggestion.length > 0) {
          await db
            .update(schema.suggestions)
            .set({
              status: "superseded",
              supersededBy: newSuggestion.id,
              supersededReason:
                "Updated recommendation from new analysis cycle",
              reviewedAt: new Date().toISOString(),
            })
            .where(eq(schema.suggestions.id, existingSuggestion[0].id));

          console.log(
            `[Cycle] Superseded previous suggestion ${existingSuggestion[0].id} with ${newSuggestion.id} for ${s.symbol}`
          );
        }
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
