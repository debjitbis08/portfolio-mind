import { GEMINI_API_KEY } from "astro:env/server";

// Removed top-level import to avoid Rollup build issues with @google/genai
// import { GoogleGenAI } from "@google/genai";

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
  action: "BUY" | "SELL" | "MOVE";
  confidence: number;
  reason: string;
  rationale?: string;
  quantity: number; // For BUY/SELL
  allocation_amount?: number; // For BUY/MOVE (Amount in INR)
  sell_symbol?: string; // For MOVE (Source of funds)
  sell_quantity?: number; // For MOVE
  technical_score?: number;
}

export class GeminiService {
  static async analyzePortfolio(
    holdings: HoldingForAnalysis[],
    availableFunds: number = 0
  ): Promise<Suggestion[]> {
    if (holdings.length === 0) return [];

    console.log("Analyzing portfolio with Gemini (New SDK)...");

    // Dynamic import to bypass build issues
    let GoogleGenAI;
    try {
      const module = await import("@google/genai");
      GoogleGenAI = module.GoogleGenAI;
    } catch (e) {
      console.error("Failed to load @google/genai SDK:", e);
      return [];
    }

    const dataClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    // Simplify holdings for prompt context
    const holdingsContext = holdings.map((h) => ({
      symbol: h.symbol,
      price: h.current_price,
      rsi: h.rsi_14,
      sma50_dev: h.price_vs_sma50,
      sma200_dev: h.price_vs_sma200,
      fundamentals: h.fundamentals
        ? {
            pe: h.fundamentals.peRatio,
            roe: h.fundamentals.roe,
          }
        : "N/A",
      story: h.qualitative ? h.qualitative.thesis_summary : "No forum intel",
    }));

    const systemPrompt = `You are an expert value investor acting as a Portfolio Copilot.
Available Cash: ₹${availableFunds.toLocaleString("en-IN")}

Strategy:
1. **Accumulate (BUY)**: Stocks in value territory (RSI < 40) AND Strong Fundamentals/Story.
2. **Trim/Exit (SELL)**: Stocks overextended (>15% above SMA200) OR Negative Story.
3. **Rebalance (MOVE)**: If cash is low, sell extended stocks to buy value picks.

Rules:
- **Story Validation**: If technicals are weak BUT "The Story" (Forum Thesis) is positive, consider Accumulating. If Story is negative, SELL.
- **Budgeting**: ensure BUY total <= (Available Cash + Proceeds from suggested SELLs).
- **Format**: Return a JSON array of specific actions.

Output Protocol: JSON Array ONLY.`;

    const userMessage = `Current Holdings: ${JSON.stringify(
      holdingsContext
    )}. Analyze and recommend actions.`;

    try {
      const response = await dataClient.models.generateContent({
        model: "gemini-1.5-flash",
        contents: [
          {
            role: "user",
            parts: [{ text: systemPrompt + "\n\n" + userMessage }],
          },
        ],
        config: {
          responseMimeType: "application/json",
        },
      });

      const text = response.text || "";

      if (!text) return [];

      const rawSuggestions = JSON.parse(text) as any[];

      // Validate and enrich
      return rawSuggestions.map((s) => {
        const holding = holdings.find(
          (h) => h.symbol === s.symbol || h.symbol === s.sell_symbol
        );
        // Map fields safely
        const action = ["BUY", "SELL", "MOVE"].includes(s.action)
          ? s.action
          : "BUY";

        return {
          symbol: s.symbol,
          stock_name: holding?.stock_name || s.symbol,
          action: action as any,
          reason: s.rationale || s.reason || "No reason provided",
          rationale: s.rationale || s.reason,
          confidence: s.technical_score || 80,
          quantity: s.quantity || 0,
          allocation_amount: s.allocation_amount,
          sell_symbol: s.sell_symbol,
          sell_quantity: s.sell_quantity,
        };
      });
    } catch (error) {
      console.error("Gemini analysis failed:", error);
      return [];
    }
  }

  static async discoverNewStocks(marketTrend: string): Promise<string[]> {
    return [];
  }
}
