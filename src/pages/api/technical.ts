/**
 * Technical Data API
 * GET: Fetch technical data for all holdings
 * POST: Refresh technical data
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../lib/middleware/requireAuth";
import { db, getHoldings, schema } from "../../lib/db";
import {
  getTechnicalData,
  type TechnicalData,
} from "../../lib/technical-indicators";

// Symbol mapping (same as holdings.ts)
const SYMBOL_MAP: Record<string, string> = {
  GODAWARIP: "GPIL",
};

function mapToYahooSymbol(growwSymbol: string): string {
  return SYMBOL_MAP[growwSymbol] || growwSymbol;
}

export const GET: APIRoute = async ({ request }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const technicalData = await db.select().from(schema.technicalData);

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
    // Get holdings
    const holdings = await getHoldings();

    if (holdings.length === 0) {
      return new Response(JSON.stringify({ success: true, updated: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get unique symbols with Yahoo mapping
    const symbols = [
      ...new Set(holdings.map((h) => mapToYahooSymbol(h.symbol))),
    ];

    const results: TechnicalData[] = [];
    const errors: string[] = [];

    // Fetch technical data for each symbol
    for (const symbol of symbols) {
      try {
        const data = await getTechnicalData(symbol);
        if (data) {
          results.push(data);

          // Store in database
          await db
            .insert(schema.technicalData)
            .values({
              symbol,
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
        errors.push(`${symbol}: ${err}`);
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
