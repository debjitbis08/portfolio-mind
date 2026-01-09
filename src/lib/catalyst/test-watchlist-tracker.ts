/**
 * Watchlist Tracker Test
 *
 * Tests NSE-BSE mapping and watchlist-based BSE announcement tracking.
 */

import { loadCommonMappings, mapNseToBse, mapBseToNse } from "./bse-nse-mapper";
import {
  getMonitoredSymbols,
  getMonitoredBseCodes,
  fetchWatchlistAnnouncements,
  fetchAnnouncementsForSymbol,
  getAnnouncementSummary,
} from "./watchlist-tracker";

/**
 * Test 1: Load common BSE-NSE mappings
 */
async function testLoadMappings(): Promise<void> {
  console.log("\n" + "=".repeat(70));
  console.log("🧪 TEST 1: Load Common BSE-NSE Mappings");
  console.log("=".repeat(70));

  try {
    await loadCommonMappings();
    console.log("✅ Successfully loaded common mappings");
  } catch (error) {
    console.error("❌ Failed to load mappings:", error);
  }
}

/**
 * Test 2: Test bidirectional mapping
 */
async function testMappingLookup(): Promise<void> {
  console.log("\n" + "=".repeat(70));
  console.log("🧪 TEST 2: Bidirectional Mapping Lookup");
  console.log("=".repeat(70));

  const testCases = [
    { nse: "RELIANCE", expectedBse: "500325" },
    { nse: "TCS", expectedBse: "532540" },
    { nse: "INFY", expectedBse: "500209" },
    { nse: "HDFCBANK", expectedBse: "500180" },
  ];

  for (const testCase of testCases) {
    console.log(`\n🔍 Testing ${testCase.nse}:`);

    // NSE -> BSE
    const bseCode = await mapNseToBse(testCase.nse);
    console.log(`   NSE -> BSE: ${testCase.nse} -> ${bseCode}`);

    if (bseCode === testCase.expectedBse) {
      console.log(`   ✅ Correct mapping`);
    } else {
      console.log(
        `   ⚠️  Expected ${testCase.expectedBse}, got ${bseCode}`
      );
    }

    // BSE -> NSE (reverse lookup)
    if (bseCode) {
      const nseSymbol = await mapBseToNse(bseCode);
      console.log(`   BSE -> NSE: ${bseCode} -> ${nseSymbol}`);

      if (nseSymbol === testCase.nse) {
        console.log(`   ✅ Reverse mapping works`);
      } else {
        console.log(
          `   ⚠️  Expected ${testCase.nse}, got ${nseSymbol}`
        );
      }
    }
  }
}

/**
 * Test 3: Get monitored symbols
 */
