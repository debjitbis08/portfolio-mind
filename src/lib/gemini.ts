/**
 * Gemini AI Service
 *
 * Provides agentic portfolio analysis with tool calling support.
 * Tier 3 support: analyzeWithCachedData uses pre-analyzed Tier 2 summaries.
 */

import { GEMINI_API_KEY } from "astro:env/server";
import {
  getToolDeclarations,
  getEnabledToolDeclarations,
  getMergedToolConfig,
  executeTool,
  clearRequestCache,
  type ToolResponse,
  type ToolConfig,
  type Citation,
} from "./tools";
import { getSuggestionsContext } from "./tools/suggestions";
import { PortfolioRole } from "./zone-status";
import { getCachedAnalysis } from "./stock-analyzer";
import { db, schema } from "./db";
import { desc, eq, inArray } from "drizzle-orm";
import { buildTier3SystemPrompt as buildTier3SystemPromptCommon } from "./tier3-prompt";

// ============================================================================
// Types
// ============================================================================

export interface HoldingForAnalysis {
  symbol: string;
  stock_name: string;
  quantity: number;
  avg_buy_price: number;
  current_price: number;
  returns_percent: number;
  rsi_14: number | null;
  price_vs_sma50: number | null;
  price_vs_sma200: number | null;
  is_wait_zone: boolean;
  wait_reasons: string[];
  fundamentals?: any;
  qualitative?: {
    source: string;
    thesis_summary?: string;
    last_activity?: string;
  } | null;
}

export interface Suggestion {
  symbol: string;
  stock_name?: string;
  action: "BUY" | "SELL" | "MOVE" | "RAISE_CASH";
  confidence: number;
  reason: string;
  rationale?: string;
  quantity: number;
  allocation_amount?: number;
  sell_symbol?: string;
  sell_quantity?: number;
  technical_score?: number;
  cash_deployment_notes?: string; // For RAISE_CASH: when/why to deploy this cash
  citations?: Citation[]; // Sources used by agent for transparency
  portfolio_role?: PortfolioRole; // Investment strategy context
}

export interface ToolCallProgress {
  tool: string;
  args: Record<string, unknown>;
  result?: ToolResponse;
}

export type ProgressCallback = (
  progress: number,
  message: string,
  toolCall?: ToolCallProgress
) => void;

// ============================================================================
// Main Service
// ============================================================================

export class GeminiService {
  private static MAX_TOOL_ITERATIONS = 10; // Safety limit

