import { type NewsItem, type CatalystAsset } from "./types";
import { potentialCatalysts, suggestions } from "../db/schema";
import { db } from "../db";
import { eq, and, gte, lt } from "drizzle-orm";
import { GoogleGenAI } from "@google/genai";
import YahooFinance from "yahoo-finance2";
import {
  isIndianMarketOpen,
  getMarketMode,
  getMarketModeDescriptor,
  type MarketMode,
} from "./market-hours";

// Standalone-compatible API key getter (uses process.env, works without Astro)
function getApiKey(): string {
  if (process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY;
  }
  throw new Error("GEMINI_API_KEY not found in environment variables");
}

// Standalone model helper that doesn't depend on Astro imports
async function callGeminiForDiscovery(prompt: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
    },
  });

  return response.text || "{}";
}

/**
 * Result of the AI discovery process
 */
interface DiscoveryResult {
  newCatalysts: number;
  catalysts: {
    predictedImpact: string;
    affectedSymbols: string[];
    watchCriteria: any;
  }[];
}

// Initialize Yahoo Finance client
const yahooFinance = new YahooFinance();

function formatMarketModePrompt(mode: MarketMode): string {
  const modeMap = {
    OPEN: {
      botMode: "Active Hunter",
      outputType: "High-velocity alerts / Immediate action.",
    },
    POST_CLOSE: {
      botMode: "Post-Game Review",
      outputType: "Performance analysis and lessons learned.",
    },
    OVERNIGHT: {
      botMode: "Signal Collector",
      outputType: "Silent queueing of overnight catalysts.",
    },
    PRE_OPEN: {
      botMode: "Strategist",
      outputType: "Top watchlist for the opening bell.",
    },
  } as const;
  const descriptor = modeMap[mode];
  const offMarket = mode !== "OPEN";

  return `
MARKET MODE: ${mode} (${descriptor.botMode})
OUTPUT TYPE: ${descriptor.outputType}
${offMarket ? "- No immediate action language. Frame as Tomorrow's Watchlist." : "- Market open: actionable timing is allowed."}
${offMarket ? "- Emphasize gap-up/gap-down scenarios and opening bell catalysts." : "- Focus on real-time confirmation."}
`;
}

/**
 * Capture and record base price for a catalyst at discovery time.
 * If market is closed, marks as pending for next-open capture.
 */
async function captureBasePrice(
  catalystId: string,
  ticker: string
): Promise<void> {
  const marketOpen = isIndianMarketOpen();

  if (marketOpen) {
    try {
      // Try both NSE and BSE suffixes
      const tickersToTry = [ticker];
      if (ticker.endsWith(".NS")) {
        tickersToTry.push(ticker.replace(".NS", ".BO"));
      } else if (ticker.endsWith(".BO")) {
        tickersToTry.push(ticker.replace(".BO", ".NS"));
      }

      let quote: any = null;
      let finalTicker = ticker;

      for (const tryTicker of tickersToTry) {
        try {
          quote = await yahooFinance.quote(tryTicker);
          if (quote?.regularMarketPrice) {
            finalTicker = tryTicker;
            break;
          }
        } catch {
          continue;
        }
      }

      if (quote?.regularMarketPrice) {
        await db
          .update(potentialCatalysts)
          .set({
            basePrice: quote.regularMarketPrice,
            basePriceTicker: finalTicker,
            basePriceRecordedAt: new Date().toISOString(),
            basePriceType: "discovery",
          })
          .where(eq(potentialCatalysts.id, catalystId));

        console.log(
          `      💰 Base price recorded: ${finalTicker} @ ₹${quote.regularMarketPrice.toFixed(
            2
          )}`
        );
      } else {
        console.warn(
          `      ⚠️  Could not fetch base price for ${ticker}, marking as pending`
        );
        await db
          .update(potentialCatalysts)
          .set({ basePriceType: "pending_next_open" })
          .where(eq(potentialCatalysts.id, catalystId));
      }
    } catch (error) {
      console.error(
        `      ❌ Error capturing base price for ${ticker}:`,
        error
      );
      await db
        .update(potentialCatalysts)
        .set({ basePriceType: "pending_next_open" })
        .where(eq(potentialCatalysts.id, catalystId));
    }
  } else {
    // Market closed - mark for next-open capture
    await db
      .update(potentialCatalysts)
      .set({ basePriceType: "pending_next_open" })
      .where(eq(potentialCatalysts.id, catalystId));

    console.log(
      `      ⏰ Market closed - base price will be captured at next open for ${ticker}`
    );
  }
}

// -- AI Analysis --

/**
 * Analyze all news for a specific ticker and determine overall impact/sentiment.
 * This is the NEW ticker-focused analysis that replaces batch-based analysis.
 */
