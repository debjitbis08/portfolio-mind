/**
 * Catalyst Gemini Service
 *
 * AI service for short-term catalyst/swing trading decisions.
 * Has access to ALL existing research tools (ValuePickr, news, financials, etc.)
 * Operates on the CATALYST portfolio, separate from the long-term portfolio.
 */

import {
  getEnabledToolDeclarations,
  getMergedToolConfig,
  executeTool,
  clearRequestCache,
  type ToolResponse,
  type ToolConfig,
  type Citation,
} from "../tools";
import { db, schema, getCatalystHoldings, type Holding } from "../db";
import { eq, desc, inArray, and, gte } from "drizzle-orm";
import { getRequiredEnv } from "../env";
import {
  getMarketStatusMessage,
  getMarketMode,
  getMarketModeDescriptor,
  type MarketMode,
} from "./market-hours";
import type { CatalystPerformanceMetrics } from "./performance-metrics";

function getGeminiApiKey(): string {
  return getRequiredEnv("GEMINI_API_KEY");
}

type MarketModeDescriptor = ReturnType<typeof getMarketModeDescriptor>;

// ============================================================================
// Types
// ============================================================================

export interface CatalystHoldingForAnalysis {
  symbol: string;
  stock_name: string;
  quantity: number;
  avg_buy_price: number;
  current_price: number;
  returns_percent: number;
  rsi_14: number | null;
  price_vs_sma50: number | null;
  price_vs_sma200: number | null;
  adv_10d?: number | null;
  entry_date?: string;
  catalyst_reason?: string; // Why this position was opened
}

export interface CatalystSuggestion {
  symbol: string;
  stock_name?: string;
  action: "BUY" | "SELL" | "HOLD" | "WATCH";
  confidence: number; // 1-10
  rationale: string;
  quantity?: number;
  allocation_amount?: number;
  entry_price?: number;
  target_price?: number;
  stop_loss?: number;
  min_hold_hours?: number; // Minimum hold time before exit (unless stop hits)
  max_hold_days?: number; // Maximum holding period
  catalyst_type?: string; // News, earnings, sector rotation, etc.
  technical_score?: number;
  citations?: Citation[];

  // New catalyst-specific fields
  risk_reward_ratio?: number; // Calculated RRR (target - entry) / (entry - stop)
  trailing_stop?: boolean; // Dynamic vs fixed stop
  entry_trigger?: string; // e.g., "Break of HOD", "Limit at VWAP"
  exit_condition?: string; // Event-based exit, e.g., "Exit Jan 14 pre-open"
  volatility_at_entry?: number; // ATR for stop calibration review
  catalyst_id?: string; // Links to potentialCatalysts.id
}

export interface CatalystToolCallProgress {
  tool: string;
  args: Record<string, unknown>;
  result?: ToolResponse;
}

export type CatalystProgressCallback = (
  progress: number,
  message: string,
  toolCall?: CatalystToolCallProgress
) => void;

// ============================================================================
// Catalyst Gemini Service
// ============================================================================

export class CatalystGeminiService {
  private static MAX_TOOL_ITERATIONS = 8;

