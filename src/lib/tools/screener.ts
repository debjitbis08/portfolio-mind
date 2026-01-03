/**
 * Screener.in Tool
 *
 * Cache-first strategy to prevent account bans.
 * Uses the existing ScreenerService and watchlist table.
 */

import { db, schema } from "../db";
import { eq } from "drizzle-orm";
import { registerToolExecutor, type ToolResponse } from "./registry";

interface BrowseScreenerArgs {
  screen_id?: string;
  force_refresh?: boolean;
}

/**
 * Browse screener - cache-first implementation
 */
async function browseScreener(
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const { screen_id = "default" } = args as unknown as BrowseScreenerArgs;

  try {
    // Get all screener stocks from watchlist
    const stocks = await db
      .select()
      .from(schema.watchlist)
      .where(eq(schema.watchlist.source, "screener"));

    if (stocks.length === 0) {
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

    // Calculate cache age from the oldest entry
    const oldestEntry = new Date(
      Math.min(
        ...stocks.map((s) => new Date(s.addedAt || Date.now()).getTime())
      )
    );
    const cacheAgeHours =
      (Date.now() - oldestEntry.getTime()) / (1000 * 60 * 60);

    console.log(
      `[Screener Tool] Returning ${
        stocks.length
      } cached symbols (${cacheAgeHours.toFixed(1)}h old)`
    );

    return {
      success: true,
      data: {
        screen_name: screen_id,
        stocks_count: stocks.length,
        from_cache: true,
        cache_age_hours: Math.round(cacheAgeHours * 10) / 10,
        stocks: stocks.map((s) => ({
          symbol: s.symbol,
          name: s.symbol,
        })),
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
