/**
 * ValuePickr Tool
 *
 * Searches and fetches investment theses from ValuePickr forum.
 */

import { registerToolExecutor, type ToolResponse } from "./registry";
import { ValuePickrService } from "../scrapers/valuepickr";

interface GetStockThesisArgs {
  query: string;
}

/**
 * Get stock thesis from ValuePickr
 */
async function getStockThesis(
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const { query } = args as unknown as GetStockThesisArgs;

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
    console.log(`[ValuePickr Tool] Searching for: ${query}`);

    const intel = await ValuePickrService.getResearch(query.trim());

    if (!intel) {
      return {
        success: true,
        data: {
          found: false,
          query: query,
          message: `No ValuePickr discussion found for "${query}"`,
        },
        meta: {
          source: "valuepickr",
        },
      };
    }

    return {
      success: true,
      data: {
        found: true,
        query: query,
        topic_url: intel.topic_url,
        thesis_summary: intel.thesis_summary,
        recent_sentiment: intel.recent_sentiment_summary || null,
        last_activity: intel.last_activity,
      },
      meta: {
        source: "valuepickr",
      },
    };
  } catch (error) {
    console.error("[ValuePickr Tool] Error:", error);

    // Check for rate limiting
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    const isRateLimit =
      errorMessage.includes("429") ||
      errorMessage.includes("rate") ||
      errorMessage.includes("slow");

    return {
      success: false,
      error: {
        code: isRateLimit ? "RATE_LIMITED" : "UNKNOWN",
        message: errorMessage,
        retryable: isRateLimit,
      },
    };
  }
}

// Register the executor
registerToolExecutor("get_stock_thesis", getStockThesis);

export { getStockThesis };
