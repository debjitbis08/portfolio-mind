/**
 * Catalyst Catcher - Main Orchestrator
 *
 * Ties together all components to run a full catalyst scan:
 * 1. Fetch news for each keyword
 * 2. Analyze batch of headlines together (holistic view)
 * 3. Validate with market data
 * 4. Dispatch single signal per keyword (no duplicates)
 */

import {
  fetchCatalystNews,
  fetchIndianMarketNews,
  getUniqueKeywords,
  getAssetsForKeyword,
  getEnabledAssets,
  markAsProcessed,
} from "./news-monitor";
import {
  analyzeNewsBatch,
  filterNoise,
  type BatchAnalysisResult,
} from "./catalyst-engine";
import {
  validateWithMarket,
  shouldActOnSignal,
  formatMarketSummary,
} from "./market-validator";
import { dispatchSignal } from "./signal-dispatcher";
import type {
  CatalystSignal,
  CatalystConfig,
  CatalystAsset,
  NewsItem,
} from "./types";
import { DEFAULT_CATALYST_CONFIG } from "./types";
import { isIndianMarketOpen, getMarketStatusMessage } from "./market-hours";
import { getEnabledSources, fetchFromSources } from "./sources/registry";

export interface ScanResult {
  keywordsScanned: number;
  articlesProcessed: number;
  catalystsFound: number;
  signalsGenerated: number;
  signals: CatalystSignal[];
  errors: string[];
  sourcesPolled?: number;
  sourceResults?: Array<{ source: string; items: number; success: boolean }>;
}

/**
 * Fetch news from all registered sources (BSE, PIB, RBI, DIPAM, DPIIT, etc.)
 * and match against keyword.
 *
 * @param keyword - Keyword to match against
 * @param maxAgeHours - Maximum age of articles in hours
 * @returns Tuple of [matched items, source stats]
 */
async function fetchFromSourceRegistry(
  keyword: string,
  maxAgeHours: number
): Promise<[import("./types").NewsItem[], Array<{ source: string; items: number; success: boolean }>]> {
  const sources = getEnabledSources();
  const results = await fetchFromSources(sources);

  const cutoffTime = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
  const matchedItems: import("./types").NewsItem[] = [];
  const sourceStats: Array<{ source: string; items: number; success: boolean }> = [];

  for (const result of results) {
    sourceStats.push({
      source: result.source,
      items: result.itemsFound,
      success: result.success,
    });

    if (!result.success) continue;

    for (const item of result.newItems) {
      // Check if article is within time window
      const pubDate = new Date(item.pubDate);
      if (pubDate < cutoffTime) continue;

      // Check if keyword appears in title (case-insensitive)
      const titleLower = item.title.toLowerCase();
      const keywordLower = keyword.toLowerCase();

      if (titleLower.includes(keywordLower)) {
        matchedItems.push(item);
      }
    }
  }

  return [matchedItems, sourceStats];
}

/**
 * @deprecated Legacy keyword-based scan. Use runBroadIndianScan() instead.
 *
 * Run a full catalyst scan across all enabled watchlist keywords.
 * Uses batch analysis for each keyword (NOT per-headline).
 *
 * NOTE: This function is kept for backward compatibility but is NOT used by the daemon.
 * The primary discovery mode is runBroadIndianScan() which fetches from all sources
 * and lets AI discover catalysts without pre-defined keywords.
 *
 * @param config - Override default configuration
 * @returns Summary of scan results
 */
