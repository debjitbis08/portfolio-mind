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

export interface ScanResult {
  keywordsScanned: number;
  articlesProcessed: number;
  catalystsFound: number;
  signalsGenerated: number;
  signals: CatalystSignal[];
  errors: string[];
}

/**
 * Run a full catalyst scan across all enabled watchlist keywords.
 * Uses batch analysis for each keyword (NOT per-headline).
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
        // Fetch recent news
        const newsItems = await fetchCatalystNews(
          keyword,
          10, // Fetch more articles for batch analysis
          mergedConfig.newsMaxAgeHours
        );

        if (newsItems.length === 0) {
          console.log(`   No new articles found`);
          continue;
        }

        console.log(`   Found ${newsItems.length} new article(s)`);
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
 * Run broad Indian market news scan.
 *
 * This is the PRIMARY discovery function that:
 * 1. Fetches news from multiple India-focused sources
 * 2. Sends the combined batch to AI discovery
 * 3. The AI identifies affected stocks/sectors (not limited to watchlist)
 *
 * Use this for comprehensive coverage of Indian market news.
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

  console.log("\n🇮🇳 Starting Broad Indian Market Scan...");
  console.log(`   ${getMarketStatusMessage()}`);
  console.log(
    `   Mode: ${mergedConfig.paperMode ? "📝 PAPER (calibration)" : "🔴 LIVE"}`
  );
  console.log(`   Confidence threshold: ${mergedConfig.confidenceThreshold}`);
  console.log("");

  try {
    // Fetch broad Indian market news
    const indianNews = await fetchIndianMarketNews(
      5, // max per source
      mergedConfig.newsMaxAgeHours
    );

    if (indianNews.length === 0) {
      console.log("📭 No new Indian news articles found");
      return result;
    }

    result.articlesProcessed = indianNews.length;
    console.log(`\n📰 Collected ${indianNews.length} unique articles`);

    // Get all enabled assets for context (optional - AI can suggest new ones)
    const assets = await getEnabledAssets();

    // Import and run discovery
    const { discoverCatalysts } = await import("./discovery");
    const discoveryResult = await discoverCatalysts(indianNews, assets);

    result.catalystsFound = discoveryResult.newCatalysts;

    console.log("\n" + "═".repeat(60));
    console.log("📊 BROAD SCAN COMPLETE");
    console.log("═".repeat(60));
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
