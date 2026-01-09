/**
 * Test script for Phase 1 Source Integration
 *
 * Tests PIB and RBI RSS feeds to verify:
 * 1. Feeds are accessible
 * 2. Data is correctly parsed
 * 3. Source metadata is properly attached
 */

import { fetchPibNews } from "./sources/pib-rss";
import { fetchAllRbiNews } from "./sources/rbi-rss";
import { getEnabledSources, getSourcesByLane } from "./sources/registry";
import type { NewsItem } from "./types";

/**
 * Format a news item for display
 */
function formatNewsItem(item: NewsItem, index: number): string {
  return `
  [${index + 1}] ${item.title}
      Source: ${item.source} (ID: ${item.sourceId || "N/A"})
      Priority: ${item.sourcePriority !== undefined ? `Level ${item.sourcePriority}` : "N/A"}
      Published: ${new Date(item.pubDate).toLocaleString()}
      URL: ${item.link}
  `;
}

/**
 * Test PIB RSS feed
 */
async function testPibFeed(): Promise<void> {
  console.log("\n" + "=".repeat(70));
  console.log("🧪 TEST 1: PIB RSS Feed");
  console.log("=".repeat(70));

  try {
    const news = await fetchPibNews(5, 48); // Last 48 hours, max 5 items

    console.log(`\n✅ Fetched ${news.length} articles from PIB`);

    if (news.length > 0) {
      console.log("\n📰 Sample Articles:");
      news.forEach((item, index) => {
        console.log(formatNewsItem(item, index));
      });

      // Verify metadata
      const hasMetadata = news.every(
        (item) => item.sourceId === "pib-rss" && item.sourcePriority === 0
      );
      if (hasMetadata) {
        console.log("\n✅ All articles have correct source metadata");
      } else {
        console.warn("\n⚠️ Some articles missing source metadata");
      }
    } else {
      console.warn("\n⚠️ No articles found (may be normal if no recent PIB releases)");
    }
  } catch (error) {
    console.error("\n❌ PIB Feed Test Failed:", error);
  }
}

/**
 * Test RBI RSS feeds
 */
async function testRbiFeed(): Promise<void> {
  console.log("\n" + "=".repeat(70));
  console.log("🧪 TEST 2: RBI RSS Feeds");
  console.log("=".repeat(70));

  try {
    const news = await fetchAllRbiNews(5, 48); // Last 48 hours, max 5 per feed

    console.log(`\n✅ Fetched ${news.length} articles from RBI`);

    if (news.length > 0) {
      console.log("\n📰 Sample Articles:");
      news.forEach((item, index) => {
        console.log(formatNewsItem(item, index));
      });

      // Verify metadata
      const hasMetadata = news.every(
        (item) => item.sourceId === "rbi-rss" && item.sourcePriority === 0
      );
      if (hasMetadata) {
        console.log("\n✅ All articles have correct source metadata");
      } else {
        console.warn("\n⚠️ Some articles missing source metadata");
      }
    } else {
      console.warn("\n⚠️ No articles found (may be normal if no recent RBI releases)");
    }
  } catch (error) {
    console.error("\n❌ RBI Feed Test Failed:", error);
  }
}

/**
 * Test source registry
 */
function testSourceRegistry(): void {
  console.log("\n" + "=".repeat(70));
  console.log("🧪 TEST 3: Source Registry");
  console.log("=".repeat(70));

  const allSources = getEnabledSources();
  console.log(`\n✅ Total enabled sources: ${allSources.length}`);

  console.log("\n📋 Source Configuration:");
  allSources.forEach((source) => {
    console.log(`
  • ${source.name}
    ID: ${source.id}
    Type: ${source.type}
    Lane: ${source.lane}
    Priority: Level ${source.priority}
    Poll Interval: ${source.pollIntervalMinutes} min
    ${source.description ? `Description: ${source.description}` : ""}
    `);
  });

  // Test lane grouping
  console.log("\n📊 Sources by Lane:");
  const lanes = ["FAST", "OFFICIAL", "SOCIAL", "MEDIA", "AGGREGATOR"] as const;
  lanes.forEach((lane) => {
    const sources = getSourcesByLane(lane);
    console.log(`  ${lane}: ${sources.length} source(s)`);
    sources.forEach((s) => console.log(`    - ${s.name}`));
  });
}

/**
 * Run all tests
 */
async function runTests(): Promise<void> {
  console.log("\n🚀 Starting Phase 1 Source Integration Tests\n");

  // Test 1: PIB RSS
  await testPibFeed();

  // Test 2: RBI RSS
  await testRbiFeed();

  // Test 3: Source Registry
  testSourceRegistry();

  console.log("\n" + "=".repeat(70));
  console.log("✅ All tests completed!");
  console.log("=".repeat(70));
  console.log(`
📝 Next Steps:
1. Verify the feeds are returning relevant news
2. Check that source metadata is correctly attached
3. Monitor for 48 hours to ensure stability
4. Proceed to Phase 2 (BSE API integration)
  `);
}

// Run tests if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch((error) => {
    console.error("Test runner failed:", error);
    process.exit(1);
  });
}

export { runTests, testPibFeed, testRbiFeed, testSourceRegistry };
