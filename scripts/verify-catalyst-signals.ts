/**
 * Catalyst Verification Script
 *
 * Verifies past predictions by checking current prices against base prices.
 * Supports multiple verification intervals: 1hr, next session, 24hr.
 *
 * Usage: npx tsx scripts/verify-catalyst-signals.ts [options]
 *
 * Options:
 *   --checkpoint X  Which checkpoint to verify: 1hr, session, 24hr (default: auto)
 *   --min-age N     Only verify signals older than N minutes (default: 60)
 *   --report        Show a summary report of all verified signals
 *   --dry-run       Don't update the log file, just show what would happen
 */

import "dotenv/config";
import YahooFinance from "yahoo-finance2";
import {
  readOpportunities,
  updateOpportunityCheckpoint,
} from "../src/lib/catalyst/signal-dispatcher";
import type {
  OpportunityLogEntry,
  PriceCheckpoint,
  ExtendedCheckpoint,
} from "../src/lib/catalyst/types";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

// Default log path
const LOG_PATH = "./logs/opportunities.log";

// Parse command line arguments
const args = process.argv.slice(2);
const minAgeMinutes = parseInt(
  args.find((a, i) => args[i - 1] === "--min-age") || "60",
  10
);
const checkpointArg = args.find((a, i) => args[i - 1] === "--checkpoint");
const reportMode = args.includes("--report");
const dryRun = args.includes("--dry-run");

type CheckpointType = "after1hr" | "nextSession" | "after24hr";

/**
 * Checkpoint configuration with time thresholds.
 */
const CHECKPOINT_CONFIG: Record<
  CheckpointType,
  { minMinutes: number; maxMinutes: number; label: string }
> = {
  after1hr: { minMinutes: 60, maxMinutes: 180, label: "1 Hour" },
  nextSession: { minMinutes: 180, maxMinutes: 720, label: "Next Session" }, // 3-12 hours
  after24hr: { minMinutes: 720, maxMinutes: 2880, label: "24 Hours" }, // 12-48 hours
};

interface VerificationStats {
  total: number;
  verified: number;
  pending: number;
  goodCalls: number;
  badCalls: number;
  neutral: number;
  accuracy: number;
}

/**
 * Fetch current price for a ticker.
 */
async function getCurrentPrice(ticker: string): Promise<number | null> {
  try {
    const quote = (await yahooFinance.quote(ticker)) as any;
    return quote?.regularMarketPrice || null;
  } catch (error) {
    console.error(`Error fetching ${ticker}:`, error);
    return null;
  }
}

/**
 * Calculate price change percentage.
 */
function calcPriceChange(basePrice: number, currentPrice: number): number {
  return ((currentPrice - basePrice) / basePrice) * 100;
}

/**
 * Determine verdict based on prediction and actual price movement.
 */
function getVerdict(
  prediction: { sentiment: string },
  priceChange: number
): "GOOD_CALL" | "BAD_CALL" | "NEUTRAL" {
  // NEUTRAL if price moved < 0.5%
  if (Math.abs(priceChange) < 0.5) {
    return "NEUTRAL";
  }

  const predictedUp = prediction.sentiment === "BULLISH";
  const actualUp = priceChange > 0;

  return predictedUp === actualUp ? "GOOD_CALL" : "BAD_CALL";
}

/**
 * Determine which checkpoint to verify based on signal age.
 */
function getCheckpointType(ageMinutes: number): CheckpointType | null {
  if (
    ageMinutes >= CHECKPOINT_CONFIG.after1hr.minMinutes &&
    ageMinutes < CHECKPOINT_CONFIG.after1hr.maxMinutes
  ) {
    return "after1hr";
  }
  if (
    ageMinutes >= CHECKPOINT_CONFIG.nextSession.minMinutes &&
    ageMinutes < CHECKPOINT_CONFIG.nextSession.maxMinutes
  ) {
    return "nextSession";
  }
  if (
    ageMinutes >= CHECKPOINT_CONFIG.after24hr.minMinutes &&
    ageMinutes < CHECKPOINT_CONFIG.after24hr.maxMinutes
  ) {
    return "after24hr";
  }
  return null;
}

/**
 * Check if a checkpoint is already verified.
 */
function hasCheckpoint(
  entry: OpportunityLogEntry,
  type: CheckpointType
): boolean {
  return !!entry.checkpoints?.[type];
}

/**
 * Verify a single opportunity at a specific checkpoint.
 */
