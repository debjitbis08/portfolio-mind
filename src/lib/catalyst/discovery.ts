import { type NewsItem, type CatalystAsset } from "./types";
import { potentialCatalysts, processedArticles } from "../db/schema";
import { db } from "../db";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { GoogleGenAI } from "@google/genai";

// Standalone-compatible API key getter (uses process.env, works without Astro)
function getApiKey(): string {
  if (process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY;
  }
  throw new Error("GEMINI_API_KEY not found in environment variables");
}

// ThinkingLevel enum for model configuration
enum ThinkingLevel {
  low = "LOW",
  medium = "MEDIUM",
  high = "HIGH",
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

/**
 * Represents a group of related news items
 */
interface NewsCluster {
  topic: string;
  items: NewsItem[];
}

/**
 * Core function to discover potential catalysts from a batch of news.
 *
 * 1. Groups news by topic (heuristic/simple).
 * 2. Sends each group to LLM to identify *hidden* market impacts.
 * 3. Saves "potential" catalysts to DB.
 */
export async function discoverCatalysts(
  newsItems: NewsItem[],
  assets: CatalystAsset[]
): Promise<DiscoveryResult> {
  if (newsItems.length === 0) return { newCatalysts: 0, catalysts: [] };

  console.log(`\n🔍 Running AI Discovery on ${newsItems.length} articles...`);

  // 1. Group news items (Simple clustering by title similarity or just batch analysis)
  // For now, we'll send them in batches of 5-10 to the LLM to find connections.
  const batches = chunkArray(newsItems, 10);
  const results: DiscoveryResult = { newCatalysts: 0, catalysts: [] };

  for (const batch of batches) {
    try {
      const analysis = await analyzeBatchForDiscovery(batch, assets);

      if (analysis.potentialCatalysts.length > 0) {
        console.log(
          `   ✨ Found ${analysis.potentialCatalysts.length} potential catalysts in batch`
        );

        for (const cat of analysis.potentialCatalysts) {
          // Verify we aren't re-adding the same thing (duplicate check based on related articles)
          // Ideally we check if *any* of the article IDs are already linked to an active catalyst
          // Skip for now to keep it simple, rely on unique IDs

          // Store in DB
          await db.insert(potentialCatalysts).values({
            predictedImpact: cat.impactSummary,
            affectedSymbols: JSON.stringify(cat.affectedTickers),
            watchCriteria: JSON.stringify(cat.watchCriteria),
            relatedArticleIds: JSON.stringify(batch.map((n) => n.link)), // Ideally map back to db IDs
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
    } catch (e) {
      console.error("   ❌ Error in discovery batch:", e);
    }
  }

  return results;
}

// -- Helpers --

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunked: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunked.push(array.slice(i, i + size));
  }
  return chunked;
}

// -- AI Analysis --

const DiscoverySchema = z.object({
  potentialCatalysts: z.array(
    z.object({
      impactSummary: z
        .string()
        .describe("Concise summary of the event and why it moves the market"),
      affectedTickers: z
        .array(z.string())
        .describe(
          "List of specific tickers from the available list that are impacted"
        ),
      confidence: z.number().describe("0-10 confidence level"),
      watchCriteria: z
        .object({
          metric: z.enum(["PRICE", "VOLUME"]),
          direction: z.enum(["UP", "DOWN"]),
          thresholdPercent: z
            .number()
            .describe("Percentage move required to confirm (e.g. 2 for 2%)"),
          timeoutHours: z
            .number()
            .describe("How long to watch for this reaction"),
        })
        .describe(
          "The specific market reaction that would CONFIRM this theory"
        ),
    })
  ),
});

async function analyzeBatchForDiscovery(
  news: NewsItem[],
  assets: CatalystAsset[]
) {
  const availableTickers = assets
    .map((a) => `${a.ticker} (${a.keyword})`)
    .join(", ");

  const newsContext = news
    .map(
      (n, i) =>
        `[${i + 1}] ${n.title} (${n.pubDate || "Unknown Date"}) - ${n.source}`
    )
    .join("\n");

  const prompt = `
  You are an Indian Market Catalyst Detector.

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

  ${
    availableTickers ? `KNOWN STOCKS TO CONSIDER:\n  ${availableTickers}\n` : ""
  }
  NEWS BATCH:
  ${newsContext}

  TASK:
  1. Identify news that creates a TANGIBLE catalyst
  2. Determine which specific Indian stocks are affected
     (Use NSE/BSE tickers like TATASTEEL.NS, TCS.NS, HINDCOPPER.NS)
  3. Define the PRECISE market reaction that would confirm your theory
     (e.g., "If TCS faces employee backlash, stock may drop 1-2% in 24 hours")

  OUTPUT FORMAT (JSON):
  {
    "potentialCatalysts": [
      {
        "impactSummary": "Concise summary of the event and why it moves the market",
        "affectedTickers": ["TICKER1.NS", "TICKER2.NS"],
        "confidence": 8,
        "watchCriteria": {
          "metric": "PRICE",
          "direction": "UP",
          "thresholdPercent": 2,
          "timeoutHours": 24
        }
      }
    ]
  }

  Return ONLY valid JSON. If nothing interesting, return {"potentialCatalysts": []}.
  `;

  const text = await callGeminiForDiscovery(prompt);

  try {
    return JSON.parse(text);
  } catch (e) {
    console.error(
      "Failed to parse discovery response:",
      text.substring(0, 200)
    );
    return { potentialCatalysts: [] };
  }
}
