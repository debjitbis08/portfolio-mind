/**
 * Stock Analyzer Service
 *
 * Tier 2 analysis engine for per-stock deep evaluation.
 * Gathers data from multiple sources (VRS, news, technicals, valuepickr),
 * uses LLM to synthesize and score the opportunity.
 *
 * Results are cached in stock_analysis_cache table.
 */

import { GEMINI_API_KEY } from "astro:env/server";
import { db, getHoldings, schema } from "./db";
import { eq, inArray } from "drizzle-orm";
import { getStockNews } from "./tools/news";
import { getStockThesis } from "./tools/valuepickr";
import { getTechnicals } from "./tools/technicals";

// ============================================================================
// Types
// ============================================================================

export interface StockAnalysisResult {
  symbol: string;
  opportunityScore: number;
  thesisSummary: string;
  risksSummary: string;
  timingSignal: "accumulate" | "wait" | "avoid";
  newsAlert: boolean;
  newsAlertReason: string | null;
  analysisJson: string;
}

export interface AnalysisJobProgress {
  total: number;
  completed: number;
  current: string | null;
  errors: string[];
  results: Array<{ symbol: string; score: number | null; error?: string }>;
}

// TTL configurations (in milliseconds)
const TTL = {
  VRS: 7 * 24 * 60 * 60 * 1000, // 7 days
  FINANCIALS: 30 * 24 * 60 * 60 * 1000, // 30 days
  VALUEPICKR: 3 * 24 * 60 * 60 * 1000, // 3 days
  NEWS: 0, // Always fresh
  TECHNICALS: 0, // Always fresh
};

// ============================================================================
// Data Gathering Functions
// ============================================================================

async function getVRSData(symbol: string): Promise<{
  data: any | null;
  fetchedAt: string | null;
}> {
  const vrs = await db
    .select()
    .from(schema.vrsResearch)
    .where(eq(schema.vrsResearch.symbol, symbol))
    .limit(1);

  if (vrs.length === 0) {
    return { data: null, fetchedAt: null };
  }

  return {
    data: {
      status: vrs[0].status,
      rationale: vrs[0].rationale,
      risks: vrs[0].risks,
      analystNote: vrs[0].analystNote,
      recPrice: vrs[0].recPrice,
      recDate: vrs[0].recDate,
    },
    fetchedAt: vrs[0].fetchedAt,
  };
}

async function getFinancialsData(symbol: string): Promise<{
  data: any | null;
  fetchedAt: string | null;
}> {
  // Get latest financials
  const financials = await db
    .select()
    .from(schema.companyFinancials)
    .where(eq(schema.companyFinancials.symbol, symbol))
    .orderBy(schema.companyFinancials.reportDate)
    .limit(4); // Last 4 quarters

  if (financials.length === 0) {
    return { data: null, fetchedAt: null };
  }

  // Get latest concall
  const concalls = await db
    .select()
    .from(schema.concallHighlights)
    .where(eq(schema.concallHighlights.symbol, symbol))
    .orderBy(schema.concallHighlights.callDate)
    .limit(1);

  return {
    data: {
      financials: financials.map((f) => ({
        period: f.periodType,
        date: f.reportDate,
        sales: f.sales,
        netProfit: f.netProfit,
        opmPercent: f.opmPercent,
        eps: f.eps,
      })),
      latestConcall: concalls[0]
        ? {
            quarter: concalls[0].quarter,
            guidance: concalls[0].managementGuidance,
            positives: concalls[0].positives,
            risks: concalls[0].risksDiscussed,
          }
        : null,
    },
    fetchedAt: financials[0].updatedAt,
  };
}

async function getNewsData(
  symbol: string,
  stockName: string | null
): Promise<{
  data: any | null;
  fetchedAt: string;
}> {
  // Always fetch fresh news
  const query = stockName || symbol;
  const result = await getStockNews({ query });

  const data = result.data as
    | {
        found?: boolean;
        sentiment_summary?: string;
        key_events?: string;
        headlines?: Array<{ title: string; source: string; date: string }>;
      }
    | undefined;

  if (!result.success || !data?.found) {
    return {
      data: null,
      fetchedAt: new Date().toISOString(),
    };
  }

  return {
    data: {
      sentimentSummary: data.sentiment_summary,
      keyEvents: data.key_events,
      headlines: data.headlines,
    },
    fetchedAt: new Date().toISOString(),
  };
}

