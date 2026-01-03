/**
 * News Tool
 *
 * Fetches recent news for stocks from Google News.
 * Attempts to fetch article content (filtering paywalls),
 * then uses Gemini 2.5 Flash to summarize sentiment and key events.
 */

import { registerToolExecutor, type ToolResponse } from "./registry";
import { getNewsIntel } from "../scrapers/news";

interface GetStockNewsArgs {
  query: string;
}

/**
 * Get recent news for a stock
 */
async function getStockNews(
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const { query } = args as unknown as GetStockNewsArgs;

  if (!query || query.trim().length === 0) {
    return {
      success: false,
      error: {
        code: "PARSE_ERROR",
        message: "Query parameter is required",
        retryable: false,
      },
    };
  }

  try {
    console.log(`[News Tool] Fetching news for: ${query}`);

    const intel = await getNewsIntel(query.trim(), 5);

    if (intel.articles_found === 0) {
      return {
        success: true,
        data: {
          found: false,
          query: query,
          message: `No recent news found for "${query}".`,
        },
        meta: {
          source: "google_news",
        },
      };
    }

    return {
      success: true,
      data: {
        found: true,
        query: query,
        articles_found: intel.articles_found,
        articles_analyzed: intel.articles_readable,
        sentiment_summary: intel.sentiment_summary,
        key_events: intel.key_events,
        headlines: intel.headlines.slice(0, 5).map((h) => ({
          title: h.title,
          source: h.source,
          date: h.date,
        })),
        instructions:
          "Use this to understand recent events affecting the stock. Key events may indicate catalysts or risks. Sentiment shows the current market narrative - but remember, market sentiment can be wrong.",
      },
      meta: {
        source: "google_news",
        fetched_at: intel.fetched_at,
      },
    };
  } catch (error) {
    console.error("[News Tool] Error:", error);

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
registerToolExecutor("get_stock_news", getStockNews);

export { getStockNews };