  /**
   * Analyze catalyst portfolio with short-term trading lens.
   * Uses same tools as main portfolio but different prompts focused on swing trading.
   */
  static async analyzeCatalystPortfolio(
    holdings: CatalystHoldingForAnalysis[],
    availableFunds: number = 0,
    performanceMetrics: CatalystPerformanceMetrics | null,
    onProgress?: CatalystProgressCallback,
    toolConfig?: ToolConfig | null
  ): Promise<CatalystSuggestion[]> {
    // Clear request cache at start of cycle
    clearRequestCache();

    const progress = (
      pct: number,
      msg: string,
      tc?: CatalystToolCallProgress
    ) => {
      console.log(`[Catalyst Gemini] ${pct}% - ${msg}`);
      onProgress?.(pct, msg, tc);
    };

    progress(5, "Initializing Catalyst AI agent...");

    const marketDescriptor = getMarketModeDescriptor();

    // Dynamic import to bypass build issues
    let GoogleGenAI: any;
    try {
      const module = await import("@google/genai");
      GoogleGenAI = module.GoogleGenAI;
    } catch (e) {
      console.error("Failed to load @google/genai SDK:", e);
      return [];
    }

    const ai = new GoogleGenAI({ apiKey: getGeminiApiKey() });

    const totalHoldingsValue = holdings.reduce(
      (sum, holding) => sum + holding.current_price * holding.quantity,
      0
    );
    const totalCapital = totalHoldingsValue + availableFunds;

    // Build system prompt for short-term trading
    const systemPrompt = this.buildCatalystSystemPrompt(
      availableFunds,
      marketDescriptor,
      totalCapital
    );

    // Build holdings context
    const holdingsContext = holdings.map((h) => ({
      symbol: h.symbol,
      name: h.stock_name,
      quantity: h.quantity,
      avg_price: h.avg_buy_price,
      current_price: h.current_price,
      returns_pct: h.returns_percent?.toFixed(1),
      rsi: h.rsi_14,
      vs_sma50: h.price_vs_sma50 ? `${h.price_vs_sma50.toFixed(1)}%` : null,
      adv_10d: h.adv_10d ?? null,
      entry_date: h.entry_date,
      catalyst_reason: h.catalyst_reason,
    }));

    // Fetch active potential catalysts with thesis data (from Pass 2)
    progress(8, "Fetching potential catalysts with thesis...");
    const potentialCatalystsData = await db
      .select()
      .from(schema.potentialCatalysts)
      .where(eq(schema.potentialCatalysts.status, "monitoring"))
      .orderBy(desc(schema.potentialCatalysts.updatedAt))
      .limit(20);

    // Fetch pending catalyst suggestions
    const pendingSuggestions = await db
      .select()
      .from(schema.suggestions)
      .where(eq(schema.suggestions.portfolioType, "CATALYST"))
      .orderBy(desc(schema.suggestions.createdAt))
      .limit(10);

    const pendingContext = pendingSuggestions.filter(
      (s) => s.status === "pending"
    );

    const recentCutoff = new Date();
    recentCutoff.setDate(recentCutoff.getDate() - 7);

    const approvedSuggestions = await db
      .select()
      .from(schema.suggestions)
      .where(
        and(
          eq(schema.suggestions.portfolioType, "CATALYST"),
          eq(schema.suggestions.status, "approved"),
          gte(schema.suggestions.createdAt, recentCutoff.toISOString())
        )
      )
      .orderBy(desc(schema.suggestions.createdAt))
      .limit(10);

    const recentTrades = await db
      .select()
      .from(schema.intradayTransactions)
      .where(
        and(
          eq(schema.intradayTransactions.portfolioType, "CATALYST"),
          gte(schema.intradayTransactions.executedAt, recentCutoff.toISOString())
        )
      )
      .orderBy(desc(schema.intradayTransactions.executedAt))
      .limit(15);

    // Build user message
    let userMessage = `## Catalyst Portfolio Analysis

### Current Positions
${
  holdings.length > 0
    ? JSON.stringify(holdingsContext, null, 2)
    : "No current positions in catalyst portfolio."
}

### Available Cash
₹${availableFunds.toLocaleString("en-IN")}

### Total Catalyst Capital
₹${totalCapital.toLocaleString("en-IN")}

### Market Status
${getMarketStatusMessage()}

### Market Mode
${marketDescriptor.mode} — ${marketDescriptor.botMode}
Output focus: ${marketDescriptor.outputType}

### Trading Cost Impact (Recent Realized)
${
  performanceMetrics
    ? JSON.stringify(
        {
          impactRatioPercent: performanceMetrics.impactRatioPercent,
          efficiencyPercent: performanceMetrics.efficiencyPercent,
          efficiencyGrade: performanceMetrics.efficiencyGrade,
          avgSellCharges: performanceMetrics.avgSellCharges,
          avgDpChargePerSell: performanceMetrics.avgDpChargePerSell,
          breakevenCapital: performanceMetrics.breakevenCapital,
          grossExpectancyR: performanceMetrics.grossExpectancyR,
          netExpectancyR: performanceMetrics.expectancyR,
        },
        null,
        2
      )
    : "No realized trade metrics yet."
}

`;

    // Add potential catalysts with thesis (from Pass 2)
    if (potentialCatalystsData.length > 0) {
      userMessage += `### 🎯 Active Catalyst Opportunities (Pass 2 Thesis)
These are AI-analyzed catalysts with trading thesis and potential scores:

${potentialCatalystsData
  .filter((c) => c.shortTermThesis) // Only show catalysts with thesis
  .map((c) => {
    const symbols = JSON.parse(c.affectedSymbols || "[]") as string[];
    const scoreEmoji =
      (c.potentialScore || 0) > 0
        ? "📈"
        : (c.potentialScore || 0) < 0
        ? "📉"
        : "➖";
    const score = c.potentialScore || 0;
    return `- **${
      c.primaryTicker || symbols[0] || "Unknown"
    }** ${scoreEmoji} Score: ${score > 0 ? "+" : ""}${score}/10
  **ID**: ${c.id}
  **Thesis**: ${c.shortTermThesis}
  **Sentiment**: ${c.sentiment || "NEUTRAL"} | **Confidence**: ${
      c.confidence || 5
    }/10
  **Affected**: ${symbols.join(", ")}
  **Updated**: ${new Date(c.updatedAt || "").toLocaleString()}`;
  })
  .join("\n\n")}

`;
    }

    // Add pending suggestions if any
    if (pendingContext.length > 0) {
      userMessage += `### ⏳ Pending Suggestions (Review Required)
${pendingContext
  .map(
    (s) =>
      `- **${s.symbol}**: ${s.action} - ${s.rationale}
  Created: ${new Date(s.createdAt || "").toLocaleDateString()}`
  )
  .join("\n\n")}

`;
    }

    if (approvedSuggestions.length > 0) {
      userMessage += `### ✅ Recently Executed Suggestions (Last 7 Days)
These were marked as executed. Avoid duplicating trades unless new info changes the thesis.

${approvedSuggestions
  .map(
    (s) =>
      `- **${s.symbol}**: ${s.action} - ${s.rationale}
  Created: ${new Date(s.createdAt || "").toLocaleDateString()}`
  )
  .join("\n\n")}

`;
    }

    if (recentTrades.length > 0) {
      userMessage += `### 🧾 Recent Manual Trades (Last 7 Days)
These trades were entered manually. Do not recommend the same trade again unless thesis changes.

${recentTrades
  .map(
    (t) =>
      `- **${t.symbol}**: ${t.type} ${t.quantity} @ ₹${t.pricePerShare}
  Executed: ${new Date(t.executedAt || "").toLocaleDateString()}`
  )
  .join("\n\n")}

`;
    }

    userMessage += `## Your Task

1. **PRIORITIZE BY SCORE**: Focus on catalysts with high potential scores (±7 or higher)
2. **REVIEW THESIS**: For each high-score catalyst, validate the thesis with tools:
   - \`get_stock_news\`: Confirm news momentum matches thesis
   - \`get_technicals\`: Check if entry timing is favorable (RSI, SMA levels)
   - \`get_financials\`: Quick earnings quality check before committing
3. **EVALUATE EXISTING POSITIONS**: Should any be exited based on catalyst updates?
4. **AVOID DUPLICATES**: Do not repeat trades already executed in the last 7 days unless the thesis materially changed.
5. **OUTPUT**: 1-3 actionable recommendations prioritized by potential score.

**Scoring Guide:**
- ±8 to ±10: High priority - validate and act quickly
- ±5 to ±7: Medium priority - validate before acting
- ±1 to ±4: Low priority - only if nothing better
- 0: Neutral - generally skip

**Remember:** This is multi-day swing trading (2-28 days). Focus on:
- Thesis-driven entries (from Pass 2 analysis)
- Trend-following exits (ATR trailing stop + indicator exhaustion)
- Position sizing (max 20% per position)`;

    // Build config with ALL tools enabled
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

      // Agentic loop with tool calling
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
          // Add model's response
          const modelParts = response.candidates?.[0]?.content?.parts;
          if (modelParts) {
            contents.push({
              role: "model",
              parts: modelParts,
            });
          }

          // Process function calls
          const functionResponses: any[] = [];

          for (const call of functionCalls) {
            const pct = 20 + iterations * 10;
            progress(Math.min(pct, 80), `🔧 ${call.name}(...)`, {
              tool: call.name,
              args: call.args,
            });

            // Execute the tool
            const result = await executeTool(call.name, call.args || {});

            progress(
              Math.min(pct + 5, 85),
              `   → ${result.success ? "✓" : "✗"} ${
                result.success ? "Success" : result.error?.message
              }`,
              { tool: call.name, args: call.args, result }
            );

            functionResponses.push({
              functionResponse: {
                name: call.name,
                response: result.success ? result.data : result.error,
              },
            });
          }

          // Add function responses
          contents.push({
            role: "user",
            parts: functionResponses,
          });

          continue;
        }