async function analyzeTickerNewsForDiscovery(
  ticker: string,
  news: NewsItem[],
  assets: CatalystAsset[],
  existingCatalysts: Awaited<ReturnType<typeof getRelevantExistingCatalysts>>,
  marketMode: MarketMode
) {
  const newsContext = news
    .map((n, i) => formatNewsItemForPrompt(n, i + 1))
    .join("\n");

  // Filter existing catalysts that involve this ticker
  const relevantExisting = existingCatalysts.filter((cat) =>
    cat.affectedSymbols.includes(ticker)
  );

  // Format existing catalysts for LLM context
  const existingContext =
    relevantExisting.length > 0
      ? `
## EXISTING CATALYSTS FOR ${ticker} (Last 48h)
 ℹ️ Before creating a NEW catalyst, check if your discovery is about the SAME event as one below.
If it's the same event (even with different details/sources), return an UPDATE instead of a new catalyst.

${relevantExisting
  .map(
    (cat, i) =>
      `${i + 1}. [${cat.id}] Created ${cat.ageHours}h ago
   Impact: ${cat.predictedImpact}
   Symbols: ${cat.affectedSymbols.join(", ")}`
  )
  .join("\n\n")}
`
      : `\n## NO EXISTING CATALYSTS FOR ${ticker}\nThis is the first analysis for this ticker in the last 48h.\n`;

  const prompt = `
  You are an Indian Market Catalyst Analyzer specializing in TICKER-SPECIFIC analysis.

  TICKER UNDER ANALYSIS: ${ticker}

  ${formatMarketModePrompt(marketMode)}

  Your goal is to analyze ALL news about ${ticker} together and determine:
  1. Overall sentiment (BULLISH/BEARISH/NEUTRAL)
  2. Predicted impact (UP/DOWN/NEUTRAL)
  3. Confidence level (1-10)
  4. Whether this represents a NEW catalyst or an UPDATE to existing ones

  WHAT TO LOOK FOR:
  - Supply shocks (factory shutdowns, strikes, raw material shortages)
  - Demand shocks (new orders, policy changes, consumer trends)
  - Regulatory changes (SEBI, RBI, government policy)
  - Corporate events (management changes, M&A, earnings surprises)
  - Sector-wide impacts that affect this ticker

  IGNORE:
  - Generic market commentary ("Sensex rises 200 points")
  - Routine earnings (unless major surprise)
  - Already widely known news

${existingContext}

  🚨 REEVALUATION RULES:
  1. If news is about the SAME event as an existing catalyst:
     - Return an UPDATE with the existing catalyst ID (8-char ID shown above)
     - REEVALUATE the impact based on ALL available information (old + new)
     - Adjust sentiment/direction if new information changes the outlook
     - Update confidence based on additional confirmation or contradiction

  2. Only create a NEW catalyst if:
     - The event is DISTINCT from all existing catalysts
     - It's a DIFFERENT aspect requiring separate tracking
     - It has a DIFFERENT timeframe or impact vector

  3. When multiple news items exist:
     - Synthesize them into a SINGLE comprehensive view
     - Identify the dominant narrative
     - Note any contradictions or uncertainties

  NEWS ARTICLES FOR ${ticker}:
  ${newsContext}

  TASK:
  1. Read ALL articles together to form a comprehensive view
  2. Check against existing catalysts - is this the SAME story or a NEW one?
  3. Determine overall BULLISH/BEARISH sentiment and predicted direction
  4. If UPDATE: provide reevaluated impact considering all information
  5. If NEW: create a new catalyst with watch criteria
  6. Return AT MOST ONE new catalyst for this ticker

  FRESHNESS & NOISE HANDLING:
  - Prioritize news just after close (15:30-20:00) and pre-open (08:00-09:15) for next session relevance.
  - De-emphasize PR fluff or routine updates unless they materially shift the catalyst strength.

  🔖 CITATION REQUIREMENT:
  - Include inline citations [1], [2], [3] etc. in your impact descriptions
  - Use the article numbers from the NEWS ARTICLES list above
  - Example: "Government announced ₹500cr subsidy [1], confirmed by RBI data [2]."
  - Cite specific claims, numbers, and key facts
  - Multiple sources for the same fact: "Production halt confirmed [1][2]"

  OUTPUT FORMAT (JSON):
  {
    "updates": [
      {
        "existingCatalystId": "b788fc78",
        "reason": "Reevaluating based on new developments",
        "updatedImpact": "Comprehensive impact description with citations [1]. Additional details [2].",
        "updatedSymbols": ["${ticker}"],
        "confidence": 9,
        "sentiment": "BULLISH",
        "direction": "UP",
        "citedArticles": [1, 2]
      }
    ],
    "newCatalysts": [
      {
        "impactSummary": "Concise summary with citations [1]. Key fact [2].",
        "affectedTickers": ["${ticker}"],
        "confidence": 8,
        "sentiment": "BULLISH",
        "watchCriteria": {
          "metric": "PRICE",
          "direction": "UP",
          "thresholdPercent": 2,
          "timeoutHours": 24
        },
        "citedArticles": [1, 2]
      }
    ]
  }

  Return ONLY valid JSON. If nothing interesting, return {"updates": [], "newCatalysts": []}.
  `;

  const text = await callGeminiForDiscovery(prompt);

  try {
    return JSON.parse(text);
  } catch (e) {
    console.error(
      `Failed to parse discovery response for ${ticker}:`,
      text.substring(0, 200)
    );
    return { updates: [], newCatalysts: [] };
  }
}

