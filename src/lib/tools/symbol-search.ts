/**
 * Symbol Search Tool
 *
 * Helps find and validate correct stock tickers using Yahoo Finance search.
 * Useful when AI generates incorrect ticker symbols.
 */

import YahooFinance from "yahoo-finance2";
import type { ToolExecutor, ToolResponse } from "./registry";
import { registerToolExecutor } from "./registry";

// Initialize Yahoo Finance client
const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey']
});

interface SymbolSearchResult {
  symbol: string;
  name: string;
  exchange: string;
  type?: string;
  score?: number;
}

/**
 * Search for a stock ticker using company name or partial symbol.
 * Returns a list of potential matches from Yahoo Finance.
 */
async function searchSymbol(query: string): Promise<SymbolSearchResult[]> {
  try {
    const results = (await yahooFinance.search(query, {
      quotesCount: 10,
      newsCount: 0,
    })) as any;

    if (!results.quotes || results.quotes.length === 0) {
      return [];
    }

    // Filter and format results
    const matches: SymbolSearchResult[] = results.quotes
      .filter((q: any) => {
        // Focus on Indian markets (NSE, BSE) and relevant types
        const isIndianExchange =
          q.exchange === "NSI" || // NSE
          q.exchange === "BSE" ||
          (q.symbol && (q.symbol.endsWith(".NS") || q.symbol.endsWith(".BO")));

        const isRelevantType =
          !q.quoteType ||
          q.quoteType === "EQUITY" ||
          q.quoteType === "ETF" ||
          q.quoteType === "INDEX";

        return isIndianExchange && isRelevantType;
      })
      .map((q: any) => ({
        symbol: q.symbol,
        name: q.shortname || q.longname || "Unknown",
        exchange: q.exchange || "Unknown",
        type: q.quoteType,
        score: q.score,
      }));

    return matches;
  } catch (error: any) {
    console.error("[SymbolSearch] Error searching for symbol:", error.message);
    return [];
  }
}

/**
 * Validate if a ticker exists and can fetch quotes from Yahoo Finance.
 * Tries both NSE (.NS) and BSE (.BO) suffixes.
 */
async function validateTicker(
  ticker: string
): Promise<{ valid: boolean; workingTicker?: string; price?: number }> {
  // Normalize ticker
  let baseTicker = ticker.toUpperCase().replace(/\.(NS|BO|BSE|NSE)$/, "");

  // Try common variations
  const tickersToTry = [
    `${baseTicker}.NS`, // NSE first (more liquid)
    `${baseTicker}.BO`, // BSE
    baseTicker, // Raw ticker (for global assets)
  ];

  for (const tryTicker of tickersToTry) {
    try {
      const quote = (await yahooFinance.quote(tryTicker)) as any;
      if (quote && quote.regularMarketPrice) {
        return {
          valid: true,
          workingTicker: tryTicker,
          price: quote.regularMarketPrice as number,
        };
      }
    } catch (error) {
      // Try next ticker
      continue;
    }
  }

  return { valid: false };
}

/**
 * Smart symbol search that combines search + validation.
 * Returns the best match with validation status.
 */
async function findBestMatch(
  companyName: string
): Promise<{
  found: boolean;
  matches: Array<{
    symbol: string;
    name: string;
    exchange: string;
    validated: boolean;
    price?: number;
  }>;
}> {
  // First, search for potential matches
  const searchResults = await searchSymbol(companyName);

  if (searchResults.length === 0) {
    return { found: false, matches: [] };
  }

  // Validate each match (but limit to top 5 to avoid rate limits)
  const matches = await Promise.all(
    searchResults.slice(0, 5).map(async (result) => {
      const validation = await validateTicker(result.symbol);
      return {
        symbol: validation.workingTicker || result.symbol,
        name: result.name,
        exchange: result.exchange,
        validated: validation.valid,
        price: validation.price,
      };
    })
  );

  // Sort: validated first, then by score
  matches.sort((a, b) => {
    if (a.validated && !b.validated) return -1;
    if (!a.validated && b.validated) return 1;
    return 0;
  });

  return {
    found: matches.length > 0,
    matches,
  };
}

// Tool executor
const executeSymbolSearch: ToolExecutor = async (
  args: Record<string, unknown>
): Promise<ToolResponse> => {
  const query = args.query as string;
  const mode = (args.mode as string) || "search"; // 'search' | 'validate' | 'smart'

  if (!query || typeof query !== "string") {
    return {
      success: false,
      error: {
        code: "PARSE_ERROR",
        message: "Query parameter is required and must be a string",
        retryable: false,
      },
    };
  }

  try {
    if (mode === "validate") {
      // Just validate if a ticker exists
      const result = await validateTicker(query);
      return {
        success: true,
        data: result,
      };
    } else if (mode === "smart") {
      // Smart search: find best match and validate
      const result = await findBestMatch(query);
      return {
        success: true,
        data: result,
      };
    } else {
      // Default: search only
      const results = await searchSymbol(query);
      return {
        success: true,
        data: {
          query,
          found: results.length > 0,
          results,
        },
      };
    }
  } catch (error: any) {
    return {
      success: false,
      error: {
        code: "UNKNOWN",
        message: error.message || "Failed to search for symbol",
        retryable: true,
      },
    };
  }
};

// Register the tool
registerToolExecutor("search_symbol", executeSymbolSearch);

// Export for direct use (outside of tool system)
export { searchSymbol, validateTicker, findBestMatch };
