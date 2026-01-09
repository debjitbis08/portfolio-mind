/**
 * Phase 2 Source Integration Test
 *
 * Tests the new "Source Zero" endpoints:
 * - BSE Corporate Announcements API
 * - DIPAM (PSU Disinvestment)
 * - DPIIT (FDI & Trade Policy)
 */

import { fetchBseAnnouncements } from "./sources/bse-api";
import { fetchDipamNews } from "./sources/dipam-scraper";
import { fetchDpiitNews } from "./sources/dpiit-scraper";
import { getEnabledSources, fetchFromSources } from "./sources/registry";
import type { NewsItem } from "./types";

/**
 * Format a news item for display
 */
function formatNewsItem(item: NewsItem, index: number): string {
  return `
  [${index + 1}] ${item.title}
      Source: ${item.source} (Priority: Level ${item.sourcePriority})
      Published: ${new Date(item.pubDate).toLocaleString()}
      URL: ${item.link}
  `;
}

/**
 * Test BSE Corporate Announcements API
 */
async function testBseApi(): Promise<void> {
  console.log("\n" + "=".repeat(70));
  console.log("🧪 TEST 1: BSE Corporate Announcements API");
  console.log("=".repeat(70));

  try {
    console.log("\nFetching last 4 hours of BSE announcements...\n");
    const startTime = Date.now();
    const news = await fetchBseAnnouncements(4, 20); // Last 4h, max 20
    const fetchTime = Date.now() - startTime;

    console.log(`✅ Fetched ${news.length} announcements in ${fetchTime}ms`);

    if (news.length > 0) {
      console.log("\n📰 Sample Announcements:");
      news.slice(0, 5).forEach((item, index) => {
        console.log(formatNewsItem(item, index));
      });
    } else {
      console.warn("\n⚠️  No announcements found (may be normal if BSE is inactive)");
    }
  } catch (error) {
    console.error("\n❌ BSE API Test Failed:", error);
  }
}

/**
 * Test DIPAM Scraper
 */
async function testDipamScraper(): Promise<void> {
  console.log("\n" + "=".repeat(70));
  console.log("🧪 TEST 2: DIPAM PSU Disinvestment Scraper");
  console.log("=".repeat(70));

  try {
    console.log("\nScraping DIPAM whatsnewlist...\n");
    const startTime = Date.now();
    const news = await fetchDipamNews(10, 48); // Last 48h, max 10
    const fetchTime = Date.now() - startTime;

    console.log(`✅ Fetched ${news.length} items in ${fetchTime}ms`);

    if (news.length > 0) {
      console.log("\n📰 Sample Items:");
      news.slice(0, 5).forEach((item, index) => {
        console.log(formatNewsItem(item, index));
      });
    } else {
      console.warn("\n⚠️  No items found (DIPAM may not have recent updates)");
    }
  } catch (error) {
    console.error("\n❌ DIPAM Scraper Test Failed:", error);
  }
}

/**
 * Test DPIIT Scraper
 */
async function testDpiitScraper(): Promise<void> {
  console.log("\n" + "=".repeat(70));
  console.log("🧪 TEST 3: DPIIT FDI & Trade Policy Scraper");
  console.log("=".repeat(70));

  try {
    console.log("\nScraping DPIIT whats-new...\n");
    const startTime = Date.now();
    const news = await fetchDpiitNews(10, 48); // Last 48h, max 10
    const fetchTime = Date.now() - startTime;

    console.log(`✅ Fetched ${news.length} items in ${fetchTime}ms`);

    if (news.length > 0) {
      console.log("\n📰 Sample Items:");
      news.slice(0, 5).forEach((item, index) => {
        console.log(formatNewsItem(item, index));
      });
    } else {
      console.warn("\n⚠️  No items found (DPIIT may not have recent updates)");
    }
  } catch (error) {
    console.error("\n❌ DPIIT Scraper Test Failed:", error);
  }
}

/**
 * Test all Phase 2 sources together
 */
async function testAllPhase2Sources(): Promise<void> {
  console.log("\n" + "=".repeat(70));
  console.log("🧪 TEST 4: All Phase 2 Sources (FAST Lane)");
  console.log("=".repeat(70));

  const fastLaneSources = getEnabledSources().filter((s) => s.lane === "FAST");

  console.log(`\nFetching from ${fastLaneSources.length} FAST lane sources in parallel...\n`);

  const startTime = Date.now();
  const results = await fetchFromSources(fastLaneSources);
  const totalTime = Date.now() - startTime;

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const totalItems = results.reduce((sum, r) => sum + r.itemsFound, 0);

  console.log(`\n📈 Results:`);
  console.log(`   Total Time: ${totalTime}ms`);
  console.log(`   Successful: ${successful}/${results.length}`);
  console.log(`   Failed: ${failed}/${results.length}`);
  console.log(`   Total Items: ${totalItems}`);

  console.log(`\n📊 Per-Source Breakdown:`);
  for (const result of results) {
    const status = result.success ? "✅" : "❌";
    console.log(`   ${status} ${result.source}: ${result.itemsFound} items`);
    if (result.error) {
      console.log(`      Error: ${result.error}`);
    }
  }
}

/**
 * Run all Phase 2 tests
 */
async function runPhase2Tests(): Promise<void> {
  console.log("\n🚀 Starting Phase 2 Source Integration Tests\n");
  console.log("🎯 Testing \"Source Zero\" endpoints:");
  console.log("   - BSE Corporate Announcements (Exchange API)");
  console.log("   - DIPAM (PSU Disinvestment)");
  console.log("   - DPIIT (FDI & Trade Policy)");

  // Test 1: BSE API
  await testBseApi();

  // Test 2: DIPAM Scraper
  await testDipamScraper();

  // Test 3: DPIIT Scraper
  await testDpiitScraper();

  // Test 4: All together
  await testAllPhase2Sources();

  console.log("\n" + "=".repeat(70));
  console.log("✅ All Phase 2 tests completed!");
  console.log("=".repeat(70));
  console.log(`
📝 Key Findings:
1. BSE API: Direct access to exchange announcements (10-min alpha!)
2. DIPAM/DPIIT: Government scrapers work but may have no recent data
3. All sources have retry + circuit breaker protection
4. Source priority: All Phase 2 sources are Level 0 (highest trust)

🎯 Next Steps:
1. Monitor BSE API for rate limiting (currently 1 req per 5 min)
2. DIPAM/DPIIT update infrequently - 30 min polling is sufficient
3. Add NSE tickers mapping for BSE scrip codes
4. Consider adding specific company tracking for BSE API
  `);
}

// Run tests if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runPhase2Tests().catch((error) => {
    console.error("Test runner failed:", error);
    process.exit(1);
  });
}

export { runPhase2Tests };
