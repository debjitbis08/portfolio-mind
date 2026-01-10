/**
 * Catalyst Suggestions API
 *
 * Generate and manage AI-driven suggestions for the catalyst/swing trading portfolio.
 * Uses the CatalystGeminiService for short-term focused analysis.
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../../lib/middleware/requireAuth";
import { db, schema, getCatalystHoldings, isPriceStale } from "../../../lib/db";
import { eq, desc, inArray, and } from "drizzle-orm";
import {
  CatalystGeminiService,
  type CatalystHoldingForAnalysis,
  type CatalystSuggestion,
} from "../../../lib/catalyst/catalyst-gemini";
import YahooFinance from "yahoo-finance2";
import { getSymbolMappings } from "../../../lib/mappings";

const yahooFinance = new YahooFinance();

/**
 * GET: Retrieve catalyst portfolio suggestions
 */
export const GET: APIRoute = async ({ request }) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "pending";
  const limit = parseInt(url.searchParams.get("limit") || "20", 10);

  try {
    // Get catalyst suggestions
    let query = db
      .select()
      .from(schema.suggestions)
      .where(eq(schema.suggestions.portfolioType, "CATALYST"))
      .orderBy(desc(schema.suggestions.createdAt))
      .limit(limit);

    if (status !== "all") {
      query = db
        .select()
        .from(schema.suggestions)
        .where(
          and(
            eq(schema.suggestions.portfolioType, "CATALYST"),
            eq(
              schema.suggestions.status,
              status as "pending" | "approved" | "rejected" | "expired"
            )
          )
        )
        .orderBy(desc(schema.suggestions.createdAt))
        .limit(limit);
    }

    const suggestions = await query;

    return new Response(
      JSON.stringify({
        suggestions: suggestions.map((s) => ({
          id: s.id,
          symbol: s.symbol,
          stockName: s.stockName,
          action: s.action,
          rationale: s.rationale,
          confidence: s.confidence,
          quantity: s.quantity,
          allocationAmount: s.allocationAmount,
          currentPrice: s.currentPrice,
          targetPrice: s.targetPrice,
          technicalScore: s.technicalScore,
          status: s.status,
          citations: s.citations ? JSON.parse(s.citations) : [],
          createdAt: s.createdAt,
          expiresAt: s.expiresAt,
          reviewedAt: s.reviewedAt,
          // Catalyst-specific fields
          stopLoss: s.stopLoss,
          maxHoldDays: s.maxHoldDays,
          riskRewardRatio: s.riskRewardRatio,
          trailingStop: s.trailingStop,
          entryTrigger: s.entryTrigger,
          exitCondition: s.exitCondition,
          volatilityAtEntry: s.volatilityAtEntry,
          catalystId: s.catalystId,
        })),
        count: suggestions.length,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[Catalyst Suggestions] GET error:", error);
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

/**
 * POST: Generate new catalyst suggestions via AI analysis
 */
export const POST: APIRoute = async ({ request }) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    console.log("[Catalyst Suggestions] Starting analysis...");

    // Get catalyst holdings
    const holdings = await getCatalystHoldings();
    const symbols = holdings.map((h) => h.symbol);

    // Fetch prices for holdings
    const mappings = await getSymbolMappings();
    const mapSymbol = (s: string) => mappings[s] || s;
    const uniqueYahooSymbols = [...new Set(symbols.map(mapSymbol))];

    let quotes: Record<string, number> = {};

    if (uniqueYahooSymbols.length > 0) {
      // Check cache first
      const cachedPrices = await db
        .select()
        .from(schema.priceCache)
        .where(inArray(schema.priceCache.symbol, uniqueYahooSymbols));

      for (const cached of cachedPrices) {
        if (!isPriceStale(cached.updatedAt)) {
          quotes[cached.symbol] = cached.price;
        }
      }

      // Fetch missing from Yahoo
      const missingSymbols = uniqueYahooSymbols.filter((s) => !quotes[s]);
      if (missingSymbols.length > 0) {
        try {
          const nseSymbols = missingSymbols.map((s) => `${s}.NS`);
          const results = await yahooFinance.quote(nseSymbols);
          const arr = Array.isArray(results) ? results : [results];
          for (const q of arr) {
            if (q?.symbol && q.regularMarketPrice) {
              quotes[q.symbol.replace(".NS", "")] = q.regularMarketPrice;
            }
          }
        } catch (e) {
          console.warn("[Catalyst Suggestions] Yahoo fetch failed:", e);
        }
      }
    }

    // Fetch technical data
    const technicalData = await db.select().from(schema.technicalData);
    const techMap = new Map<string, (typeof technicalData)[0]>();
    for (const t of technicalData) {
      techMap.set(t.symbol, t);
    }

    // Build holdings for analysis
    const holdingsForAnalysis: CatalystHoldingForAnalysis[] = holdings.map(
      (h) => {
        const yahooSymbol = mapSymbol(h.symbol);
        const currentPrice = quotes[yahooSymbol] || quotes[h.symbol] || 0;
        const tech = techMap.get(yahooSymbol) || techMap.get(h.symbol);
        const investedValue = h.investedValue;
        const currentValue = currentPrice * h.quantity;
        const returnsPercent =
          investedValue > 0
            ? ((currentValue - investedValue) / investedValue) * 100
            : 0;

        return {
          symbol: h.symbol,
          stock_name: h.stockName,
          quantity: h.quantity,
          avg_buy_price: h.avgBuyPrice,
          current_price: currentPrice,
          returns_percent: returnsPercent,
          rsi_14: tech?.rsi14 ?? null,
          price_vs_sma50: tech?.priceVsSma50 ?? null,
          price_vs_sma200: tech?.priceVsSma200 ?? null,
        };
      }
    );

    // Get catalyst funds from settings
    const [settings] = await db.select().from(schema.settings).limit(1);
    const catalystFunds = settings?.catalystFunds ?? 0;

    console.log(
      `[Catalyst Suggestions] Analyzing ${holdingsForAnalysis.length} holdings with ₹${catalystFunds} available`
    );

    // Run catalyst analysis
    const suggestions = await CatalystGeminiService.analyzeCatalystPortfolio(
      holdingsForAnalysis,
      catalystFunds,
      (pct, msg) => console.log(`[Catalyst] ${pct}% - ${msg}`)
    );

    console.log(
      `[Catalyst Suggestions] Generated ${suggestions.length} suggestions`
    );

    // Save suggestions to database
    const savedSuggestions: any[] = [];

    for (const suggestion of suggestions) {
      const [saved] = await db
        .insert(schema.suggestions)
        .values({
          symbol: suggestion.symbol,
          stockName: suggestion.stock_name,
          action: suggestion.action as any,
          rationale: suggestion.rationale,
          confidence: suggestion.confidence,
          quantity: suggestion.quantity,
          allocationAmount: suggestion.allocation_amount,
          currentPrice: suggestion.entry_price,
          targetPrice: suggestion.target_price,
          technicalScore: suggestion.technical_score,
          portfolioType: "CATALYST",
          status: "pending",
          citations: suggestion.citations
            ? JSON.stringify(suggestion.citations)
            : null,
          // Catalyst-specific fields
          stopLoss: suggestion.stop_loss,
          maxHoldDays: suggestion.max_hold_days,
          riskRewardRatio: suggestion.risk_reward_ratio,
          trailingStop: suggestion.trailing_stop ? 1 : 0, // Convert boolean to SQLite integer
          entryTrigger: suggestion.entry_trigger,
          exitCondition: suggestion.exit_condition,
          volatilityAtEntry: suggestion.volatility_at_entry,
          catalystId: suggestion.catalyst_id,
        })
        .returning();

      savedSuggestions.push(saved);
    }

    return new Response(
      JSON.stringify({
        success: true,
        count: savedSuggestions.length,
        suggestions: savedSuggestions.map((s) => ({
          id: s.id,
          symbol: s.symbol,
          action: s.action,
          rationale: s.rationale,
          confidence: s.confidence,
        })),
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[Catalyst Suggestions] POST error:", error);
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

/**
 * PATCH: Update suggestion status (approve/reject)
 */
export const PATCH: APIRoute = async ({ request }) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { id, status, notes } = body;

    if (!id || !status) {
      return new Response(
        JSON.stringify({ error: "id and status are required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (!["approved", "rejected", "expired"].includes(status)) {
      return new Response(JSON.stringify({ error: "Invalid status" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const [updated] = await db
      .update(schema.suggestions)
      .set({
        status: status as "approved" | "rejected" | "expired",
        reviewedAt: new Date().toISOString(),
      })
      .where(eq(schema.suggestions.id, id))
      .returning();

    if (!updated) {
      return new Response(JSON.stringify({ error: "Suggestion not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // If notes provided, save them
    if (notes) {
      await db.insert(schema.actionNotes).values({
        suggestionId: id,
        content: notes,
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        suggestion: {
          id: updated.id,
          symbol: updated.symbol,
          action: updated.action,
          status: updated.status,
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[Catalyst Suggestions] PATCH error:", error);
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
