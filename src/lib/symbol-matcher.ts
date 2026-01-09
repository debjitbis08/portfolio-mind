/**
 * Symbol Matcher Utility
 *
 * Handles fuzzy matching between different symbol formats:
 * - NSE symbols with suffix (HAL.NS, RELIANCE.NS)
 * - BSE symbols with suffix (HAL.BO)
 * - Clean symbols (HAL, RELIANCE)
 *
 * Used to match catalyst data (which may use clean symbols) with
 * portfolio symbols (which include exchange suffixes).
 */

export interface SymbolMatchResult {
  matched: boolean;
  confidence: number; // 0-1
  matchedSymbol?: string;
}

/**
 * Normalize a symbol by removing exchange suffixes and converting to uppercase
 */
export function normalizeSymbol(symbol: string): string {
  return symbol
    .toUpperCase()
    .replace(/\.(NS|BO|BSE|NSE)$/, '')
    .trim();
}

/**
 * Check if two symbols match, accounting for exchange suffixes
 *
 * @example
 * matchSymbols("HAL.NS", "HAL") // { matched: true, confidence: 1.0 }
 * matchSymbols("RELIANCE.NS", "RELIANCE.BO") // { matched: true, confidence: 0.9 }
 * matchSymbols("HAL", "HINDCOPPER") // { matched: false, confidence: 0.0 }
 */
export function matchSymbols(symbol1: string, symbol2: string): SymbolMatchResult {
  const norm1 = normalizeSymbol(symbol1);
  const norm2 = normalizeSymbol(symbol2);

  // Exact match after normalization
  if (norm1 === norm2) {
    return {
      matched: true,
      confidence: 1.0,
      matchedSymbol: symbol2,
    };
  }

  // Check if one is a prefix of the other (e.g., "TCS" vs "TCSTECH")
  if (norm1.startsWith(norm2) || norm2.startsWith(norm1)) {
    const minLen = Math.min(norm1.length, norm2.length);
    const maxLen = Math.max(norm1.length, norm2.length);

    // Only match if the shorter symbol is at least 70% of the longer one
    if (minLen / maxLen >= 0.7) {
      return {
        matched: true,
        confidence: minLen / maxLen,
        matchedSymbol: symbol2,
      };
    }
  }

  return {
    matched: false,
    confidence: 0.0,
  };
}

/**
 * Find matching symbols from a list of candidates
 *
 * @param targetSymbol - The symbol to match
 * @param candidates - List of candidate symbols to check
 * @param minConfidence - Minimum confidence threshold (default: 0.9)
 * @returns Array of matching symbols sorted by confidence (highest first)
 */
export function findMatchingSymbols(
  targetSymbol: string,
  candidates: string[],
  minConfidence: number = 0.9
): Array<{ symbol: string; confidence: number }> {
  const matches: Array<{ symbol: string; confidence: number }> = [];

  for (const candidate of candidates) {
    const result = matchSymbols(targetSymbol, candidate);
    if (result.matched && result.confidence >= minConfidence) {
      matches.push({
        symbol: candidate,
        confidence: result.confidence,
      });
    }
  }

  // Sort by confidence (highest first)
  return matches.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Check if a symbol appears in a list of affected symbols (with fuzzy matching)
 *
 * @param symbol - The symbol to check
 * @param affectedSymbols - List of symbols that may be affected by a catalyst
 * @returns true if symbol matches any in the affected list
 */
export function isSymbolAffected(
  symbol: string,
  affectedSymbols: string[]
): boolean {
  const matches = findMatchingSymbols(symbol, affectedSymbols, 0.9);
  return matches.length > 0;
}

/**
 * Common AI-generated ticker mistakes and their corrections
 * Add entries here when you discover the AI is generating wrong tickers
 *
 * Format: 'WRONG_TICKER.NS': 'CORRECT_TICKER.NS'
 *
 * To find the correct ticker:
 * 1. Search the stock name on NSE/BSE website
 * 2. Or use Yahoo Finance search
 * 3. Add the mapping here once confirmed
 */
const TICKER_CORRECTIONS: Record<string, string> = {
  // Examples:
  'BHARATFORGE.NS': 'BHARATFORG.NS',  // Bharat Forge Ltd
  "TATAMOTORS.NS": "TMPV.NS", // Tata Motors Ltd (corrected case)
  "HPCL.NS": "HINDPETRO.NS",       // Hindustan Petroleum Corp Ltd
  "VARDHMNRLV.NS": "VTL.NS",      // Vardhman Textiles Limited
  "REC.NS": "RECLTD.NS",           // REC Limited
  "EMS.NS": "EMSLIMITED.NS",       // EMS Limited
  "MARUTIINT.NS": "MARUTI.NS",     // Maruti Suzuki India Ltd
  // 'JMFINANCIAL.NS': 'JMFINANCIL.NS',  // JM Financial Ltd
  // 'BHARTIA.NS': 'BHARTIARTL.NS',      // Bharti Airtel Ltd

  // Add your corrections below:
};

/**
 * Correct a potentially wrong ticker symbol
 * Returns the corrected ticker if a correction exists, otherwise returns the original
 */
export function correctTicker(ticker: string): string {
  return TICKER_CORRECTIONS[ticker] || ticker;
}

/**
 * Correct all tickers in an array
 */
export function correctTickers(tickers: string[]): string[] {
  return tickers.map(correctTicker);
}

/**
 * Search for a ticker correction using the symbol search tool.
 * This is an async operation that queries Yahoo Finance.
 *
 * @param wrongTicker - The incorrect ticker
 * @param companyName - The company name to search for
 * @returns Promise with the suggested correct ticker, or null if not found
 */
export async function searchTickerCorrection(
  wrongTicker: string,
  companyName: string
): Promise<string | null> {
  try {
    // Dynamic import to avoid circular dependencies
    const { findBestMatch } = await import("./tools/symbol-search");
    const result = await findBestMatch(companyName);

    if (result.found && result.matches.length > 0) {
      const bestMatch = result.matches[0];
      if (bestMatch.validated) {
        return bestMatch.symbol;
      }
    }
  } catch (error) {
    console.debug(`[SymbolMatcher] Search failed for "${companyName}":`, error);
  }
  return null;
}