export async function runCatalystScan(
  config: Partial<CatalystConfig> = {}
): Promise<ScanResult> {
  const mergedConfig: CatalystConfig = {
    ...DEFAULT_CATALYST_CONFIG,
    ...config,
  };

  const result: ScanResult = {
    keywordsScanned: 0,
    articlesProcessed: 0,
    catalystsFound: 0,
    signalsGenerated: 0,
    signals: [],
    errors: [],
  };

  console.log("\n🚀 Starting Catalyst Scan...");
  console.log(`   ${getMarketStatusMessage()}`);
  console.log(
    `   Mode: ${mergedConfig.paperMode ? "📝 PAPER (calibration)" : "🔴 LIVE"}`
  );
  console.log(`   Confidence threshold: ${mergedConfig.confidenceThreshold}`);
  console.log(`   News age: ${mergedConfig.newsMaxAgeHours}h`);
  if (!isIndianMarketOpen()) {
    console.log(
      `   ⏰ After-hours signals will be marked as 'pending_market_open'`
    );
  }
  console.log("");

  try {
    const keywords = await getUniqueKeywords();
    console.log(`📋 Found ${keywords.length} keywords to scan\n`);

    if (keywords.length === 0) {
      console.log(
        "⚠️  No keywords in watchlist. Add assets via API or database."
      );
      return result;
    }

    for (const keyword of keywords) {
      result.keywordsScanned++;
      console.log(`\n━━━ Scanning: ${keyword} ━━━`);

      try {
        // Fetch from ALL registered sources (BSE, PIB, RBI, DIPAM, DPIIT, etc.)
        console.log(`   📡 Fetching from source registry...`);
        const [newsItems, sourceStats] = await fetchFromSourceRegistry(
          keyword,
          mergedConfig.newsMaxAgeHours
        );

        // Update result with source stats
        if (!result.sourceResults) {
          result.sourceResults = sourceStats;
          result.sourcesPolled = sourceStats.length;
        }

        if (newsItems.length === 0) {
          console.log(`   No matching articles found from ${sourceStats.length} sources`);
          const successfulSources = sourceStats.filter(s => s.success && s.items > 0);
          if (successfulSources.length > 0) {
            console.log(`   ℹ️  Sources fetched ${sourceStats.reduce((sum, s) => sum + s.items, 0)} total items, but none matched keyword "${keyword}"`);
          }
          continue;
        }

        console.log(`   Found ${newsItems.length} matching article(s) from source registry`);
        result.articlesProcessed += newsItems.length;

        // Pre-filter obvious noise
        const filteredNews = filterNoise(newsItems);
        const filteredCount = newsItems.length - filteredNews.length;
        if (filteredCount > 0) {
          console.log(`   Filtered ${filteredCount} noise article(s)`);
        }

        if (filteredNews.length === 0) {
          console.log(`   All articles were noise, skipping`);
          // Mark all as processed
          for (const item of newsItems) {
            await markAsProcessed(item, keyword, false);
          }
          continue;
        }

        // Get assets for this keyword
        const assets = await getAssetsForKeyword(keyword);
        if (assets.length === 0) {
          console.log(`   ⚠️ No assets configured for keyword "${keyword}"`);
          continue;
        }

        const primaryAsset = assets[0];

        // BATCH ANALYSIS: Analyze all headlines together
        console.log(
          `   🧠 Analyzing ${filteredNews.length} headlines together...`
        );
        const analysis = await analyzeNewsBatch(filteredNews, primaryAsset);

        // Mark all news as processed
        for (const item of newsItems) {
          const isCatalyst =
            analysis.isCatalyst &&
            filteredNews.some((f) => f.link === item.link);
          await markAsProcessed(
            item,
            keyword,
            isCatalyst,
            JSON.stringify(analysis)
          );
        }

        // Log the analysis result
        if (!analysis.isCatalyst) {
          console.log(`   → NO CATALYST: ${analysis.reasoning}`);
          if (analysis.summary) {
            console.log(`   📋 Summary: ${analysis.summary}`);
          }
          continue;
        }

        result.catalystsFound++;

        // Check confidence threshold
        if (analysis.confidence < mergedConfig.confidenceThreshold) {
          console.log(
            `   → Low confidence (${analysis.confidence}/${mergedConfig.confidenceThreshold}): ${analysis.reasoning}`
          );
          continue;
        }

        console.log(
          `   → 🎯 CATALYST: ${analysis.impactType} (${analysis.confidence}/10)`
        );
        console.log(`   📰 Key headline: ${analysis.keyHeadline}`);
        console.log(`   📋 Summary: ${analysis.summary}`);
        console.log(`   💡 Reasoning: ${analysis.reasoning}`);

        // Validate with market data (use first asset's validation ticker)
        let marketConfirmation = await validateWithMarket(
          primaryAsset,
          analysis.sentiment
        );

        // If market validation fails, create a placeholder for LLM-only verification
        if (!marketConfirmation) {
          console.log(`   → ⚠️ Market data unavailable, using LLM-only signal`);
          marketConfirmation = {
            ticker:
              primaryAsset.globalValidationTicker ||
              primaryAsset.ticker ||
              "N/A",
            currentPrice: 0,
            priceChangePercent: 0,
            averageVolume: 0,
            currentVolume: 0,
            volumeRatio: 0,
            volumeSpike: false,
            isTrending: false,
            priceConfirmsSentiment: false,
          };
        } else {
          console.log(`   → ${formatMarketSummary(marketConfirmation)}`);
        }

        // Find the news item matching the key headline (or use first)
        const keyNewsItem =
          filteredNews.find((item) =>
            item.title.includes(analysis.keyHeadline.slice(0, 50))
          ) || filteredNews[0];

        // Create ONE signal per keyword (not per ticker)
        // The signal represents the entire news landscape for this keyword
        const signal: CatalystSignal = {
          asset: primaryAsset,
          action: analysis.sentiment === "BULLISH" ? "BUY_WATCH" : "SELL_WATCH",
          news: keyNewsItem,
          analysis: {
            isCatalyst: analysis.isCatalyst,
            sentiment: analysis.sentiment,
            impactType: analysis.impactType,
            confidence: analysis.confidence,
            reasoning: `${analysis.summary} | ${analysis.reasoning}`,
          },
          technical: marketConfirmation,
          status: "active",
          createdAt: new Date().toISOString(),
        };

        await dispatchSignal(signal, mergedConfig);
        result.signalsGenerated++;
        result.signals.push(signal);

        // Log affected tickers (but don't create duplicate signals)
        if (assets.length > 1) {
          const tickers = assets.map((a) => a.ticker || "(global)").join(", ");
          console.log(`   📊 Affected tickers: ${tickers}`);
        }
      } catch (error) {
        const errMsg = `Error scanning "${keyword}": ${
          error instanceof Error ? error.message : "Unknown"
        }`;
        console.error(`   ❌ ${errMsg}`);
        result.errors.push(errMsg);
      }
    }

    console.log("\n" + "═".repeat(60));
    console.log("📊 SCAN COMPLETE");
    console.log("═".repeat(60));
    console.log(`   Keywords scanned: ${result.keywordsScanned}`);
    console.log(`   Articles processed: ${result.articlesProcessed}`);
    console.log(`   Catalysts found: ${result.catalystsFound}`);
    console.log(`   Signals generated: ${result.signalsGenerated}`);
    if (result.sourcesPolled) {
      console.log(`   Sources polled: ${result.sourcesPolled}`);
      const successfulSources = result.sourceResults?.filter(s => s.success) || [];
      console.log(`   Sources successful: ${successfulSources.length}/${result.sourcesPolled}`);
      if (successfulSources.length > 0) {
        console.log(`\n   📡 Source Summary:`);
        result.sourceResults?.forEach(s => {
          const status = s.success ? "✅" : "❌";
          console.log(`      ${status} ${s.source}: ${s.items} items`);
        });
      }
    }
    if (result.errors.length > 0) {
      console.log(`   Errors: ${result.errors.length}`);
    }
    console.log("");

    return result;
  } catch (error) {
    const errMsg = `Scan failed: ${
      error instanceof Error ? error.message : "Unknown error"
    }`;
    console.error(`\n❌ ${errMsg}`);
    result.errors.push(errMsg);
    return result;
  }
}

