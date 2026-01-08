/**
 * Catalyst Scan Script
 *
 * Standalone script to run a catalyst scan.
 * Usage: npx tsx scripts/run-catalyst-scan.ts [options]
 *
 * Options:
 *   --live       Run in live mode (persist signals to DB)
 *   --keyword X  Scan only a specific keyword
 *   --hours N    Look back N hours for news (default: 2)
 *   --seed       Seed the watchlist with initial assets
 */

// Load environment variables from .env file
import "dotenv/config";

import {
  runCatalystScan,
  scanKeyword,
  DEFAULT_CATALYST_CONFIG,
} from "../src/lib/catalyst";
import { db } from "../src/lib/db";
import { catalystWatchlist } from "../src/lib/db/schema";
import type { CatalystConfig } from "../src/lib/catalyst/types";

// Parse command line arguments
const args = process.argv.slice(2);
const isLive = args.includes("--live");
const seedMode = args.includes("--seed");
const keywordIndex = args.indexOf("--keyword");
const hoursIndex = args.indexOf("--hours");

const specificKeyword = keywordIndex !== -1 ? args[keywordIndex + 1] : null;
const hoursBack = hoursIndex !== -1 ? parseInt(args[hoursIndex + 1], 10) : 2;

/**
 * Seed the watchlist with initial assets from the implementation plan.
 */