async function testMonitoredSymbols(): Promise<void> {
  console.log("\n" + "=".repeat(70));
  console.log("🧪 TEST 3: Get Monitored Symbols (Watchlist + Holdings)");
  console.log("=".repeat(70));

  try {
    const symbols = await getMonitoredSymbols();
    console.log(`\n📊 Found ${symbols.length} monitored symbols:`);

    if (symbols.length > 0) {
      console.log(`   ${symbols.slice(0, 10).join(", ")}${symbols.length > 10 ? "..." : ""}`);
    } else {
      console.log("   ⚠️  No symbols found in watchlist or holdings");
      console.log(
        "   Tip: Add some symbols to your watchlist or import transactions"
      );
    }

    // Get BSE codes for monitored symbols
    const bseMappings = await getMonitoredBseCodes();
    console.log(
      `\n🔗 Found ${bseMappings.length} BSE mappings (${Math.round((bseMappings.length / symbols.length) * 100)}% coverage):`
    );

    if (bseMappings.length > 0) {
      bseMappings.slice(0, 5).forEach((mapping) => {
        console.log(
          `   ${mapping.nseSymbol} -> BSE ${mapping.bseCode} (${mapping.companyName})`
        );
      });

      if (bseMappings.length > 5) {
        console.log(`   ... and ${bseMappings.length - 5} more`);
      }
    }

    if (bseMappings.length < symbols.length) {
      console.log(
        `\n⚠️  ${symbols.length - bseMappings.length} symbols missing BSE mappings`
      );
    }
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

/**
 * Test 4: Fetch watchlist announcements
 */
async function testWatchlistAnnouncements(): Promise<void> {
  console.log("\n" + "=".repeat(70));
  console.log("🧪 TEST 4: Fetch BSE Announcements for Watchlist");
  console.log("=".repeat(70));

  try {
    console.log("\n⏳ Fetching announcements (last 24 hours)...\n");
    const startTime = Date.now();

    const announcements = await fetchWatchlistAnnouncements(24);
    const fetchTime = Date.now() - startTime;

    console.log(
      `\n✅ Fetched ${announcements.length} announcements in ${fetchTime}ms`
    );

    if (announcements.length > 0) {
      console.log("\n📰 Recent Announcements:\n");
      announcements.slice(0, 5).forEach((ann, idx) => {
        console.log(`[${idx + 1}] ${ann.title}`);
        console.log(`    Source: ${ann.source}`);
        console.log(`    Published: ${new Date(ann.pubDate).toLocaleString()}`);
        console.log(`    URL: ${ann.link}\n`);
      });

      if (announcements.length > 5) {
        console.log(`... and ${announcements.length - 5} more announcements`);
      }
    } else {
      console.log("ℹ️  No announcements found in the last 24 hours");
    }
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

/**
 * Test 5: Fetch announcements for specific symbol
 */
async function testSymbolAnnouncements(): Promise<void> {
  console.log("\n" + "=".repeat(70));
  console.log("🧪 TEST 5: Fetch Announcements for Specific Symbol");
  console.log("=".repeat(70));

  const testSymbol = "RELIANCE"; // Most active company

  try {
    console.log(`\n⏳ Fetching announcements for ${testSymbol} (last 48 hours)...\n`);
    const startTime = Date.now();

    const announcements = await fetchAnnouncementsForSymbol(testSymbol, 48);
    const fetchTime = Date.now() - startTime;

    console.log(
      `\n✅ Fetched ${announcements.length} announcements in ${fetchTime}ms`
    );

    if (announcements.length > 0) {
      console.log(`\n📰 ${testSymbol} Announcements:\n`);
      announcements.forEach((ann, idx) => {
        console.log(`[${idx + 1}] ${ann.title}`);
        console.log(`    Category: ${ann.source}`);
        console.log(`    Date: ${new Date(ann.pubDate).toLocaleString()}`);
        console.log(`    URL: ${ann.link}\n`);
      });
    } else {
      console.log(`ℹ️  No announcements found for ${testSymbol} in the last 48 hours`);
    }
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

/**
 * Test 6: Get announcement summary
 */
async function testAnnouncementSummary(): Promise<void> {
  console.log("\n" + "=".repeat(70));
  console.log("🧪 TEST 6: Get Announcement Summary");
  console.log("=".repeat(70));

  try {
    console.log("\n⏳ Generating summary (last 24 hours)...\n");
    const startTime = Date.now();

    const summary = await getAnnouncementSummary(24);
    const fetchTime = Date.now() - startTime;

    console.log(`\n📊 Summary (generated in ${fetchTime}ms):\n`);
    console.log(`   Total Monitored: ${summary.totalMonitored} companies`);
    console.log(
      `   Companies with News: ${summary.companiesWithAnnouncements}`
    );
    console.log(`   Total Announcements: ${summary.totalAnnouncements}\n`);

    if (summary.announcements.length > 0) {
      console.log("📈 Most Active Companies:\n");
      summary.announcements.slice(0, 10).forEach((company, idx) => {
        console.log(
          `   [${idx + 1}] ${company.nseSymbol} (${company.companyName})`
        );
        console.log(`       ${company.count} announcements`);
        console.log(`       Latest: ${company.latestTitle.substring(0, 80)}...`);
        console.log(`       Date: ${new Date(company.latestDate).toLocaleString()}\n`);
      });
    }
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

/**
 * Run all tests
 */
async function runAllTests(): Promise<void> {
  console.log("\n🚀 Starting Watchlist Tracker Tests\n");
  console.log("🎯 Testing NSE-BSE mapping and watchlist-based tracking");

  // Test 1: Load mappings (prerequisite for other tests)
  await testLoadMappings();

  // Test 2: Test bidirectional lookup
  await testMappingLookup();

  // Test 3: Get monitored symbols
  await testMonitoredSymbols();

  // Test 4: Fetch watchlist announcements
  await testWatchlistAnnouncements();

  // Test 5: Fetch for specific symbol
  await testSymbolAnnouncements();

  // Test 6: Get summary
  await testAnnouncementSummary();

  console.log("\n" + "=".repeat(70));
  console.log("✅ All Watchlist Tracker tests completed!");
  console.log("=".repeat(70));
  console.log(`
📝 Key Features:

1. **NSE-BSE Mapping**: Bidirectional lookup between NSE symbols and BSE scrip codes
   - Top 40 stocks pre-loaded for immediate coverage
   - Easy to add custom mappings via addBseNseMapping()

2. **Watchlist Integration**: Automatic tracking of BSE announcements for:
   - All symbols in your watchlist
   - All symbols in your holdings (portfolio)
   - Deduplicated and monitored in real-time

3. **Company-Specific Tracking**: Fetch announcements for specific companies
   - fetchAnnouncementsForSymbol("RELIANCE", 24)
   - Get targeted alerts for portfolio holdings

4. **Dashboard Summary**: Aggregate view of recent activity
   - Shows most active companies
   - Total announcement count
   - Coverage statistics

🎯 Integration Points:

- Add to catalyst daemon for automatic monitoring
- Use in API endpoints for real-time alerts
- Display in UI for portfolio-relevant news feed
- Trigger notifications for high-priority announcements

💡 Next Steps:

1. Integrate fetchWatchlistAnnouncements() into catalyst daemon
2. Add UI component to display announcements on portfolio page
3. Create alert system for critical announcements (Board Meetings, Results)
4. Build historical tracking for outcome analysis
  `);
}

// Run tests if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().catch((error) => {
    console.error("Test runner failed:", error);
    process.exit(1);
  });
}

export { runAllTests };
