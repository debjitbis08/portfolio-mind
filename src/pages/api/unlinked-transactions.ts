/**
 * Unlinked Transactions API
 * Returns transactions from last N days that are not linked to suggestions,
 * along with auto-match proposals from the suggestion matcher.
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../lib/middleware/requireAuth";
import { db, schema } from "../../lib/db";
import { gte, notInArray, eq, and } from "drizzle-orm";
import { findMatchesForTransactions } from "../../lib/matching/suggestion-matcher";

export const GET: APIRoute = async ({ request, url }) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const daysBack = parseInt(url.searchParams.get("days") || "7", 10);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);

    // Get all linked transaction IDs
    const linkedTxs = await db
      .select({ transactionId: schema.suggestionTransactions.transactionId })
      .from(schema.suggestionTransactions);

    const linkedIds = linkedTxs.map((l) => l.transactionId);

    // Get executed transactions from the lookback period that are not linked
    let unlinkedTransactions;
    if (linkedIds.length > 0) {
      unlinkedTransactions = await db
        .select()
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.status, "Executed"),
            gte(schema.transactions.executedAt, cutoffDate.toISOString()),
            notInArray(schema.transactions.id, linkedIds)
          )
        );
    } else {
      unlinkedTransactions = await db
        .select()
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.status, "Executed"),
            gte(schema.transactions.executedAt, cutoffDate.toISOString())
          )
        );
    }

    // Get auto-match proposals for unlinked transactions
    const transactionIds = unlinkedTransactions.map((t) => t.id);
    const proposals = await findMatchesForTransactions(transactionIds);

    // Format response
    const formattedTransactions = unlinkedTransactions.map((t) => ({
      id: t.id,
      symbol: t.symbol,
      stock_name: t.stockName,
      type: t.type,
      quantity: t.quantity,
      value: t.value,
      price_per_share: t.quantity > 0 ? t.value / t.quantity : 0,
      executed_at: t.executedAt,
      exchange: t.exchange,
    }));

    // Group proposals by transaction ID
    const proposalsByTx = new Map<string, typeof proposals>();
    for (const proposal of proposals) {
      if (!proposalsByTx.has(proposal.transactionId)) {
        proposalsByTx.set(proposal.transactionId, []);
      }
      proposalsByTx.get(proposal.transactionId)!.push(proposal);
    }

    return new Response(
      JSON.stringify({
        transactions: formattedTransactions,
        proposals: proposals.map((p) => ({
          suggestion_id: p.suggestionId,
          transaction_id: p.transactionId,
          match_type: p.matchType,
          confidence: p.confidence,
          reason: p.reason,
          suggestion: {
            symbol: p.suggestion.symbol,
            action: p.suggestion.action,
            target_price: p.suggestion.targetPrice,
            approved_at: p.suggestion.approvedAt,
          },
        })),
        summary: {
          total_unlinked: unlinkedTransactions.length,
          total_proposals: proposals.length,
          lookback_days: daysBack,
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error fetching unlinked transactions:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