/**
 * PASS 2: Generate a SHORT-TERM TRADING THESIS for a ticker.
 *
 * This synthesizes:
 * - Current news items (from this scan)
 * - Past catalyst outcomes (from existing catalysts)
 * - Pass 1 analysis results
 *
 * Output: A trading thesis with explicit +/- potential score for use by Pass 3.
 */
async function synthesizeTickerOutcome(
  ticker: string,
  news: NewsItem[],
  existingCatalysts: Awaited<ReturnType<typeof getRelevantExistingCatalysts>>,
  pass1Analysis: any,
  marketMode: MarketMode
): Promise<{
  shouldUpdate: boolean;
  shortTermThesis: string;
  sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
  potentialScore: number; // -10 to +10
  confidence: number; // 1-10
  keyInsight: string;
} | null> {
  const newsContext = news
    .map((n, i) => formatNewsItemForPrompt(n, i + 1))
    .join("\n");

  // Filter existing catalysts for this ticker
  const relevantExisting = existingCatalysts.filter((cat) =>
    cat.affectedSymbols.includes(ticker)
  );

  const existingContext =
    relevantExisting.length > 0
      ? `
## PAST CATALYSTS FOR ${ticker} (Last 48h)
These are previous catalyst events - consider their outcomes when forming your thesis:

${relevantExisting
  .map(
    (cat, i) =>
      `${i + 1}. [${cat.id}] ${cat.predictedImpact}
   Created: ${cat.ageHours}h ago | Status: Still monitoring`
  )
  .join("\n\n")}
`
      : `\n## NO PAST CATALYSTS FOR ${ticker}\nThis is a fresh analysis with no prior context.\n`;

  const prompt = `
You are a SHORT-TERM SWING TRADER analyzing ${ticker} for a 1-28 day trading opportunity.

## YOUR TASK - PASS 2: GENERATE TRADING THESIS

Based on all available information, generate a TRADING THESIS that answers:
1. **What is happening?** - Synthesize all news into ONE clear narrative
2. **How will the stock move?** - BULLISH, BEARISH, or NEUTRAL over the next 1-4 weeks
3. **How strong is the potential?** - Rate from -10 (strong bearish) to +10 (strong bullish)
4. **How confident are you?** - Rate 1-10 based on source quality and consistency

## PASS 1 ANALYSIS (Individual News Assessment)
${JSON.stringify(pass1Analysis, null, 2)}

## CURRENT NEWS FOR ${ticker}
${newsContext}

${existingContext}

## MARKET MODE
${formatMarketModePrompt(marketMode)}

## THESIS GENERATION RULES

**Scoring Guide (potentialScore):**
- +8 to +10: Major positive catalyst (big order wins, regulatory approval, sector tailwind)
- +4 to +7: Moderate positive (good earnings, positive news cluster)
- +1 to +3: Slight positive (minor news, might move 1-3%)
- 0: Neutral (no clear direction)
- -1 to -3: Slight negative (minor headwinds)
- -4 to -7: Moderate negative (earnings miss, sector concerns)
- -8 to -10: Major negative catalyst (regulatory action, fraud, major loss)

**Confidence Guide:**
- 9-10: Multiple reliable sources confirm the same story
- 7-8: Clear catalyst from credible source
- 5-6: Single source or mixed signals
- 3-4: Speculation or unverified claims
- 1-2: Very uncertain / contradicting information

**Thesis Writing:**
- Write 2-3 sentences that a trader can act on
- Include the KEY CATALYST driving the thesis
- Mention timeframe expectations if applicable
- Cite sources with [1], [2], etc.
- If multiple articles or existing catalysts are present, ALWAYS return shouldUpdate=true and produce a single unified narrative (even if neutral).

**Off-Market Additions (when market is not OPEN):**
- Frame thesis as a Pre-Market Briefing or Tomorrow's Watchlist entry.
- Include a GAP scenario: "If open > X% gap, watch for continuation vs gap-and-trap."
- If conviction is extremely high (confidence 9-10), mention AMO readiness and liquidity risk.
- In keyInsight, include a short "Sector sentiment: score" on a -3 to +3 scale.

## OUTPUT FORMAT (JSON)
{
  "shouldUpdate": true,
  "shortTermThesis": "2-3 sentence trading thesis with citations [1][2]. What to expect and why.",
  "sentiment": "BULLISH" | "BEARISH" | "NEUTRAL",
  "potentialScore": 7,
  "confidence": 8,
  "keyInsight": "One-line actionable takeaway for traders"
}

Set shouldUpdate=false ONLY if there's genuinely nothing interesting for traders.
Return ONLY valid JSON.
`;

  const text = await callGeminiForDiscovery(prompt);

  try {
    const result = JSON.parse(text);
    // Validate and clamp values
    return {
      shouldUpdate: Boolean(result.shouldUpdate),
      shortTermThesis: result.shortTermThesis || "",
      sentiment: ["BULLISH", "BEARISH", "NEUTRAL"].includes(result.sentiment)
        ? result.sentiment
        : "NEUTRAL",
      potentialScore: Math.max(
        -10,
        Math.min(10, Number(result.potentialScore) || 0)
      ),
      confidence: Math.max(1, Math.min(10, Number(result.confidence) || 5)),
      keyInsight: result.keyInsight || "",
    };
  } catch (e) {
    console.error(
      `Failed to parse synthesis response for ${ticker}:`,
      text.substring(0, 200)
    );
    return null;
  }
}