/**
 * Run broad Indian market news scan - PRIMARY DISCOVERY MODE
 *
 * This is the main catalyst discovery function that:
 * 1. Fetches news from ALL registered sources (BSE, PIB, RBI, DIPAM, DPIIT, Media)
 * 2. Sends the combined batch to AI discovery
 * 3. The AI identifies catalysts and affected stocks (not limited to watchlist)
 * 4. Generates signals for discovered catalysts
 *
 * Signals show on catalyst page. Portfolio Mind uses signals for watchlist/holdings.
 */
export async function runBroadIndianScan(
  config: Partial<CatalystConfig> = {}
): Promise<ScanResult> {
  const mergedConfig: CatalystConfig = {
    ...DEFAULT_CATALYST_CONFIG,
    ...config,
  };

  const result: ScanResult = {
    keywordsScanned: 0,
    articlesProcessed: 0,
    catalystsFound: 0,
    signalsGenerated: 0,
    signals: [],
    errors: [],
  };

  console.log("\n🇮🇳 Starting Catalyst Discovery Scan...");
  console.log(`   ${getMarketStatusMessage()}`);
  console.log(
    `   Mode: ${mergedConfig.paperMode ? "📝 PAPER (calibration)" : "🔴 LIVE"}`
  );
  console.log(`   Confidence threshold: ${mergedConfig.confidenceThreshold}`);
  console.log("");

  try {
    // Fetch from ALL registered sources (BSE, PIB, RBI, DIPAM, DPIIT, Media)
    console.log("📡 Fetching from source registry...");
    const sources = getEnabledSources();
    const sourceResults = await fetchFromSources(sources);

    // Collect all news items
    const allNews: import("./types").NewsItem[] = [];
    const sourceStats: Array<{ source: string; items: number; success: boolean }> = [];

    for (const sourceResult of sourceResults) {
      sourceStats.push({
        source: sourceResult.source,
        items: sourceResult.itemsFound,
        success: sourceResult.success,
      });

      if (sourceResult.success) {
        allNews.push(...sourceResult.newItems);
      }
    }

    result.sourcesPolled = sourceStats.length;
    result.sourceResults = sourceStats;

    // Log source summary
    const successfulSources = sourceStats.filter(s => s.success);
    console.log(`   Polled ${sourceStats.length} sources: ${successfulSources.length} successful`);
    sourceStats.forEach(s => {
      const status = s.success ? "✅" : "❌";
      console.log(`   ${status} ${s.source}: ${s.items} items`);
    });

    if (allNews.length === 0) {
      console.log("\n📭 No new articles found from any source");
      return result;
    }

    // Filter by time window
    const cutoffTime = new Date(Date.now() - mergedConfig.newsMaxAgeHours * 60 * 60 * 1000);
    const recentNews = allNews.filter(item => {
      const pubDate = new Date(item.pubDate);
      return pubDate >= cutoffTime;
    });

    result.articlesProcessed = recentNews.length;
    console.log(`\n📰 Collected ${recentNews.length} articles within ${mergedConfig.newsMaxAgeHours}h window (${allNews.length} total)`);

    // Get all enabled assets for context (optional - AI can suggest new ones)
    const assets = await getEnabledAssets();

    // Import and run discovery
    const { discoverCatalysts } = await import("./discovery");
    const discoveryResult = await discoverCatalysts(recentNews, assets);

    result.catalystsFound = discoveryResult.newCatalysts;

    console.log("\n" + "═".repeat(60));
    console.log("📊 CATALYST DISCOVERY COMPLETE");
    console.log("═".repeat(60));
    console.log(`   Sources polled: ${result.sourcesPolled}`);
    console.log(`   Sources successful: ${successfulSources.length}/${result.sourcesPolled}`);
    console.log(`   Articles processed: ${result.articlesProcessed}`);
    console.log(`   Catalysts discovered: ${result.catalystsFound}`);
    if (discoveryResult.catalysts.length > 0) {
      console.log("\n   🎯 Discovered catalysts:");
      for (const cat of discoveryResult.catalysts) {
        console.log(`      • ${cat.predictedImpact}`);
        console.log(`        Affected: ${cat.affectedSymbols.join(", ")}`);
      }
    }
    console.log("");

    return result;
  } catch (error) {
    const errMsg = `Broad scan failed: ${
      error instanceof Error ? error.message : "Unknown error"
    }`;
    console.error(`\n❌ ${errMsg}`);
    result.errors.push(errMsg);
    return result;
  }
}

