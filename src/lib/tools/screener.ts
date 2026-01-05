/**
 * Screener.in Tool
 *
 * Cache-first strategy to prevent account bans.
 * Uses the existing ScreenerService and watchlist table.
 *
 * Enhanced to provide enriched stock data for smarter AI selection.
 */

import { db, schema } from "../db";
import { eq, inArray } from "drizzle-orm";
import { registerToolExecutor, type ToolResponse } from "./registry";

interface BrowseScreenerArgs {
  screen_id?: string;
  force_refresh?: boolean;
}

interface EnrichedStock {
  symbol: string;
  name: string;
  sector: string | null;
  market_cap_cr: number | null;
  pe_ratio: number | null;
  roe: number | null;

  // Technicals
  rsi_14: number | null;
  price_vs_sma50: number | null;
  price_vs_sma200: number | null;

  // Financial trends (may be null if not synced)
  profit_growth_yoy: number | null;
  sales_growth_yoy: number | null;

  // Research flags
  has_valuepickr_thesis: boolean;
  has_user_research: boolean;
  has_financials_synced: boolean;

  // Computed signals
  value_zone: boolean;
  opportunity_score: number;
}

/**
 * Calculate opportunity score based on available data
 * Max 100, designed to work with partial data
 */
function calculateOpportunityScore(stock: Partial<EnrichedStock>): number {
  let score = 0;

  // +30 for ValuePickr thesis (story validated)
  if (stock.has_valuepickr_thesis) score += 30;

  // +25 for value zone (good timing - RSI < 40 and near SMAs)
  if (stock.value_zone) score += 25;

  // +20 for user research (documented conviction)
  if (stock.has_user_research) score += 20;

  // +15 for ROE > 15% (quality business)
  if (stock.roe && stock.roe > 15) score += 15;

  // +10 for profit growth (only if financials synced)
  if (stock.profit_growth_yoy && stock.profit_growth_yoy > 0) score += 10;

  return score;
}

/**
 * Check if stock is in "value zone" - good timing for accumulation
 */
function isInValueZone(
  rsi: number | null,
  priceVsSma50: number | null,
  priceVsSma200: number | null
): boolean {
  // RSI < 40 indicates oversold/value territory
  const rsiGood = rsi !== null && rsi < 40;

  // Within 10% of SMA50 or SMA200 (near support)
  const nearSma50 =
    priceVsSma50 !== null && priceVsSma50 > -15 && priceVsSma50 < 10;
  const nearSma200 =
    priceVsSma200 !== null && priceVsSma200 > -15 && priceVsSma200 < 15;

  // Value zone: RSI good OR near a support level
  return rsiGood || nearSma50 || nearSma200;
}

/**
 * Calculate YoY growth from financial periods
 */
function calculateYoyGrowth(
  financials: {
    reportDate: string;
    netProfit: number | null;
    sales: number | null;
  }[]
): { profitGrowth: number | null; salesGrowth: number | null } {
  if (financials.length < 2) {
    return { profitGrowth: null, salesGrowth: null };
  }

  // Sort by date descending
  const sorted = [...financials].sort(
    (a, b) =>
      new Date(b.reportDate).getTime() - new Date(a.reportDate).getTime()
  );

  const current = sorted[0];
  const previous = sorted[1];

  let profitGrowth: number | null = null;
  let salesGrowth: number | null = null;

  if (
    current.netProfit !== null &&
    previous.netProfit !== null &&
    previous.netProfit !== 0
  ) {
    profitGrowth =
      ((current.netProfit - previous.netProfit) /
        Math.abs(previous.netProfit)) *
      100;
  }

  if (
    current.sales !== null &&
    previous.sales !== null &&
    previous.sales !== 0
  ) {
    salesGrowth = ((current.sales - previous.sales) / previous.sales) * 100;
  }

  return { profitGrowth, salesGrowth };
}

/**
 * Browse screener - cache-first implementation with enriched data
 */