async function verifyCheckpoint(
  entry: OpportunityLogEntry,
  checkpointType: CheckpointType
): Promise<ExtendedCheckpoint | null> {
  const ticker = entry.marketState.globalTicker;
  const basePrice = entry.marketState.basePrice;

  if (!basePrice || basePrice === 0) {
    console.log(`  ⚠️  No base price for ${entry.id}, skipping`);
    return null;
  }

  // 1. Check Global Ticker (Validation)
  const currentGlobalPrice = await getCurrentPrice(ticker);
  if (!currentGlobalPrice) {
    console.log(`  ⚠️  Could not fetch current price for ${ticker}`);
    return null;
  }

  const globalPriceChange = calcPriceChange(basePrice, currentGlobalPrice);
  const verdict = getVerdict(entry.llmPrediction, globalPriceChange);

  // 2. Check Indian Ticker (Execution) if available
  let indianPrice: number | undefined;
  let indianChange: number | undefined;

  if (entry.indianTicker) {
    const currentIndianPrice = await getCurrentPrice(entry.indianTicker);
    if (currentIndianPrice) {
      indianPrice = currentIndianPrice;
      // If we recorded a base price for the Indian stock, use it.
      // Otherwise, we can't calculate precise change yet (future improvement).
      if (entry.indianBasePrice) {
        indianChange = calcPriceChange(
          entry.indianBasePrice,
          currentIndianPrice
        );
      }
    }
  }

  const verdictEmoji =
    verdict === "GOOD_CALL" ? "✅" : verdict === "BAD_CALL" ? "❌" : "➖";

  const checkpointLabel = CHECKPOINT_CONFIG[checkpointType].label;
  console.log(
    `  ${verdictEmoji} [${checkpointLabel}] ${entry.llmPrediction.sentiment} prediction`
  );

  // Log Global
  console.log(
    `      Global (${ticker}): $${basePrice.toFixed(
      2
    )} → $${currentGlobalPrice.toFixed(2)} (${
      globalPriceChange >= 0 ? "+" : ""
    }${globalPriceChange.toFixed(2)}%)`
  );

  // Log Indian
  if (entry.indianTicker && indianPrice) {
    const changeStr =
      indianChange !== undefined
        ? `(${indianChange >= 0 ? "+" : ""}${indianChange.toFixed(2)}%)`
        : "(No base price)";
    console.log(
      `      🇮🇳 India (${entry.indianTicker}): ₹${indianPrice.toFixed(
        2
      )} ${changeStr}`
    );
  }

  return {
    checkedAt: new Date().toISOString(),
    price: currentGlobalPrice,
    priceChangeFromSignal: globalPriceChange,
    verdict,
    indianStockPrice: indianPrice,
    indianStockChange: indianChange,
  };
}

/**
 * Generate a summary report.
 */
function generateReport(entries: OpportunityLogEntry[]): VerificationStats {
  const withVerdicts = entries.filter(
    (e) => e.finalVerdict && e.finalVerdict !== "PENDING"
  );
  const pending = entries.filter(
    (e) => !e.finalVerdict || e.finalVerdict === "PENDING"
  );

  const goodCalls = withVerdicts.filter(
    (e) => e.finalVerdict === "GOOD_CALL"
  ).length;
  const badCalls = withVerdicts.filter(
    (e) => e.finalVerdict === "BAD_CALL"
  ).length;
  const neutral = withVerdicts.filter(
    (e) => e.finalVerdict === "NEUTRAL"
  ).length;

  const decidedCalls = goodCalls + badCalls;
  const accuracy = decidedCalls > 0 ? (goodCalls / decidedCalls) * 100 : 0;

  return {
    total: entries.length,
    verified: withVerdicts.length,
    pending: pending.length,
    goodCalls,
    badCalls,
    neutral,
    accuracy,
  };
}

/**
 * Print a detailed report.
 */
