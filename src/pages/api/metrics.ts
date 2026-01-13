/**
 * Performance Metrics API - P&L Focused
 * Calculate actual portfolio gains from AI suggestions
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../lib/middleware/requireAuth";
import { db, schema } from "../../lib/db";
import { eq, and, gte, inArray } from "drizzle-orm";

interface MetricsResponse {
  summary: {
    total_pnl: number; // Total P&L in ₹
    total_pnl_percent: number; // Weighted average gain %
    unrealized_pnl: number;
    realized_pnl: number;
    total_invested: number; // Total capital deployed via bot suggestions
    win_rate: number; // % of trades that are profitable
    total_trades: number;
    winning_trades: number;
  };
  best_performer: {
    symbol: string;
    gain_percent: number;
    gain_amount: number;
  } | null;
  worst_performer: {
    symbol: string;
    gain_percent: number;
    gain_amount: number;
  } | null;
  by_action: {
    action: string;
    count: number;
    linked: number;
    total_pnl: number;
    avg_gain_percent: number | null;
  }[];
  recent_links: {
    suggestion_id: string;
    symbol: string;
    action: string;
    transaction_value: number;
    current_value: number;
    gain_amount: number;
    gain_percent: number;
    days_held: number;
    status: "holding" | "closed";
    linked_at: string;
  }[];
}

export const GET: APIRoute = async ({ request, url }) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    type MetricsTransaction = {
      id: string;
      symbol: string;
      type: "BUY" | "SELL" | "OPENING_BALANCE";
      quantity: number;
      value: number;
      totalCharges: number;
      executedAt: string;
    };

    const getNetValue = (tx: MetricsTransaction) =>
      tx.type === "SELL"
        ? tx.value - (tx.totalCharges || 0)
        : tx.value + (tx.totalCharges || 0);

    const daysBack = parseInt(url.searchParams.get("days") || "365", 10);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);

    // Get approved suggestions from the lookback period
    const approvedSuggestions = await db
      .select()
      .from(schema.suggestions)
      .where(
        and(
          inArray(schema.suggestions.status, ["approved", "rejected"]),
          eq(schema.suggestions.portfolioType, "LONGTERM"),
          gte(schema.suggestions.createdAt, cutoffDate.toISOString())
        )
      );

    // Get all suggestion-transaction links (broker + intraday)
    const suggestionLinks = await db
      .select({
        suggestionId: schema.suggestionTransactions.suggestionId,
        transactionId: schema.suggestionTransactions.transactionId,
        createdAt: schema.suggestionTransactions.createdAt,
      })
      .from(schema.suggestionTransactions);
    const intradayLinks = await db
      .select({
        suggestionId: schema.intradaySuggestionLinks.suggestionId,
        transactionId: schema.intradaySuggestionLinks.intradayTransactionId,
        createdAt: schema.intradaySuggestionLinks.createdAt,
      })
      .from(schema.intradaySuggestionLinks);
    const approvedSuggestionIds = new Set(
      approvedSuggestions.map((s) => s.id)
    );
    const allLinks = [...suggestionLinks, ...intradayLinks].filter((link) =>
      approvedSuggestionIds.has(link.suggestionId)
    );

    // Get suggestion IDs that have links
    const linkedSuggestionIds = new Set(allLinks.map((l) => l.suggestionId));

    // Get transaction details for all linked transactions
    const transactionIds = allLinks.map((l) => l.transactionId);
    const brokerTransactionsRaw =
      transactionIds.length > 0
        ? await db
            .select()
            .from(schema.transactions)
            .where(
              and(
                inArray(schema.transactions.id, transactionIds),
                eq(schema.transactions.portfolioType, "LONGTERM")
              )
            )
        : [];
    const intradayTransactionsRaw =
      transactionIds.length > 0
        ? await db
            .select()
            .from(schema.intradayTransactions)
            .where(
              and(
                inArray(schema.intradayTransactions.id, transactionIds),
                eq(schema.intradayTransactions.portfolioType, "LONGTERM")
              )
            )
        : [];

    const brokerTransactions: MetricsTransaction[] = brokerTransactionsRaw.map(
      (tx) => ({
        id: tx.id,
        symbol: tx.symbol,
        type: tx.type,
        quantity: tx.quantity,
        value: tx.value,
        totalCharges: tx.totalCharges || 0,
        executedAt: tx.executedAt,
      })
    );
    const intradayTransactions: MetricsTransaction[] =
      intradayTransactionsRaw.map((tx) => ({
        id: tx.id,
        symbol: tx.symbol,
        type: tx.type,
        quantity: tx.quantity,
        value: tx.quantity * tx.pricePerShare,
        totalCharges: tx.totalCharges || 0,
        executedAt: tx.executedAt || tx.createdAt || "",
      }));

    const transactionsById = new Map<string, MetricsTransaction>();
    for (const tx of brokerTransactions) {
      transactionsById.set(tx.id, tx);
    }
    for (const tx of intradayTransactions) {
      transactionsById.set(tx.id, tx);
    }

    // Get current prices for all linked symbols
    const linkedSymbols = [
      ...new Set(
        allLinks
          .map((l) => {
            const suggestion = approvedSuggestions.find(
              (s) => s.id === l.suggestionId
            );
            return suggestion?.symbol;
          })
          .filter(Boolean) as string[]
      ),
    ];

    const priceData =
      linkedSymbols.length > 0
        ? await db
            .select()
            .from(schema.priceCache)
            .where(inArray(schema.priceCache.symbol, linkedSymbols))
        : [];

    const priceBySymbol = new Map(priceData.map((p) => [p.symbol, p.price]));

    // Get all transactions for the linked symbols to find SELL matches
    const brokerSymbolTransactionsRaw =
      linkedSymbols.length > 0
        ? await db
            .select()
            .from(schema.transactions)
            .where(
              and(
                inArray(schema.transactions.symbol, linkedSymbols),
                eq(schema.transactions.portfolioType, "LONGTERM")
              )
            )
        : [];
    const intradaySymbolTransactionsRaw =
      linkedSymbols.length > 0
        ? await db
            .select()
            .from(schema.intradayTransactions)
            .where(
              and(
                inArray(schema.intradayTransactions.symbol, linkedSymbols),
                eq(schema.intradayTransactions.portfolioType, "LONGTERM")
              )
            )
        : [];
    const brokerSymbolTransactions: MetricsTransaction[] =
      brokerSymbolTransactionsRaw.map((tx) => ({
        id: tx.id,
        symbol: tx.symbol,
        type: tx.type,
        quantity: tx.quantity,
        value: tx.value,
        totalCharges: tx.totalCharges || 0,
        executedAt: tx.executedAt,
      }));
    const intradaySymbolTransactions: MetricsTransaction[] =
      intradaySymbolTransactionsRaw.map((tx) => ({
        id: tx.id,
        symbol: tx.symbol,
        type: tx.type,
        quantity: tx.quantity,
        value: tx.quantity * tx.pricePerShare,
        totalCharges: tx.totalCharges || 0,
        executedAt: tx.executedAt || tx.createdAt || "",
      }));
    const allSymbolTransactions = [
      ...brokerSymbolTransactions,
      ...intradaySymbolTransactions,
    ];

    // Group transactions by symbol for finding matching SELLs
    const transactionsBySymbol = new Map<
      string,
      (typeof allSymbolTransactions)[0][]
    >();
    for (const tx of allSymbolTransactions) {
      const existing = transactionsBySymbol.get(tx.symbol) || [];
      existing.push(tx);
      transactionsBySymbol.set(tx.symbol, existing);
    }

    // Calculate P&L for each linked trade
    const tradePnL: {
      suggestionId: string;
      symbol: string;
      action: string;
      buyValue: number;
      currentValue: number;
      gainAmount: number;
      gainPercent: number;
      daysHeld: number;
      status: "holding" | "closed";
      linkedAt: string;
    }[] = [];

    for (const link of allLinks) {
      const suggestion = approvedSuggestions.find(
        (s) => s.id === link.suggestionId
      );
      const transaction = transactionsById.get(link.transactionId);

      if (!suggestion || !transaction) continue;

      const symbol = suggestion.symbol;
      const currentPrice = priceBySymbol.get(symbol);

      if (suggestion.action === "BUY") {
        const buyValue = getNetValue(transaction);
        const quantity = transaction.quantity;
        const pricePerShare = quantity > 0 ? buyValue / quantity : 0;

        // Check if there's a matching SELL after this BUY
        const symbolTxs = transactionsBySymbol.get(symbol) || [];
        const buyDate = new Date(transaction.executedAt);
        const matchingSell = symbolTxs.find(
          (tx) =>
            tx.type === "SELL" &&
            new Date(tx.executedAt) > buyDate &&
            tx.quantity <= quantity
        );

        let status: "holding" | "closed" = "holding";
        let currentValue = 0;
        let gainAmount = 0;
        let gainPercent = 0;

        if (matchingSell) {
          // Closed position - use actual sale proceeds
          status = "closed";
          const sellPricePerShare =
            matchingSell.quantity > 0
              ? getNetValue(matchingSell) / matchingSell.quantity
              : 0;
          currentValue = sellPricePerShare * quantity; // Proportional to original quantity
          gainAmount = currentValue - buyValue;
          gainPercent = buyValue > 0 ? (gainAmount / buyValue) * 100 : 0;
        } else if (currentPrice && currentPrice > 0) {
          // Still holding - use current market price
          currentValue = currentPrice * quantity;
          gainAmount = currentValue - buyValue;
          gainPercent = buyValue > 0 ? (gainAmount / buyValue) * 100 : 0;
        }

        const daysHeld = Math.floor(
          (Date.now() - buyDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        tradePnL.push({
          suggestionId: suggestion.id,
          symbol,
          action: suggestion.action,
          buyValue,
          currentValue,
          gainAmount,
          gainPercent,
          daysHeld,
          status,
          linkedAt: link.createdAt || "",
        });
      } else if (suggestion.action === "SELL") {
        // For SELL suggestions: Calculate profit from the sale
        // Find corresponding BUY to calculate average cost
        const symbolTxs = transactionsBySymbol.get(symbol) || [];
        const sellDate = new Date(transaction.executedAt);
        const sellValue = getNetValue(transaction);
        const sellQuantity = transaction.quantity;
        const sellPricePerShare =
          sellQuantity > 0 ? sellValue / sellQuantity : 0;

        // Find BUYs before this SELL to calculate average cost
        const priorBuys = symbolTxs.filter(
          (tx) => tx.type === "BUY" && new Date(tx.executedAt) < sellDate
        );

        let totalBoughtQty = 0;
        let totalBoughtValue = 0;
        for (const buy of priorBuys) {
          totalBoughtQty += buy.quantity;
          totalBoughtValue += getNetValue(buy);
        }

        const avgBuyPrice =
          totalBoughtQty > 0 ? totalBoughtValue / totalBoughtQty : 0;
        const costBasis = avgBuyPrice * sellQuantity;
        const gainAmount = sellValue - costBasis;
        const gainPercent = costBasis > 0 ? (gainAmount / costBasis) * 100 : 0;

        const daysHeld = Math.floor(
          (sellDate.getTime() -
            new Date(priorBuys[0]?.executedAt || sellDate).getTime()) /
            (1000 * 60 * 60 * 24)
        );

        tradePnL.push({
          suggestionId: suggestion.id,
          symbol,
          action: suggestion.action,
          buyValue: costBasis, // Cost basis for the sold shares
          currentValue: sellValue,
          gainAmount,
          gainPercent,
          daysHeld,
          status: "closed",
          linkedAt: link.createdAt || "",
        });
      }
    }

    // Aggregate metrics
    const totalInvested = tradePnL.reduce((sum, t) => sum + t.buyValue, 0);
    const totalPnL = tradePnL.reduce((sum, t) => sum + t.gainAmount, 0);
    const totalPnLPercent =
      totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;

    const unrealizedPnL = tradePnL
      .filter((t) => t.status === "holding")
      .reduce((sum, t) => sum + t.gainAmount, 0);

    const realizedPnL = tradePnL
      .filter((t) => t.status === "closed")
      .reduce((sum, t) => sum + t.gainAmount, 0);

    const winningTrades = tradePnL.filter((t) => t.gainAmount > 0).length;
    const winRate =
      tradePnL.length > 0 ? (winningTrades / tradePnL.length) * 100 : 0;

    // Find best and worst performers
    const sortedByGain = [...tradePnL].sort(
      (a, b) => b.gainPercent - a.gainPercent
    );
    const bestPerformer =
      sortedByGain.length > 0
        ? {
            symbol: sortedByGain[0].symbol,
            gain_percent: Math.round(sortedByGain[0].gainPercent * 10) / 10,
            gain_amount: Math.round(sortedByGain[0].gainAmount),
          }
        : null;

    const worstPerformer =
      sortedByGain.length > 0
        ? {
            symbol: sortedByGain[sortedByGain.length - 1].symbol,
            gain_percent:
              Math.round(
                sortedByGain[sortedByGain.length - 1].gainPercent * 10
              ) / 10,
            gain_amount: Math.round(
              sortedByGain[sortedByGain.length - 1].gainAmount
            ),
          }
        : null;

    // By-action breakdown
    const byActionMap: {
      [action: string]: {
        count: number;
        linked: number;
        pnl: number;
        gains: number[];
      };
    } = {};

    for (const suggestion of approvedSuggestions.filter(
      (s) => s.status === "approved"
    )) {
      if (!byActionMap[suggestion.action]) {
        byActionMap[suggestion.action] = {
          count: 0,
          linked: 0,
          pnl: 0,
          gains: [],
        };
      }
      byActionMap[suggestion.action].count++;
      if (linkedSuggestionIds.has(suggestion.id)) {
        byActionMap[suggestion.action].linked++;
      }
    }

    for (const trade of tradePnL) {
      if (byActionMap[trade.action]) {
        byActionMap[trade.action].pnl += trade.gainAmount;
        byActionMap[trade.action].gains.push(trade.gainPercent);
      }
    }

    // Format recent links
    const recentLinks = tradePnL
      .sort((a, b) => b.linkedAt.localeCompare(a.linkedAt))
      .slice(0, 15)
      .map((t) => ({
        suggestion_id: t.suggestionId,
        symbol: t.symbol,
        action: t.action,
        transaction_value: Math.round(t.buyValue),
        current_value: Math.round(t.currentValue),
        gain_amount: Math.round(t.gainAmount),
        gain_percent: Math.round(t.gainPercent * 10) / 10,
        days_held: t.daysHeld,
        status: t.status,
        linked_at: t.linkedAt,
      }));

    const response: MetricsResponse = {
      summary: {
        total_pnl: Math.round(totalPnL),
        total_pnl_percent: Math.round(totalPnLPercent * 10) / 10,
        unrealized_pnl: Math.round(unrealizedPnL),
        realized_pnl: Math.round(realizedPnL),
        total_invested: Math.round(totalInvested),
        win_rate: Math.round(winRate * 10) / 10,
        total_trades: tradePnL.length,
        winning_trades: winningTrades,
      },
      best_performer: bestPerformer,
      worst_performer: worstPerformer,
      by_action: Object.entries(byActionMap).map(([action, data]) => ({
        action,
        count: data.count,
        linked: data.linked,
        total_pnl: Math.round(data.pnl),
        avg_gain_percent:
          data.gains.length > 0
            ? Math.round(
                (data.gains.reduce((a, b) => a + b, 0) / data.gains.length) * 10
              ) / 10
            : null,
      })),
      recent_links: recentLinks,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error calculating metrics:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
