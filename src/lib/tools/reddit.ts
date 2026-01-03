/**
 * Reddit Sentiment Tool
 *
 * Provides retail investor sentiment from Indian investment subreddits.
 * This is a SIGNAL source, not a thesis source - use for contrarian indicators.
 */

import { registerToolExecutor, type ToolResponse } from "./registry";
import { searchReddit } from "../scrapers/reddit";

interface GetRedditSentimentArgs {
  query: string;
}

/**
 * Get Reddit sentiment for a stock
 */
async function getRedditSentiment(
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const { query } = args as unknown as GetRedditSentimentArgs;

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
    console.log(`[Reddit Tool] Fetching sentiment for: ${query}`);

    const sentiment = await searchReddit(query.trim(), 10);

    if (sentiment.posts_found === 0) {
      return {
        success: true,
        data: {
          found: false,
          query: query,
          message: `No Reddit discussions found for "${query}"`,
          sentiment_signal: "NO_DATA",
        },
        meta: {
          source: "reddit",
        },
      };
    }

    return {
      success: true,
      data: {
        found: true,
        query: query,
        posts_found: sentiment.posts_found,
        sentiment_signal: sentiment.sentiment_signal,
        subreddits: sentiment.subreddits_searched,
        recent_posts: sentiment.posts.slice(0, 5).map((p) => ({
          title: p.title.substring(0, 100),
          score: p.score,
          comments: p.comments,
          subreddit: p.subreddit,
          age_hours: p.age_hours,
        })),
        interpretation:
          sentiment.sentiment_signal === "BULLISH"
            ? "Retail sentiment is positive - could indicate crowded trade (use as contrarian signal)"
            : sentiment.sentiment_signal === "BEARISH"
            ? "Retail sentiment is negative - could be opportunity if thesis is strong"
            : "Retail sentiment is neutral or mixed",
      },
      meta: {
        source: "reddit",
        fetched_at: sentiment.fetched_at,
      },
    };
  } catch (error) {
    console.error("[Reddit Tool] Error:", error);

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
registerToolExecutor("get_reddit_sentiment", getRedditSentiment);

export { getRedditSentiment };