/**
 * Groups news items by ticker symbol.
 * Returns a map of ticker -> news items that mention that ticker.
 */
function groupNewsByTicker(
  newsItems: NewsItem[],
  assets: CatalystAsset[]
): Map<string, NewsItem[]> {
  const tickerGroups = new Map<string, NewsItem[]>();

  // Group news by ticker mentions
  for (const newsItem of newsItems) {
    const text = `${newsItem.title} ${newsItem.source}`.toUpperCase();
    const mentionedTickers = new Set<string>();

    // Check each asset for matches
    for (const asset of assets) {
      if (!asset.ticker) continue;

      let matched = false;

      // 1. Check keyword (company name) - PRIMARY MATCHING METHOD
      if (asset.keyword) {
        const keywordPattern = new RegExp(
          `\\b${asset.keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
          "i"
        );
        if (keywordPattern.test(text)) {
          matched = true;
        }
      }

      // 2. Check ticker symbol (fallback)
      if (!matched && asset.ticker) {
        const base = asset.ticker.replace(/\.(NS|BO)$/, "");
        const tickerPatterns = [
          new RegExp(`\\b${base}\\b`, "i"),
          new RegExp(`\\b${asset.ticker}\\b`, "i"),
        ];
        if (tickerPatterns.some((p) => p.test(text))) {
          matched = true;
        }
      }

      // 3. Check related tickers
      if (!matched && asset.relatedTickers) {
        for (const relatedTicker of asset.relatedTickers) {
          const base = relatedTicker.replace(/\.(NS|BO)$/, "");
          const relatedPattern = new RegExp(`\\b${base}\\b`, "i");
          if (relatedPattern.test(text)) {
            matched = true;
            break;
          }
        }
      }

      if (matched) {
        mentionedTickers.add(asset.ticker);
      }
    }

    // Add to groups
    if (mentionedTickers.size > 0) {
      for (const ticker of mentionedTickers) {
        if (!tickerGroups.has(ticker)) {
          tickerGroups.set(ticker, []);
        }
        tickerGroups.get(ticker)!.push(newsItem);
      }
    }
  }

  return tickerGroups;
}

/**
 * Core function to discover potential catalysts from a batch of news.
 *
 * NEW APPROACH:
 * 1. Groups news by ticker symbol
 * 2. Analyzes all news for each ticker together
 * 3. Creates/updates potential catalysts per ticker with comprehensive analysis
 * 4. Saves to DB for tracker to monitor and reevaluate
 */
export async function discoverCatalysts(
  newsItems: NewsItem[],
  assets: CatalystAsset[]
): Promise<DiscoveryResult> {
  if (newsItems.length === 0) return { newCatalysts: 0, catalysts: [] };

  const marketMode = getMarketMode();
  const marketDescriptor = getMarketModeDescriptor();

  // Expire old catalysts before discovering new ones
  const expired = await expireOldCatalysts();
  if (expired > 0) {
    console.log(`   🗑️  Expired ${expired} old catalyst(s) (>48h)`);
  }

  console.log(
    `\n🔍 Running Ticker-Grouped AI Discovery on ${newsItems.length} articles...`
  );
  console.log(
    `   🕒 Market mode: ${marketDescriptor.botMode} (${marketDescriptor.mode})`
  );

  // Fetch existing catalysts for LLM context (deduplication & updates)
  const existingCatalysts = await getRelevantExistingCatalysts();
  if (existingCatalysts.length > 0) {
    console.log(
      `   📋 Loaded ${existingCatalysts.length} existing catalysts for reevaluation`
    );
  }

  // 1. Group news by ticker
  const tickerGroups = groupNewsByTicker(newsItems, assets);
  console.log(`   📊 Grouped news into ${tickerGroups.size} ticker groups`);

  // Log grouping summary
  for (const [ticker, news] of tickerGroups.entries()) {
    console.log(`      ${ticker}: ${news.length} article(s)`);
  }

  const results: DiscoveryResult = { newCatalysts: 0, catalysts: [] };
  let updateCount = 0;

  // FALLBACK: If no ticker groups found, use batch analysis on all news
  if (tickerGroups.size === 0) {
    console.log(
      `   ⚠️  No ticker matches found. Falling back to batch analysis...`
    );

    // Chunk news into batches of 10 for analysis
    const chunkSize = 10;
    for (let i = 0; i < newsItems.length; i += chunkSize) {
      const batch = newsItems.slice(i, i + chunkSize);
      console.log(
        `\n   🔍 Analyzing batch ${Math.floor(i / chunkSize) + 1} (${
          batch.length
        } articles)...`
      );

      const analysis = await analyzeBatchForDiscovery(
        batch,
        assets,
        existingCatalysts,
        marketMode
      );

      const batchCitations = buildSourceCitations(batch);
      const batchRelatedArticleIds = buildRelatedArticleIds(batch);

      // Process updates
      if (analysis.updates && analysis.updates.length > 0) {
        for (const update of analysis.updates) {
          const idStr = String(update.existingCatalystId).toLowerCase();
          if (!/^[a-f0-9]{8}/.test(idStr)) continue;

          const matchingCatalyst = existingCatalysts.find(
            (c) => c.id === idStr || c.fullId.startsWith(idStr)
          );

          if (!matchingCatalyst) continue;

          await db
            .update(potentialCatalysts)
            .set({
              predictedImpact: update.updatedImpact,
              affectedSymbols: JSON.stringify(update.updatedSymbols),
              relatedArticleIds: JSON.stringify(batchRelatedArticleIds),
              sourceCitations: JSON.stringify(batchCitations),
              updatedAt: new Date().toISOString(),
            })
            .where(eq(potentialCatalysts.id, matchingCatalyst.fullId));

          updateCount++;
          console.log(`      🔄 Updated [${idStr}]: ${update.reason}`);
        }
      }

      // Process new catalysts
      if (analysis.newCatalysts && analysis.newCatalysts.length > 0) {
        console.log(
          `      ✨ Found ${analysis.newCatalysts.length} catalyst(s)`
        );

        for (const cat of analysis.newCatalysts) {
          await db.insert(potentialCatalysts).values({
            predictedImpact: cat.impactSummary,
            affectedSymbols: JSON.stringify(cat.affectedTickers),
            watchCriteria: JSON.stringify(cat.watchCriteria),
            relatedArticleIds: JSON.stringify(batchRelatedArticleIds),
            sourceCitations: JSON.stringify(batchCitations),
            status: "monitoring",
            validationLog: "[]",
          });

          results.newCatalysts++;
          results.catalysts.push({
            predictedImpact: cat.impactSummary,
            affectedSymbols: cat.affectedTickers,
            watchCriteria: cat.watchCriteria,
          });
        }
      }
    }

    // CONSOLIDATION PASS: Ensure ONE entry per ticker symbol
    if (results.newCatalysts > 0) {
      console.log(
        `\n   🔄 Running consolidation pass to ensure ONE entry per ticker...`
      );

      // Fetch all monitoring catalysts (including newly created ones)
      const allCatalysts = await db
        .select()
        .from(potentialCatalysts)
        .where(eq(potentialCatalysts.status, "monitoring"));

      // Group catalysts by ticker
      const tickerCatalystMap = new Map<string, typeof allCatalysts>();

      for (const catalyst of allCatalysts) {
        const symbols = JSON.parse(
          catalyst.affectedSymbols || "[]"
        ) as string[];
        for (const ticker of symbols) {
          if (!tickerCatalystMap.has(ticker)) {
            tickerCatalystMap.set(ticker, []);
          }
          tickerCatalystMap.get(ticker)!.push(catalyst);
        }
      }

      let consolidatedCount = 0;

      // For each ticker with multiple catalysts, keep the newest and delete older ones
      for (const [ticker, catalysts] of tickerCatalystMap.entries()) {
        if (catalysts.length <= 1) continue;

        // Sort by creation time (newest first)
        const sortedCatalysts = catalysts.sort(
          (a, b) =>
            new Date(b.createdAt || 0).getTime() -
            new Date(a.createdAt || 0).getTime()
        );

        const newestCatalyst = sortedCatalysts[0];
        const olderCatalysts = sortedCatalysts.slice(1);

        // Delete all older catalysts for this ticker
        for (const oldCat of olderCatalysts) {
          await db
            .update(suggestions)
            .set({ catalystId: null })
            .where(eq(suggestions.catalystId, oldCat.id));
          await db
            .delete(potentialCatalysts)
            .where(eq(potentialCatalysts.id, oldCat.id));
          consolidatedCount++;
        }

        console.log(
          `      🗑️  ${ticker}: Consolidated ${
            catalysts.length
          } entries → 1 [${newestCatalyst.id.slice(0, 8)}]`
        );
      }

      if (consolidatedCount > 0) {
        console.log(
          `   ✅ Removed ${consolidatedCount} duplicate catalyst(s) to ensure ONE per ticker`
        );
      }
    }

    // Skip to summary
    console.log(`\n   📊 Discovery Summary:`);
    console.log(`      New catalysts: ${results.newCatalysts}`);
    if (updateCount > 0) {
      console.log(`      Updated catalysts: ${updateCount}`);
    }

    return results;
  }

  // 2. Two-pass analysis for each ticker (when grouping succeeded)
  for (const [ticker, tickerNews] of tickerGroups.entries()) {
    try {
      const tickerCitations = buildSourceCitations(tickerNews);
      const tickerRelatedArticleIds = buildRelatedArticleIds(tickerNews);
      console.log(
        `\n   🔍 Pass 1: Analyzing ${ticker} (${tickerNews.length} articles)...`
      );

      // PASS 1: Individual article analysis
      const analysis = await analyzeTickerNewsForDiscovery(
        ticker,
        tickerNews,
        assets,
        existingCatalysts,
        marketMode
      );

      // Process UPDATES first (reevaluation of existing catalysts)
      if (analysis.updates && analysis.updates.length > 0) {
        for (const update of analysis.updates) {
          const idStr = String(update.existingCatalystId).toLowerCase();
          if (!/^[a-f0-9]{8}/.test(idStr)) {
            console.error(
              `      ⚠️  Invalid catalyst ID format: ${update.existingCatalystId}`
            );
            continue;
          }

          const matchingCatalyst = existingCatalysts.find(
            (c) => c.id === idStr || c.fullId.startsWith(idStr)
          );

          if (!matchingCatalyst) {
            console.error(
              `      ⚠️  Cannot find catalyst ${update.existingCatalystId} for update`
            );
            continue;
          }

          await db
            .update(potentialCatalysts)
            .set({
              predictedImpact: update.updatedImpact,
              affectedSymbols: JSON.stringify(update.updatedSymbols),
              relatedArticleIds: JSON.stringify(tickerRelatedArticleIds),
              sourceCitations: JSON.stringify(tickerCitations),
              updatedAt: new Date().toISOString(),
            })
            .where(eq(potentialCatalysts.id, matchingCatalyst.fullId));

          updateCount++;
          console.log(`      🔄 Updated [${idStr}]: ${update.reason}`);
        }
      }

      // Process NEW catalysts from Pass 1 (keep only the primary entry per ticker)
      if (analysis.newCatalysts && analysis.newCatalysts.length > 0) {
        const [primary, ...extra] = analysis.newCatalysts;
        console.log(
          `      ✨ Pass 1 found ${analysis.newCatalysts.length} catalyst(s)`
        );
        if (extra.length > 0) {
          console.log(
            `      🧩 Consolidating ${extra.length} extra catalyst(s) into primary narrative`
          );
        }

        await db.insert(potentialCatalysts).values({
          predictedImpact: primary.impactSummary,
          affectedSymbols: JSON.stringify(primary.affectedTickers),
          watchCriteria: JSON.stringify(primary.watchCriteria),
          relatedArticleIds: JSON.stringify(tickerRelatedArticleIds),
          sourceCitations: JSON.stringify(tickerCitations),
          status: "monitoring",
          validationLog: "[]",
        });

        results.newCatalysts++;
        results.catalysts.push({
          predictedImpact: primary.impactSummary,
          affectedSymbols: primary.affectedTickers,
          watchCriteria: primary.watchCriteria,
        });
      }

      const hasExistingCatalysts = existingCatalysts.some((cat) =>
        cat.affectedSymbols.includes(ticker)
      );

      // PASS 2: Comprehensive synthesis - create ONE unified entry per ticker
      if (
        tickerNews.length > 1 ||
        hasExistingCatalysts ||
        (analysis.newCatalysts && analysis.newCatalysts.length > 1) ||
        (analysis.updates && analysis.updates.length > 0)
      ) {
        console.log(
          `   🔍 Pass 2: Synthesizing comprehensive view for ${ticker}...`
        );

        const synthesis = await synthesizeTickerOutcome(
          ticker,
          tickerNews,
          existingCatalysts,
          analysis,
          marketMode
        );

        if (synthesis) {
          const shouldPersistSynthesis = synthesis.shouldUpdate;

          // Find ALL catalysts for this ticker (both existing and newly created)
          const allTickerCatalysts = await db
            .select()
            .from(potentialCatalysts)
            .where(eq(potentialCatalysts.status, "monitoring"));

          const relevantCatalysts = allTickerCatalysts.filter((c) => {
            const symbols = JSON.parse(c.affectedSymbols || "[]") as string[];
            return symbols.includes(ticker);
          });

          if (relevantCatalysts.length === 0) {
            continue;
          }

          // Sort by creation time (newest first)
          const sortedCatalysts = relevantCatalysts.sort(
            (a, b) =>
              new Date(b.createdAt || 0).getTime() -
              new Date(a.createdAt || 0).getTime()
          );

          const newestCatalyst = sortedCatalysts[0];
          const olderCatalysts = sortedCatalysts.slice(1);

          if (shouldPersistSynthesis) {
            // Update the newest catalyst with Pass 2 trading thesis
            await db
              .update(potentialCatalysts)
              .set({
                // Pass 2 thesis fields
                primaryTicker: ticker,
                shortTermThesis: synthesis.shortTermThesis,
                sentiment: synthesis.sentiment,
                potentialScore: synthesis.potentialScore,
                confidence: synthesis.confidence,
                // Also update predictedImpact with keyInsight for backwards compatibility
                predictedImpact:
                  synthesis.keyInsight || newestCatalyst.predictedImpact,
                relatedArticleIds: JSON.stringify(tickerRelatedArticleIds),
                sourceCitations: JSON.stringify(tickerCitations),
                updatedAt: new Date().toISOString(),
              })
              .where(eq(potentialCatalysts.id, newestCatalyst.id));
          }

          // Delete all older catalysts for this ticker to ensure ONE entry per symbol
          if (olderCatalysts.length > 0) {
            for (const oldCat of olderCatalysts) {
              await db
                .update(suggestions)
                .set({ catalystId: null })
                .where(eq(suggestions.catalystId, oldCat.id));
              await db
                .delete(potentialCatalysts)
                .where(eq(potentialCatalysts.id, oldCat.id));
            }
            console.log(
              `      🗑️  Removed ${olderCatalysts.length} older catalyst(s) for ${ticker}`
            );
          }

          if (shouldPersistSynthesis) {
            // Log the thesis result
            const scoreEmoji =
              synthesis.potentialScore > 0
                ? "📈"
                : synthesis.potentialScore < 0
                ? "📉"
                : "➖";
            console.log(
              `      ✅ Pass 2: ${ticker} [${newestCatalyst.id.slice(
                0,
                8
              )}] ${scoreEmoji} Score: ${
                synthesis.potentialScore > 0 ? "+" : ""
              }${synthesis.potentialScore} (${
                synthesis.sentiment
              }, confidence ${synthesis.confidence}/10)`
            );
          }

          // Capture base price if not already recorded
          if (!newestCatalyst.basePrice) {
            await captureBasePrice(newestCatalyst.id, ticker);
          }
        }
      }
    } catch (e) {
      console.error(`      ❌ Error analyzing ${ticker}:`, e);
    }
  }

  // Summary
  console.log(`\n   📊 Discovery Summary:`);
  console.log(`      New catalysts: ${results.newCatalysts}`);
  if (updateCount > 0) {
    console.log(`      Updated catalysts: ${updateCount}`);
  }

  return results;
}

// -- Helpers --

function buildRelatedArticleIds(news: NewsItem[]): string[] {
  return news.map((item) => item.link);
}

function formatNewsItemForPrompt(item: NewsItem, index: number): string {
  const contentLabel = item.contentType ? `Content (${item.contentType})` : null;
  const contentBlock =
    item.content && item.content.length > 0
      ? `\n${contentLabel ?? "Content"}: ${item.content}`
      : "";
  const link = item.contentUrl || item.link;

  return `[${index}] ${item.title} (${item.pubDate || "Unknown Date"}) - ${
    item.source
  } [URL: ${link}]${contentBlock}`;
}

function buildSourceCitations(news: NewsItem[]) {
  return news.map((item, idx) => ({
    index: idx + 1,
    title: item.title,
    url: item.contentUrl || item.link,
    source: item.source || "Unknown",
    pubDate: item.pubDate || "Unknown Date",
  }));
}

/**
 * Expires old potential catalysts that have been monitoring for > 48 hours.
 * This prevents the database from accumulating stale catalysts.
 */
async function expireOldCatalysts(): Promise<number> {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const result = await db
    .update(potentialCatalysts)
    .set({
      status: "expired",
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(potentialCatalysts.status, "monitoring"),
        lt(potentialCatalysts.createdAt, cutoff) // Expire catalysts OLDER than 48h
      )
    )
    .returning({ id: potentialCatalysts.id });

  return result.length;
}

/**
 * Gets relevant existing catalysts to provide context to the LLM for deduplication.
 * Returns catalysts from the last 48 hours that are still being monitored.
 */
async function getRelevantExistingCatalysts(): Promise<
  Array<{
    id: string; // Short 8-char ID for LLM prompt
    fullId: string; // Full UUID for database operations
    predictedImpact: string;
    affectedSymbols: string[];
    createdAt: string;
    ageHours: number;
  }>
> {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const existing = await db
    .select()
    .from(potentialCatalysts)
    .where(
      and(
        eq(potentialCatalysts.status, "monitoring"),
        gte(potentialCatalysts.createdAt, cutoff)
      )
    )
    .orderBy(potentialCatalysts.createdAt); // Oldest first for context

  const now = Date.now();
  return existing.map((cat) => {
    const createdAt = cat.createdAt || new Date().toISOString();
    const createdMs = new Date(createdAt).getTime();
    const ageHours = Math.round((now - createdMs) / (60 * 60 * 1000));

    return {
      id: cat.id.slice(0, 8), // First 8 chars for brevity in LLM prompt
      fullId: cat.id, // Keep full UUID for database lookups
      predictedImpact: cat.predictedImpact,
      affectedSymbols: JSON.parse(cat.affectedSymbols || "[]") as string[],
      createdAt,
      ageHours,
    };
  });
}

// -- AI Analysis --

async function analyzeBatchForDiscovery(
  news: NewsItem[],
  assets: CatalystAsset[],
  existingCatalysts: Awaited<ReturnType<typeof getRelevantExistingCatalysts>>,
  marketMode: MarketMode
) {
  const availableTickers = assets
    .map((a) => `${a.ticker} (${a.keyword})`)
    .join(", ");

  const newsContext = news
    .map((n, i) => formatNewsItemForPrompt(n, i + 1))
    .join("\n");

  // Format existing catalysts for LLM context
  const existingContext =
    existingCatalysts.length > 0
      ? `
## EXISTING CATALYSTS (Last 48h)
ℹ️ Before creating a NEW catalyst, check if your discovery is about the SAME event as one below.
If it's the same event (even with different details/sources), return an UPDATE instead of a new catalyst.

${existingCatalysts
  .map(
    (cat, i) =>
      `${i + 1}. [${cat.id}] Created ${cat.ageHours}h ago
   Impact: ${cat.predictedImpact}
   Symbols: ${cat.affectedSymbols.join(", ")}`
  )
  .join("\n\n")}
`
      : "";

  const prompt = `
  You are an Indian Market Catalyst Detector with DEDUPLICATION intelligence.

  Your goal is to find ACTIONABLE trading opportunities in this Indian business news batch.
  Focus on events that will materially impact stock prices.

  ${formatMarketModePrompt(marketMode)}

  WHAT TO LOOK FOR:
  - Supply shocks (factory shutdowns, strikes, raw material shortages)
  - Demand shocks (new orders, policy changes, consumer trends)
  - Regulatory changes (SEBI, RBI, government policy)
  - Corporate events (management changes, M&A, earnings surprises)
  - Sector-wide impacts (IT hiring freezes, defence orders, infra spending)

  IGNORE:
  - Generic market commentary ("Sensex rises 200 points")
  - Routine earnings (unless major surprise)
  - Already widely known news
${existingContext}

  🚨 CRITICAL DEDUPLICATION RULES:
  1. If a news item is about the SAME event as an existing catalyst:
     - Return an UPDATE with the existing catalyst ID (8-char ID shown above)
     - Merge new details into the impact description
     - Add any newly discovered affected symbols to the list
     - Increase confidence if more sources confirm the event

  2. Only create a NEW catalyst if:
     - The event is DISTINCT from all existing catalysts
     - It's a DIFFERENT aspect of a broad story (e.g., separate policy change)
     - It affects DIFFERENT companies for DIFFERENT reasons

  3. Examples of SAME event (should UPDATE):
     - "₹235-cr port project in TN" vs "Tamil Nadu gets ₹235-crore maritime investment"
     - "IREDA gets Excellent rating" vs "Union Minister confirms IREDA's Excellent MoU"
     - Different sources reporting the IDENTICAL event (same amount, same companies, same date)

  4. Examples of DIFFERENT events (should CREATE NEW):
     - Two separate policy announcements (even in same sector)
     - Different companies facing unrelated issues
     - Distinct time-sensitive events (strike today vs earnings next week)

  ${
    availableTickers ? `KNOWN STOCKS TO CONSIDER:\n  ${availableTickers}\n` : ""
  }
  NEWS BATCH:
  ${newsContext}

  TASK:
  1. Check EACH news item against existing catalysts first
  2. If it's the SAME event → prepare an UPDATE
  3. If it's a NEW event → identify catalyst and affected stocks
  4. Define the PRECISE market reaction that would confirm your theory

  🔖 CITATION REQUIREMENT:
  - Include inline citations [1], [2], [3] etc. in your impact descriptions
  - Use the article numbers from the NEWS BATCH list above
  - Example: "₹235cr port project announced [1], benefits multiple players [2]."
  - Cite specific claims, numbers, and key facts

  OUTPUT FORMAT (JSON):
  {
    "updates": [
      {
        "existingCatalystId": "b788fc78",
        "reason": "Same Tamil Nadu port project news, adding more details",
        "updatedImpact": "Enhanced description with citations [1]. Additional source [2].",
        "updatedSymbols": ["ADANIPORTS.NS", "LT.NS", "DREDGECORP.NS"],
        "confidence": 9,
        "citedArticles": [1, 2]
      }
    ],
    "newCatalysts": [
      {
        "impactSummary": "Concise summary with citation [1]. Key detail [2].",
        "affectedTickers": ["TICKER1.NS", "TICKER2.NS"],
        "confidence": 8,
        "watchCriteria": {
          "metric": "PRICE",
          "direction": "UP",
          "thresholdPercent": 2,
          "timeoutHours": 24
        },
        "citedArticles": [1, 2]
      }
    ]
  }

  Return ONLY valid JSON. If nothing interesting, return {"updates": [], "newCatalysts": []}.
  `;

  const text = await callGeminiForDiscovery(prompt);

  try {
    return JSON.parse(text);
  } catch (e) {
    console.error(
      "Failed to parse discovery response:",
      text.substring(0, 200)
    );
    return { updates: [], newCatalysts: [] };
  }
}
