#!/usr/bin/env tsx
/**
 * Script to generate and display the complete Tier 3 prompt
 *
 * This script shows exactly what prompt is sent to the Gemini API for Tier 3 analysis.
 * It includes:
 * - The system prompt (investment philosophy, decision framework)
 * - The user message (portfolio data, opportunities, pending suggestions)
 * - Available tools (Note: Tier 3 uses NO tools - it relies on cached data)
 */

import { db, getHoldings } from "../src/lib/db";
import * as schema from "../src/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import type { HoldingForAnalysis } from "../src/lib/gemini";
import { buildTier3SystemPrompt } from "../src/lib/tier3-prompt";

// ============================================================================
// MAIN SCRIPT
// ============================================================================

async function main() {
  console.log("=".repeat(80));
  console.log("TIER 3 ANALYSIS SYSTEM - PROMPT GENERATOR");
  console.log("=".repeat(80));
  console.log();

  // -------------------------------------------------------------------------
  // 1. FETCH REAL HOLDINGS
  // -------------------------------------------------------------------------
  console.log("📊 FETCHING REAL HOLDINGS DATA...");
  console.log("=".repeat(80));

  const dbHoldings = await getHoldings();
  console.log(`✓ Found ${dbHoldings.length} holdings`);

  // Fetch technical data
  const technicalData = await db.select().from(schema.technicalData);
  const techMap = new Map<string, (typeof technicalData)[0]>();
  for (const t of technicalData) {
    techMap.set(t.symbol, t);
  }
  console.log(`✓ Loaded technical data for ${technicalData.length} symbols`);

  // Build HoldingForAnalysis (same logic as cycle/run.ts)
  const holdings: HoldingForAnalysis[] = dbHoldings.map((h) => {
    const tech =
      techMap.get(h.symbol) ||
      techMap.get(`${h.symbol}.NS`) ||
      techMap.get(`${h.symbol}.BO`);

    const priceVsSma50 = tech?.priceVsSma50 ?? null;
    const priceVsSma200 = tech?.priceVsSma200 ?? null;
    const rsi14 = tech?.rsi14 ?? null;

    // Build wait reasons
    const waitReasons: string[] = [];
    if (rsi14 && rsi14 > 40) waitReasons.push(`RSI ${rsi14.toFixed(0)}`);
    if (priceVsSma50 && priceVsSma50 > 15)
      waitReasons.push(`+${priceVsSma50.toFixed(0)}% SMA50`);
    if (priceVsSma200 && priceVsSma200 > 15)
      waitReasons.push(`+${priceVsSma200.toFixed(0)}% SMA200`);
    if (tech?.sma200 && tech?.currentPrice && tech.currentPrice < tech.sma200) {
      waitReasons.push("Below SMA200");
    }

    return {
      symbol: h.symbol,
      stock_name: h.stockName,
      quantity: h.quantity,
      avg_buy_price: h.avgBuyPrice,
      current_price: tech?.currentPrice || 0,
      returns_percent:
        h.avgBuyPrice > 0 && tech?.currentPrice
          ? ((tech.currentPrice - h.avgBuyPrice) / h.avgBuyPrice) * 100
          : 0,
      rsi_14: rsi14,
      price_vs_sma50: priceVsSma50,
      price_vs_sma200: priceVsSma200,
      is_wait_zone: waitReasons.length > 0,
      wait_reasons: waitReasons,
    };
  });

  // Get available funds from settings
  const settings = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.id, 1))
    .limit(1);
  const availableFunds = settings[0]?.availableFunds ?? 0;

  console.log(`✓ Available Cash: ₹${availableFunds.toLocaleString("en-IN")}`);
  console.log();

  // -------------------------------------------------------------------------
  // 2. SYSTEM PROMPT (imported from GeminiService)
  // -------------------------------------------------------------------------
  console.log("📋 SYSTEM PROMPT");
  console.log("=".repeat(80));
  const systemPrompt = buildTier3SystemPrompt(availableFunds);
  console.log(systemPrompt);
  console.log();

  // -------------------------------------------------------------------------
  // 3. FETCH CACHED ANALYSIS DATA
  // -------------------------------------------------------------------------
  console.log("📊 FETCHING CACHED ANALYSIS DATA...");
  console.log("=".repeat(80));

  // Get delisted symbols to exclude
  const delistedStocks = await db
    .select({ symbol: schema.watchlist.symbol })
    .from(schema.watchlist)
    .where(eq(schema.watchlist.delisted, true));
  const delistedSymbols = new Set(delistedStocks.map((s) => s.symbol));

  // Get "interesting" symbols from watchlist
  const interestingStocks = await db
    .select({ symbol: schema.watchlist.symbol })
    .from(schema.watchlist)
    .where(eq(schema.watchlist.interesting, true));
  const interestingSymbols = new Set(interestingStocks.map((s) => s.symbol));

  // Get all cached analysis
  const allCached = await db
    .select()
    .from(schema.stockAnalysisCache)
    .orderBy(desc(schema.stockAnalysisCache.opportunityScore));

  // Filter out delisted stocks
  const validCached = allCached.filter((c) => !delistedSymbols.has(c.symbol));

  // Filter out delisted stocks from holdings (same logic as cycle/run.ts)
  const activeHoldings = holdings.filter((h) => !delistedSymbols.has(h.symbol));

  if (delistedSymbols.size > 0) {
    const skipped = holdings.length - activeHoldings.length;
    console.log(`✓ Filtered out ${skipped} delisted stock(s)`);
  }

  // Use actual holding symbols from the filtered active holdings
  const holdingSymbols = new Set(activeHoldings.map((h) => h.symbol));

  // Separate holdings analysis from opportunities
  const holdingsCached = validCached.filter((c) =>
    holdingSymbols.has(c.symbol)
  );

  // Only include opportunities that are STILL marked as "interesting"
  const opportunitiesCached = validCached.filter(
    (c) => !holdingSymbols.has(c.symbol) && interestingSymbols.has(c.symbol)
  );

  // Group opportunities by timing signal
  const accumulate = opportunitiesCached.filter(
    (c) => c.timingSignal === "accumulate" && (c.opportunityScore ?? 0) >= 70
  );
  const wait = opportunitiesCached.filter(
    (c) => c.timingSignal === "wait" && (c.opportunityScore ?? 0) >= 60
  );

  // Check for urgent news alerts in holdings
  const holdingsWithAlerts = holdingsCached.filter((c) => c.newsAlert);

  console.log(`✓ Found ${accumulate.length} accumulate opportunities`);
  console.log(`✓ Found ${wait.length} wait zone stocks`);
  console.log(`✓ Found ${holdingsWithAlerts.length} holdings with alerts`);
  console.log();

  // -------------------------------------------------------------------------
  // 4. BUILD USER MESSAGE
  // -------------------------------------------------------------------------
  console.log("💬 USER MESSAGE (Portfolio Data)");
  console.log("=".repeat(80));

  // Build holdings context with cached analysis (using activeHoldings without delisted)
  const holdingsWithAnalysis = activeHoldings.map((h) => {
    const cached = holdingsCached.find((c) => c.symbol === h.symbol);
    return {
      symbol: h.symbol,
      name: h.stock_name,
      quantity: h.quantity,
      avg_cost: h.avg_buy_price,
      current_price: h.current_price,
      returns_pct: h.returns_percent?.toFixed(1),
      opportunity_score: cached?.opportunityScore ?? null,
      timing_signal: cached?.timingSignal ?? null,
    };
  });

  let userMessage = `## Current Portfolio

| Symbol | Name | Qty | Avg | Current | Return | Score | Signal |
|--------|------|-----|-----|---------|--------|-------|--------|
${holdingsWithAnalysis
  .map(
    (h) =>
      `| ${h.symbol} | ${h.name || "-"} | ${
        h.quantity
      } | ₹${h.avg_cost?.toFixed(0)} | ₹${h.current_price?.toFixed(0)} | ${
        h.returns_pct
      }% | ${h.opportunity_score ?? "-"} | ${h.timing_signal ?? "-"} |`
  )
  .join("\n")}

**Total Holdings:** ${activeHoldings.length}
**Available Cash:** ₹${availableFunds.toLocaleString("en-IN")}

`;

  // Add alerts section if any
  if (holdingsWithAlerts.length > 0) {
    userMessage += `## ⚠️ HOLDINGS WITH NEWS ALERTS (Review First!)

${holdingsWithAlerts
  .map(
    (h) =>
      `**${h.symbol}** (Score: ${h.opportunityScore}, Signal: ${h.timingSignal})
- Alert: ${h.newsAlertReason}
- Thesis: ${h.thesisSummary}`
  )
  .join("\n\n")}

`;
  }

  // Add top opportunities (accumulate)
  if (accumulate.length > 0) {
    userMessage += `## 🟢 Top Opportunities (Accumulate Zone)

These stocks have STRONG fundamentals AND favorable timing:

${accumulate
  .slice(0, 10)
  .map(
    (o) =>
      `**${o.symbol}** — Score: ${o.opportunityScore}/100
_${o.thesisSummary}_
Risks: ${o.risksSummary}
${o.newsAlert ? `⚠️ NEWS: ${o.newsAlertReason}` : ""}`
  )
  .join("\n\n")}

`;
  }

  // Add wait zone stocks
  if (wait.length > 0) {
    userMessage += `## 🟡 Good Stocks to Monitor (Wait Zone)

These have good fundamentals but timing says wait:

${wait
  .slice(0, 5)
  .map(
    (o) =>
      `- **${o.symbol}** (${o.opportunityScore}): ${o.thesisSummary?.slice(
        0,
        100
      )}...`
  )
  .join("\n")}

`;
  }

  userMessage += `## Your Task

1. **ALERTS FIRST**: If any holdings have news alerts, evaluate if action needed
2. **PENDING SUGGESTIONS**: Confirm, update, or invalidate previous recommendations
3. **NEW OPPORTUNITIES**: From the 🟢 Accumulate list, pick 1-2 that fit the portfolio
4. **PORTFOLIO BALANCE**: Consider sector overlap, position sizing, cash levels

You have all the pre-analyzed data you need. Focus on PORTFOLIO-LEVEL decisions.

Output 1-3 actionable recommendations.`;

  console.log(userMessage);
  console.log();

  // -------------------------------------------------------------------------
  // 4. COMPLETE PROMPT
  // -------------------------------------------------------------------------
  console.log("🎯 COMPLETE PROMPT SENT TO GEMINI");
  console.log("=".repeat(80));
  const completePrompt = systemPrompt + "\n\n" + userMessage;
  console.log(`Total Length: ${completePrompt.length} characters`);
  console.log();

  // -------------------------------------------------------------------------
  // 5. TOOLS AVAILABLE
  // -------------------------------------------------------------------------
  console.log("🔧 TOOLS AVAILABLE TO TIER 3");
  console.log("=".repeat(80));
  console.log("❌ NONE");
  console.log();
  console.log("Tier 3 does NOT use tools. It relies entirely on:");
  console.log(
    "  - Pre-cached Tier 2 stock analysis (from stockAnalysisCache table)"
  );
  console.log("  - Portfolio holdings data");
  console.log("  - Pending suggestions from previous cycles");
  console.log();
  console.log("This makes Tier 3 MUCH faster as it doesn't need to:");
  console.log("  ❌ Scrape ValuePickr");
  console.log("  ❌ Fetch Google News");
  console.log("  ❌ Load financial data");
  console.log("  ❌ Calculate technicals");
  console.log();
  console.log("All that data is already summarized in the cached analysis!");
  console.log();

  // -------------------------------------------------------------------------
  // 6. CONFIGURATION
  // -------------------------------------------------------------------------
  console.log("⚙️  GEMINI CONFIGURATION");
  console.log("=".repeat(80));
  console.log("Model: gemini-3-pro-preview");
  console.log("Thinking Level: HIGH");
  console.log("Tools: None (uses cached data only)");
  console.log("Max Iterations: 1 (single LLM call, no tool loops)");
  console.log();

  // -------------------------------------------------------------------------
  // 7. SUMMARY
  // -------------------------------------------------------------------------
  console.log("📊 SUMMARY");
  console.log("=".repeat(80));
  console.log(`System Prompt Length: ${systemPrompt.length} chars`);
  console.log(`User Message Length: ${userMessage.length} chars`);
  console.log(`Total Prompt Length: ${completePrompt.length} chars`);
  console.log();
  console.log(
    "Tier 3 focuses on PORTFOLIO-LEVEL decisions using pre-analyzed data."
  );
  console.log("It's designed to be fast, efficient, and focused on action.");
  console.log("=".repeat(80));

  process.exit(0);
}

// Run the script
main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
