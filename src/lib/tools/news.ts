/**
 * News Tool
 *
 * Fetches recent news for stocks from Google News.
 * Attempts to fetch article content (filtering paywalls),
 * then uses Gemini 2.5 Flash to summarize sentiment and key events.
 */

import { registerToolExecutor, type ToolResponse } from "./registry";
import { getNewsIntel } from "../scrapers/news";
import { getHoldings } from "../db";

interface GetStockNewsArgs {
  symbol: string;
  hours_recent?: number; // Optional: default to 24h for fresher news
}

/**
 * Get company name for a symbol from holdings
 */
async function getCompanyName(symbol: string): Promise<string | null> {
  try {
    const holdings = await getHoldings();
    const holding = holdings.find((h) => h.symbol === symbol);
    return holding?.stockName || null;
  } catch (error) {
    console.warn(`[News Tool] Failed to lookup company name for ${symbol}:`, error);
    return null;
  }
}

/**
 * Get recent news for a stock
 */
async function getStockNews(
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const { symbol, hours_recent = 24 } = args as unknown as GetStockNewsArgs; // Default: 24h for Tier 2

  if (!symbol || symbol.trim().length === 0) {
    return {
      success: false,
      error: {
        code: "PARSE_ERROR",
        message: "Symbol parameter is required",
        retryable: false,
      },
    };
  }

  try {
    // Look up company name from holdings
    const companyName = await getCompanyName(symbol.trim());

    // Use company name if available, otherwise fall back to symbol
    const searchQuery = companyName || symbol.trim();

    console.log(`[News Tool] Fetching news for: ${symbol} (search query: ${searchQuery}, last ${hours_recent}h)`);

    const intel = await getNewsIntel(searchQuery, 5, hours_recent);

    if (intel.articles_found === 0) {
      return {
        success: true,
        data: {
          found: false,
          symbol: symbol,
          search_query: searchQuery,
          message: `No recent news found for "${searchQuery}".`,
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
        symbol: symbol,
        search_query: searchQuery,
        articles_found: intel.articles_found,
        articles_analyzed: intel.articles_readable,
        sentiment_summary: intel.sentiment_summary,
        key_events: intel.key_events,
        headlines: intel.headlines.slice(0, 5).map((h) => ({
          title: h.title,
          source: h.source,
          date: h.date,
        })),
        articles: intel.articles.map((article) => ({
          title: article.title,
          source: article.source,
          date: article.date,
          url: article.url,
          content: article.content,
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