async function getValuePickrData(
  symbol: string,
  stockName: string | null
): Promise<{
  data: any | null;
  fetchedAt: string | null;
}> {
  // Check cache first - ValuePickr data is stored in stock_intel.social_sentiment
  const cached = await db
    .select({
      socialSentiment: schema.stockIntel.socialSentiment,
      updatedAt: schema.stockIntel.updatedAt,
    })
    .from(schema.stockIntel)
    .where(eq(schema.stockIntel.symbol, symbol))
    .limit(1);

  // Check if cache is fresh (within 3 days)
  if (cached.length > 0 && cached[0].socialSentiment && cached[0].updatedAt) {
    const cacheAge = Date.now() - new Date(cached[0].updatedAt).getTime();
    const TTL_3_DAYS = 3 * 24 * 60 * 60 * 1000;

    if (cacheAge < TTL_3_DAYS) {
      console.log(`[StockAnalyzer] Using cached ValuePickr data for ${symbol}`);
      try {
        const cachedData = JSON.parse(cached[0].socialSentiment);
        return {
          data: {
            thesisSummary: cachedData.thesis_summary,
            recentSentiment: cachedData.recent_sentiment_summary,
            topicUrl: cachedData.topic_url,
          },
          fetchedAt: cached[0].updatedAt,
        };
      } catch {
        // Parse error, fetch fresh
      }
    }
  }

  // No valid cache, fetch fresh
  console.log(`[StockAnalyzer] Fetching fresh ValuePickr data for ${symbol}`);
  const query = stockName || symbol;
  const result = await getStockThesis({ query });

  const data = result.data as
    | {
        found?: boolean;
        thesis_summary?: string;
        recent_sentiment?: string;
        topic_url?: string;
      }
    | undefined;

  if (!result.success || !data?.found) {
    return { data: null, fetchedAt: null };
  }

  return {
    data: {
      thesisSummary: data.thesis_summary,
      recentSentiment: data.recent_sentiment,
      topicUrl: data.topic_url,
    },
    fetchedAt: new Date().toISOString(),
  };
}

async function getTechnicalsData(symbol: string): Promise<{
  data: any | null;
}> {
  const result = await getTechnicals({ symbol });

  if (!result.success) {
    return { data: null };
  }

  return {
    data: result.data,
  };
}

// ============================================================================
// LLM Analysis
// ============================================================================

async function runLLMAnalysis(
  symbol: string,
  stockName: string | null,
  vrs: any,
  financials: any,
  news: any,
  valuepickr: any,
  technicals: any
): Promise<StockAnalysisResult> {
  // Dynamic import to bypass build issues
  let GoogleGenAI: any;
  try {
    const module = await import("@google/genai");
    GoogleGenAI = module.GoogleGenAI;
  } catch (e) {
    console.error("Failed to load @google/genai SDK:", e);
    throw new Error("LLM SDK not available");
  }

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  // Build the analysis prompt
  const prompt = buildAnalysisPrompt(
    symbol,
    stockName,
    vrs,
    financials,
    news,
    valuepickr,
    technicals
  );

  try {
    // Import ThinkingLevel for reasoning config
    const { ThinkingLevel } = await import("@google/genai");

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview", // Fast for per-stock analysis
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.HIGH, // Deep reasoning for investment decisions
        },
      },
    });

    const text = response.text || "";
    const analysis = JSON.parse(text);

    return {
      symbol,
      opportunityScore: analysis.opportunity_score ?? 50,
      thesisSummary: analysis.thesis_summary ?? "No summary available",
      risksSummary: analysis.risks_summary ?? "No risks identified",
      timingSignal: ["accumulate", "wait", "avoid"].includes(
        analysis.timing_signal
      )
        ? analysis.timing_signal
        : "wait",
      newsAlert: analysis.news_alert ?? false,
      newsAlertReason: analysis.news_alert_reason ?? null,
      analysisJson: text,
    };
  } catch (error) {
    console.error(`[StockAnalyzer] LLM error for ${symbol}:`, error);
    throw error;
  }
}

