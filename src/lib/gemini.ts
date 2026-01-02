/**
 * Gemini AI Service
 * Uses Gemini 2.5 Flash for portfolio analysis and suggestion generation
 */

import { GoogleGenAI } from "@google/genai";
import { GEMINI_API_KEY } from "astro:env/server";

// Initialize Gemini client using type-safe env vars
const getGeminiClient = () => {
  return new GoogleGenAI({ apiKey: GEMINI_API_KEY });
};

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
}

export interface Suggestion {
  symbol: string;
  stock_name: string;
  action: "BUY" | "HOLD" | "WATCH";
  rationale: string;
  technical_score: number;
  // New fields, made optional as not all actions will have all fields
  quantity?: number;
  allocation_amount?: number;
  sell_symbol?: string;
  sell_quantity?: number;
}

/**
 * Analyze portfolio holdings and generate suggestions
 */
export async function analyzePortfolio(
  holdings: HoldingForAnalysis[],
  availableFunds: number = 0
): Promise<Suggestion[]> {
  const ai = getGeminiClient();

  // simplified holdings for context
  const holdingsContext = holdings.map((h) => ({
    symbol: h.symbol,
    currentPrice: h.current_price,
    value: h.quantity * h.current_price,
    rsi: h.rsi_14?.toFixed(0) || "N/A",
    vsSMA50: h.price_vs_sma50 ? `${h.price_vs_sma50.toFixed(1)}%` : "N/A",
    vsSMA200: h.price_vs_sma200 ? `${h.price_vs_sma200.toFixed(1)}%` : "N/A",
    waitZone: h.is_wait_zone,
    waitReasons: h.wait_reasons,
  }));

  const prompt = `You are an expert value investor managing a portfolio.

## Portfolio Context
- Available Cash: ₹${availableFunds.toLocaleString("en-IN")}
- Current Holdings: ${JSON.stringify(holdingsContext)}

## Strategy: Actionable Value Investing
1. **Accumulate** stocks in value territory (RSI < 40, near SMAs).
2. **Trim/Exit** stocks that are overextended (>15% above SMA200) or breaking down.
3. **Rebalance (MOVE)**: If cash is low, suggest selling extended stocks to buy value stocks.

## Rules
- **IGNORE** stocks that are just "Hold" or "Wait". ONLY output actionable trades.
- **Budgeting**: Ensure total BUY recommendations do not exceed (Available Cash + Proceeds from suggested SELLs).
- **Format**: Return a JSON array of specific actions.

## Action Types
- **BUY**: Strong buy signal. Specify quantity based on budget.
- **SELL**: Weak technicals or overextended. Specify quantity to sell.
- **MOVE**: Rebalance. Sell Stock A to Buy Stock B.

## Output Format (JSON Only)
[
  {
    "action": "BUY",
    "symbol": "STOCK",
    "quantity": 10,
    "allocation_amount": 5000,
    "rationale": "RSI 35, support at SMA200",
    "technical_score": 85
  },
  {
    "action": "SELL",
    "symbol": "STOCK",
    "quantity": 5,
    "rationale": "Extended 20% above SMA200",
    "technical_score": 20
  },
  {
    "action": "MOVE",
    "symbol": "BUY_STOCK", // The stock to buy
    "sell_symbol": "SELL_STOCK", // The stock to sell
    "quantity": 10, // Buy qty
    "sell_quantity": 5, // Sell qty
    "rationale": "Switching from overbought RELIANCE to value pick ZOMATO",
    "technical_score": 90
  }
]`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const text = response.text || "";

    // Extract JSON
    let jsonStr = text;
    if (text.includes("```json")) {
      jsonStr = text.split("```json")[1].split("```")[0].trim();
    } else if (text.includes("```")) {
      jsonStr = text.split("```")[1].split("```")[0].trim();
    }

    const rawSuggestions = JSON.parse(jsonStr) as any[];

    // Validate and enrich
    return rawSuggestions.map((s) => {
      const holding = holdings.find(
        (h) => h.symbol === s.symbol || h.symbol === s.sell_symbol
      );
      return {
        symbol: s.symbol,
        stock_name: holding?.stock_name || s.symbol, // Use the stock_name from holding if available
        action: s.action,
        rationale: s.rationale,
        technical_score: s.technical_score,
        // New fields
        quantity: s.quantity,
        allocation_amount: s.allocation_amount,
        sell_symbol: s.sell_symbol,
        sell_quantity: s.sell_quantity,
      };
    }) as Suggestion[];
  } catch (error) {
    console.error("Gemini analysis failed:", error);
    throw error;
  }
}

/**
 * Generate discovery suggestions for new stocks to watch
 * (Kept for compatibility, can be integrated later)
 */
export async function discoverNewStocks(
  existingSymbols: string[]
): Promise<string[]> {
  return []; // Placeholder for now
}
