/**
 * Watchlist API
 * GET: List all watchlist stocks with enrichment
 * POST: Add stock manually
 * PUT: Update stock (notes, interesting flag)
 * DELETE: Remove stock
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../lib/middleware/requireAuth";
import { db, schema } from "../../lib/db";
import { eq, inArray, desc } from "drizzle-orm";
import {
  getZoneStatus,
  getZoneReasons,
  PortfolioRole,
} from "../../lib/zone-status";

// GET - List all watchlist stocks with enrichment data
export const GET: APIRoute = async ({ request, url }) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const filterSource = url.searchParams.get("source");
    const filterInteresting = url.searchParams.get("interesting");

    // Get all watchlist stocks
    let watchlistStocks = await db
      .select()
      .from(schema.watchlist)
      .orderBy(desc(schema.watchlist.addedAt));

    // Filter out delisted stocks
    watchlistStocks = watchlistStocks.filter((s) => !s.delisted);

    // Apply filters
    if (filterSource) {
      watchlistStocks = watchlistStocks.filter(
        (s) => s.source === filterSource
      );
    }
    if (filterInteresting === "true") {
      watchlistStocks = watchlistStocks.filter((s) => s.interesting);
    }

    const symbols = watchlistStocks.map((s) => s.symbol);

    // Fetch enrichment data
    const [
      stockIntelData,
      technicalData,
      financialsCount,
      vrsResearchData,
      portfolioRolesData,
    ] = await Promise.all([
      symbols.length > 0
        ? db
            .select()
            .from(schema.stockIntel)
            .where(inArray(schema.stockIntel.symbol, symbols))
        : [],
      symbols.length > 0
        ? db
            .select()
            .from(schema.technicalData)
            .where(inArray(schema.technicalData.symbol, symbols))
        : [],
      symbols.length > 0
        ? db
            .select({ symbol: schema.companyFinancials.symbol })
            .from(schema.companyFinancials)
            .where(inArray(schema.companyFinancials.symbol, symbols))
        : [],
      symbols.length > 0
        ? db
            .select()
            .from(schema.vrsResearch)
            .where(inArray(schema.vrsResearch.symbol, symbols))
        : [],
      symbols.length > 0
        ? db
            .select()
            .from(schema.portfolioRoles)
            .where(inArray(schema.portfolioRoles.symbol, symbols))
        : [],
    ]);

    // Build lookup maps
    const intelMap = new Map(stockIntelData.map((i) => [i.symbol, i]));
    const techMap = new Map(technicalData.map((t) => [t.symbol, t]));
    const financialSymbols = new Set(financialsCount.map((f) => f.symbol));
    const vrsMap = new Map(vrsResearchData.map((v) => [v.symbol, v]));
    const portfolioRoleMap = new Map(
      portfolioRolesData.map((pr) => [pr.symbol, pr.role])
    );

    // Enrich stocks
    const enrichedStocks = watchlistStocks.map((stock) => {
      const intel = intelMap.get(stock.symbol);
      const tech =
        techMap.get(stock.symbol) ||
        techMap.get(`${stock.symbol}.NS`) ||
        techMap.get(`${stock.symbol}.BO`);

      // Parse fundamentals
      let fundamentals: any = null;
      if (intel?.fundamentals) {
        try {
          fundamentals = JSON.parse(intel.fundamentals);
        } catch {}
      }

      // Check for thesis
      let hasThesis = false;
      if (intel?.socialSentiment) {
        try {
          const sentiment = JSON.parse(intel.socialSentiment);
          hasThesis = !!(sentiment?.thesis_summary || sentiment?.last_activity);
        } catch {}
      }

      // Get portfolio role
      const portfolioRole = portfolioRoleMap.get(stock.symbol) || null;

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

      return {
        symbol: stock.symbol,
        source: stock.source,
        notes: stock.notes,
        interesting: stock.interesting ?? false,
        added_at: stock.addedAt,
        // Enrichment
        name: stock.name || stock.symbol, // Use stored name, fallback to symbol
        sector: fundamentals?.sector ?? null,
        current_price: tech?.currentPrice ?? null,
        rsi_14: tech?.rsi14 ? Math.round(tech.rsi14) : null,
        sma_50: tech?.sma50 ?? null,
        sma_200: tech?.sma200 ?? null,
        price_vs_sma50: tech?.priceVsSma50 ?? null,
        price_vs_sma200: tech?.priceVsSma200 ?? null,
        zone_status: zoneStatus,
        is_wait_zone: zoneStatus !== "BUY",
        wait_reasons: waitReasons,
        portfolio_role: portfolioRole,
        technical_updated_at: tech?.updatedAt ?? null,
        has_thesis: hasThesis,
        has_financials: financialSymbols.has(stock.symbol),
        vrs_research: vrsMap.get(stock.symbol) || null,
      };
    });

    return new Response(
      JSON.stringify({
        count: enrichedStocks.length,
        stocks: enrichedStocks,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Watchlist GET error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Server error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

// POST - Add stock manually
export const POST: APIRoute = async ({ request }) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { symbol, name, notes } = body;

    if (!symbol || typeof symbol !== "string") {
      return new Response(JSON.stringify({ error: "Symbol is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const normalizedSymbol = symbol.toUpperCase().trim();

    // Check if already exists
    const existing = await db
      .select()
      .from(schema.watchlist)
      .where(eq(schema.watchlist.symbol, normalizedSymbol))
      .limit(1);

    if (existing.length > 0) {
      return new Response(
        JSON.stringify({ error: "Stock already in watchlist" }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      );
    }

    // Insert with optional name
    await db.insert(schema.watchlist).values({
      symbol: normalizedSymbol,
      name: name?.trim() || null,
      source: "manual",
      notes: notes || null,
    });

    // Trigger intel update for the new symbol
    try {
      const { IntelService } = await import("../../lib/intel");
      IntelService.updateFundamentals([normalizedSymbol]).catch((err) =>
        console.error("Background intel update failed:", err)
      );
    } catch {}

    return new Response(
      JSON.stringify({ success: true, symbol: normalizedSymbol }),
      { status: 201, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Watchlist POST error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Server error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

// PUT - Update stock (notes, interesting)
export const PUT: APIRoute = async ({ request }) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { symbol, notes, interesting, name } = body;

    if (!symbol) {
      return new Response(JSON.stringify({ error: "Symbol is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const updates: Partial<typeof schema.watchlist.$inferInsert> = {};
    if (notes !== undefined) updates.notes = notes;
    if (interesting !== undefined) updates.interesting = interesting;
    if (name !== undefined) updates.name = name;

    if (Object.keys(updates).length === 0) {
      return new Response(JSON.stringify({ error: "No updates provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    await db
      .update(schema.watchlist)
      .set(updates)
      .where(eq(schema.watchlist.symbol, symbol.toUpperCase()));

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Watchlist PUT error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Server error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

// DELETE - Remove stock from watchlist
export const DELETE: APIRoute = async ({ request }) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const url = new URL(request.url);
    const symbol = url.searchParams.get("symbol");

    if (!symbol) {
      return new Response(
        JSON.stringify({ error: "Symbol query param required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const normalizedSymbol = symbol.trim().toUpperCase();

    await Promise.all([
      db
        .delete(schema.watchlist)
        .where(eq(schema.watchlist.symbol, normalizedSymbol)),
      db
        .delete(schema.vrsResearch)
        .where(eq(schema.vrsResearch.symbol, normalizedSymbol)),
    ]);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Watchlist DELETE error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Server error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