async function browseScreener(
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const { screen_id = "default" } = args as unknown as BrowseScreenerArgs;

  try {
    // Get all screener stocks from watchlist
    const watchlistStocks = await db
      .select()
      .from(schema.watchlist)
      .where(eq(schema.watchlist.source, "screener"));

    if (watchlistStocks.length === 0) {
      return {
        success: false,
        error: {
          code: "NOT_FOUND",
          message:
            "No screener data available. Import screens via Settings > Integrations first.",
          retryable: false,
        },
      };
    }

    const symbols = watchlistStocks.map((s) => s.symbol);

    // Fetch enrichment data in parallel
    const [stockIntelData, technicalData, researchDocs, financialsData] =
      await Promise.all([
        db
          .select()
          .from(schema.stockIntel)
          .where(inArray(schema.stockIntel.symbol, symbols)),
        db
          .select()
          .from(schema.technicalData)
          .where(inArray(schema.technicalData.symbol, symbols)),
        db
          .select({ symbol: schema.companyResearch.symbol })
          .from(schema.companyResearch)
          .where(inArray(schema.companyResearch.symbol, symbols)),
        db
          .select({
            symbol: schema.companyFinancials.symbol,
            reportDate: schema.companyFinancials.reportDate,
            periodType: schema.companyFinancials.periodType,
            netProfit: schema.companyFinancials.netProfit,
            sales: schema.companyFinancials.sales,
          })
          .from(schema.companyFinancials)
          .where(inArray(schema.companyFinancials.symbol, symbols)),
      ]);

    // Build lookup maps
    const intelMap = new Map(stockIntelData.map((i) => [i.symbol, i]));
    const techMap = new Map(technicalData.map((t) => [t.symbol, t]));
    const researchSymbols = new Set(researchDocs.map((r) => r.symbol));

    // Group financials by symbol (annual only for YoY)
    const financialsMap = new Map<string, typeof financialsData>();
    for (const f of financialsData) {
      if (f.periodType === "annual") {
        const existing = financialsMap.get(f.symbol) || [];
        existing.push(f);
        financialsMap.set(f.symbol, existing);
      }
    }

    // Enrich each stock
    const enrichedStocks: EnrichedStock[] = watchlistStocks.map((stock) => {
      const intel = intelMap.get(stock.symbol);
      const tech =
        techMap.get(stock.symbol) ||
        techMap.get(`${stock.symbol}.NS`) ||
        techMap.get(`${stock.symbol}.BO`);
      const financials = financialsMap.get(stock.symbol) || [];

      // Parse fundamentals from stockIntel
      let fundamentals: any = null;
      if (intel?.fundamentals) {
        try {
          fundamentals = JSON.parse(intel.fundamentals);
        } catch {}
      }

      // Check for ValuePickr thesis
      let hasThesis = false;
      if (intel?.socialSentiment) {
        try {
          const sentiment = JSON.parse(intel.socialSentiment);
          hasThesis = !!(sentiment?.thesis_summary || sentiment?.last_activity);
        } catch {}
      }

      // Calculate growth metrics
      const { profitGrowth, salesGrowth } = calculateYoyGrowth(financials);

      // Determine value zone
      const valueZone = isInValueZone(
        tech?.rsi14 ?? null,
        tech?.priceVsSma50 ?? null,
        tech?.priceVsSma200 ?? null
      );

      const enriched: EnrichedStock = {
        symbol: stock.symbol,
        name: fundamentals?.sector ? stock.symbol : stock.symbol, // TODO: Get proper name
        sector: fundamentals?.sector ?? null,
        market_cap_cr: fundamentals?.marketCap
          ? Math.round(fundamentals.marketCap / 10000000)
          : null,
        pe_ratio: fundamentals?.peRatio ?? null,
        roe: fundamentals?.roe ? Math.round(fundamentals.roe * 100) : null,

        rsi_14: tech?.rsi14 ? Math.round(tech.rsi14) : null,
        price_vs_sma50: tech?.priceVsSma50
          ? Math.round(tech.priceVsSma50 * 10) / 10
          : null,
        price_vs_sma200: tech?.priceVsSma200
          ? Math.round(tech.priceVsSma200 * 10) / 10
          : null,

        profit_growth_yoy: profitGrowth ? Math.round(profitGrowth) : null,
        sales_growth_yoy: salesGrowth ? Math.round(salesGrowth) : null,

        has_valuepickr_thesis: hasThesis,
        has_user_research: researchSymbols.has(stock.symbol),
        has_financials_synced: financials.length > 0,

        value_zone: valueZone,
        opportunity_score: 0, // Will be calculated next
      };

      enriched.opportunity_score = calculateOpportunityScore(enriched);

      return enriched;
    });

    // Sort by opportunity_score descending
    enrichedStocks.sort((a, b) => b.opportunity_score - a.opportunity_score);

    // Calculate cache age from the oldest entry
    const oldestEntry = new Date(
      Math.min(
        ...watchlistStocks.map((s) =>
          new Date(s.addedAt || Date.now()).getTime()
        )
      )
    );
    const cacheAgeHours =
      (Date.now() - oldestEntry.getTime()) / (1000 * 60 * 60);

    console.log(
      `[Screener Tool] Returning ${
        enrichedStocks.length
      } enriched symbols (${cacheAgeHours.toFixed(1)}h old)`
    );

    // Summary stats for the agent
    const withThesis = enrichedStocks.filter(
      (s) => s.has_valuepickr_thesis
    ).length;
    const inValueZone = enrichedStocks.filter((s) => s.value_zone).length;
    const topOpportunities = enrichedStocks.filter(
      (s) => s.opportunity_score >= 50
    ).length;

    return {
      success: true,
      data: {
        screen_name: screen_id,
        stocks_count: enrichedStocks.length,
        summary: {
          with_thesis: withThesis,
          in_value_zone: inValueZone,
          high_opportunity: topOpportunities,
          tip: "Focus on stocks with opportunity_score >= 50 for best risk/reward",
        },
        from_cache: true,
        cache_age_hours: Math.round(cacheAgeHours * 10) / 10,
        stocks: enrichedStocks,
        last_updated: oldestEntry.toISOString(),
      },
      meta: {
        from_cache: true,
        cache_age_hours: Math.round(cacheAgeHours * 10) / 10,
        source: "screener",
      },
    };
  } catch (error) {
    console.error("[Screener Tool] Error:", error);
    return {
      success: false,
      error: {
        code: "UNKNOWN",
        message: error instanceof Error ? error.message : "Unknown error",
        retryable: true,
      },
    };
  }
}

// Register the executor
registerToolExecutor("browse_screener", browseScreener);

export { browseScreener };
