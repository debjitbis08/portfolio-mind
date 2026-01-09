/**
 * Enhanced Test Script for Source Integration
 *
 * Tests retry mechanisms, caching, and circuit breakers.
 */

import {
  getEnabledSources,
  fetchFromSource,
  fetchFromSources,
} from "./sources/registry";
import {
  getRssCacheStats,
  clearRssCache,
} from "./sources/fetch-utils";
import {
  getCircuitBreakerStats,
  resetAllCircuitBreakers,
} from "./sources/circuit-breaker";

/**
 * Test 1: Basic fetch with retry
 */
async function testBasicFetch(): Promise<void> {
  console.log("\n" + "=".repeat(70));
  console.log("🧪 TEST 1: Basic Fetch with Retry & Caching");
  console.log("=".repeat(70));

  const sources = getEnabledSources().filter(
    (s) => s.id === "pib-rss" || s.id === "rbi-rss"
  );

  console.log(`\nFetching from ${sources.length} sources...\n`);

  const results = await fetchFromSources(sources);

  for (const result of results) {
    const status = result.success ? "✅" : "❌";
    console.log(`\n${status} ${result.source}`);
    console.log(`   Items: ${result.itemsFound}`);
    console.log(`   Time: ${result.fetchedAt}`);
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  }

  // Show cache stats
  const cacheStats = getRssCacheStats();
  console.log(`\n📦 Cache Stats:`);
  console.log(`   Cached URLs: ${cacheStats.size}`);
  for (const entry of cacheStats.entries) {
    console.log(`   - ${entry.url.split("/").pop()} (${entry.age}s old)`);
  }
}

/**
 * Test 2: Cache effectiveness (second fetch should be instant)
 */
async function testCacheEffectiveness(): Promise<void> {
  console.log("\n" + "=".repeat(70));
  console.log("🧪 TEST 2: Cache Effectiveness");
  console.log("=".repeat(70));

  const source = getEnabledSources().find((s) => s.id === "pib-rss");
  if (!source) {
    console.warn("PIB source not found");
    return;
  }

  console.log("\nFirst fetch (should hit network)...");
  const start1 = Date.now();
  const result1 = await fetchFromSource(source);
  const time1 = Date.now() - start1;

  console.log(`   Time: ${time1}ms`);
  console.log(`   Items: ${result1.itemsFound}`);

  console.log("\nSecond fetch (should hit cache)...");
  const start2 = Date.now();
  const result2 = await fetchFromSource(source);
  const time2 = Date.now() - start2;

  console.log(`   Time: ${time2}ms`);
  console.log(`   Items: ${result2.itemsFound}`);

  const speedup = time2 > 0 ? (time1 / time2).toFixed(2) : "N/A";
  console.log(`\n🚀 Cache speedup: ${speedup}x`);
}

/**
 * Test 3: Circuit breaker behavior
 */
async function testCircuitBreaker(): Promise<void> {
  console.log("\n" + "=".repeat(70));
  console.log("🧪 TEST 3: Circuit Breaker Status");
  console.log("=".repeat(70));

  const stats = getCircuitBreakerStats();

  if (Object.keys(stats).length === 0) {
    console.log("\n⚪ No circuit breaker activity yet");
  } else {
    console.log("\n📊 Circuit Breaker Stats:");
    for (const [sourceId, stat] of Object.entries(stats)) {
      const statusEmoji =
        stat.status === "CLOSED"
          ? "🟢"
          : stat.status === "OPEN"
            ? "🔴"
            : "🟡";
      console.log(`\n   ${statusEmoji} ${sourceId}`);
      console.log(`      Status: ${stat.status}`);
      console.log(`      Failures: ${stat.failureCount}`);
      if (stat.lastFailureAgo) {
        console.log(`      Last Failure: ${stat.lastFailureAgo}`);
      }
      if (stat.lastSuccessAgo) {
        console.log(`      Last Success: ${stat.lastSuccessAgo}`);
      }
    }
  }
}

/**
 * Test 4: Parallel multi-source fetch
 */
async function testParallelFetch(): Promise<void> {
  console.log("\n" + "=".repeat(70));
  console.log("🧪 TEST 4: Parallel Multi-Source Fetch");
  console.log("=".repeat(70));

  // Clear cache to force network fetches
  clearRssCache();
  console.log("\n🗑️  Cache cleared for fresh test\n");

  const sources = getEnabledSources().filter(
    (s) => s.lane === "OFFICIAL" || s.lane === "MEDIA"
  );

  console.log(`Fetching from ${sources.length} sources in parallel...\n`);

  const startTime = Date.now();
  const results = await fetchFromSources(sources);
  const totalTime = Date.now() - startTime;

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const totalItems = results.reduce((sum, r) => sum + r.itemsFound, 0);

  console.log(`\n📈 Results:`);
  console.log(`   Total Time: ${totalTime}ms`);
  console.log(`   Successful: ${successful}/${results.length}`);
  console.log(`   Failed: ${failed}/${results.length}`);
  console.log(`   Total Items: ${totalItems}`);
}

/**
 * Run all enhanced tests
 */
async function runEnhancedTests(): Promise<void> {
  console.log("\n🚀 Starting Enhanced Source Integration Tests\n");
  console.log("⚡ Features being tested:");
  console.log("   - Exponential backoff retry (3 attempts, 2-10s delays)");
  console.log("   - 10-minute RSS feed caching");
  console.log("   - Circuit breaker (opens after 3 failures)");
  console.log("   - 20-second request timeout");

  // Reset state
  resetAllCircuitBreakers();
  clearRssCache();

  // Test 1: Basic fetch
  await testBasicFetch();

  // Test 2: Cache effectiveness
  await testCacheEffectiveness();

  // Test 3: Circuit breaker
  await testCircuitBreaker();

  // Test 4: Parallel fetch
  await testParallelFetch();

  console.log("\n" + "=".repeat(70));
  console.log("✅ All enhanced tests completed!");
  console.log("=".repeat(70));
  console.log(`
📝 Observations:
1. Retry Mechanism: Check logs for "Retrying in Xms..." messages
2. Caching: Second fetch should be ~100x faster than first
3. Circuit Breaker: Sources that fail 3x enter "OPEN" state
4. Network Timeouts: Connections timeout after 20 seconds

🎯 Production Recommendations:
- Deploy to production and monitor for 24-48 hours
- Check circuit breaker stats to identify problematic sources
- Adjust cache TTL based on update frequency
- Consider increasing timeout for slow networks
  `);
}

// Run tests if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runEnhancedTests().catch((error) => {
    console.error("Test runner failed:", error);
    process.exit(1);
  });
}

export { runEnhancedTests };
