/**
 * Import Transactions API
 * POST: Import transactions from XLSX files
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../lib/middleware/requireAuth";
import { db, schema } from "../../lib/db";
import { eq, and } from "drizzle-orm";
import {
  parseOrderHistory,
  parseHoldingsStatement,
  reconcile,
} from "../../lib/xlsx-importer";

export const POST: APIRoute = async ({ request }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const formData = await request.formData();
    const orderHistoryFile = formData.get("orderHistory") as File | null;
    const holdingsFile = formData.get("holdings") as File | null;

    if (!orderHistoryFile) {
      return new Response(
        JSON.stringify({ error: "Order history file is required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Parse order history
    const orderBuffer = await orderHistoryFile.arrayBuffer();
    const transactions = parseOrderHistory(orderBuffer);

    // Parse holdings (optional, for reconciliation)
    let holdings = null;
    let reconciliationResult = null;
    if (holdingsFile) {
      const holdingsBuffer = await holdingsFile.arrayBuffer();
      holdings = parseHoldingsStatement(holdingsBuffer);
      reconciliationResult = reconcile(transactions, holdings);
    }

    // Insert transactions with deduplication
    const transactionsToInsert = transactions
      .filter((tx) => tx.status === "Executed")
      .map((tx) => ({
        isin: tx.isin,
        symbol: tx.symbol.replace(/[$]/g, ""), // Clean up special chars
        stockName: tx.stockName,
        type: tx.type as "BUY" | "SELL" | "OPENING_BALANCE",
        quantity: tx.quantity,
        value: tx.value,
        exchange: tx.exchange,
        exchangeOrderId: tx.exchangeOrderId,
        executedAt: tx.executedAt.toISOString(),
        status: tx.status,
      }));

    let insertedCount = 0;
    for (const tx of transactionsToInsert) {
      try {
        // Check if already exists (by exchange order ID)
        if (tx.exchangeOrderId) {
          const existing = await db
            .select()
            .from(schema.transactions)
            .where(eq(schema.transactions.exchangeOrderId, tx.exchangeOrderId))
            .limit(1);

          if (existing.length > 0) {
            continue; // Skip duplicate
          }
        }

        await db.insert(schema.transactions).values(tx);
        insertedCount++;
      } catch (err) {
        // Likely duplicate, skip
        console.error("Insert error:", err);
      }
    }

    // Handle reconciliation with holdings file
    let adjustmentsInserted = 0;
    if (reconciliationResult && reconciliationResult.adjustments.length > 0) {
      for (const adj of reconciliationResult.adjustments) {
        const holding = reconciliationResult.actual.get(adj.symbol);
        if (!holding) continue;

        const valueDiffPercent =
          Math.abs(adj.valueDiff / holding.buyValue) * 100;
        const shouldAdjust = adj.quantityDiff !== 0 || valueDiffPercent > 5;

        if (!shouldAdjust) continue;

        // Delete existing transactions for this symbol
        await db
          .delete(schema.transactions)
          .where(eq(schema.transactions.symbol, adj.symbol));

        // Insert OPENING_BALANCE
        await db.insert(schema.transactions).values({
          isin: holding.isin,
          symbol: adj.symbol,
          stockName: holding.stockName,
          type: "OPENING_BALANCE",
          quantity: holding.quantity,
          value: holding.buyValue,
          exchange: null,
          exchangeOrderId: `OPENING_BAL_${adj.symbol}`,
          executedAt: new Date("2020-04-01").toISOString(),
          status: "Executed",
        });

        adjustmentsInserted++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        transactionsImported: insertedCount,
        adjustmentsCreated: adjustmentsInserted,
        reconciliation: reconciliationResult
          ? {
              discrepancies: reconciliationResult.adjustments.length,
              details: reconciliationResult.adjustments,
            }
          : null,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Import error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};
