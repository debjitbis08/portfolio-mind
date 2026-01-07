/**
 * Technical Data API
 * GET: Fetch technical data for all holdings
 * POST: Refresh technical data
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../lib/middleware/requireAuth";
import { db, getHoldings, schema } from "../../lib/db";
import { eq } from "drizzle-orm";
import {
  getTechnicalData,
  type TechnicalData,
} from "../../lib/technical-indicators";

// Symbol mapping utility
import { getSymbolMappings } from "../../lib/mappings";

export const GET: APIRoute = async ({ request }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  const url = new URL(request.url);
  const requestedSymbol = url.searchParams.get("symbol")?.toUpperCase();

  try {
    let query = db.select().from(schema.technicalData);

    if (requestedSymbol) {
      // In technicalData table, the symbol is the Yahoo symbol (stored via POST)
      // or the mapped symbol. We'll try both just in case, but usually it's the mapped one.
      const mappings = await getSymbolMappings();
      const mappedSymbol = mappings[requestedSymbol] || requestedSymbol;

      query = db
        .select()
        .from(schema.technicalData)
        .where(eq(schema.technicalData.symbol, mappedSymbol)) as any;
    }

    const technicalData = await query;

    // Convert to snake_case for API consistency
    const formatted = technicalData.map((t) => ({
      symbol: t.symbol,
      current_price: t.currentPrice,
      rsi_14: t.rsi14,
      sma_50: t.sma50,
      sma_200: t.sma200,
      price_vs_sma50: t.priceVsSma50,
      price_vs_sma200: t.priceVsSma200,
      updated_at: t.updatedAt,
    }));

    return new Response(JSON.stringify({ data: formatted }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Technical GET error:", err);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const POST: APIRoute = async ({ request }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json().catch(() => ({}));
    const { symbol } = body;

    // Fetch mappings once
    const mappings = await getSymbolMappings();
    const mapSymbol = (s: string) => mappings[s] || s;

    let symbolsToRefresh: string[] = [];

    if (symbol) {
      // Refresh single symbol
      symbolsToRefresh = [mapSymbol(symbol)];
    } else {
      // Get all holdings
      const holdings = await getHoldings();
      if (holdings.length === 0) {
        return new Response(JSON.stringify({ success: true, updated: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Get delisted stocks to skip
      const delistedStocks = await db
        .select({ symbol: schema.watchlist.symbol })
        .from(schema.watchlist)
        .where(eq(schema.watchlist.delisted, true));
      const delistedSymbols = new Set(delistedStocks.map((s) => s.symbol));

      // Filter out delisted holdings
      const activeHoldings = holdings.filter(
        (h) => !delistedSymbols.has(h.symbol)
      );

      console.log(
        `[Technical] Skipping ${
          holdings.length - activeHoldings.length
        } delisted stock(s), refreshing ${activeHoldings.length}`
      );

      // Get unique symbols with Yahoo mapping
      symbolsToRefresh = [
        ...new Set(activeHoldings.map((h) => mapSymbol(h.symbol))),
      ];
    }

    const results: TechnicalData[] = [];
    const errors: string[] = [];

    // Fetch technical data for each symbol
    for (const s of symbolsToRefresh) {
      try {
        const data = await getTechnicalData(s);
        if (data) {
          results.push(data);

          // Store in database
          await db
            .insert(schema.technicalData)
            .values({
              symbol: s,
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
        }
      } catch (err) {
        errors.push(`${s}: ${err}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        updated: results.length,
        errors: errors.length > 0 ? errors : undefined,
        data: results,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Technical POST error:", err);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
