#!/usr/bin/env tsx
/**
 * Ticker Search CLI Tool
 *
 * Usage:
 *   pnpm tsx scripts/search-ticker.ts "Vardhman Textiles"
 *   pnpm tsx scripts/search-ticker.ts --validate VARDHMNRLV.NS
 *   pnpm tsx scripts/search-ticker.ts --smart "REC Limited"
 */

import { searchSymbol, validateTicker, findBestMatch } from "../src/lib/tools/symbol-search";

const args = process.argv.slice(2);

if (args.length === 0) {
  console.log("Ticker Search Tool");
  console.log("");
  console.log("Usage:");
  console.log("  Search for a company:");
  console.log('    pnpm tsx scripts/search-ticker.ts "Vardhman Textiles"');
  console.log("");
  console.log("  Validate a ticker:");
  console.log("    pnpm tsx scripts/search-ticker.ts --validate VARDHMNRLV.NS");
  console.log("");
  console.log("  Smart search (search + validate):");
  console.log('    pnpm tsx scripts/search-ticker.ts --smart "REC Limited"');
  process.exit(0);
}

async function main() {
  const mode = args[0].startsWith("--") ? args[0].slice(2) : "search";
  const query = args[0].startsWith("--") ? args.slice(1).join(" ") : args.join(" ");

  if (!query) {
    console.error("❌ Error: Query is required");
    process.exit(1);
  }

  console.log(`\n🔍 Mode: ${mode}`);
  console.log(`📝 Query: "${query}"\n`);

  try {
    if (mode === "validate") {
      // Validate ticker
      const result = await validateTicker(query);
      if (result.valid) {
        console.log("✅ Valid ticker found!");
        console.log(`   Symbol: ${result.workingTicker}`);
        console.log(`   Price: ₹${result.price?.toFixed(2) || "N/A"}`);
      } else {
        console.log("❌ Ticker is invalid (no quote data available)");
        console.log("   Try searching for the company name instead");
      }
    } else if (mode === "smart") {
      // Smart search with validation
      const result = await findBestMatch(query);
      if (result.found) {
        console.log(`✅ Found ${result.matches.length} match(es):\n`);
        result.matches.forEach((match, i) => {
          const status = match.validated ? "✅ Valid" : "⚠️  Unvalidated";
          const price = match.price ? `₹${match.price.toFixed(2)}` : "N/A";
          console.log(`${i + 1}. ${match.symbol} - ${match.name}`);
          console.log(`   Exchange: ${match.exchange}`);
          console.log(`   Status: ${status}`);
          console.log(`   Price: ${price}\n`);
        });

        // Show ticker correction suggestion
        const bestMatch = result.matches[0];
        if (bestMatch.validated) {
          console.log("📝 Suggested TICKER_CORRECTIONS entry:");
          console.log(`   "${query}": "${bestMatch.symbol}",\n`);
        }
      } else {
        console.log("❌ No matches found");
      }
    } else {
      // Simple search
      const results = await searchSymbol(query);
      if (results.length > 0) {
        console.log(`✅ Found ${results.length} match(es):\n`);
        results.forEach((result, i) => {
          console.log(`${i + 1}. ${result.symbol} - ${result.name}`);
          console.log(`   Exchange: ${result.exchange}`);
          console.log(`   Type: ${result.type || "Unknown"}\n`);
        });
      } else {
        console.log("❌ No matches found");
      }
    }
  } catch (error: any) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

main();
