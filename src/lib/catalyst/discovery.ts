import { type NewsItem, type CatalystAsset } from "./types";
import { potentialCatalysts, processedArticles } from "../db/schema";
import { db } from "../db";
import { eq, inArray } from "drizzle-orm";
import { getGeminiModel, ThinkingLevel } from "../gemini";
import { z } from "zod";

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
  const model = getGeminiModel({
    thinkingConfig: { thinkingLevel: ThinkingLevel.medium },
    responseSchema: DiscoverySchema,
  });

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
  You are a Hedge Fund "Blind Spot" Detector.

  Your goal is to find NON-OBVIOUS market catalysts in this news batch.
  Ignore generic market noise. Look for specific events that will shock supply/demand.

  AVAILABLE ASSETS TO WATCH:
  ${availableTickers}

  NEWS BATCH:
  ${newsContext}

  TASK:
  1. Do any of these news items create a tangible catalyst for the assets above?
  2. If yes, define the PRECISE market reaction that would confirm your theory.
     (e.g., "If copper strike confirmed, price should rise > 1% in 4 hours")

  OUTPUT:
  Return a JSON with a list of 'potentialCatalysts'.
  If nothing interesting, return empty list.
  `;

  const response = await model.generateContent(prompt);
  // @ts-ignore - The types for generateContent with schema are generic
  const text =
    typeof response.text === "function" ? response.text() : response.text;

  return response.candidates?.[0]?.content?.parts?.[0]?.functionCall
    ? JSON.parse(text || "{}")
    : JSON.parse(text || "{}");
}
