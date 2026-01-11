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
  parseICICIDirectTradebookTransactions,
  parseICICIDirectHoldings,
  convertICICIToGrowwFormat,
  type GrowwTransaction,
  type GrowwHolding,
} from "../../lib/xlsx-importer";
import {
  findMatchesForTransactions,
  autoLinkHighConfidenceMatches,
} from "../../lib/matching/suggestion-matcher";

/**
 * Check if a file has actual content (not an empty file input)
 */
function isValidFile(file: File | null): file is File {
  return file !== null && file.size > 0 && file.name !== "";
}

/**
 * Detect ICICI Direct CSV type based on filename or content
 */
function detectICICIDirectCsvType(
  filename: string,
  content?: string
): "portfolio" | "tradebook" | null {
  const lowerName = filename.toLowerCase();
  if (lowerName.includes("portfolioeqt") && lowerName.endsWith(".csv")) {
    return "portfolio";
  }
  if (
    (lowerName.includes("tradebook") || lowerName.includes("trade_book")) &&
    lowerName.endsWith(".csv")
  ) {
    return "tradebook";
  }

  if (content?.includes("Stock Symbol,Company Name,ISIN Code")) {
    return "portfolio";
  }
  if (
    content &&
    content.includes("Trade Date") &&
    (content.includes("Buy/Sell") || content.includes("Buy Sell"))
  ) {
    return "tradebook";
  }
  return null;
}

function isICICIDirectFile(filename: string, content?: string): boolean {
  return detectICICIDirectCsvType(filename, content) !== null;
}

export const POST: APIRoute = async ({ request }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    // Clear all intraday transactions before importing real broker data
    // These temporary manual trades are replaced by the imported transactions
    const intradayCleared = await db
      .delete(schema.intradaySuggestionLinks)
      .returning();
    await db.delete(schema.intradayTransactions);
    if (intradayCleared.length > 0) {
      console.log(
        `[Import] Cleared ${intradayCleared.length} intraday transactions`
      );
    }

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
      const iciciType = detectICICIDirectCsvType(
        iciciTransactionsFile.name,
        csvText
      );
      const iciciTxs =
        iciciType === "tradebook"
          ? parseICICIDirectTradebookTransactions(csvText)
          : parseICICIDirectTransactions(csvText);
      transactions = await convertICICIToGrowwFormat(iciciTxs);

      if (isValidFile(iciciHoldingsFile)) {
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
        const iciciType = detectICICIDirectCsvType(filename, csvText);
        const iciciTxs =
          iciciType === "tradebook"
            ? parseICICIDirectTradebookTransactions(csvText)
            : parseICICIDirectTransactions(csvText);
        transactions = await convertICICIToGrowwFormat(iciciTxs);

        if (
          isValidFile(holdingsFile) &&
          isICICIDirectFile(holdingsFile.name)
        ) {
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

        if (isValidFile(holdingsFile)) {
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

    // Auto-match imported transactions to suggestions
    let matchingResult = { created: 0, skipped: 0, proposals: 0 };
    if (insertedCount > 0) {
      try {
        // Get IDs of just-inserted transactions
        const recentTransactionIds = transactionsToInsert
          .slice(0, insertedCount)
          .map((tx) => {
            // We need to find the actual inserted transaction IDs
            // For simplicity, we'll match recent transactions by symbol + executedAt
            return null; // Placeholder
          })
          .filter(Boolean) as string[];

        // Find all recently inserted transactions
        const recentTransactions = await db
          .select()
          .from(schema.transactions)
          .orderBy(schema.transactions.createdAt)
          .limit(insertedCount);

        const txIds = recentTransactions.map((t) => t.id);

        if (txIds.length > 0) {
          const proposals = await findMatchesForTransactions(txIds);
          matchingResult.proposals = proposals.length;

          if (proposals.length > 0) {
            const linkResult = await autoLinkHighConfidenceMatches(
              proposals,
              80
            );
            matchingResult.created = linkResult.created;
            matchingResult.skipped = linkResult.skipped;
          }
        }
      } catch (err) {
        console.error("Auto-matching error:", err);
        // Don't fail import if matching fails
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        source: isICICIImport ? "icici_direct" : "groww",
        transactionsImported: insertedCount,
        adjustmentsCreated: adjustmentsInserted,
        suggestionMatches: matchingResult,
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
