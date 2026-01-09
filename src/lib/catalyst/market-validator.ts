/**
 * Market Validator - Yahoo Finance Price/Volume Validation
 *
 * Validates catalyst signals against real-time market data.
 * Uses GLOBAL tickers (HG=F, CL=F) for commodities since NSE/MCX data is often delayed.
 */

import YahooFinance from "yahoo-finance2";
import type { MarketConfirmation, Sentiment, CatalystAsset } from "./types";
import { GLOBAL_VALIDATION_TICKERS } from "./types";
import { validateTicker, findBestMatch } from "../tools/symbol-search";

// Initialize Yahoo Finance client (v3 API)
const yahooFinance = new YahooFinance();

/**
 * Suggest a ticker correction using symbol search.
 * This helps identify the correct ticker when validation fails.
 */
async function suggestTickerCorrection(
  failedTicker: string,
  companyKeyword: string
): Promise<void> {
  try {
    // Skip if no valid search query
    if (!companyKeyword || companyKeyword.trim().length === 0) {
      // Try using the ticker base as a fallback search term
      const baseTicker = failedTicker.replace(/\.(NS|BO|BSE|NSE)$/, '');
      if (baseTicker && baseTicker.length > 2) {
        console.warn(
          `[MarketValidator]    ℹ️  No company name available, trying ticker search: "${baseTicker}"`
        );
        companyKeyword = baseTicker;
      } else {
        console.warn(
          `[MarketValidator]    ⚠️  Cannot suggest correction: no company name or valid ticker base`
        );
        return;
      }
    }

    // Try to find a match using the company keyword
    const result = await findBestMatch(companyKeyword);

    if (result.found && result.matches.length > 0) {
      const bestMatch = result.matches[0];
      if (bestMatch.validated) {
        console.warn(
          `[MarketValidator]    🔍 Suggestion: "${failedTicker}" → "${bestMatch.symbol}" (${bestMatch.name})`
        );
        console.warn(
          `[MarketValidator]    📝 Add to TICKER_CORRECTIONS: "${failedTicker}": "${bestMatch.symbol}"`
        );
      } else if (result.matches.length > 1) {
        console.warn(
          `[MarketValidator]    🔍 Found ${result.matches.length} possible matches:`
        );
        result.matches.slice(0, 3).forEach((match, i) => {
          console.warn(
            `[MarketValidator]       ${i + 1}. ${match.symbol} - ${match.name} (${match.exchange})`
          );
        });
      }
    } else {
      console.warn(
        `[MarketValidator]    ⚠️  No alternatives found for "${companyKeyword}". Try manual search: pnpm tsx scripts/search-ticker.ts --smart "${companyKeyword}"`
      );
    }
  } catch (error: any) {
    // Log error for debugging but don't fail validation
    console.warn(
      `[MarketValidator]    ⚠️  Symbol search failed: ${error.message}`
    );
  }
}

/**
 * Get the validation ticker for an asset.
 * For commodities, uses global futures; for equities, uses the direct ticker.
 */
export function getValidationTicker(asset: CatalystAsset): string | null {
  // First check if the asset has an explicit global validation ticker
  if (asset.globalValidationTicker) {
    return asset.globalValidationTicker;
  }

  // Check if the keyword maps to a known global ticker
  const globalTicker = GLOBAL_VALIDATION_TICKERS[asset.keyword];
  if (globalTicker) {
    return globalTicker;
  }

  // For equities/ETFs, use the direct ticker
  if (
    asset.ticker &&
    (asset.assetType === "EQUITY" || asset.assetType === "ETF")
  ) {
    return asset.ticker;
  }

  return null;
}

/**
 * Validate a catalyst signal with market data.
 * Checks if price and volume confirm the expected sentiment.
 *
 * @param asset - The asset to validate
 * @param expectedSentiment - The sentiment predicted by LLM
 * @returns Market confirmation data
 */