async function seedWatchlist() {
  console.log("\n🌱 Seeding catalyst watchlist...\n");

  const seedData = [
    // Commodities
    {
      keyword: "Copper",
      ticker: "HINDCOPPER.NS",
      assetType: "EQUITY" as const,
      globalValidationTicker: "HG=F",
      notes: "Hindustan Copper - MCX copper proxy",
    },
    {
      keyword: "Crude Oil",
      ticker: "ONGC.NS",
      assetType: "EQUITY" as const,
      globalValidationTicker: "CL=F",
      notes: "ONGC - moves with Brent",
    },
    {
      keyword: "Crude Oil",
      ticker: "BPCL.NS",
      assetType: "EQUITY" as const,
      globalValidationTicker: "CL=F",
      notes: "BPCL - OMC, inverse correlation",
    },
    {
      keyword: "Natural Gas",
      ticker: "GAIL.NS",
      assetType: "EQUITY" as const,
      globalValidationTicker: "NG=F",
      notes: "GAIL - natural gas exposure",
    },
    {
      keyword: "Gold",
      ticker: "GOLDBEES.NS",
      assetType: "ETF" as const,
      globalValidationTicker: "GC=F",
      notes: "Gold ETF",
    },
    {
      keyword: "Silver",
      ticker: "SILVERBEES.NS",
      assetType: "ETF" as const,
      globalValidationTicker: "SI=F",
      notes: "Silver ETF",
    },
    {
      keyword: "Uranium",
      ticker: null,
      assetType: "COMMODITY" as const,
      globalValidationTicker: "URA",
      notes: "Track via Global X Uranium ETF",
    },
    {
      keyword: "Coffee",
      ticker: null,
      assetType: "COMMODITY" as const,
      globalValidationTicker: "KC=F",
      notes: "Coffee futures",
    },

    // High-Impact Sectors
    {
      keyword: "Semiconductors India",
      ticker: "DIXON.NS",
      assetType: "EQUITY" as const,
      notes: "Electronics manufacturing",
    },
    {
      keyword: "Apple supplier India",
      ticker: "TATAELXSI.NS",
      assetType: "EQUITY" as const,
      notes: "Tech services",
    },
    {
      keyword: "EV battery India",
      ticker: "TATAMOTORS.NS",
      assetType: "EQUITY" as const,
      notes: "EV play",
    },
    {
      keyword: "Lithium",
      ticker: "EXIDEIND.NS",
      assetType: "EQUITY" as const,
      globalValidationTicker: "LIT",
      notes: "Battery/Lithium exposure",
    },
    {
      keyword: "Sugar exports",
      ticker: "BALRAMCHIN.NS",
      assetType: "EQUITY" as const,
      notes: "Commodity cycle",
    },
    {
      keyword: "Fertilizer shortage",
      ticker: "CHAMBALFERT.NS",
      assetType: "EQUITY" as const,
      notes: "Urea, DAP",
    },
    {
      keyword: "Suez Canal",
      ticker: "ADANIPORTS.NS",
      assetType: "EQUITY" as const,
      notes: "Shipping disruption",
    },
    {
      keyword: "Defense India",
      ticker: "HAL.NS",
      assetType: "EQUITY" as const,
      notes: "Hindustan Aeronautics",
    },
    {
      keyword: "Defense India",
      ticker: "BEL.NS",
      assetType: "EQUITY" as const,
      notes: "Bharat Electronics",
    },
    {
      keyword: "Defense India",
      ticker: "BHARATFORGE.NS",
      assetType: "EQUITY" as const,
      notes: "Bharat Forge",
    },

    // Global Keywords (affect multiple stocks)
    {
      keyword: "OPEC",
      ticker: null,
      assetType: "GLOBAL" as const,
      relatedTickers: "ONGC.NS,BPCL.NS,IOC.NS",
      globalValidationTicker: "CL=F",
      notes: "Oil price catalyst",
    },
    {
      keyword: "Taiwan China",
      ticker: null,
      assetType: "GLOBAL" as const,
      relatedTickers: "DIXON.NS,TATAELXSI.NS",
      notes: "Semiconductor supply chain",
    },
    {
      keyword: "Red Sea shipping",
      ticker: null,
      assetType: "GLOBAL" as const,
      relatedTickers: "ADANIPORTS.NS",
      notes: "Freight costs",
    },
    {
      keyword: "Monsoon India",
      ticker: null,
      assetType: "GLOBAL" as const,
      relatedTickers: "CHAMBALFERT.NS,GNFC.NS",
      notes: "Agri sector",
    },
    {
      keyword: "RBI interest rate",
      ticker: null,
      assetType: "GLOBAL" as const,
      relatedTickers: "HDFCBANK.NS,ICICIBANK.NS",
      notes: "Financials",
    },
  ];

  for (const item of seedData) {
    try {
      await db.insert(catalystWatchlist).values({
        keyword: item.keyword,
        ticker: item.ticker,
        assetType: item.assetType,
        globalValidationTicker: item.globalValidationTicker || null,
        relatedTickers: item.relatedTickers || null,
        notes: item.notes,
        enabled: true,
      });
      console.log(
        `   ✅ Added: ${item.keyword} -> ${item.ticker || "(global)"}`
      );
    } catch (error) {
      // Likely duplicate, skip
      console.log(
        `   ⏭️  Skipped (exists): ${item.keyword} -> ${
          item.ticker || "(global)"
        }`
      );
    }
  }

  console.log("\n✅ Watchlist seeded!\n");
}

async function main() {
  console.log("\n" + "═".repeat(60));
  console.log("🎯 CATALYST CATCHER");
  console.log("═".repeat(60));

  // Handle seed mode
  if (seedMode) {
    await seedWatchlist();
    process.exit(0);
  }

  // Build config
  const config: Partial<CatalystConfig> = {
    paperMode: !isLive,
    newsMaxAgeHours: hoursBack,
  };

  console.log(`\nConfiguration:`);
  console.log(`   Mode: ${isLive ? "🔴 LIVE" : "📝 PAPER (calibration)"}`);
  console.log(`   News lookback: ${hoursBack} hours`);
  if (specificKeyword) {
    console.log(`   Target: ${specificKeyword}`);
  }

  // Run scan
  let result;
  if (specificKeyword) {
    result = await scanKeyword(specificKeyword, config);
  } else {
    result = await runCatalystScan(config);
  }

  // Exit with appropriate code
  if (result.errors.length > 0) {
    console.error("\n❌ Scan completed with errors");
    process.exit(1);
  }

  console.log("\n✅ Scan completed successfully");
  process.exit(0);
}

main().catch((error) => {
  console.error("\n💥 Fatal error:", error);
  process.exit(1);
});
