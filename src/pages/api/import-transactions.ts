/**
 * Import Transactions API
 * POST: Import transactions from XLSX files (Groww/Zerodha) or CSV files (ICICI Direct)
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../lib/middleware/requireAuth";
import { db, schema } from "../../lib/db";
import { eq, and } from "drizzle-orm";
import {
  parseOrderHistory,
  parseHoldingsStatement,
  reconcile,
  parseICICIDirectTransactions,
  parseICICIDirectHoldings,
  convertICICIToGrowwFormat,
  type GrowwTransaction,
  type GrowwHolding,
} from "../../lib/xlsx-importer";

/**
 * Detect if a file is an ICICI Direct CSV based on filename or content
 */
function isICICIDirectFile(filename: string, content?: string): boolean {
  // Check filename pattern: 8503558265_PortFolioEqtAll.csv
  if (filename.includes("PortFolioEqt") && filename.endsWith(".csv")) {
    return true;
  }
  // Check content for ICICI-specific header
  if (content && content.includes("Stock Symbol,Company Name,ISIN Code")) {
    return true;
  }
  return false;
}

export const POST: APIRoute = async ({ request }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const formData = await request.formData();
    const orderHistoryFile = formData.get("orderHistory") as File | null;
    const holdingsFile = formData.get("holdings") as File | null;

    // Also check for ICICI Direct specific field names
    const iciciTransactionsFile = formData.get(
      "iciciTransactions"
    ) as File | null;
    const iciciHoldingsFile = formData.get("iciciHoldings") as File | null;

    let transactions: GrowwTransaction[] = [];
    let holdings: GrowwHolding[] | null = null;
    let isICICIImport = false;

    // Detect and parse ICICI Direct files
    if (iciciTransactionsFile) {
      isICICIImport = true;
      const csvText = await iciciTransactionsFile.text();
      const iciciTxs = parseICICIDirectTransactions(csvText);
      transactions = convertICICIToGrowwFormat(iciciTxs);

      if (iciciHoldingsFile) {
        const holdingsCsv = await iciciHoldingsFile.text();
        const iciciHoldings = parseICICIDirectHoldings(holdingsCsv);
        // Convert to GrowwHolding format for reconciliation
        holdings = iciciHoldings.map((h) => ({
          stockName: h.companyName,
          isin: h.isinCode,
          quantity: h.quantity,
          avgBuyPrice: h.avgCostPrice,
          buyValue: h.valueAtCost,
          closingPrice: h.currentMarketPrice,
          closingValue: h.valueAtMarketPrice,
          unrealisedPnL: h.unrealizedPnL,
        }));
      }
    }
    // Check if orderHistory is actually an ICICI file
    else if (orderHistoryFile) {
      const filename = orderHistoryFile.name;

      if (isICICIDirectFile(filename)) {
        isICICIImport = true;
        const csvText = await orderHistoryFile.text();
        const iciciTxs = parseICICIDirectTransactions(csvText);
        transactions = convertICICIToGrowwFormat(iciciTxs);

        if (holdingsFile && isICICIDirectFile(holdingsFile.name)) {
          const holdingsCsv = await holdingsFile.text();
          const iciciHoldings = parseICICIDirectHoldings(holdingsCsv);
          holdings = iciciHoldings.map((h) => ({
            stockName: h.companyName,
            isin: h.isinCode,
            quantity: h.quantity,
            avgBuyPrice: h.avgCostPrice,
            buyValue: h.valueAtCost,
            closingPrice: h.currentMarketPrice,
            closingValue: h.valueAtMarketPrice,
            unrealisedPnL: h.unrealizedPnL,
          }));
        }
      } else {
        // Standard Groww/Zerodha XLSX parsing
        const orderBuffer = await orderHistoryFile.arrayBuffer();
        transactions = parseOrderHistory(orderBuffer);

        if (holdingsFile) {
          const holdingsBuffer = await holdingsFile.arrayBuffer();
          holdings = parseHoldingsStatement(holdingsBuffer);
        }
      }
    } else {
      return new Response(
        JSON.stringify({ error: "Order history file is required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Reconcile if holdings provided
    let reconciliationResult = null;
    if (holdings) {
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
        source: isICICIImport ? "icici_direct" : "groww",
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
