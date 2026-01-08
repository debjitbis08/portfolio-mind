/**
 * Catalyst Engine - LLM-based News Analysis
 *
 * Uses Gemini Flash to analyze news headlines and determine if they
 * represent material catalysts (supply shocks, regulatory changes, etc.)
 *
 * V2: Batch analysis - analyzes multiple headlines together to form
 * a holistic view rather than per-headline decisions.
 */

import { GoogleGenAI, type GenerateContentResponse } from "@google/genai";
import type {
  AnalysisResult,
  CatalystAsset,
  ImpactType,
  Sentiment,
  NewsItem,
} from "./types";

// Use Gemini 2.0 Flash for speed and cost efficiency
const MODEL_ID = "gemini-3-flash-preview";

/**
 * Get Gemini API key from environment.
 * Works in both Astro context and standalone Node.js scripts.
 */
function getApiKey(): string {
  if (process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY;
  }
  throw new Error("GEMINI_API_KEY not found in environment variables");
}

// Lazy-initialize Gemini client
let _genai: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI {
  if (!_genai) {
    _genai = new GoogleGenAI({ apiKey: getApiKey() });
  }
  return _genai;
}

/**
 * Extended analysis result for batch analysis.
 * Includes the key headline that drove the decision.
 */
export interface BatchAnalysisResult extends AnalysisResult {
  keyHeadline: string; // The most significant headline driving this view
  headlinesAnalyzed: number;
  summary: string; // Multi-sentence summary of the news landscape
}

/**
 * System prompt for batch headline analysis.
 * Looks at multiple headlines to form a holistic view.
 */
function buildBatchSystemPrompt(asset: CatalystAsset): string {
  return `You are a senior commodities and equity analyst at a macro hedge fund.
You are reviewing the recent news flow for "${asset.keyword}" to determine if there's a material trading catalyst.

Analyze ALL the headlines below TOGETHER to form a holistic view. Consider:
- Are multiple sources reporting the same event? (higher conviction)
- Is this a developing story or one-off news?
- What's the net impact across all headlines?

CATALYST TYPES:

SUPPLY_SHOCK (typically Bullish for commodity/producer):
- Mine closures, strikes, worker shortages
- War/geopolitical disruption to production
- Weather destroying crops, floods at facilities
- Factory fires, refinery shutdowns
- Export bans or restrictions

DEMAND_SHOCK (direction depends on context):
- New legislation mandating usage (Bullish)
- Tech breakthrough enabling new demand (Bullish)
- Major customer bankruptcy (Bearish)
- New major contracts or orders

REGULATORY:
- New regulations impacting industry
- Government policy changes
- Export/import restrictions

NOISE (DO NOT FLAG AS CATALYST):
- Earnings reports and quarterly results
- Analyst upgrades/downgrades
- Generic market commentary
- Opinion pieces and editorials
- Price target changes
- Local crime/theft stories

Return ONLY valid JSON (no markdown):
{
  "isCatalyst": boolean,
  "sentiment": "BULLISH" | "BEARISH" | "NEUTRAL",
  "impactType": "SUPPLY_SHOCK" | "DEMAND_SHOCK" | "REGULATORY" | "NOISE",
  "confidence": number (1-10),
  "keyHeadline": "The single most important headline driving this view",
  "summary": "2-3 sentence summary of the overall news landscape for this asset",
  "reasoning": "One sentence explaining why this is or isn't a catalyst"
}`;
}

/**
 * Parse the batch analysis response.
 */
function parseBatchResponse(responseText: string): BatchAnalysisResult {
  const defaultResult: BatchAnalysisResult = {
    isCatalyst: false,
    sentiment: "NEUTRAL",
    impactType: "NOISE",
    confidence: 0,
    reasoning: "Failed to parse LLM response",
    keyHeadline: "",
    headlinesAnalyzed: 0,
    summary: "",
  };

  try {
    let cleaned = responseText.trim();
    if (cleaned.startsWith("```json")) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith("```")) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith("```")) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    const parsed = JSON.parse(cleaned);

    return {
      isCatalyst: Boolean(parsed.isCatalyst),
      sentiment: (parsed.sentiment as Sentiment) || "NEUTRAL",
      impactType: (parsed.impactType as ImpactType) || "NOISE",
      confidence: Math.min(10, Math.max(1, Number(parsed.confidence) || 0)),
      reasoning: String(parsed.reasoning || "No reasoning provided"),
      keyHeadline: String(parsed.keyHeadline || ""),
      headlinesAnalyzed: 0, // Will be set by caller
      summary: String(parsed.summary || ""),
    };
  } catch (error) {
    console.error("[CatalystEngine] Failed to parse response:", responseText);
    return defaultResult;
  }
}

