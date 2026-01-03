/**
 * Reddit Sentiment Tool
 *
 * Provides retail investor sentiment from Indian investment subreddits.
 * Fetches full post content and comments, then uses Gemini 2.5 Flash
 * to create a comprehensive summary - just like a human would read
 * through the discussions and form an opinion.
 *
 * Use this as a CONTRARIAN indicator:
 * - High retail bullishness → Might be crowded trade
 * - High retail bearishness → Might be opportunity if thesis is strong
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

    const intel = await searchReddit(query.trim(), 5);

    if (intel.posts_found === 0) {
      return {
        success: true,
        data: {
          found: false,
          query: query,
          message: `No Reddit discussions found for "${query}". This stock may not be actively discussed by retail investors.`,
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
        posts_found: intel.posts_found,
        sentiment_summary: intel.sentiment_summary,
        key_points: intel.key_points,
        discussion_quality: intel.discussion_quality,
        subreddits: intel.subreddits_searched.map((s) => `r/${s}`),
        sample_discussions: intel.sample_posts,
        instructions:
          "Use this as a CONTRARIAN indicator. High retail bullishness may indicate a crowded trade. High retail bearishness, combined with a strong thesis, may indicate opportunity. Also consider the discussion quality - high quality discussions with informed analysis are more reliable signals.",
      },
      meta: {
        source: "reddit",
        fetched_at: intel.fetched_at,
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
