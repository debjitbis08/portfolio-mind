import {
  runBroadIndianScan,
  runCatalystScan,
  runCatalystTracker,
} from "../src/lib/catalyst";

// Configuration
const SCAN_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const NEWS_LOOKBACK_HOURS = 4; // Look back 4 hours for broad scan

async function main() {
  console.log("🚀 Starting Catalyst Daemon...");
  console.log("   Mode: India-Focused Broad Discovery + Keyword Tracking");
  console.log("   Interval: 30 minutes");
  console.log("");

  // Main Loop
  while (true) {
    try {
      const cycleStart = Date.now();
      console.log(`\n⏰ Cycle started at ${new Date().toISOString()}`);

      // 1. Tracker Pass (Validate existing potential catalysts)
      await runCatalystTracker();

      // 2. Broad Indian Market Scan (Primary - comprehensive coverage)
      console.log("\n" + "─".repeat(60));
      await runBroadIndianScan({
        newsMaxAgeHours: NEWS_LOOKBACK_HOURS,
        paperMode: true, // Stay in paper mode for calibration
      });

      // 3. Keyword-Based Scan (Secondary - for specific commodities)
      console.log("\n" + "─".repeat(60));
      await runCatalystScan({
        newsMaxAgeHours: NEWS_LOOKBACK_HOURS,
        paperMode: true,
      });

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

// Start
main().catch(console.error);
