import { type NewsItem, type CatalystAsset } from "./types";
import { potentialCatalysts } from "../db/schema";
import { db } from "../db";
import { eq, and, gte, lt } from "drizzle-orm";
import { GoogleGenAI } from "@google/genai";

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

// -- AI Analysis --

/**
 * Analyze all news for a specific ticker and determine overall impact/sentiment.
 * This is the NEW ticker-focused analysis that replaces batch-based analysis.
 */
async function analyzeTickerNewsForDiscovery(
  ticker: string,
  news: NewsItem[],
  assets: CatalystAsset[],
  existingCatalysts: Awaited<ReturnType<typeof getRelevantExistingCatalysts>>
) {
  const newsContext = news
    .map(
      (n, i) =>
        `[${i + 1}] ${n.title} (${n.pubDate || "Unknown Date"}) - ${n.source} [URL: ${n.link}]`
    )
    .join("\n");

  // Filter existing catalysts that involve this ticker
  const relevantExisting = existingCatalysts.filter(cat =>
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
 * PASS 2: Synthesize all news for a ticker into a single comprehensive outcome.
 * This takes the Pass 1 analysis results and creates a unified view.
 */
async function synthesizeTickerOutcome(
  ticker: string,
  news: NewsItem[],
  existingCatalysts: Awaited<ReturnType<typeof getRelevantExistingCatalysts>>,
  pass1Analysis: any
) {
  const newsContext = news
    .map(
      (n, i) =>
        `[${i + 1}] ${n.title} (${n.pubDate || "Unknown Date"}) - ${n.source} [URL: ${n.link}]`
    )
    .join("\n");

  // Filter existing catalysts for this ticker
  const relevantExisting = existingCatalysts.filter(cat =>
    cat.affectedSymbols.includes(ticker)
  );

  const existingContext =
    relevantExisting.length > 0
      ? `
## EXISTING CATALYSTS FOR ${ticker}
${relevantExisting
  .map(
    (cat, i) =>
      `${i + 1}. [${cat.id}] ${cat.predictedImpact} (Created ${cat.ageHours}h ago)`
  )
  .join("\n")}
`
      : "";

  const prompt = `
You are performing COMPREHENSIVE SYNTHESIS for ticker: ${ticker}

PASS 1 RESULTS:
${JSON.stringify(pass1Analysis, null, 2)}

ALL NEWS FOR ${ticker}:
${newsContext}

${existingContext}

YOUR TASK - PASS 2 SYNTHESIS:
Now that individual catalysts have been identified or updated in Pass 1, synthesize ALL information into ONE comprehensive assessment:

1. **Unified Narrative**: Combine all news into a single coherent story
2. **Overall Sentiment**: What is the DOMINANT sentiment across all sources? (BULLISH/BEARISH/NEUTRAL)
3. **Comprehensive Impact**: Merge all impact descriptions into one comprehensive statement
4. **Confidence Level**: Based on multiple sources and consistency, rate 1-10
5. **Key Insights**: What's the single most important takeaway?

SYNTHESIS RULES:
- If multiple articles say the same thing → Increase confidence, merge details
- If articles contradict → Note uncertainty, lower confidence
- If articles show progression → Show timeline/evolution
- Focus on WHAT MATTERS for trading decisions

🔖 CITATION REQUIREMENT:
- Include inline citations [1], [2], [3] in your comprehensiveImpact text
- Use the article numbers from ALL NEWS list above
- Example: "₹500cr investment announced [1], boosting sector confidence [2][3]."
- Cite all key facts and claims with their source article numbers

OUTPUT FORMAT (JSON):
{
  "shouldUpdate": true/false,
  "comprehensiveImpact": "Single unified description with citations [1]. Additional detail [2].",
  "dominantSentiment": "BULLISH/BEARISH/NEUTRAL",
  "confidence": 8,
  "keyInsight": "One-line summary of what traders need to know",
  "reasoning": "Why this synthesis makes sense given all the information",
  "citedArticles": [1, 2, 3]
}

Set shouldUpdate=true only if synthesis provides meaningful new insight beyond Pass 1.
Return ONLY valid JSON.
`;

  const text = await callGeminiForDiscovery(prompt);

  try {
    return JSON.parse(text);
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
        const keywordPattern = new RegExp(`\\b${asset.keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (keywordPattern.test(text)) {
          matched = true;
        }
      }

      // 2. Check ticker symbol (fallback)
      if (!matched && asset.ticker) {
        const base = asset.ticker.replace(/\.(NS|BO)$/, '');
        const tickerPatterns = [
          new RegExp(`\\b${base}\\b`, 'i'),
          new RegExp(`\\b${asset.ticker}\\b`, 'i'),
        ];
        if (tickerPatterns.some(p => p.test(text))) {
          matched = true;
        }
      }

      // 3. Check related tickers
      if (!matched && asset.relatedTickers) {
        for (const relatedTicker of asset.relatedTickers) {
          const base = relatedTicker.replace(/\.(NS|BO)$/, '');
          const relatedPattern = new RegExp(`\\b${base}\\b`, 'i');
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

  // Expire old catalysts before discovering new ones
  const expired = await expireOldCatalysts();
  if (expired > 0) {
    console.log(`   🗑️  Expired ${expired} old catalyst(s) (>48h)`);
  }

  console.log(`\n🔍 Running Ticker-Grouped AI Discovery on ${newsItems.length} articles...`);

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
    console.log(`   ⚠️  No ticker matches found. Falling back to batch analysis...`);

    // Chunk news into batches of 10 for analysis
    const chunkSize = 10;
    for (let i = 0; i < newsItems.length; i += chunkSize) {
      const batch = newsItems.slice(i, i + chunkSize);
      console.log(`\n   🔍 Analyzing batch ${Math.floor(i/chunkSize) + 1} (${batch.length} articles)...`);

      const analysis = await analyzeBatchForDiscovery(batch, assets, existingCatalysts);

      // Process updates
      if (analysis.updates && analysis.updates.length > 0) {
        for (const update of analysis.updates) {
          const idStr = String(update.existingCatalystId).toLowerCase();
          if (!/^[a-f0-9]{8}/.test(idStr)) continue;

          const matchingCatalyst = existingCatalysts.find((c) =>
            c.id === idStr || c.fullId.startsWith(idStr)
          );

          if (!matchingCatalyst) continue;

          await db
            .update(potentialCatalysts)
            .set({
              predictedImpact: update.updatedImpact,
              affectedSymbols: JSON.stringify(update.updatedSymbols),
              updatedAt: new Date().toISOString(),
            })
            .where(eq(potentialCatalysts.id, matchingCatalyst.fullId));

          updateCount++;
          console.log(`      🔄 Updated [${idStr}]: ${update.reason}`);
        }
      }

      // Process new catalysts
      if (analysis.newCatalysts && analysis.newCatalysts.length > 0) {
        console.log(`      ✨ Found ${analysis.newCatalysts.length} catalyst(s)`);

        for (const cat of analysis.newCatalysts) {
          // Build citation metadata from batch
          const citations = batch.map((n, idx) => ({
            index: idx + 1,
            title: n.title,
            url: n.link,
            source: n.source || "Unknown",
            pubDate: n.pubDate || "Unknown Date",
          }));

          await db.insert(potentialCatalysts).values({
            predictedImpact: cat.impactSummary,
            affectedSymbols: JSON.stringify(cat.affectedTickers),
            watchCriteria: JSON.stringify(cat.watchCriteria),
            relatedArticleIds: JSON.stringify(batch.map((n) => n.link)),
            sourceCitations: JSON.stringify(citations),
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
      console.log(`\n   🔄 Running consolidation pass to ensure ONE entry per ticker...`);

      // Fetch all monitoring catalysts (including newly created ones)
      const allCatalysts = await db
        .select()
        .from(potentialCatalysts)
        .where(eq(potentialCatalysts.status, "monitoring"));

      // Group catalysts by ticker
      const tickerCatalystMap = new Map<string, typeof allCatalysts>();

      for (const catalyst of allCatalysts) {
        const symbols = JSON.parse(catalyst.affectedSymbols || "[]") as string[];
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
        const sortedCatalysts = catalysts.sort((a, b) =>
          new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
        );

        const newestCatalyst = sortedCatalysts[0];
        const olderCatalysts = sortedCatalysts.slice(1);

        // Delete all older catalysts for this ticker
        for (const oldCat of olderCatalysts) {
          await db
            .delete(potentialCatalysts)
            .where(eq(potentialCatalysts.id, oldCat.id));
          consolidatedCount++;
        }

        console.log(`      🗑️  ${ticker}: Consolidated ${catalysts.length} entries → 1 [${newestCatalyst.id.slice(0, 8)}]`);
      }

      if (consolidatedCount > 0) {
        console.log(`   ✅ Removed ${consolidatedCount} duplicate catalyst(s) to ensure ONE per ticker`);
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
      console.log(`\n   🔍 Pass 1: Analyzing ${ticker} (${tickerNews.length} articles)...`);

      // PASS 1: Individual article analysis
      const analysis = await analyzeTickerNewsForDiscovery(
        ticker,
        tickerNews,
        assets,
        existingCatalysts
      );

      // Process UPDATES first (reevaluation of existing catalysts)
      if (analysis.updates && analysis.updates.length > 0) {
        for (const update of analysis.updates) {
          const idStr = String(update.existingCatalystId).toLowerCase();
          if (!/^[a-f0-9]{8}/.test(idStr)) {
            console.error(`      ⚠️  Invalid catalyst ID format: ${update.existingCatalystId}`);
            continue;
          }

          const matchingCatalyst = existingCatalysts.find((c) =>
            c.id === idStr || c.fullId.startsWith(idStr)
          );

          if (!matchingCatalyst) {
            console.error(`      ⚠️  Cannot find catalyst ${update.existingCatalystId} for update`);
            continue;
          }

          await db
            .update(potentialCatalysts)
            .set({
              predictedImpact: update.updatedImpact,
              affectedSymbols: JSON.stringify(update.updatedSymbols),
              updatedAt: new Date().toISOString(),
            })
            .where(eq(potentialCatalysts.id, matchingCatalyst.fullId));

          updateCount++;
          console.log(`      🔄 Updated [${idStr}]: ${update.reason}`);
        }
      }

      // Process NEW catalysts from Pass 1
      if (analysis.newCatalysts && analysis.newCatalysts.length > 0) {
        console.log(`      ✨ Pass 1 found ${analysis.newCatalysts.length} catalyst(s)`);

        for (const cat of analysis.newCatalysts) {
          // Build citation metadata from news array
          const citations = tickerNews.map((n, idx) => ({
            index: idx + 1,
            title: n.title,
            url: n.link,
            source: n.source || "Unknown",
            pubDate: n.pubDate || "Unknown Date",
          }));

          await db.insert(potentialCatalysts).values({
            predictedImpact: cat.impactSummary,
            affectedSymbols: JSON.stringify(cat.affectedTickers),
            watchCriteria: JSON.stringify(cat.watchCriteria),
            relatedArticleIds: JSON.stringify(tickerNews.map((n) => n.link)),
            sourceCitations: JSON.stringify(citations),
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

      // PASS 2: Comprehensive synthesis - create ONE unified entry per ticker
      if (tickerNews.length > 1 || (analysis.updates && analysis.updates.length > 0)) {
        console.log(`   🔍 Pass 2: Synthesizing comprehensive view for ${ticker}...`);

        const synthesis = await synthesizeTickerOutcome(
          ticker,
          tickerNews,
          existingCatalysts,
          analysis
        );

        if (synthesis && synthesis.shouldUpdate) {
          // Find ALL catalysts for this ticker (both existing and newly created)
          const allTickerCatalysts = await db
            .select()
            .from(potentialCatalysts)
            .where(eq(potentialCatalysts.status, "monitoring"));

          const relevantCatalysts = allTickerCatalysts.filter(c => {
            const symbols = JSON.parse(c.affectedSymbols || "[]") as string[];
            return symbols.includes(ticker);
          });

          if (relevantCatalysts.length > 0) {
            // Sort by creation time (newest first)
            const sortedCatalysts = relevantCatalysts.sort((a, b) =>
              new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
            );

            const newestCatalyst = sortedCatalysts[0];
            const olderCatalysts = sortedCatalysts.slice(1);

            // Update the newest catalyst with comprehensive synthesis
            await db
              .update(potentialCatalysts)
              .set({
                predictedImpact: synthesis.comprehensiveImpact,
                updatedAt: new Date().toISOString(),
              })
              .where(eq(potentialCatalysts.id, newestCatalyst.id));

            // Delete all older catalysts for this ticker to ensure ONE entry per symbol
            if (olderCatalysts.length > 0) {
              for (const oldCat of olderCatalysts) {
                await db
                  .delete(potentialCatalysts)
                  .where(eq(potentialCatalysts.id, oldCat.id));
              }
              console.log(`      🗑️  Removed ${olderCatalysts.length} older catalyst(s) for ${ticker}`);
            }

            console.log(`      ✅ Pass 2: ONE comprehensive entry for ${ticker} [${newestCatalyst.id.slice(0, 8)}]`);
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
  existingCatalysts: Awaited<ReturnType<typeof getRelevantExistingCatalysts>>
) {
  const availableTickers = assets
    .map((a) => `${a.ticker} (${a.keyword})`)
    .join(", ");

  const newsContext = news
    .map(
      (n, i) =>
        `[${i + 1}] ${n.title} (${n.pubDate || "Unknown Date"}) - ${n.source} [URL: ${n.link}]`
    )
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
