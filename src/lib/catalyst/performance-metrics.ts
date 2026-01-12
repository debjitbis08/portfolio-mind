import { db, schema } from "../db";
import { and, asc, eq, inArray } from "drizzle-orm";

export type CatalystPerformanceMetrics = {
  profitFactor: number | null;
  winRate: number | null;
  maxDrawdownPercent: number | null;
  expectancyR: number | null;
  avgWinR: number | null;
  avgLossR: number | null;
  grossProfit: number;
  grossLoss: number;
  closedTrades: number;
  defaultRiskUsed: number;
};

const DEFAULT_RISK_PERCENT = 0.02;

type Lot = {
  quantity: number;
  pricePerShare: number;
  executedAt: string;
  stopLoss: number | null;
};

export async function calculateCatalystPerformanceMetrics(): Promise<CatalystPerformanceMetrics> {
  const transactions = await db
    .select()
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.status, "Executed"),
        eq(schema.transactions.portfolioType, "CATALYST")
      )
    )
    .orderBy(asc(schema.transactions.executedAt));

  if (transactions.length === 0) {
    return {
      profitFactor: null,
      winRate: null,
      maxDrawdownPercent: null,
      expectancyR: null,
      avgWinR: null,
      avgLossR: null,
      grossProfit: 0,
      grossLoss: 0,
      closedTrades: 0,
      defaultRiskUsed: 0,
    };
  }

  const transactionIds = transactions.map((t) => t.id);
  const suggestionLinks =
    transactionIds.length > 0
      ? await db
          .select({
            transactionId: schema.suggestionTransactions.transactionId,
            suggestionId: schema.suggestionTransactions.suggestionId,
          })
          .from(schema.suggestionTransactions)
          .where(inArray(schema.suggestionTransactions.transactionId, transactionIds))
      : [];

  const linkedSuggestionIds = [
    ...new Set(suggestionLinks.map((l) => l.suggestionId)),
  ];

  const suggestions =
    linkedSuggestionIds.length > 0
      ? await db
          .select()
          .from(schema.suggestions)
          .where(
            and(
              inArray(schema.suggestions.id, linkedSuggestionIds),
              eq(schema.suggestions.portfolioType, "CATALYST")
            )
          )
      : [];

  const suggestionById = new Map(suggestions.map((s) => [s.id, s]));
  const stopLossByTransactionId = new Map<string, number | null>();

  for (const link of suggestionLinks) {
    const suggestion = suggestionById.get(link.suggestionId);
    if (!suggestion) continue;
    stopLossByTransactionId.set(link.transactionId, suggestion.stopLoss);
  }

  const lotsBySymbol = new Map<string, Lot[]>();
  const tradePnL: number[] = [];
  const tradeR: number[] = [];
  let defaultRiskUsed = 0;

  for (const tx of transactions) {
    if (tx.type === "OPENING_BALANCE") continue;

    const pricePerShare = tx.quantity > 0 ? tx.value / tx.quantity : 0;

    if (tx.type === "BUY") {
      const lots = lotsBySymbol.get(tx.symbol) || [];
      lots.push({
        quantity: tx.quantity,
        pricePerShare,
        executedAt: tx.executedAt,
        stopLoss: stopLossByTransactionId.get(tx.id) ?? null,
      });
      lotsBySymbol.set(tx.symbol, lots);
      continue;
    }

    if (tx.type !== "SELL") continue;

    let remaining = tx.quantity;
    const lots = lotsBySymbol.get(tx.symbol) || [];
    while (remaining > 0 && lots.length > 0) {
      const lot = lots[0];
      const matchedQty = Math.min(remaining, lot.quantity);
      const pnl = (pricePerShare - lot.pricePerShare) * matchedQty;
      tradePnL.push(pnl);

      const stopLoss = lot.stopLoss;
      let riskPerShare =
        stopLoss !== null && stopLoss < lot.pricePerShare
          ? lot.pricePerShare - stopLoss
          : lot.pricePerShare * DEFAULT_RISK_PERCENT;

      if (!stopLoss || stopLoss >= lot.pricePerShare) {
        defaultRiskUsed += 1;
      }

      if (riskPerShare <= 0) {
        riskPerShare = lot.pricePerShare * DEFAULT_RISK_PERCENT;
        defaultRiskUsed += 1;
      }

      const risk = riskPerShare * matchedQty;
      tradeR.push(risk > 0 ? pnl / risk : 0);

      lot.quantity -= matchedQty;
      remaining -= matchedQty;

      if (lot.quantity <= 0) {
        lots.shift();
      }
    }
    lotsBySymbol.set(tx.symbol, lots);
  }

  if (tradePnL.length === 0) {
    return {
      profitFactor: null,
      winRate: null,
      maxDrawdownPercent: null,
      expectancyR: null,
      avgWinR: null,
      avgLossR: null,
      grossProfit: 0,
      grossLoss: 0,
      closedTrades: 0,
      defaultRiskUsed,
    };
  }

  const grossProfit = tradePnL.filter((p) => p > 0).reduce((a, b) => a + b, 0);
  const grossLoss = tradePnL.filter((p) => p < 0).reduce((a, b) => a + b, 0);
  const profitFactor =
    grossLoss !== 0 ? Math.abs(grossProfit / grossLoss) : null;

  const winningTrades = tradePnL.filter((p) => p > 0).length;
  const winRate = (winningTrades / tradePnL.length) * 100;

  let equity = 0;
  let peak = 0;
  let maxDrawdownPercent = 0;
  for (const pnl of tradePnL) {
    equity += pnl;
    if (equity > peak) peak = equity;
    if (peak > 0) {
      const drawdown = ((peak - equity) / peak) * 100;
      if (drawdown > maxDrawdownPercent) {
        maxDrawdownPercent = drawdown;
      }
    }
  }

  const avgWinR =
    tradeR.filter((r) => r > 0).reduce((a, b) => a + b, 0) /
    Math.max(1, tradeR.filter((r) => r > 0).length);
  const avgLossR =
    tradeR.filter((r) => r < 0).reduce((a, b) => a + b, 0) /
    Math.max(1, tradeR.filter((r) => r < 0).length);
  const expectancyR = tradeR.reduce((a, b) => a + b, 0) / tradeR.length;

  return {
    profitFactor,
    winRate,
    maxDrawdownPercent,
    expectancyR,
    avgWinR: Number.isFinite(avgWinR) ? avgWinR : null,
    avgLossR: Number.isFinite(avgLossR) ? avgLossR : null,
    grossProfit,
    grossLoss: Math.abs(grossLoss),
    closedTrades: tradePnL.length,
    defaultRiskUsed,
  };
}
