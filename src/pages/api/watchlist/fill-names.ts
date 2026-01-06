/**
 * Fill Missing Watchlist Names API
 * POST: Fetches stock names from Yahoo Finance for watchlist entries with empty names
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../../lib/middleware/requireAuth";
import { db, schema } from "../../../lib/db";
import { eq, isNull, or } from "drizzle-orm";
import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

// Symbol mapping utility
import { getSymbolMappings } from "../../../lib/mappings";

interface FillResult {
  symbol: string;
  name: string | null;
  status: "updated" | "not_found" | "error";
  error?: string;
}

/**
 * Try to get stock name from Yahoo Finance
 */
async function getStockName(symbolToFetch: string): Promise<string | null> {
  const isBseCode = /^\d{5,6}$/.test(symbolToFetch);
  const suffixes = isBseCode ? [".BO", ".NS"] : [".NS", ".BO"];

  for (const suffix of suffixes) {
    try {
      const quote = await yahooFinance.quote(`${symbolToFetch}${suffix}`);
      // Prefer longName, fall back to shortName
      const name = quote.longName || quote.shortName;
      if (name) {
        // Clean up the name (remove exchange suffix if present)
        return name.replace(/\s*-\s*BSE$|\s*-\s*NSE$/i, "").trim();
      }
    } catch {
      // Try next suffix
    }
  }
  return null;
}

export const POST: APIRoute = async ({ request }) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    // Get all watchlist entries with empty or null names
    const stocksNeedingNames = await db
      .select()
      .from(schema.watchlist)
      .where(or(isNull(schema.watchlist.name), eq(schema.watchlist.name, "")));

    if (stocksNeedingNames.length === 0) {
      return new Response(
        JSON.stringify({
          message: "All watchlist entries already have names",
          updated: 0,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const results: FillResult[] = [];
    const mappings = await getSymbolMappings();

    for (const stock of stocksNeedingNames) {
      try {
        const resolvedSymbol = mappings[stock.symbol] || stock.symbol;
        const name = await getStockName(resolvedSymbol);

        if (name) {
          await db
            .update(schema.watchlist)
            .set({ name })
            .where(eq(schema.watchlist.symbol, stock.symbol));

          results.push({ symbol: stock.symbol, name, status: "updated" });
        } else {
          results.push({
            symbol: stock.symbol,
            name: null,
            status: "not_found",
          });
        }
      } catch (error) {
        results.push({
          symbol: stock.symbol,
          name: null,
          status: "error",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    const updatedCount = results.filter((r) => r.status === "updated").length;

    return new Response(
      JSON.stringify({
        message: `Updated ${updatedCount} of ${results.length} stocks`,
        updated: updatedCount,
        results,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Fill names error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Server error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