  /**
   * Analyze portfolio with agentic tool calling
   */
  static async analyzePortfolio(
    holdings: HoldingForAnalysis[],
    availableFunds: number = 0,
    onProgress?: ProgressCallback,
    toolConfig?: ToolConfig | null
  ): Promise<Suggestion[]> {
    if (holdings.length === 0) return [];

    // Clear request cache at start of cycle
    clearRequestCache();

    const progress = (pct: number, msg: string, tc?: ToolCallProgress) => {
      console.log(`[Gemini] ${pct}% - ${msg}`);
      onProgress?.(pct, msg, tc);
    };

    progress(5, "Initializing AI agent...");

    // Dynamic import to bypass build issues
    let GoogleGenAI: any;
    try {
      const module = await import("@google/genai");
      GoogleGenAI = module.GoogleGenAI;
    } catch (e) {
      console.error("Failed to load @google/genai SDK:", e);
      return [];
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    // Build initial context
    const holdingsContext = holdings.map((h) => ({
      symbol: h.symbol,
      name: h.stock_name,
      price: h.current_price,
      quantity: h.quantity,
      returns_pct: h.returns_percent?.toFixed(1),
      rsi: h.rsi_14,
      vs_sma50: h.price_vs_sma50 ? `${h.price_vs_sma50.toFixed(1)}%` : null,
      vs_sma200: h.price_vs_sma200 ? `${h.price_vs_sma200.toFixed(1)}%` : null,
      wait_zone: h.is_wait_zone ? h.wait_reasons.join(", ") : null,
    }));

    // System prompt with tool guidance
    const systemPrompt = this.buildSystemPrompt(availableFunds);

    // User message with holdings
    const holdingSymbols = holdings.map((h) => h.symbol);

    // Fetch previous suggestions context (Pending + History)
    progress(8, "Fetching suggestion history...");
    const suggestionsContext = await getSuggestionsContext();

    // Split into Pending vs History
    const pendingSuggestions = suggestionsContext.filter(
      (s) => s.status === "pending"
    );
    const historySuggestions = suggestionsContext.filter((s) =>
      ["approved", "rejected"].includes(s.status)
    );

    // Build context string
    let previousSuggestionsContext = "";

    if (suggestionsContext.length > 0) {
      previousSuggestionsContext += `## Previous Suggestions & Context\n\n`;

      if (pendingSuggestions.length > 0) {
        previousSuggestionsContext += `### ⚠️ PENDING REVIEW (Action Required)\n`;
        previousSuggestionsContext += `You previously recommended these. You MUST decide: STILL VALID, UPDATE, or INVALIDATE.\n\n`;
        previousSuggestionsContext += pendingSuggestions
          .map(
            (s) =>
              `- **${s.symbol}**: ${s.action} (${
                s.createdAt
                  ? new Date(s.createdAt).toLocaleDateString()
                  : "unknown date"
              }) [Confidence: ${s.confidence || "?"}/10]
  Rationale: ${s.rationale}${
                s.notes && s.notes.length > 0
                  ? `\n  User Notes:\n${s.notes
                      .map((n) => `  - "${n}"`)
                      .join("\n")}`
                  : ""
              }`
          )
          .join("\n\n");
        previousSuggestionsContext += `\n\n`;
      }

      if (historySuggestions.length > 0) {
        previousSuggestionsContext += `### 📜 RECENT HISTORY (Context Only)\n`;
        previousSuggestionsContext += `Recent user decisions on your suggestions. Use this to learn user preferences.\n\n`;
        previousSuggestionsContext += historySuggestions
          .map(
            (s) =>
              `- **${s.symbol}**: ${
                s.action
              } -> **${s.status.toUpperCase()}** (${
                s.createdAt
                  ? new Date(s.createdAt).toLocaleDateString()
                  : "unknown date"
              })
  Your Rationale: ${s.rationale}${
                s.notes && s.notes.length > 0
                  ? `\n  User Notes:\n${s.notes
                      .map((n) => `  - "${n}"`)
                      .join("\n")}`
                  : ""
              }`
          )
          .join("\n\n");
        previousSuggestionsContext += `\n\n`;
      }
    }

    const userMessage = `${previousSuggestionsContext}## Current Portfolio

Holdings: ${JSON.stringify(holdingsContext, null, 2)}

## Your Task (IMPORTANT: Focus on DISCOVERY!)

1. **REVIEW PREVIOUS SUGGESTIONS**: If you have pending suggestions above, evaluate them first
2. **DISCOVERY PHASE**: Use \`browse_screener\` to get enriched stock data from my watchlist
   - Stocks are pre-sorted by opportunity_score (0-100)
   - **PRIORITIZE**: opportunity_score >= 50 (good thesis + timing)
   - **FOCUS ON**: value_zone=true stocks (good accumulation timing)
   - **RESPECT**: has_user_research=true (my documented conviction)
   - Look for stocks NOT already in my portfolio: ${holdingSymbols.join(", ")}

3. **RESEARCH PHASE**: For top opportunity stocks (pick 2-4 highest scores):
   - Use \`get_company_knowledge\` first if has_user_research=true
   - Use \`get_stock_thesis\` if has_valuepickr_thesis=true
   - Use \`get_stock_news\` to check recent sentiment

4. **TIMING CHECK**: Technicals are already in screener data (rsi_14, price_vs_sma50/200)
   - Only call \`get_technicals\` if you need more detail

5. **OUTPUT**: Recommend 1-3 NEW opportunities from screener.
   Include previous suggestions if still valid.`;

    // Build config with tools (filtered by enabled status)
    const mergedConfig = getMergedToolConfig(toolConfig ?? null);
    const toolDeclarations = getEnabledToolDeclarations(mergedConfig);
    const config: any = {
      tools: toolDeclarations.length
        ? [{ functionDeclarations: toolDeclarations }]
        : undefined,
    };

    // Initial conversation
    let contents: any[] = [
      {
        role: "user",
        parts: [{ text: systemPrompt + "\n\n" + userMessage }],
      },
    ];

    progress(10, `Sending to Gemini with ${toolDeclarations.length} tools...`);

    try {
      let iterations = 0;

      // Agentic loop
      while (iterations < this.MAX_TOOL_ITERATIONS) {
        iterations++;

        const response = await ai.models.generateContent({
          model: "gemini-3-pro-preview",
          contents,
          config,
        });

        // Check for function calls
        const functionCalls = response.functionCalls;

        if (functionCalls && functionCalls.length > 0) {
          // First, add the model's response with function calls (preserving thought signatures)
          // For Gemini 3+, we must preserve the full response including thoughtSignature
          const modelParts = response.candidates?.[0]?.content?.parts;
          if (modelParts) {
            contents.push({
              role: "model",
              parts: modelParts,
            });
          }

          // Process each function call and collect responses
          const functionResponses: any[] = [];

          for (const call of functionCalls) {
            const pct = 20 + iterations * 8;
            progress(
              Math.min(pct, 80),
              `🔧 ${call.name}(${JSON.stringify(call.args)})`,
              { tool: call.name, args: call.args }
            );

            // Execute the tool
            const result = await executeTool(call.name, call.args || {});

            progress(
              Math.min(pct + 4, 85),
              `   → ${result.success ? "✓" : "✗"} ${
                result.success ? "Success" : result.error?.message
              }`,
              { tool: call.name, args: call.args, result }
            );

            // Collect function response
            functionResponses.push({
              functionResponse: {
                name: call.name,
                response: result.success ? result.data : result.error,
              },
            });
          }

          // Add all function responses in a single user message
          contents.push({
            role: "user",
            parts: functionResponses,
          });

          // Continue the loop to get next response
          continue;
        }

        // No function calls - this is the final response
        progress(90, "Agent completed, parsing suggestions...");

        const text = response.text || "";
        if (!text) {
          console.warn("[Gemini] Empty response text");
          return [];
        }

        // Extract JSON from response
        const suggestions = this.parseResponse(text, holdings);
        progress(100, `Found ${suggestions.length} actionable suggestions`);

        return suggestions;
      }

      // Hit iteration limit
      console.warn("[Gemini] Hit max tool iterations");
      progress(100, "Completed (iteration limit reached)");
      return [];
    } catch (error) {
      console.error("Gemini analysis failed:", error);
      progress(
        100,
        `Error: ${error instanceof Error ? error.message : "Unknown"}`
      );
      return [];
    }
  }

  // ============================================================================
  // TIER 3: Portfolio Discovery with Cached Analysis
  // ============================================================================

  /**
   * Analyze portfolio using pre-cached Tier 2 stock analysis.
   * This is MUCH faster as it doesn't need to call tools for each stock.
   * Tool calling is still available for deep-dives if needed.
   */
  static async analyzeWithCachedData(
    holdings: HoldingForAnalysis[],
    availableFunds: number = 0,
    onProgress?: ProgressCallback,
    toolConfig?: ToolConfig | null
  ): Promise<Suggestion[]> {
    if (holdings.length === 0) return [];

    // Clear request cache at start of cycle
    clearRequestCache();

    const progress = (pct: number, msg: string, tc?: ToolCallProgress) => {
      console.log(`[Gemini Tier 3] ${pct}% - ${msg}`);
      onProgress?.(pct, msg, tc);
    };

    progress(5, "Loading cached stock analysis...");

    // Load cached Tier 2 analysis for all stocks
    const holdingSymbols = holdings.map((h) => h.symbol);

    // Get delisted symbols to exclude
    const delistedStocks = await db
      .select({ symbol: schema.watchlist.symbol })
      .from(schema.watchlist)
      .where(eq(schema.watchlist.delisted, true));
    const delistedSymbols = new Set(delistedStocks.map((s) => s.symbol));

    // Get "interesting" symbols from watchlist (for filtering opportunities)
    const interestingStocks = await db
      .select({ symbol: schema.watchlist.symbol })
      .from(schema.watchlist)
      .where(eq(schema.watchlist.interesting, true));
    const interestingSymbols = new Set(interestingStocks.map((s) => s.symbol));

    // Get all cached analysis (both holdings and opportunities), excluding delisted
    // Join with watchlist to get stock names
    const allCachedRaw = await db
      .select({
        cache: schema.stockAnalysisCache,
        watchlist: {
          name: schema.watchlist.name,
        },
      })
      .from(schema.stockAnalysisCache)
      .leftJoin(
        schema.watchlist,
        eq(schema.stockAnalysisCache.symbol, schema.watchlist.symbol)
      )
      .orderBy(desc(schema.stockAnalysisCache.opportunityScore));

    const allCached = allCachedRaw.map((row) => ({
      ...row.cache,
      stockName: row.watchlist?.name || null,
    }));

    // Filter out delisted stocks
    const validCached = allCached.filter((c) => !delistedSymbols.has(c.symbol));

    // Separate holdings analysis from opportunities
    const holdingsCached = validCached.filter((c) =>
      holdingSymbols.includes(c.symbol)
    );
    // Only include opportunities that are STILL marked as "interesting"
    // This prevents stale cached analyses from appearing after unmarking
    const opportunitiesCached = validCached.filter(
      (c) =>
        !holdingSymbols.includes(c.symbol) && interestingSymbols.has(c.symbol)
    );

    // Group opportunities by timing signal
    const accumulate = opportunitiesCached.filter(
      (c) => c.timingSignal === "accumulate" && (c.opportunityScore ?? 0) >= 70
    );
    const wait = opportunitiesCached.filter(
      (c) => c.timingSignal === "wait" && (c.opportunityScore ?? 0) >= 60
    );
    const avoid = opportunitiesCached.filter(
      (c) => c.timingSignal === "avoid" || (c.opportunityScore ?? 0) < 60
    );

    // Check for urgent news alerts in holdings
    const holdingsWithAlerts = holdingsCached.filter((c) => c.newsAlert);

    progress(
      10,
      `Found ${accumulate.length} accumulate, ${wait.length} wait, ${holdingsWithAlerts.length} alerts`
    );

    // Fetch intraday transactions with their linked suggestion notes
    const intradayWithNotesRaw = await db
      .select({
        id: schema.intradayTransactions.id,
        symbol: schema.intradayTransactions.symbol,
        stockName: schema.intradayTransactions.stockName,
        type: schema.intradayTransactions.type,
        quantity: schema.intradayTransactions.quantity,
        pricePerShare: schema.intradayTransactions.pricePerShare,
        executedAt: schema.intradayTransactions.executedAt,
        createdAt: schema.intradayTransactions.createdAt,
        note: schema.actionNotes.content,
      })
      .from(schema.intradayTransactions)
      .leftJoin(
        schema.intradaySuggestionLinks,
        eq(
          schema.intradayTransactions.id,
          schema.intradaySuggestionLinks.intradayTransactionId
        )
      )
      .leftJoin(
        schema.actionNotes,
        eq(
          schema.intradaySuggestionLinks.suggestionId,
          schema.actionNotes.suggestionId
        )
      );

    // Group notes by transaction ID
    const intradayMap = new Map<string, any>();
    for (const row of intradayWithNotesRaw) {
      if (!intradayMap.has(row.id)) {
        intradayMap.set(row.id, {
          ...row,
          notes: [] as string[],
        });
      }
      if (row.note) {
        intradayMap.get(row.id).notes.push(row.note);
      }
    }

    const recentIntraday = Array.from(intradayMap.values()).filter((tx) => {
      const execDate = new Date(tx.executedAt || tx.createdAt || 0);
      const daysAgo = (Date.now() - execDate.getTime()) / (1000 * 60 * 60 * 24);
      return daysAgo <= 7; // Only show last 7 days of activity
    });

    // Dynamic import for SDK
    let GoogleGenAI: any;
    let ThinkingLevel: any;
    try {
      const module = await import("@google/genai");
      GoogleGenAI = module.GoogleGenAI;
      ThinkingLevel = module.ThinkingLevel;
    } catch (e) {
      console.error("Failed to load @google/genai SDK:", e);
      return [];
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    // Fetch previous suggestions context
    progress(15, "Fetching suggestion history...");
    const suggestionsContext = await getSuggestionsContext();
    const pendingSuggestions = suggestionsContext.filter(
      (s) => s.status === "pending"
    );
    console.log(
      `[Gemini Tier 3] Found ${pendingSuggestions.length} pending suggestions, ${suggestionsContext.length} total in history`
    );

    // Build holdings context with any cached analysis
    const holdingsWithAnalysis = holdings.map((h) => {
      const cached = holdingsCached.find((c) => c.symbol === h.symbol);
      return {
        symbol: h.symbol,
        name: h.stock_name,
        quantity: h.quantity,
        avg_cost: h.avg_buy_price,
        current_price: h.current_price,
        returns_pct: h.returns_percent?.toFixed(1),
        // Add cached Tier 2 data if available
        opportunity_score: cached?.opportunityScore ?? null,
        timing_signal: cached?.timingSignal ?? null,
        thesis: cached?.thesisSummary ?? null,
        risks: cached?.risksSummary ?? null,
        news_alert: cached?.newsAlert ?? false,
        news_alert_reason: cached?.newsAlertReason ?? null,
      };
    });

    // Build the Tier 3 system prompt
    const systemPrompt = this.buildTier3SystemPrompt(availableFunds);

    // Build user message with pre-analyzed data
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

**Total Holdings:** ${holdings.length}
**Available Cash:** ₹${availableFunds.toLocaleString("en-IN")}

`;

    // Add alerts section if any
    if (holdingsWithAlerts.length > 0) {
      userMessage += `## ⚠️ HOLDINGS WITH NEWS ALERTS (Review First!)

${holdingsWithAlerts
  .map(
    (h) =>
      `**${h.stockName || h.symbol}** (${h.symbol}) (Score: ${
        h.opportunityScore
      }, Signal: ${h.timingSignal})
- Alert: ${h.newsAlertReason}
- Thesis: ${h.thesisSummary}`
  )
  .join("\n\n")}

`;
    }

    // Add pending suggestions
    if (pendingSuggestions.length > 0) {
      userMessage += `## Pending Suggestions (Review These)

${pendingSuggestions
  .map(
    (s) =>
      `- **${s.symbol}**: ${s.action} (${new Date(
        s.createdAt || ""
      ).toLocaleDateString("en-IN")}) - ${s.rationale}${
        s.notes && s.notes.length > 0
          ? `\n  User Notes:\n${s.notes.map((n) => `  - "${n}"`).join("\n")}`
          : ""
      }`
  )
  .join("\n\n")}

`;
    }

    // Add recent intraday activity
    if (recentIntraday.length > 0) {
      userMessage += `## 🕒 Recent Intraday Activity (Last 7 Days)

These are manual trades entered since the last official broker import.
The positions shown in the table above ALREADY include these shares.

${recentIntraday
  .map(
    (tx) =>
      `- **${tx.stockName || tx.symbol}** (${tx.symbol}): ${tx.type} ${
        tx.quantity
      } shares @ ₹${tx.pricePerShare} (${new Date(
        tx.executedAt || tx.createdAt || ""
      ).toLocaleDateString("en-IN")})${
        tx.notes && tx.notes.length > 0
          ? `\n  User Notes:\n${tx.notes
              .map((n: string) => `  - "${n}"`)
              .join("\n")}`
          : ""
      }`
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
      `**${o.stockName || o.symbol}** (${o.symbol}) — Score: ${
        o.opportunityScore
      }/100
_${o.thesisSummary}_
Risks: ${o.risksSummary}
${o.newsAlert ? `⚠️ NEWS: ${o.newsAlertReason}` : ""}`
  )
  .join("\n\n")}

`;
    }

    // Add wait zone stocks (could be good for watchlist awareness)
    if (wait.length > 0) {
      userMessage += `## 🟡 Good Stocks to Monitor (Wait Zone)

These have good fundamentals but timing says wait:

${wait
  .slice(0, 5)
  .map(
    (o) =>
      `- **${o.stockName || o.symbol}** (${o.symbol}) [${
        o.opportunityScore
      }]: ${o.thesisSummary?.slice(0, 100)}...`
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

Output 1-3 actionable recommendations. If no stocks meet the Buy criteria AND no holdings trigger a Sell signal, **it is perfectly fine to recommend NO trades.**`;

    // Tier 3 does NOT use tools - it has all the pre-analyzed data it needs
    // This prevents expensive external scraper calls (ValuePickr, News, etc.)
    const config: any = {
      // NO TOOLS - Tier 3 uses cached summaries only
      thinkingConfig: {
        thinkingLevel: ThinkingLevel.HIGH, // Deep reasoning for portfolio decisions
      },
    };

    progress(20, "Sending to Gemini Tier 3...");

    // Initial conversation
    let contents: any[] = [
      {
        role: "user",
        parts: [{ text: systemPrompt + "\n\n" + userMessage }],
      },
    ];

    try {
      // Single LLM call - no tools, no iterations
      const response = await ai.models.generateContent({
        model: "gemini-3-pro-preview", // Pro for portfolio decisions
        contents,
        config,
      });

      // Got final response
      const text = response.text || "";
      console.log(
        "[Gemini Tier 3] Final response received, length:",
        text.length
      );

      const suggestions = this.parseResponse(text, holdings);
      progress(100, `Found ${suggestions.length} recommendations`);

      return suggestions;
    } catch (error) {
      console.error("Gemini Tier 3 failed:", error);
      progress(
        100,
        `Error: ${error instanceof Error ? error.message : "Unknown"}`
      );
      return [];
    }
  }

  /**
   * Build Tier 3 system prompt (focused on portfolio decisions)
   * Delegates to the centralized prompt builder
   */
  public static buildTier3SystemPrompt(availableFunds: number): string {
    // Import from centralized prompt module
    return buildTier3SystemPromptCommon(availableFunds);
  }

  /**
   * Build the system prompt
   */
  private static buildSystemPrompt(availableFunds: number): string {
    return `You are an expert LONG-TERM VALUE INVESTOR acting as a Portfolio Copilot.
Your primary goal is WEALTH BUILDING through patient accumulation of quality businesses.

## Your Tools
- \`browse_screener\`: Get stocks from pre-built screener.in screens (discovery)
- \`get_company_knowledge\`: Get user's research docs, notes, saved links, and tables for a stock (CHECK THIS FIRST!)
- \`get_stock_thesis\`: Get ValuePickr investment thesis (FUNDAMENTAL ANALYSIS - highest trust)
- \`get_financials\`: Get P&L, Cash Flow, Balance Sheet data. **EARNINGS QUALITY CHECK**: Is CFO ≈ Net Profit?
- \`get_stock_news\`: Get Google News headlines (CURRENT EVENTS - medium trust)
- \`get_reddit_sentiment\`: Get Reddit discussions with posts and top comments (read like a human!)
- \`get_technicals\`: Get RSI, SMA50, SMA200 for timing signals
- \`check_wait_zone\`: Check if a stock is overextended (timing only)
- \`get_commodity_prices\`: Get gold/silver spot prices in INR per gram

## Important: Tool Usage & Retry Logic
- IF \`get_stock_thesis\` or \`get_stock_news\` returns "Not Found": **YOU MUST RETRY** with a different query.
  - If you tried the Company Name (e.g., "Reliance Industries"), retry with the Symbol (e.g., "RELIANCE").
  - If you tried the Symbol, retry with the full Company Name.
  - This is critical for finding data. Do not give up after one failed attempt.

## Tool Priority & Trust Hierarchy
1. **User's Own Research** = HIGHEST TRUST - always check \`get_company_knowledge\` first!
2. **ValuePickr thesis** = PRIMARY external source for buy/sell decisions (high trust)
3. **Google News** = Recent events, context (medium trust)
4. **Reddit discussions** = Read the actual posts and comments like a human would:
   - What specific concerns are retail investors raising?
   - Is the discussion quality high (informed analysis) or low (hype/FUD)?
   - Use as CONTRARIAN signal: extreme bullishness = crowded trade, extreme fear = opportunity
5. **Technicals** = Timing signals, not reasons to buy

## Investment Philosophy
Available Cash: ₹${availableFunds.toLocaleString("en-IN")}

**THE STORY IS EVERYTHING**. We invest in businesses, not charts.

### Step 1: Is this a QUALITY BUSINESS? (Primary Decision)
Ask yourself:
- Does it have a strong investment thesis? (ValuePickr sentiment)
- Is the business model sound?
- Is there a clear growth story or moat?
- Is management trustworthy?
- Are fundamentals improving?

If NO to most of these → SKIP, don't even check technicals
If YES → Proceed to timing check

### Step 2: Is NOW a good time to accumulate? (Timing Signal)
Technicals help you decide WHEN to buy a stock you already like:
- RSI < 40: Good accumulation zone
- Near SMA50/SMA200: Good support levels
- RSI > 70 or 40%+ above SMAs: WAIT, don't accumulate now

**KEY INSIGHT**: Low RSI without a good story = value trap, not value buy!

### When to BUY
- Story is STRONG (positive thesis, good fundamentals)
- AND timing is favorable (RSI < 40, near SMAs)
- You have cash available

### When to HOLD (Default!)
- You like the story but timing is unfavorable → Just wait
- Stock is extended but thesis still positive → Don't sell, just don't add
- Not enough conviction on either direction

### When to SELL (Very Rare!)
Only sell when:
1. **THESIS BROKEN**: Story has fundamentally changed (management issues, business model broken)
2. **STRATEGIC ROTATION**: >100% gains AND better opportunity exists
NEVER sell just because RSI is high or stock is above SMA200.

### When to RAISE_CASH (Sell Without Reinvestment)
Use RAISE_CASH when you want to sell but have NO immediate replacement:
1. **THESIS BROKEN** but no clear alternative identified yet
2. **POSITION TOO LARGE** relative to current conviction - trim to right-size
3. **MARKET CAUTION** - build cash for anticipated pullback or uncertainty
4. **STRATEGIC TRIMMING** - take profits to have dry powder for future opportunities

RAISE_CASH is different from SELL:
- SELL implies reinvestment or rotation to another stock
- RAISE_CASH explicitly means "hold the proceeds as cash for now"

You can partially raise cash (e.g., sell 50% of position) by specifying quantity.

### Protected Categories
- **Gold ETFs (GOLDBEES, etc.)**: Treated as gold exposure, wealth preservation asset
- **Silver ETFs (SILVERBEES, etc.)**: Treated as silver exposure, wealth preservation
- **Physical Gold/Silver/SGBs**: Not trading vehicles, long-term hedges
- **Momentum sectors (Defense, Infra)**: Ride the wave if story is good
- **Quality compounders**: Long term holds

### Commodity Awareness
The portfolio may include commodity exposure through:
1. **Gold/Silver ETFs** - Automatically classified as commodity exposure
2. **Physical holdings** - Tracked separately, not for trading
3. **SGBs (Sovereign Gold Bonds)** - Government-backed gold exposure

When analyzing commodity positions, use \`get_commodity_prices\` to compare:
- Spot price vs ETF NAV (look for premium/discount opportunities)
- Overall portfolio allocation to commodities

## Your Rationale Should Reference:
✓ User's own research (if they have any - cite it!)
✓ The investment thesis/story (from ValuePickr)
✓ Business quality signals
✓ Why NOW is a good time (technicals as confirmation)
✗ NOT just "RSI is low" or "near SMA" - that's not enough!

## User Research

Before making recommendations, check if the user has contributed research using \`get_company_knowledge\`.

If they have:
1. Reference their investment thesis in your analysis
2. Don't contradict documented research without strong evidence
3. Cite specific insights: "Based on your notes about..."
4. Note when their thesis aligns with or conflicts with current data

User research represents their conviction and deep analysis - respect it.

## Output Format

**IMPORTANT**: You MUST include citations for every source you used - not just user content but also ValuePickr, News, Reddit, and Technicals. This makes your reasoning transparent.

\`\`\`json
[
  {
    "action": "BUY" | "SELL" | "RAISE_CASH",
    "symbol": "STOCKNAME",
    "quantity": 10,
    "rationale": "Strong thesis because [story reason]. Timing favorable with RSI at X.",
    "confidence": 8,
    "technical_score": 85,
    "allocation_amount": 50000,
    "portfolio_role": "VALUE" | "MOMENTUM" | "CORE" | "SPECULATIVE" | "INCOME",
    "cash_deployment_notes": "Optional: when/why to deploy this cash later",
    "citations": [
      { "type": "research", "id": "uuid", "title": "Investment Thesis", "excerpt": "Key insight used..." },
      { "type": "valuepickr", "title": "Stock Thread Summary", "source": "ValuePickr" },
      { "type": "news", "title": "Recent headline", "source": "Google News" },
      { "type": "technicals", "title": "RSI 34, -5% from SMA50" }
    ]
  }
]
\`\`\`

**Field Definitions:**
- \`confidence\` (1-10): Your overall conviction in this recommendation. 1=speculative, 5=moderate conviction, 10=extremely high conviction. This reflects how strongly you believe the user should act on this.
- \`technical_score\` (0-100): Pure technical setup quality - RSI positioning, SMA proximity, chart patterns. A stock can have high technical_score but low confidence (great entry but uncertain thesis) or vice versa.
- \`portfolio_role\`: The investment strategy this stock serves:
  - **VALUE**: Deep value play with margin of safety. Buy when beaten down, be patient.
  - **MOMENTUM**: Trend-following, riding strength. Trim when overheated, cut when trend breaks.
  - **CORE**: Long-term compounder, buy-and-hold. Never sell just because of technicals.
  - **SPECULATIVE**: High-risk/reward bet. Small position, defined exit.
  - **INCOME**: Dividend/distribution focused. Hold for yield, less sensitive to price swings.

**Citation Types:**
- \`research\`, \`link\`, \`note\`, \`table\` = User's own content (include \`id\` field)
- \`valuepickr\`, \`news\`, \`reddit\`, \`technicals\` = External tool results (include \`source\` field)

If no HIGH CONVICTION actions → return empty array: []
Better to do nothing than to make a low-conviction trade.`;
  }

  /**
   * Parse the final response to extract suggestions
   */
  private static parseResponse(
    text: string,
    holdings: HoldingForAnalysis[]
  ): Suggestion[] {
    try {
      // Try to find JSON in the response
      let jsonStr = text;

      // Look for JSON block
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      } else {
        // Try to find object or array directly
        const objectMatch = text.match(/\{[\s\S]*\}/);
        const arrayMatch = text.match(/\[[\s\S]*\]/);
        if (objectMatch) {
          jsonStr = objectMatch[0];
        } else if (arrayMatch) {
          jsonStr = arrayMatch[0];
        }
      }

      const parsed = JSON.parse(jsonStr);

      // Handle both formats:
      // 1. Array: [{symbol, action, ...}, ...]
      // 2. Object: {suggestions: [...], portfolio_notes: "..."}
      let rawSuggestions: any[];
      if (Array.isArray(parsed)) {
        rawSuggestions = parsed;
      } else if (parsed.suggestions && Array.isArray(parsed.suggestions)) {
        rawSuggestions = parsed.suggestions;
        // Log portfolio notes if present
        if (parsed.portfolio_notes) {
          console.log("[Gemini] Portfolio notes:", parsed.portfolio_notes);
        }
      } else {
        console.warn(
          "[Gemini] Response format not recognized:",
          Object.keys(parsed)
        );
        return [];
      }

      // Validate and enrich
      return rawSuggestions
        .filter((s) => s && s.action && s.symbol)
        .map((s) => {
          const holding = holdings.find(
            (h) => h.symbol === s.symbol || h.symbol === s.sell_symbol
          );

          const action = ["BUY", "SELL", "MOVE", "RAISE_CASH"].includes(
            s.action
          )
            ? s.action
            : "BUY";

          // Parse and validate citations if present
          let citations: Citation[] | undefined;
          if (Array.isArray(s.citations)) {
            citations = s.citations
              .filter(
                (c: any) =>
                  c && typeof c.type === "string" && typeof c.title === "string"
              )
              .map((c: any) => ({
                type: c.type,
                id: c.id,
                title: c.title,
                excerpt: c.excerpt,
                source: c.source,
                url: c.url,
              }));
          }

          return {
            symbol: s.symbol,
            stock_name: holding?.stock_name || s.symbol,
            action: action as "BUY" | "SELL" | "MOVE" | "RAISE_CASH",
            reason: s.rationale || s.reason || "No reason provided",
            rationale: s.rationale || s.reason,
            confidence:
              s.confidence ?? Math.round((s.technical_score || 80) / 10),
            quantity: s.quantity || 0,
            allocation_amount: s.allocation_amount,
            sell_symbol: s.sell_symbol,
            sell_quantity: s.sell_quantity,
            technical_score: s.technical_score,
            citations,
            portfolio_role: [
              "VALUE",
              "MOMENTUM",
              "CORE",
              "SPECULATIVE",
              "INCOME",
            ].includes(s.portfolio_role)
              ? (s.portfolio_role as PortfolioRole)
              : undefined,
          };
        });
    } catch (error) {
      console.error("[Gemini] Failed to parse response:", error);
      console.error("[Gemini] Raw text:", text.substring(0, 500));
      return [];
    }
  }

  /**
   * Placeholder for discovery feature
   */
  static async discoverNewStocks(_marketTrend: string): Promise<string[]> {
    return [];
  }
}