/**
 * Run scan for a specific keyword only.
 */
export async function scanKeyword(
  keyword: string,
  config: Partial<CatalystConfig> = {}
): Promise<ScanResult> {
  const mergedConfig: CatalystConfig = {
    ...DEFAULT_CATALYST_CONFIG,
    ...config,
  };

  const result: ScanResult = {
    keywordsScanned: 1,
    articlesProcessed: 0,
    catalystsFound: 0,
    signalsGenerated: 0,
    signals: [],
    errors: [],
  };

  // Get assets for this keyword
  const assets = await getAssetsForKeyword(keyword);
  if (assets.length === 0) {
    result.errors.push(`No assets configured for keyword "${keyword}"`);
    return result;
  }

  const primaryAsset = assets[0];

  // Fetch and process news
  const newsItems = await fetchCatalystNews(
    keyword,
    10,
    mergedConfig.newsMaxAgeHours
  );
  result.articlesProcessed = newsItems.length;

  if (newsItems.length === 0) {
    return result;
  }

  // Pre-filter noise
  const filteredNews = filterNoise(newsItems);
  if (filteredNews.length === 0) {
    for (const item of newsItems) {
      await markAsProcessed(item, keyword, false);
    }
    return result;
  }

  // Batch analysis
  const analysis = await analyzeNewsBatch(filteredNews, primaryAsset);

  // Mark all as processed
  for (const item of newsItems) {
    await markAsProcessed(
      item,
      keyword,
      analysis.isCatalyst,
      JSON.stringify(analysis)
    );
  }

  if (
    analysis.isCatalyst &&
    analysis.confidence >= mergedConfig.confidenceThreshold
  ) {
    result.catalystsFound++;

    let marketConfirmation = await validateWithMarket(
      primaryAsset,
      analysis.sentiment
    );

    // Fallback if market data unavailable
    if (!marketConfirmation) {
      marketConfirmation = {
        ticker:
          primaryAsset.globalValidationTicker || primaryAsset.ticker || "N/A",
        currentPrice: 0,
        priceChangePercent: 0,
        averageVolume: 0,
        currentVolume: 0,
        volumeRatio: 0,
        volumeSpike: false,
        isTrending: false,
        priceConfirmsSentiment: false,
      };
    }

    const keyNewsItem =
      filteredNews.find((item) =>
        item.title.includes(analysis.keyHeadline.slice(0, 50))
      ) || filteredNews[0];

    const signal: CatalystSignal = {
      asset: primaryAsset,
      action: analysis.sentiment === "BULLISH" ? "BUY_WATCH" : "SELL_WATCH",
      news: keyNewsItem,
      analysis: {
        isCatalyst: analysis.isCatalyst,
        sentiment: analysis.sentiment,
        impactType: analysis.impactType,
        confidence: analysis.confidence,
        reasoning: `${analysis.summary} | ${analysis.reasoning}`,
      },
      technical: marketConfirmation,
      status: "active",
      createdAt: new Date().toISOString(),
    };

    await dispatchSignal(signal, mergedConfig);
    result.signalsGenerated++;
    result.signals.push(signal);
  }

  return result;
}

// Re-export types and utilities for convenience
export * from "./types";
export { getActiveSignals, updateSignalStatus } from "./signal-dispatcher";
export { getEnabledAssets, getUniqueKeywords } from "./news-monitor";
export { discoverCatalysts } from "./discovery";
export { runCatalystTracker } from "./tracker";
export {
  isIndianMarketOpen,
  getMarketStatusMessage,
  getNextMarketOpen,
} from "./market-hours";