        // No function calls - final response
        progress(90, "Agent completed, parsing suggestions...");

        const text = response.text || "";
        if (!text) {
          console.warn("[Catalyst Gemini] Empty response text");
          return [];
        }

        let suggestions = this.parseResponse(text, holdings);
        if (marketDescriptor.mode !== "OPEN") {
          suggestions = suggestions.map((s) => ({ ...s, action: "WATCH" }));
        }
        if (marketDescriptor.mode === "PRE_OPEN" && suggestions.length > 3) {
          suggestions = suggestions.slice(0, 3);
        }
        progress(100, `Found ${suggestions.length} catalyst suggestions`);

        return suggestions;
      }

      // Hit iteration limit
      console.warn("[Catalyst Gemini] Hit max tool iterations");
      progress(100, "Completed (iteration limit reached)");
      return [];
    } catch (error) {
      console.error("Catalyst Gemini analysis failed:", error);
      progress(
        100,
        `Error: ${error instanceof Error ? error.message : "Unknown"}`
      );
      return [];
    }
  }

  /**
   * Build system prompt focused on short-term catalyst trading.
   */
  private static buildCatalystSystemPrompt(
    availableFunds: number,
    marketDescriptor: MarketModeDescriptor,
    totalCapital: number
  ): string {
    const offMarket = marketDescriptor.mode !== "OPEN";

    return `You are a SHORT-TERM SWING TRADER focused on catalyst-driven opportunities.
Your holding period is 2 days to 4 weeks maximum. This is SEPARATE from long-term investing.

## Your Trading Style
- **Event-driven**: News, earnings, sector rotation, policy changes
- **Technical confirmation**: Entry only when technicals align with catalyst
- **Trend retention**: Prefer trailing stops and indicator exhaustion over fixed targets
- **Position sizing**: Max 20% of catalyst portfolio per position

## Available Cash
₹${availableFunds.toLocaleString(
      "en-IN"
    )} in the catalyst portfolio (separate from long-term funds)

## Total Catalyst Capital
₹${totalCapital.toLocaleString("en-IN")} (holdings market value + cash)

## Market Mode
${marketDescriptor.mode} — ${marketDescriptor.botMode}
Output focus: ${marketDescriptor.outputType}

${offMarket ? "## Off-Market Execution Rules" : "## Market-Open Execution Rules"}
${offMarket ? "- Do NOT output BUY/SELL/HOLD. Use WATCH entries only." : "- BUY/SELL/HOLD allowed when criteria are met."}
${offMarket ? "- Treat output as Tomorrow's Watchlist or Pre-Market Briefing." : "- Act only on high-conviction, well-timed setups."}
${offMarket ? "- Include a gap plan in entry_trigger (e.g., \"If open > 3% gap...\")." : "- Use technical triggers for intraday confirmation."}
${offMarket ? "- If catalyst is 10/10, mention AMO suggestion with liquidity risk in rationale." : "- Ensure stop-loss and risk-reward are valid."}

## Your Tools (Full Access to Research Data)
- \`get_stock_news\`: **CRITICAL** - Find momentum catalysts, recent developments
- \`get_technicals\`: Entry/exit timing - RSI, SMA levels
- \`get_financials\`: Quick earnings quality check before entry
- \`get_stock_thesis\`: Fundamental backdrop from ValuePickr
- \`get_company_knowledge\`: User's own research and notes
- \`browse_screener\`: Find candidates from watchlist

## Trading Rules for Catalyst Portfolio
1. **Minimum hold time**: Default min_hold_hours = 48 (unless stop-loss is hit)
2. **Catalyst required**: Every trade needs a clear catalyst (news, earnings, technical breakout)
3. **Hybrid exit engine**:
   - Phase 1 (first 48h): 3.0x ATR Chandelier trailing stop below highest high.
   - Phase 2 (if profit >= 3%): switch to 20-day EMA exit (or tighten to 1.5x ATR).
   - Phase 3 (if RSI > 75): tighten stop to 9-day EMA.
4. **Liquidity guard (ADV)**: Position size must be <= 1% of 20D ADV (use adv_10d as proxy if 20D not available).
5. **Volume sanity check**: If a stock spikes +5% early with volume < 2% of ADV, treat as a retail trap.
6. **Exit warning**: If exits are triggering but volume < 50% of ADV, tighten the trailing stop immediately.
7. **No fixed profit targets**: target_price is a projected move for R math, not a hard exit
8. **Friction-aware R**: Only enter trades where projected profit >= 10x avgSellCharges
9. **Earnings gap risk**: Avoid holding through earnings; prefer exit before results day
10. **Rotation allowed**: If cash is insufficient but conviction is high, recommend a SELL to fund the BUY

## Output Format

Return suggestions as JSON:

\`\`\`json
[
  {
    "action": "BUY" | "SELL" | "HOLD" | "WATCH",
    "symbol": "STOCKNAME",
    "quantity": 10,
    "rationale": "Catalyst: [what]. Entry timing: [why now]. Risk: [what could go wrong].",
    "confidence": 7,
    "entry_price": 150.00,
    "target_price": 170.00,
    "stop_loss": 140.00,
    "min_hold_hours": 48,
    "max_hold_days": 14,
    "catalyst_type": "NEWS" | "EARNINGS" | "TECHNICAL" | "SECTOR",
    "technical_score": 75,
    "allocation_amount": 25000,
    "risk_reward_ratio": 2.0,
    "trailing_stop": false,
    "entry_trigger": "Break of HOD with volume",
    "exit_condition": "Phase 1: 3x ATR Chandelier (48h). Phase 2: 20 EMA if +3%. Phase 3: 9 EMA if RSI > 75. Exit before earnings.",
    "volatility_at_entry": 3.5,
    "catalyst_id": "uuid-if-linked-to-potential-catalyst",
    "citations": [
      { "type": "news", "title": "Headline driving trade", "source": "ET" },
      { "type": "technicals", "title": "RSI 40, near SMA50 support" }
    ]
  }
]
\`\`\`

**Field Definitions:**
- \`entry_price\`: Current/target entry price
- \`target_price\`: Projected move for R math (not a hard exit target)
- \`stop_loss\`: Exit point if trade goes wrong (REQUIRED)
- \`min_hold_hours\`: Minimum time to hold unless stop_loss is hit
- \`max_hold_days\`: Maximum days to hold before re-evaluation
- \`catalyst_type\`: What's driving this trade
- \`risk_reward_ratio\`: (target - entry) / (entry - stop), should be >= 2.0
- \`trailing_stop\`: true for dynamic stop, false for fixed
- \`entry_trigger\`: Specific condition to enter (e.g., "Break of HOD", "Limit at VWAP")
- \`exit_condition\`: Event-based exit criteria (e.g., "Exit Jan 14 pre-open")
- \`volatility_at_entry\`: ATR value for position sizing context
- \`catalyst_id\`: Link to potential catalyst ID if applicable. Use the exact ID listed in "Active Catalyst Opportunities" and never invent or guess.

If no HIGH CONVICTION setups → return empty array: []
Better to stay in cash than force a trade.`;
  }

  /**
   * Parse the response to extract catalyst suggestions.
   */
  private static parseResponse(
    text: string,
    holdings: CatalystHoldingForAnalysis[]
  ): CatalystSuggestion[] {
    try {
      let jsonStr = text;

      // Look for JSON block
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      } else {
        const arrayMatch = text.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          jsonStr = arrayMatch[0];
        }
      }

      const parsed = JSON.parse(jsonStr);
      const rawSuggestions = Array.isArray(parsed) ? parsed : [];

      return rawSuggestions
        .filter((s) => s && s.action && s.symbol)
        .map((s) => {
          const holding = holdings.find((h) => h.symbol === s.symbol);

          // Parse citations if present
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
            action: ["BUY", "SELL", "HOLD", "WATCH"].includes(s.action)
              ? s.action
              : "WATCH",
            confidence: s.confidence ?? 5,
            rationale: s.rationale || "No rationale provided",
            quantity: s.quantity,
            allocation_amount: s.allocation_amount,
            entry_price: s.entry_price,
            target_price: s.target_price,
            stop_loss: s.stop_loss,
            min_hold_hours: s.min_hold_hours,
            max_hold_days: s.max_hold_days,
            catalyst_type: s.catalyst_type,
            technical_score: s.technical_score,
            citations,
            // New catalyst-specific fields
            risk_reward_ratio: s.risk_reward_ratio,
            trailing_stop: s.trailing_stop,
            entry_trigger: s.entry_trigger,
            exit_condition: s.exit_condition,
            volatility_at_entry: s.volatility_at_entry,
            catalyst_id: s.catalyst_id,
          } as CatalystSuggestion;
        });
    } catch (error) {
      console.error("[Catalyst Gemini] Failed to parse response:", error);
      console.error("[Catalyst Gemini] Raw text:", text.substring(0, 500));
      return [];
    }
  }

  /**
   * Portfolio-aware analysis of a confirmed catalyst signal.
   * Called when a signal is confirmed to determine if we should create a suggestion.
   *
   * Takes into account:
   * - Available catalyst cash
   * - Current catalyst holdings (exposure check)
   * - Recent trades (washout rule)
   */
  static async analyzeSignal(
    signal: {
      ticker: string;
      newsTitle: string;
      sentiment: string;
      impactType: string;
      confidence: number;
    },
    portfolioContext: {
      availableFunds: number;
      currentHoldings: Array<{
        symbol: string;
        stock_name: string;
        quantity: number;
        avg_buy_price: number;
        current_price: number;
        returns_percent: number;
      }>;
      recentTrades: Array<{
        symbol: string;
        type: string;
        pricePerShare: number;
        executedAt: string;
      }>;
    }
  ): Promise<CatalystSuggestion | null> {
    clearRequestCache();

    const marketMode = getMarketMode();
    if (marketMode !== "OPEN") {
      console.log(
        `[Catalyst Gemini] Skipping signal analysis (${marketMode} mode)`
      );
      return null;
    }

    let GoogleGenAI: any;
    try {
      const module = await import("@google/genai");
      GoogleGenAI = module.GoogleGenAI;
    } catch (e) {
      console.error("Failed to load @google/genai SDK:", e);
      return null;
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    // Build holdings context
    const holdingsText =
      portfolioContext.currentHoldings.length > 0
        ? portfolioContext.currentHoldings
            .map(
              (h) =>
                `- ${h.symbol}: ${
                  h.quantity
                } shares @ ₹${h.avg_buy_price.toFixed(2)} (${
                  h.returns_percent >= 0 ? "+" : ""
                }${h.returns_percent.toFixed(1)}%)`
            )
            .join("\n")
        : "No current positions";

    // Build recent trades context
    const recentTradesText =
      portfolioContext.recentTrades.length > 0
        ? portfolioContext.recentTrades
            .slice(0, 5)
            .map(
              (t) =>
                `- ${t.type} ${t.symbol} @ ₹${t.pricePerShare} (${new Date(
                  t.executedAt
                ).toLocaleDateString()})`
            )
            .join("\n")
        : "No recent trades";

    // Portfolio-aware prompt with safety protocols
    const prompt = `You are a SHORT-TERM SWING TRADER evaluating a confirmed catalyst signal.
Holding period: 2-28 days. This is the CATALYST portfolio, separate from long-term.

## Confirmed Signal
- **Stock**: ${signal.ticker}
- **News**: ${signal.newsTitle}
- **Sentiment**: ${signal.sentiment}
- **Impact Type**: ${signal.impactType}
- **Signal Confidence**: ${signal.confidence}/10

## Your Current CATALYST Portfolio
${holdingsText}
Total positions: ${portfolioContext.currentHoldings.length}

## Available CATALYST Cash
₹${portfolioContext.availableFunds.toLocaleString("en-IN")}

## Recent Catalyst Trades (Last 7 Days)
${recentTradesText}

## Catalyst Portfolio Rules (Safety Protocols)
1. **Dispassionate Execution**: You are the emotional buffer. Ignore hype; focus on volume and structure.
2. **Minimum hold time**: Default min_hold_hours = 48 unless stop-loss is hit.
3. **The 2:1 Rule**: Only recommend "BUY" if Reward:Risk ratio >= 2.0.
4. **Hybrid exits**: Use trailing_stop with ATR/EMA phases and RSI tightening.
5. **Friction-aware R**: Target profit must be >= 10x estimated charges (₹35-45).
6. **Concentration Guard**: Max 20% per position; Max 5 total positions.
7. **Washout Rule**: Do not re-enter a stock within 3 days of an exit, even if a new catalyst appears.
8. **Cash Check**: No cash = No buy. Don't recommend if funds are insufficient.

## Task
Evaluate if this signal warrants capital deployment.

Return JSON:
\`\`\`json
{
  "action": "BUY" | "HOLD" | "PASS",
  "symbol": "${signal.ticker}",
  "rationale": "Why this fits or doesn't fit the catalyst portfolio NOW",
  "confidence": 7,
  "quantity": 50,
  "allocation_amount": 15000,
  "entry_price": 300.00,
  "target_price": 330.00,
  "stop_loss": 285.00,
  "min_hold_hours": 48,
  "max_hold_days": 14,
  "trailing_stop": true,
  "exit_condition": "Exit on RSI < 65 or 9 EMA < 21 EMA; avoid earnings week"
}
\`\`\`

Return action="PASS" if:
- Portfolio is full (5 positions) or cash is insufficient
- The news is already "priced in"
- The Stop Loss is too wide to maintain a 2:1 ratio
- Washout rule applies (recently exited this stock)`;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { responseMimeType: "application/json" },
      });

      const text = response.text || "";
      const parsed = JSON.parse(text);

      if (parsed.action === "PASS") {
        console.log(
          `[Catalyst Gemini] PASS: ${parsed.rationale || "No reason given"}`
        );
        return null;
      }

      return {
        symbol: parsed.symbol || signal.ticker,
        action: parsed.action || "HOLD",
        confidence: parsed.confidence || 5,
        rationale: parsed.rationale || "Signal-based trade",
        quantity: parsed.quantity,
        allocation_amount: parsed.allocation_amount,
        entry_price: parsed.entry_price,
        target_price: parsed.target_price,
        stop_loss: parsed.stop_loss,
        min_hold_hours: parsed.min_hold_hours,
        max_hold_days: parsed.max_hold_days,
        trailing_stop: parsed.trailing_stop,
        exit_condition: parsed.exit_condition,
        risk_reward_ratio: parsed.risk_reward_ratio,
        volatility_at_entry: parsed.volatility_at_entry,
      };
    } catch (error) {
      console.error("[Catalyst Gemini] Signal analysis failed:", error);
      return null;
    }
  }
}
