/**
 * Catalyst Gemini Service
 *
 * AI service for short-term catalyst/swing trading decisions.
 * Has access to ALL existing research tools (ValuePickr, news, financials, etc.)
 * Operates on the CATALYST portfolio, separate from the long-term portfolio.
 */

import { GEMINI_API_KEY } from "astro:env/server";
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
import { eq, desc, inArray } from "drizzle-orm";

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
  entry_date?: string;
  catalyst_reason?: string; // Why this position was opened
}

export interface CatalystSuggestion {
  symbol: string;
  stock_name?: string;
  action: "BUY" | "SELL" | "HOLD";
  confidence: number; // 1-10
  rationale: string;
  quantity?: number;
  allocation_amount?: number;
  entry_price?: number;
  target_price?: number;
  stop_loss?: number;
  max_hold_days?: number; // Maximum holding period
  catalyst_type?: string; // News, earnings, sector rotation, etc.
  technical_score?: number;
  citations?: Citation[];
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

    // Build system prompt for short-term trading
    const systemPrompt = this.buildCatalystSystemPrompt(availableFunds);

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

    userMessage += `## Your Task

1. **PRIORITIZE BY SCORE**: Focus on catalysts with high potential scores (±7 or higher)
2. **REVIEW THESIS**: For each high-score catalyst, validate the thesis with tools:
   - \`get_stock_news\`: Confirm news momentum matches thesis
   - \`get_technicals\`: Check if entry timing is favorable (RSI, SMA levels)
   - \`get_financials\`: Quick earnings quality check before committing
3. **EVALUATE EXISTING POSITIONS**: Should any be exited based on catalyst updates?
4. **OUTPUT**: 1-3 actionable recommendations prioritized by potential score.

**Scoring Guide:**
- ±8 to ±10: High priority - validate and act quickly
- ±5 to ±7: Medium priority - validate before acting
- ±1 to ±4: Low priority - only if nothing better
- 0: Neutral - generally skip

**Remember:** This is SHORT-TERM trading (1-28 days). Focus on:
- Thesis-driven entries (from Pass 2 analysis)
- Quick exits on catalyst failure
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

        const suggestions = this.parseResponse(text, holdings);
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
  private static buildCatalystSystemPrompt(availableFunds: number): string {
    return `You are a SHORT-TERM SWING TRADER focused on catalyst-driven opportunities.
Your holding period is 1 day to 4 weeks maximum. This is SEPARATE from long-term investing.

## Your Trading Style
- **Event-driven**: News, earnings, sector rotation, policy changes
- **Technical confirmation**: Entry only when technicals align with catalyst
- **Quick exits**: Cut losses fast, take profits when momentum fades
- **Position sizing**: Max 20% of catalyst portfolio per position

## Available Cash
₹${availableFunds.toLocaleString(
      "en-IN"
    )} in the catalyst portfolio (separate from long-term funds)

## Your Tools (Full Access to Research Data)
- \`get_stock_news\`: **CRITICAL** - Find momentum catalysts, recent developments
- \`get_technicals\`: Entry/exit timing - RSI, SMA levels
- \`get_financials\`: Quick earnings quality check before entry
- \`get_stock_thesis\`: Fundamental backdrop from ValuePickr
- \`get_company_knowledge\`: User's own research and notes
- \`browse_screener\`: Find candidates from watchlist

## Trading Rules for Catalyst Portfolio
1. **Short holding period**: 1-28 days typical
2. **Catalyst required**: Every trade needs a clear catalyst (news, earnings, technical breakout)
3. **Stop-loss mandatory**: Define exit before entry
4. **Take profits**: Partial profits at technical resistance
5. **Cut failures fast**: Exit if catalyst thesis invalidated

## Output Format

Return suggestions as JSON:

\`\`\`json
[
  {
    "action": "BUY" | "SELL",
    "symbol": "STOCKNAME",
    "quantity": 10,
    "rationale": "Catalyst: [what]. Entry timing: [why now]. Risk: [what could go wrong].",
    "confidence": 7,
    "entry_price": 150.00,
    "target_price": 170.00,
    "stop_loss": 140.00,
    "max_hold_days": 14,
    "catalyst_type": "NEWS" | "EARNINGS" | "TECHNICAL" | "SECTOR",
    "technical_score": 75,
    "allocation_amount": 25000,
    "citations": [
      { "type": "news", "title": "Headline driving trade", "source": "ET" },
      { "type": "technicals", "title": "RSI 40, near SMA50 support" }
    ]
  }
]
\`\`\`

**Field Definitions:**
- \`entry_price\`: Current/target entry price
- \`target_price\`: Where to take profits
- \`stop_loss\`: Exit point if trade goes wrong
- \`max_hold_days\`: Maximum days to hold before re-evaluation
- \`catalyst_type\`: What's driving this trade

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
            action: ["BUY", "SELL", "HOLD"].includes(s.action)
              ? s.action
              : "BUY",
            confidence: s.confidence ?? 5,
            rationale: s.rationale || "No rationale provided",
            quantity: s.quantity,
            allocation_amount: s.allocation_amount,
            entry_price: s.entry_price,
            target_price: s.target_price,
            stop_loss: s.stop_loss,
            max_hold_days: s.max_hold_days,
            catalyst_type: s.catalyst_type,
            technical_score: s.technical_score,
            citations,
          } as CatalystSuggestion;
        });
    } catch (error) {
      console.error("[Catalyst Gemini] Failed to parse response:", error);
      console.error("[Catalyst Gemini] Raw text:", text.substring(0, 500));
      return [];
    }
  }

  /**
   * Quick analysis of a specific catalyst signal.
   * Called when a new signal is generated to get AI's take.
   */
  static async analyzeSignal(
    signal: {
      ticker: string;
      newsTitle: string;
      sentiment: string;
      impactType: string;
      confidence: number;
    },
    availableFunds: number = 0
  ): Promise<CatalystSuggestion | null> {
    clearRequestCache();

    let GoogleGenAI: any;
    try {
      const module = await import("@google/genai");
      GoogleGenAI = module.GoogleGenAI;
    } catch (e) {
      console.error("Failed to load @google/genai SDK:", e);
      return null;
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    // Quick prompt for signal analysis
    const prompt = `You are a swing trader evaluating a catalyst signal.

## Signal
- **Stock**: ${signal.ticker}
- **News**: ${signal.newsTitle}
- **Sentiment**: ${signal.sentiment}
- **Impact Type**: ${signal.impactType}
- **Confidence**: ${signal.confidence}/10

## Available Cash
₹${availableFunds.toLocaleString("en-IN")}

## Task
Should we act on this signal? Give a quick recommendation.

Return JSON:
\`\`\`json
{
  "action": "BUY" | "HOLD" | "PASS",
  "symbol": "${signal.ticker}",
  "rationale": "Why or why not to act",
  "confidence": 7,
  "target_price": 0,
  "stop_loss": 0,
  "allocation_amount": 0
}
\`\`\``;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { responseMimeType: "application/json" },
      });

      const text = response.text || "";
      const parsed = JSON.parse(text);

      if (parsed.action === "PASS") {
        return null;
      }

      return {
        symbol: parsed.symbol || signal.ticker,
        action: parsed.action || "HOLD",
        confidence: parsed.confidence || 5,
        rationale: parsed.rationale || "Signal-based trade",
        target_price: parsed.target_price,
        stop_loss: parsed.stop_loss,
        allocation_amount: parsed.allocation_amount,
      };
    } catch (error) {
      console.error("[Catalyst Gemini] Signal analysis failed:", error);
      return null;
    }
  }
}
