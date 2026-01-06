/**
 * Gemini AI Service
 *
 * Provides agentic portfolio analysis with tool calling support.
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
        // Try to find array directly
        const arrayMatch = text.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          jsonStr = arrayMatch[0];
        }
      }

      const rawSuggestions = JSON.parse(jsonStr) as any[];

      if (!Array.isArray(rawSuggestions)) {
        console.warn("[Gemini] Response is not an array");
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