/**
 * Analyze multiple news headlines together to form a holistic view.
 * This is preferred over per-headline analysis for better context.
 *
 * @param newsItems - Array of news items to analyze together
 * @param asset - The asset context (keyword, type, etc.)
 * @returns Batch analysis result with overall view
 */
export async function analyzeNewsBatch(
  newsItems: NewsItem[],
  asset: CatalystAsset
): Promise<BatchAnalysisResult> {
  if (newsItems.length === 0) {
    return {
      isCatalyst: false,
      sentiment: "NEUTRAL",
      impactType: "NOISE",
      confidence: 0,
      reasoning: "No news items to analyze",
      keyHeadline: "",
      headlinesAnalyzed: 0,
      summary: "No recent news found for this asset.",
    };
  }

  const systemPrompt = buildBatchSystemPrompt(asset);

  // Format headlines with sources and dates
  const headlinesList = newsItems
    .map((item, i) => {
      const date = new Date(item.pubDate).toLocaleDateString();
      return `${i + 1}. "${item.title}" - ${item.source} (${date})`;
    })
    .join("\n");

  try {
    const response: GenerateContentResponse =
      await getGenAI().models.generateContent({
        model: MODEL_ID,
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `${systemPrompt}\n\nHEADLINES TO ANALYZE:\n${headlinesList}`,
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          temperature: 0.3,
          maxOutputTokens: 1500,
        },
      });

    const text = response.text || "";
    const result = parseBatchResponse(text);
    result.headlinesAnalyzed = newsItems.length;
    return result;
  } catch (error) {
    console.error("[CatalystEngine] Batch analysis failed:", error);
    return {
      isCatalyst: false,
      sentiment: "NEUTRAL",
      impactType: "NOISE",
      confidence: 0,
      reasoning: `LLM error: ${
        error instanceof Error ? error.message : "Unknown"
      }`,
      keyHeadline: "",
      headlinesAnalyzed: newsItems.length,
      summary: "Analysis failed due to an error.",
    };
  }
}

/**
 * Quick check if a headline is likely noise (pre-filter before LLM).
 * Saves API calls by filtering obvious non-catalysts.
 */
export function isLikelyNoise(headline: string): boolean {
  const noisePatterns = [
    /earnings/i,
    /quarterly results/i,
    /q[1-4] results/i,
    /analyst (upgrade|downgrade)/i,
    /price target/i,
    /rating (upgrade|downgrade)/i,
    /market (open|close)/i,
    /index (add|remove)/i,
    /opinion:/i,
    /editorial:/i,
    /what you need to know/i,
    /things to watch/i,
    /arrested for/i,
    /theft/i,
    /stolen/i,
  ];

  return noisePatterns.some((pattern) => pattern.test(headline));
}

/**
 * Filter news items to remove obvious noise before LLM analysis.
 */
export function filterNoise(newsItems: NewsItem[]): NewsItem[] {
  return newsItems.filter((item) => !isLikelyNoise(item.title));
}

// =============================================================================
// Legacy single-headline analysis (kept for backwards compatibility)
// =============================================================================

/**
 * @deprecated Use analyzeNewsBatch instead for better context
 */
export async function analyzeNewsItem(
  headline: string,
  asset: CatalystAsset
): Promise<AnalysisResult> {
  const result = await analyzeNewsBatch(
    [
      {
        title: headline,
        link: "",
        pubDate: new Date().toISOString(),
        source: "Unknown",
      },
    ],
    asset
  );
  return {
    isCatalyst: result.isCatalyst,
    sentiment: result.sentiment,
    impactType: result.impactType,
    confidence: result.confidence,
    reasoning: result.reasoning,
  };
}
