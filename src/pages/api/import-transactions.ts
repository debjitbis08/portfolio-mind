import type { APIRoute } from "astro";
import { createServerClient } from "../../lib/supabase";
import {
  parseOrderHistory,
  parseHoldingsStatement,
  reconcile,
} from "../../lib/xlsx-importer";

export const POST: APIRoute = async ({ request }) => {
  try {
    const formData = await request.formData();
    const orderHistoryFile = formData.get("orderHistory") as File | null;
    const holdingsFile = formData.get("holdings") as File | null;
    const userId = formData.get("userId") as string;

    if (!orderHistoryFile) {
      return new Response(
        JSON.stringify({ error: "Order history file is required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: "User ID is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get service role key from env
    const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createServerClient(serviceRoleKey);

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

    // Insert transactions with deduplication (upsert on exchange_order_id)
    const transactionsToInsert = transactions
      .filter((tx) => tx.status === "Executed")
      .map((tx) => ({
        user_id: userId,
        isin: tx.isin,
        symbol: tx.symbol.replace(/[$]/g, ""), // Clean up special chars like $
        stock_name: tx.stockName,
        type: tx.type,
        quantity: tx.quantity,
        value: tx.value,
        exchange: tx.exchange,
        exchange_order_id: tx.exchangeOrderId,
        executed_at: tx.executedAt.toISOString(),
        status: tx.status,
      }));

    const { data: insertedTx, error: txError } = await supabase
      .from("transactions")
      .upsert(transactionsToInsert, {
        onConflict: "user_id,exchange_order_id",
        ignoreDuplicates: true,
      })
      .select();

    if (txError) {
      return new Response(JSON.stringify({ error: txError.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Handle reconciliation with holdings file
    // When holdings file is provided, it's the source of truth for:
    // 1. Total quantity
    // 2. Average buy price (invested value)
    // If there's a mismatch in either, we replace with holdings data
    let adjustmentsInserted = 0;
    if (reconciliationResult && reconciliationResult.adjustments.length > 0) {
      for (const adj of reconciliationResult.adjustments) {
        // Process if quantity doesn't match OR value differs by more than 5%
        const holding = reconciliationResult.actual.get(adj.symbol);
        if (!holding) continue;

        const valueDiffPercent =
          Math.abs(adj.valueDiff / holding.buyValue) * 100;
        const shouldAdjust = adj.quantityDiff !== 0 || valueDiffPercent > 5;

        if (!shouldAdjust) continue; // Skip if both quantity and value match closely

        // For stocks with discrepancies (likely due to stock splits or old history),
        // delete all existing transactions for this symbol and create a single
        // OPENING_BALANCE that matches the holdings file exactly

        // First, delete existing transactions for this symbol
        const { error: deleteError } = await supabase
          .from("transactions")
          .delete()
          .eq("user_id", userId)
          .eq("symbol", adj.symbol);

        if (deleteError) {
          console.error(
            `Failed to delete transactions for ${adj.symbol}:`,
            deleteError
          );
          continue;
        }

        // Now insert a single OPENING_BALANCE with the holdings file data
        const { error: insertError } = await supabase
          .from("transactions")
          .insert({
            user_id: userId,
            isin: holding.isin,
            symbol: adj.symbol,
            stock_name: holding.stockName,
            type: "OPENING_BALANCE",
            quantity: holding.quantity, // Use holdings quantity as source of truth
            value: holding.buyValue, // Use holdings invested value as source of truth
            exchange: null,
            exchange_order_id: `OPENING_BAL_${adj.symbol}`,
            executed_at: new Date("2020-04-01").toISOString(),
            status: "Executed",
          });

        if (insertError) {
          console.error(
            `Failed to insert OPENING_BALANCE for ${adj.symbol}:`,
            insertError
          );
        } else {
          adjustmentsInserted++;
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        transactionsImported: transactionsToInsert.length,
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