function buildAnalysisPrompt(
  symbol: string,
  stockName: string | null,
  vrs: any,
  financials: any,
  news: any,
  valuepickr: any,
  technicals: any
): string {
  let prompt = `You are evaluating a single stock for investment potential.

## Stock: ${symbol}${stockName ? ` - ${stockName}` : ""}

`;

  // VRS Section
  if (vrs?.data) {
    prompt += `## Value Research Stock (VRS) Data
Status: ${vrs.data.status}
${
  vrs.data.rationale
    ? `\n### Investment Thesis:\n${vrs.data.rationale.substring(0, 3000)}`
    : ""
}
${
  vrs.data.risks ? `\n### Key Risks:\n${vrs.data.risks.substring(0, 1500)}` : ""
}
${vrs.data.analystNote ? `\n### Analyst Note:\n${vrs.data.analystNote}` : ""}
${
  vrs.data.recPrice
    ? `\nRecommended Price: ₹${vrs.data.recPrice} (${vrs.data.recDate})`
    : ""
}

`;
  } else {
    prompt += `## VRS Data: Not available for this stock\n\n`;
  }

  // Financials Section
  if (financials?.data) {
    prompt += `## Recent Financials
${JSON.stringify(financials.data.financials, null, 2)}
${
  financials.data.latestConcall
    ? `
### Latest Concall (${financials.data.latestConcall.quarter}):
Guidance: ${financials.data.latestConcall.guidance || "N/A"}
Positives: ${financials.data.latestConcall.positives || "N/A"}
Risks: ${financials.data.latestConcall.risks || "N/A"}
`
    : ""
}

`;
  } else {
    prompt += `## Financials: Not available\n\n`;
  }

  // ValuePickr Section
  if (valuepickr?.data) {
    const vpAge = valuepickr.fetchedAt
      ? `fetched ${new Date(valuepickr.fetchedAt).toLocaleDateString()}`
      : "";
    prompt += `## ValuePickr Community Discussion ${vpAge ? `(${vpAge})` : ""}
⚠️ DISCLAIMER: These are OPINIONS from retail investors on a forum, NOT verified facts.
Treat as sentiment/sentiment data, not investment research.

Thesis: ${valuepickr.data.thesisSummary || "N/A"}
Recent Sentiment: ${valuepickr.data.recentSentiment || "N/A"}

`;
  } else {
    prompt += `## ValuePickr: No discussion found\n\n`;
  }

  // News Section (always fresh)
  const newsDate = news?.fetchedAt
    ? new Date(news.fetchedAt).toLocaleDateString()
    : new Date().toLocaleDateString();
  if (news?.data) {
    prompt += `## NEWS (Fetched: ${newsDate}, covering last 24-48 hours)
Note: Headlines are from Google News. Verify important news from primary sources.

Sentiment: ${news.data.sentimentSummary || "N/A"}
Key Events: ${news.data.keyEvents || "N/A"}
Headlines:
${
  news.data.headlines
    ?.map(
      (h: any) => `- ${h.title} (${h.source}${h.date ? `, ${h.date}` : ""})`
    )
    .join("\n") || "No headlines"
}

`;
  } else {
    prompt += `## NEWS (as of ${newsDate}): No recent news found\n\n`;
  }

  // Technicals Section
  if (technicals?.data) {
    prompt += `## Technicals (Real-time)
- Current Price: ₹${technicals.data.current_price || "N/A"}
- RSI(14): ${technicals.data.rsi_14 || "N/A"}
- vs SMA50: ${
      technicals.data.price_vs_sma50_pct
        ? `${technicals.data.price_vs_sma50_pct.toFixed(1)}%`
        : "N/A"
    }
- vs SMA200: ${
      technicals.data.price_vs_sma200_pct
        ? `${technicals.data.price_vs_sma200_pct.toFixed(1)}%`
        : "N/A"
    }
- Zone Status: ${technicals.data.zone_status || "N/A"}

`;
  } else {
    prompt += `## Technicals: Not available\n\n`;
  }

  // Instructions - Long-term Value Investing Framework
  prompt += `---

## CRITICAL: Long-Term Value Investing Mindset (3-5 Year Horizon)

You are evaluating this stock for a LONG-TERM VALUE INVESTOR who:
- Holds positions for 3-5+ years
- Buys quality businesses during temporary weakness
- Follows the "blood on the streets" philosophy - fear creates opportunity
- Only sells when the CORE THESIS is permanently broken

### Source Credibility Framework:

**VERIFIED DATA (High Trust):**
- Company financials, earnings reports, concall transcripts
- VRS research (professional analyst recommendations)
- Exchange filings and regulatory disclosures

**OPINIONS (Treat with Skepticism):**
- ValuePickr forum posts = retail investor opinions, NOT facts
- News headlines = often sensationalized, verify from primary sources
- Reddit/social media = sentiment indicator only, high noise

**KEY RULE**: Never treat an anonymous internet opinion as investment thesis.
Forum posts show what retail thinks, but their analysis may be wrong.
Use opinions to gauge SENTIMENT, not to make BUY/SELL decisions.

### Distinguish TWO Types of Negative News:

**THESIS-BREAKING (Sell/Avoid):**
- Management fraud or governance failures
- Business model obsolescence (technology disruption)
- Permanent structural decline in core markets
- Unsustainable debt leading to potential bankruptcy

**THESIS-TESTING (Often a Buying Opportunity!):**
- Regulatory headwinds (taxes, duties, policies) - companies adapt
- Cyclical downturns - these reverse
- Temporary margin pressure - often recovers
- Sector-wide selloffs - opportunity if company fundamentals solid
- Short-term earnings miss - look at trajectory, not single quarter

### The ITC Example:
A cigarette excise duty hike is THESIS-TESTING, not THESIS-BREAKING:
- ITC has survived and thrived through many duty hikes
- Core business generates massive cash flow regardless
- Diversification into FMCG/Hotels reduces dependency
- If RSI is extremely oversold during panic = SCREAMING BUY

## Your Task

1. **Evaluate thesis durability** - Is the CORE investment case still valid?
2. **Classify news** - Is negative news THESIS-BREAKING or THESIS-TESTING?
3. **Apply contrarian lens** - Does panic selling create opportunity for patient investors?
4. **Assess timing** - RSI < 30 + thesis intact = contrarian buy zone
5. **Score** the opportunity (0-100)

## Output Format (JSON only, no markdown):

{
  "opportunity_score": 0-100,
  "thesis_summary": "2-3 sentence summary of the investment case",
  "risks_summary": "Key risks in 1-2 sentences",
  "timing_signal": "accumulate" | "wait" | "avoid",
  "news_alert": true | false,
  "news_alert_reason": "Only if news_alert is true - explain: is this THESIS-BREAKING or THESIS-TESTING?"
}

## Scoring Guide (Long-Term Perspective):
- 80-100: Strong thesis + panic creates buying opportunity = GREAT entry
- 70-79: Solid thesis + reasonable valuation = accumulate
- 60-69: Good thesis but timing not ideal (overbought) = wait
- 40-59: Thesis unclear or unproven = needs more clarity
- 0-39: THESIS-BREAKING issues (fraud, obsolescence, structural decline)

**KEY INSIGHT**: Low RSI due to temporary bad news + intact long-term thesis = HIGHER score, not lower!

Important: If no VRS data exists, rely more heavily on ValuePickr and news. Be conservative in scoring without strong thesis backing.`;

  return prompt;
}

