/**
 * News Tool
 *
 * Fetches recent news for stocks from Google News.
 */

import { registerToolExecutor, type ToolResponse } from "./registry";
import { fetchGoogleNews, summarizeNewsSentiment } from "../scrapers/news";

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

    const news = await fetchGoogleNews(query.trim(), 5);

    if (news.items.length === 0) {
      return {
        success: true,
        data: {
          found: false,
          query: query,
          message: `No recent news found for "${query}"`,
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
        news_count: news.items.length,
        headlines: news.items.map((item) => ({
          title: item.title,
          source: item.source,
          date: item.pubDate,
        })),
        summary: summarizeNewsSentiment(news),
      },
      meta: {
        source: "google_news",
        fetched_at: news.fetched_at,
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
