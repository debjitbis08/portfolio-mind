/**
 * Generate Portfolio Roles for Holdings
 *
 * This script uses AI to analyze holdings/stocks and output recommended
 * portfolio roles WITHOUT modifying the database.
 *
 * Output format: JSON array that can be manually reviewed and applied.
 */

import { db, schema } from "../src/lib/db/index.ts";
import { getHoldings } from "../src/lib/db/index.ts";
import { GoogleGenAI } from "@google/genai";

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

if (!GOOGLE_API_KEY) {
  console.error("❌ GOOGLE_API_KEY environment variable not set");
  process.exit(1);
}

const genAI = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });

interface PortfolioRoleRecommendation {
  symbol: string;
  stockName: string;
  recommendedRole: "VALUE" | "MOMENTUM" | "CORE" | "SPECULATIVE" | "INCOME";
  reasoning: string;
}

const SYSTEM_PROMPT = `You are a portfolio strategist analyzing investment holdings to classify them by investment strategy.

Given a stock name, determine the most appropriate Portfolio Role based on the company's general characteristics:

**Portfolio Roles:**
- **VALUE**: Deep value play with margin of safety. Buying beaten-down stocks with strong fundamentals.
- **MOMENTUM**: Trend-following, riding strength. Technical strength, breakouts, positive momentum.
- **CORE**: Long-term compounder, buy-and-hold. Quality businesses for the long haul, not trading.
- **SPECULATIVE**: High-risk/reward bet. Turnaround stories, small caps, uncertain outcomes.
- **INCOME**: Dividend/distribution focused. Stable income generators, high yield.

Analyze the rationale and assign the SINGLE most appropriate role. Consider:
- VALUE: Focus on undervaluation, low multiples, margin of safety
- MOMENTUM: Focus on technical strength, trends, breakouts
- CORE: Focus on quality, moat, long-term compounding
- SPECULATIVE: Focus on high risk/reward, turnarounds, uncertainty
- INCOME: Focus on dividends, stable cash flows, yield

Output valid JSON only:
{
  "role": "VALUE" | "MOMENTUM" | "CORE" | "SPECULATIVE" | "INCOME",
  "reasoning": "One sentence explanation"
}`;

async function analyzeWithAI(
  symbol: string,
  stockName: string
): Promise<{ role: string; reasoning: string }> {
  const prompt = `Stock: ${stockName} (${symbol})

What is the most appropriate Portfolio Role for this holding?`;

  const result = await genAI.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      { role: "user", parts: [{ text: SYSTEM_PROMPT }] },
      { role: "user", parts: [{ text: prompt }] },
    ],
    config: {
      temperature: 0.3,
      maxOutputTokens: 500,
    },
  });

  const responseText = result.text;

  // Extract JSON from response
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Invalid JSON response: ${responseText}`);
  }

  return JSON.parse(jsonMatch[0]);
}

async function main() {
  console.log("🔍 Fetching holdings without portfolio roles...\n");

  // Get all holdings
  const holdings = await getHoldings();

  // Get existing portfolio roles
  const existingRoles = await db.select().from(schema.portfolioRoles);
  const existingRoleSymbols = new Set(existingRoles.map((r) => r.symbol));

  // Filter to holdings without roles
  const holdingsWithoutRoles = holdings.filter(
    (h) => !existingRoleSymbols.has(h.symbol)
  );

  if (holdingsWithoutRoles.length === 0) {
    console.log("✅ All holdings already have portfolio roles assigned!");
    return;
  }

  console.log(`Found ${holdingsWithoutRoles.length} holdings to analyze\n`);

  const recommendations: PortfolioRoleRecommendation[] = [];

  for (const holding of holdingsWithoutRoles) {
    console.log(`Analyzing ${holding.symbol} (${holding.stockName})...`);

    try {
      const analysis = await analyzeWithAI(holding.symbol, holding.stockName);

      recommendations.push({
        symbol: holding.symbol,
        stockName: holding.stockName,
        recommendedRole: analysis.role as any,
        reasoning: analysis.reasoning,
      });

      console.log(`  ✓ Recommended: ${analysis.role}`);
    } catch (error) {
      console.error(`  ✗ Error: ${error}`);
      recommendations.push({
        symbol: holding.symbol,
        stockName: holding.stockName,
        recommendedRole: "CORE", // Safe default
        reasoning: `Error analyzing: ${error}`,
      });
    }

    // Rate limiting
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log("\n" + "=".repeat(80));
  console.log("📊 PORTFOLIO ROLE RECOMMENDATIONS");
  console.log("=".repeat(80) + "\n");

  // Output as formatted table
  console.log("Symbol".padEnd(15), "Stock Name".padEnd(30), "Role".padEnd(15), "Reasoning");
  console.log("-".repeat(100));

  for (const rec of recommendations) {
    console.log(
      rec.symbol.padEnd(15),
      rec.stockName.substring(0, 28).padEnd(30),
      rec.recommendedRole.padEnd(15),
      rec.reasoning.substring(0, 40)
    );
  }

  console.log("\n" + "=".repeat(80));
  console.log("📋 SQL INSERT STATEMENTS");
  console.log("=".repeat(80) + "\n");
  console.log("-- Copy and run these in your database:\n");

  for (const rec of recommendations) {
    console.log(
      `INSERT INTO portfolio_roles (symbol, role) VALUES ('${rec.symbol}', '${rec.recommendedRole}'); -- ${rec.stockName}`
    );
  }

  console.log("\n" + "=".repeat(80));
  console.log("💾 JSON OUTPUT (for manual review)");
  console.log("=".repeat(80) + "\n");
  console.log(JSON.stringify(recommendations, null, 2));

  console.log("\n✅ Analysis complete!");
  console.log("\nNext steps:");
  console.log("1. Review the recommendations above");
  console.log("2. Copy the SQL INSERT statements");
  console.log("3. Run them in your database: sqlite3 data/investor.db < statements.sql");
  console.log("4. Or use the manual editor on the company page to set roles one by one");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