// ============================================================================
// Main Analysis Function
// ============================================================================

/**
 * Analyze a single stock and cache the results
 */
export async function analyzeStock(
  symbol: string
): Promise<StockAnalysisResult | null> {
  console.log(`[StockAnalyzer] Starting analysis for ${symbol}`);

  try {
    // Get stock name from watchlist
    const watchlistEntry = await db
      .select({ name: schema.watchlist.name })
      .from(schema.watchlist)
      .where(eq(schema.watchlist.symbol, symbol))
      .limit(1);

    const stockName = watchlistEntry[0]?.name || null;

    // Gather all data
    console.log(`[StockAnalyzer] Gathering data for ${symbol}...`);

    const [vrs, financials, news, valuepickr, technicals] = await Promise.all([
      getVRSData(symbol),
      getFinancialsData(symbol),
      getNewsData(symbol, stockName),
      getValuePickrData(symbol, stockName),
      getTechnicalsData(symbol),
    ]);

    console.log(`[StockAnalyzer] Running LLM analysis for ${symbol}...`);

    // Run LLM analysis
    const result = await runLLMAnalysis(
      symbol,
      stockName,
      vrs,
      financials,
      news,
      valuepickr,
      technicals
    );

    // Calculate expiry (7 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // Save to cache
    await db
      .insert(schema.stockAnalysisCache)
      .values({
        symbol,
        opportunityScore: result.opportunityScore,
        thesisSummary: result.thesisSummary,
        risksSummary: result.risksSummary,
        timingSignal: result.timingSignal,
        newsAlert: result.newsAlert,
        newsAlertReason: result.newsAlertReason,
        analysisJson: result.analysisJson,
        vrsDataAt: vrs.fetchedAt,
        financialsAt: financials.fetchedAt,
        valuepickrAt: valuepickr.fetchedAt,
        newsAt: news.fetchedAt,
        analyzedAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
      })
      .onConflictDoUpdate({
        target: schema.stockAnalysisCache.symbol,
        set: {
          opportunityScore: result.opportunityScore,
          thesisSummary: result.thesisSummary,
          risksSummary: result.risksSummary,
          timingSignal: result.timingSignal,
          newsAlert: result.newsAlert,
          newsAlertReason: result.newsAlertReason,
          analysisJson: result.analysisJson,
          vrsDataAt: vrs.fetchedAt,
          financialsAt: financials.fetchedAt,
          valuepickrAt: valuepickr.fetchedAt,
          newsAt: news.fetchedAt,
          analyzedAt: new Date().toISOString(),
          expiresAt: expiresAt.toISOString(),
        },
      });

    console.log(
      `[StockAnalyzer] Completed ${symbol}: Score=${result.opportunityScore}, Signal=${result.timingSignal}`
    );

    return result;
  } catch (error) {
    console.error(`[StockAnalyzer] Error analyzing ${symbol}:`, error);
    return null;
  }
}

