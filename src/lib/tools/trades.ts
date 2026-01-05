/**
 * Recent Trades Tool
 *
 * Provides the AI agent visibility into recent buy/sell transactions.
 * Helps the agent understand trading activity and avoid recommending
 * stocks that were recently traded.
 */

import { db } from "../db";
import * as schema from "../db/schema";
import { registerToolExecutor, type ToolResponse } from "./registry";
import { desc, gte, eq, and, sql } from "drizzle-orm";

interface TradeResult {
  symbol: string;
  stockName: string;
  type: "BUY" | "SELL" | "OPENING_BALANCE";
  quantity: number;
  value: number;
  pricePerShare: number;
  executedAt: string;
  daysAgo: number;
}

async function getRecentTrades(args: {
  symbol?: string;
  days_back?: number;
}): Promise<ToolResponse> {
  const daysBack = Math.min(Math.max(args.days_back ?? 30, 1), 365);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);
  const cutoffIso = cutoffDate.toISOString();

  try {
    // Build query conditions
    const conditions = [
      gte(schema.transactions.executedAt, cutoffIso),
      eq(schema.transactions.status, "Executed"),
    ];

    if (args.symbol) {
      conditions.push(
        eq(schema.transactions.symbol, args.symbol.toUpperCase())
      );
    }

    // Query transactions
    const trades = await db
      .select({
        symbol: schema.transactions.symbol,
        stockName: schema.transactions.stockName,
        type: schema.transactions.type,
        quantity: schema.transactions.quantity,
        value: schema.transactions.value,
        executedAt: schema.transactions.executedAt,
      })
      .from(schema.transactions)
      .where(and(...conditions))
      .orderBy(desc(schema.transactions.executedAt))
      .limit(50);

    if (trades.length === 0) {
      return {
        success: true,
        data: {
          message: args.symbol
            ? `No trades found for ${args.symbol} in the last ${daysBack} days.`
            : `No trades found in the last ${daysBack} days.`,
          trades: [],
          summary: { totalBuys: 0, totalSells: 0, uniqueSymbols: 0 },
        },
      };
    }

    // Calculate days ago and price per share
    const now = new Date();
    const formattedTrades: TradeResult[] = trades.map((t) => {
      const execDate = new Date(t.executedAt);
      const daysAgo = Math.floor(
        (now.getTime() - execDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      return {
        symbol: t.symbol,
        stockName: t.stockName,
        type: t.type as "BUY" | "SELL" | "OPENING_BALANCE",
        quantity: t.quantity,
        value: t.value,
        pricePerShare: t.quantity > 0 ? t.value / t.quantity : 0,
        executedAt: t.executedAt,
        daysAgo,
      };
    });

    // Generate summary
    const buys = formattedTrades.filter((t) => t.type === "BUY");
    const sells = formattedTrades.filter((t) => t.type === "SELL");
    const uniqueSymbols = new Set(formattedTrades.map((t) => t.symbol)).size;

    // Group by symbol for easier agent consumption
    const bySymbol: Record<string, TradeResult[]> = {};
    for (const trade of formattedTrades) {
      if (!bySymbol[trade.symbol]) {
        bySymbol[trade.symbol] = [];
      }
      bySymbol[trade.symbol].push(trade);
    }

    return {
      success: true,
      data: {
        trades: formattedTrades,
        bySymbol,
        summary: {
          totalBuys: buys.length,
          totalSells: sells.length,
          uniqueSymbols,
          totalBuyValue: buys.reduce((sum, t) => sum + t.value, 0),
          totalSellValue: sells.reduce((sum, t) => sum + t.value, 0),
          daysBack,
        },
        guidance:
          "Use this data to understand the user's recent trading activity. Avoid recommending stocks that were just bought (within 7 days) unless there's a strong reason to add more. For recently sold stocks, check if there's a reason they exited the position.",
      },
    };
  } catch (error) {
    console.error("[get_recent_trades] Error:", error);
    return {
      success: false,
      error: {
        code: "UNKNOWN",
        message: `Failed to fetch trades: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        retryable: false,
      },
    };
  }
}

// Register the executor
registerToolExecutor("get_recent_trades", getRecentTrades);
