import {
  discoverCatalysts,
  runCatalystTracker,
  fetchCatalystNews,
  getUniqueKeywords,
  getEnabledAssets,
  filterNoise,
} from "../src/lib/catalyst";
import { type NewsItem, type CatalystAsset } from "../src/lib/catalyst/types";

// Configuration
const SCAN_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const NEWS_LOOKBACK_HOURS = 24;

async function main() {
  console.log("🚀 Starting Catalyst Daemon...");
  console.log("   Mode: Continuous Discovery & Tracking");
  console.log("   Interval: 10 minutes");

  // Main Loop
  while (true) {
    try {
      const cycleStart = Date.now();
      console.log(`\n⏰ Cycle started at ${new Date().toISOString()}`);

      // 1. Tracker Pass (Validate existing items first)
      await runCatalystTracker();

      // 2. Discovery Pass (Find new items)
      await runDiscoveryCycle();

      const duration = Date.now() - cycleStart;
      console.log(
        `\n💤 Cycle finished in ${(duration / 1000).toFixed(1)}s. Sleeping...`
      );
    } catch (error) {
      console.error("❌ Fatal error in daemon loop:", error);
    }

    // Sleep
    await new Promise((resolve) => setTimeout(resolve, SCAN_INTERVAL_MS));
  }
}

async function runDiscoveryCycle() {
  const assets = await getEnabledAssets();
  // Group assets by keyword to minimize news redundancy
  const keywords = Array.from(new Set(assets.map((a) => a.keyword)));

  let totalNews = 0;
  let allNewsItems: NewsItem[] = [];

  console.log(`\n🌍 Fetching news for ${keywords.length} keywords...`);

  // Fetch news for all keywords
  for (const keyword of keywords) {
    try {
      // We fetch broadly
      const news = await fetchCatalystNews(keyword, 5, NEWS_LOOKBACK_HOURS);
      // Basic deduping happens in fetchCatalystNews against global cache, but here we just collect
      // dedupe locally relative to this cycle if needed, but fetchCatalystNews returns *new* items mostly
      // if properly implemented. Actually fetchCatalystNews dedupes against DB `processed_articles`.

      if (news.length > 0) {
        // Add keyword context to source distinctiveness if needed, but for now just flatten
        allNewsItems.push(...news);
      }
    } catch (e) {
      console.error(`   Error fetching for ${keyword}:`, e);
    }
  }

  // Pre-filter noise to save tokens
  const filteredNews = filterNoise(allNewsItems);
  console.log(
    `   Found ${allNewsItems.length} articles, ${filteredNews.length} after noise filter.`
  );

  if (filteredNews.length === 0) return;

  // Run AI Discovery
  await discoverCatalysts(filteredNews, assets);
}

// Start
main().catch(console.error);