export async function validateWithMarket(
  asset: CatalystAsset,
  expectedSentiment: Sentiment
): Promise<MarketConfirmation | null> {
  const ticker = getValidationTicker(asset);

  if (!ticker) {
    console.warn(
      `[MarketValidator] No validation ticker for "${asset.keyword}"`
    );
    return null;
  }

  // Try both NSE and BSE suffixes if ticker has one
  const tickersToTry: string[] = [ticker];
  if (ticker.endsWith('.NS')) {
    tickersToTry.push(ticker.replace('.NS', '.BO'));
  } else if (ticker.endsWith('.BO')) {
    tickersToTry.push(ticker.replace('.BO', '.NS'));
  }

  let quote: any = null;
  let finalTicker: string = ticker;

  for (const tryTicker of tickersToTry) {
    try {
      quote = (await yahooFinance.quote(tryTicker)) as any;
      if (quote && quote.regularMarketPrice) {
        finalTicker = tryTicker;
        break;
      }
    } catch (err) {
      // Try next ticker
      continue;
    }
  }

  if (!quote || !quote.regularMarketPrice) {
    // Log failed ticker lookups to help identify corrections needed
    // These might be wrong tickers from AI that need to be added to TICKER_CORRECTIONS in symbol-matcher.ts
    console.warn(`[MarketValidator] ❌ No quote data for "${ticker}" (also tried: ${tickersToTry.slice(1).join(', ') || 'no alternatives'})`);
    console.warn(`[MarketValidator]    💡 If this ticker is wrong, add correction to src/lib/symbol-matcher.ts TICKER_CORRECTIONS`);

    // Try to auto-suggest a correction using symbol search
    await suggestTickerCorrection(ticker, asset.keyword);

    return null;
  }

  try {

    const currentPrice = quote.regularMarketPrice as number;
    const priceChange = (quote.regularMarketChangePercent || 0) as number;
    const currentVolume = (quote.regularMarketVolume || 0) as number;
    const averageVolume = (quote.averageDailyVolume10Day ||
      currentVolume) as number;

    // Calculate volume ratio
    const volumeRatio = averageVolume > 0 ? currentVolume / averageVolume : 1;

    // Volume spike: typically > 1.5x average, but during early trading
    // we scale down since volume accumulates through the day
    const hourOfDay = new Date().getUTCHours();
    const tradingHoursFraction = Math.max(0.1, Math.min(1, hourOfDay / 16));
    const adjustedVolumeThreshold = 1.5 * tradingHoursFraction;
    const volumeSpike = volumeRatio > adjustedVolumeThreshold;

    // Check if price confirms sentiment
    // BULLISH should have green price, BEARISH should have red
    let priceConfirmsSentiment = false;
    if (expectedSentiment === "BULLISH" && priceChange > 0) {
      priceConfirmsSentiment = true;
    } else if (expectedSentiment === "BEARISH" && priceChange < 0) {
      priceConfirmsSentiment = true;
    } else if (expectedSentiment === "NEUTRAL") {
      priceConfirmsSentiment = Math.abs(priceChange) < 1; // Flat is okay
    }

    // Check trend (price vs SMA50 if available)
    // Note: This requires additional API call, so we'll keep it simple
    const isTrending = priceChange > 0; // Simplified: positive = trending up

    return {
      ticker: finalTicker, // Use the ticker that actually worked (might be .BO instead of .NS)
      currentPrice,
      priceChangePercent: priceChange,
      averageVolume,
      currentVolume,
      volumeRatio,
      volumeSpike,
      isTrending,
      priceConfirmsSentiment,
    };
  } catch (error) {
    console.error(
      `[MarketValidator] Error fetching quote for "${ticker}":`,
      error
    );
    return null;
  }
}

/**
 * Validate multiple tickers and return the first successful result.
 * Useful for GLOBAL keywords that affect multiple stocks.
 */
export async function validateMultipleTickers(
  tickers: string[],
  expectedSentiment: Sentiment
): Promise<Map<string, MarketConfirmation>> {
  const results = new Map<string, MarketConfirmation>();

  for (const ticker of tickers) {
    const fakeAsset: CatalystAsset = {
      id: "",
      keyword: "",
      ticker,
      assetType: "EQUITY",
      enabled: true,
    };

    const confirmation = await validateWithMarket(fakeAsset, expectedSentiment);
    if (confirmation) {
      results.set(ticker, confirmation);
    }
  }

  return results;
}

/**
 * Check if market conditions support acting on a signal.
 * Returns true if:
 * - Price confirms sentiment (BULLISH = green, BEARISH = red)
 * - OR there's a volume spike (market is reacting)
 */
export function shouldActOnSignal(confirmation: MarketConfirmation): boolean {
  // If price confirms sentiment and there's volume, strong signal
  if (confirmation.priceConfirmsSentiment && confirmation.volumeSpike) {
    return true;
  }

  // If only price confirms but move is significant (>1%), still interesting
  if (
    confirmation.priceConfirmsSentiment &&
    Math.abs(confirmation.priceChangePercent) > 1
  ) {
    return true;
  }

  // Volume spike alone might indicate the market is waking up to the news
  // but price hasn't caught up yet - this can be a great entry
  if (confirmation.volumeSpike && confirmation.volumeRatio > 2) {
    return true;
  }

  return false;
}

/**
 * Get a human-readable summary of market confirmation.
 */
export function formatMarketSummary(confirmation: MarketConfirmation): string {
  const direction = confirmation.priceChangePercent >= 0 ? "📈" : "📉";
  const volumeIndicator = confirmation.volumeSpike ? "🔥" : "";

  return `${
    confirmation.ticker
  }: ${direction} ${confirmation.priceChangePercent.toFixed(
    2
  )}%, Vol: ${confirmation.volumeRatio.toFixed(1)}x avg ${volumeIndicator}`;
}
