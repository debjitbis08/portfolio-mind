/**
 * Batch sync technicals for watchlist stocks
 * POST: Sync technical data for all watchlist stocks
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../../lib/middleware/requireAuth";
import { db, schema } from "../../../lib/db";
import { eq } from "drizzle-orm";
import {
  getTechnicalData,
  type TechnicalData,
} from "../../../lib/technical-indicators";
import { getSymbolMappings } from "../../../lib/mappings";

interface SyncResult {
  symbol: string;
  success: boolean;
  error?: string;
  data?: any;
}

export const POST: APIRoute = async ({ request }) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json().catch(() => ({}));
    const { symbols: requestedSymbols } = body;

    // Get symbols to sync
    let symbolsToSync: string[] = [];
    if (requestedSymbols && Array.isArray(requestedSymbols)) {
      symbolsToSync = requestedSymbols;
    } else {
      // Get all watchlist stocks
      const watchlistStocks = await db.select().from(schema.watchlist);
      symbolsToSync = watchlistStocks.map((s) => s.symbol);
    }

    if (symbolsToSync.length === 0) {
      return new Response(JSON.stringify({ error: "No stocks to sync" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Fetch mappings once
    const mappings = await getSymbolMappings();
    const mapSymbol = (s: string) => mappings[s] || s;

    console.log(
      `[Batch Tech Sync] Starting sync for ${symbolsToSync.length} stocks...`
    );

    const results: SyncResult[] = [];

    // Sync each stock
    for (const rawSymbol of symbolsToSync) {
      try {
        const yahooSymbol = mapSymbol(rawSymbol);
        console.log(
          `[Batch Tech Sync] Fetching ${yahooSymbol} (from ${rawSymbol})...`
        );

        const data = await getTechnicalData(yahooSymbol);

        if (data) {
          // Store in database
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

          results.push({ symbol: rawSymbol, success: true, data });
        } else {
          results.push({
            symbol: rawSymbol,
            success: false,
            error: "No data returned",
          });
        }

        // Small delay to avoid aggressive rate limiting
        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        console.error(`[Batch Tech Sync] Error syncing ${rawSymbol}:`, err);
        results.push({
          symbol: rawSymbol,
          success: false,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    return new Response(
      JSON.stringify({
        success: true,
        total: symbolsToSync.length,
        synced: successCount,
        failed: failCount,
        results,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[Batch Tech Sync] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Sync failed",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