/**
 * Analyze all holdings + stocks marked as "interesting" in the watchlist
 */
export async function analyzeInterestingStocks(
  onProgress?: (progress: AnalysisJobProgress) => void,
  delayBetweenStocks: number = 2000 // 2 seconds between stocks to avoid rate limits
): Promise<AnalysisJobProgress> {
  // Get all interesting stocks from watchlist (excluding delisted)
  const interestingStocks = await db
    .select({ symbol: schema.watchlist.symbol })
    .from(schema.watchlist)
    .where(eq(schema.watchlist.interesting, true));

  // Get delisted symbols to exclude
  const delistedStocks = await db
    .select({ symbol: schema.watchlist.symbol })
    .from(schema.watchlist)
    .where(eq(schema.watchlist.delisted, true));
  const delistedSymbols = new Set(delistedStocks.map((s) => s.symbol));

  // Get actual holdings (stocks with net qty > 0)
  const holdings = await getHoldings();

  // Combine and deduplicate, excluding delisted stocks
  const interestingSymbols = new Set(
    interestingStocks
      .map((s) => s.symbol)
      .filter((s) => !delistedSymbols.has(s))
  );
  const holdingSymbols = new Set(
    holdings.map((h) => h.symbol).filter((s) => !delistedSymbols.has(s))
  );
  const allSymbols = new Set([...interestingSymbols, ...holdingSymbols]);
  const symbols = Array.from(allSymbols);

  console.log(
    `[StockAnalyzer] Starting batch analysis for ${symbols.length} stocks (${interestingSymbols.size} interesting + ${holdingSymbols.size} holdings)`
  );

  const progress: AnalysisJobProgress = {
    total: symbols.length,
    completed: 0,
    current: null,
    errors: [],
    results: [],
  };

  for (const symbol of symbols) {
    progress.current = symbol;
    onProgress?.(progress);

    try {
      const result = await analyzeStock(symbol);

      progress.results.push({
        symbol,
        score: result?.opportunityScore ?? null,
        error: result ? undefined : "Analysis failed",
      });

      if (!result) {
        progress.errors.push(`${symbol}: Analysis failed`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      progress.errors.push(`${symbol}: ${errorMsg}`);
      progress.results.push({
        symbol,
        score: null,
        error: errorMsg,
      });
    }

    progress.completed++;
    onProgress?.(progress);

    // Rate limiting delay
    if (progress.completed < symbols.length) {
      await new Promise((resolve) => setTimeout(resolve, delayBetweenStocks));
    }
  }

  progress.current = null;
  onProgress?.(progress);

  console.log(
    `[StockAnalyzer] Batch complete: ${progress.completed}/${progress.total}, ${progress.errors.length} errors`
  );

  return progress;
}

/**
 * Get cached analysis for stocks
 */
export async function getCachedAnalysis(
  symbols?: string[]
): Promise<Map<string, typeof schema.stockAnalysisCache.$inferSelect>> {
  let query = db.select().from(schema.stockAnalysisCache);

  if (symbols && symbols.length > 0) {
    query = query.where(
      inArray(schema.stockAnalysisCache.symbol, symbols)
    ) as typeof query;
  }

  const results = await query;
  return new Map(results.map((r) => [r.symbol, r]));
}