function printReport(entries: OpportunityLogEntry[], stats: VerificationStats) {
  console.log("\n" + "═".repeat(60));
  console.log("📊 CATALYST VERIFICATION REPORT");
  console.log("═".repeat(60));

  console.log(`\nTotal Signals: ${stats.total}`);
  console.log(`Verified: ${stats.verified}`);
  console.log(`Pending: ${stats.pending}`);

  if (stats.verified > 0) {
    console.log(`\n✅ Good Calls: ${stats.goodCalls}`);
    console.log(`❌ Bad Calls: ${stats.badCalls}`);
    console.log(`➖ Neutral: ${stats.neutral}`);
    console.log(`\n📈 Accuracy: ${stats.accuracy.toFixed(1)}%`);
  }

  // Show breakdown by keyword
  const byKeyword = new Map<
    string,
    { good: number; bad: number; neutral: number }
  >();
  for (const entry of entries.filter(
    (e) => e.finalVerdict && e.finalVerdict !== "PENDING"
  )) {
    const kw = entry.keyword;
    const current = byKeyword.get(kw) || { good: 0, bad: 0, neutral: 0 };
    if (entry.finalVerdict === "GOOD_CALL") current.good++;
    else if (entry.finalVerdict === "BAD_CALL") current.bad++;
    else current.neutral++;
    byKeyword.set(kw, current);
  }

  if (byKeyword.size > 0) {
    console.log("\n📋 By Keyword:");
    for (const [kw, counts] of byKeyword) {
      const total = counts.good + counts.bad;
      const acc = total > 0 ? ((counts.good / total) * 100).toFixed(0) : "N/A";
      console.log(
        `   ${kw}: ${counts.good}✅ ${counts.bad}❌ ${counts.neutral}➖ (${acc}% accuracy)`
      );
    }
  }

  // Show recent entries with checkpoint details
  console.log("\n📜 Recent Signals:");
  const recent = entries.slice(-5);
  for (const entry of recent) {
    const vIcon =
      entry.finalVerdict === "GOOD_CALL"
        ? "✅"
        : entry.finalVerdict === "BAD_CALL"
        ? "❌"
        : entry.finalVerdict === "NEUTRAL"
        ? "➖"
        : "⏳";
    const time = new Date(entry.timestamp).toLocaleString();
    console.log(
      `   ${vIcon} [${time}] ${entry.keyword}: ${entry.headline.slice(
        0,
        50
      )}...`
    );

    // Show checkpoints
    if (entry.checkpoints) {
      const { after1hr, nextSession, after24hr } = entry.checkpoints;
      const parts = [];
      if (after1hr)
        parts.push(
          `1hr: ${
            after1hr.priceChangeFromSignal >= 0 ? "+" : ""
          }${after1hr.priceChangeFromSignal.toFixed(1)}%`
        );
      if (nextSession)
        parts.push(
          `session: ${
            nextSession.priceChangeFromSignal >= 0 ? "+" : ""
          }${nextSession.priceChangeFromSignal.toFixed(1)}%`
        );
      if (after24hr)
        parts.push(
          `24hr: ${
            after24hr.priceChangeFromSignal >= 0 ? "+" : ""
          }${after24hr.priceChangeFromSignal.toFixed(1)}%`
        );
      if (parts.length > 0) {
        console.log(`      ${parts.join(" | ")}`);
      }
    }
  }

  console.log("\n" + "═".repeat(60));
}

async function main() {
  console.log("\n" + "═".repeat(60));
  console.log("🔍 CATALYST SIGNAL VERIFICATION");
  console.log("═".repeat(60));

  console.log(`\nLog file: ${LOG_PATH}`);
  console.log(`Min age: ${minAgeMinutes} minutes`);
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE UPDATE"}`);
  if (checkpointArg) {
    console.log(`Checkpoint: ${checkpointArg}`);
  }

  // Read all opportunities
  const entries = readOpportunities(LOG_PATH);
  console.log(`\nLoaded ${entries.length} signals`);

  if (entries.length === 0) {
    console.log("No signals to verify.");
    return;
  }

  // If report mode, just show the report
  if (reportMode) {
    const stats = generateReport(entries);
    printReport(entries, stats);
    return;
  }

  const now = Date.now();
  let verified = 0;

  console.log("\nVerifying...\n");

  for (const entry of entries) {
    const ageMinutes = (now - new Date(entry.timestamp).getTime()) / 60000;

    // Determine which checkpoint to verify
    let checkpointType: CheckpointType | null = null;

    if (checkpointArg) {
      // Manual checkpoint selection
      const mapping: Record<string, CheckpointType> = {
        "1hr": "after1hr",
        session: "nextSession",
        "24hr": "after24hr",
      };
      checkpointType = mapping[checkpointArg] || null;
    } else {
      // Auto-detect based on age
      checkpointType = getCheckpointType(ageMinutes);
    }

    if (!checkpointType) {
      continue; // Not ready for any checkpoint
    }

    // Skip if already verified at this checkpoint
    if (hasCheckpoint(entry, checkpointType)) {
      continue;
    }

    console.log(`📌 ${entry.keyword} (${entry.id})`);
    console.log(`   "${entry.headline.slice(0, 60)}..."`);
    console.log(`   Age: ${Math.round(ageMinutes)} minutes`);

    const checkpoint = await verifyCheckpoint(entry, checkpointType);

    if (checkpoint && !dryRun) {
      updateOpportunityCheckpoint(
        LOG_PATH,
        entry.id,
        checkpointType,
        checkpoint
      );
      verified++;
    }
  }

  console.log(`\n✅ Verified ${verified} checkpoints`);

  // Show updated stats
  const updatedEntries = readOpportunities(LOG_PATH);
  const stats = generateReport(updatedEntries);
  printReport(updatedEntries, stats);
}

main().catch((error) => {
  console.error("\n💥 Fatal error:", error);
  process.exit(1);
});
