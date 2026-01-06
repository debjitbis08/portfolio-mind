/**
 * Suggestions API
 * GET: Get pending suggestions
 * POST: Update suggestion status (approve/reject)
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../lib/middleware/requireAuth";
import { db, schema } from "../../lib/db";
import { eq, desc, inArray } from "drizzle-orm";

export const GET: APIRoute = async ({ request, url }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const statusFilter = url.searchParams.get("status") || "pending";
    const symbol = url.searchParams.get("symbol");

    // Build query conditions
    const conditions = [];

    if (statusFilter === "history") {
      conditions.push(
        inArray(schema.suggestions.status, [
          "approved",
          "rejected",
          "superseded",
          "expired",
        ])
      );
    } else {
      conditions.push(eq(schema.suggestions.status, statusFilter as any));
    }

    if (symbol) {
      conditions.push(eq(schema.suggestions.symbol, symbol.toUpperCase()));
    }

    const whereCondition =
      conditions.length > 0
        ? conditions.length === 1
          ? conditions[0]
          : (await import("drizzle-orm")).and(...conditions)
        : undefined;

    const suggestions = await db
      .select()
      .from(schema.suggestions)
      .where(whereCondition)
      .orderBy(desc(schema.suggestions.createdAt));

    // Fetch linked transactions for all suggestions
    const suggestionIds = suggestions.map((s) => s.id);
    const links =
      suggestionIds.length > 0
        ? await db
            .select()
            .from(schema.suggestionTransactions)
            .where(
              inArray(schema.suggestionTransactions.suggestionId, suggestionIds)
            )
        : [];

    // Group links by suggestion ID
    const linksBySuggestion = new Map<
      string,
      Array<{
        transactionId: string;
        matchType: string;
        confidence: number | null;
      }>
    >();

    for (const link of links) {
      if (!linksBySuggestion.has(link.suggestionId)) {
        linksBySuggestion.set(link.suggestionId, []);
      }
      linksBySuggestion.get(link.suggestionId)!.push({
        transactionId: link.transactionId,
        matchType: link.matchType,
        confidence: link.confidence,
      });
    }

    // Fetch transaction details for all linked transactions
    const transactionIds = links.map((l) => l.transactionId);
    const transactions =
      transactionIds.length > 0
        ? await db
            .select()
            .from(schema.transactions)
            .where(inArray(schema.transactions.id, transactionIds))
        : [];

    const transactionsById = new Map(transactions.map((t) => [t.id, t]));

    // Convert to snake_case for API response consistency
    const formatted = suggestions.map((s) => {
      // Parse citations JSON if present
      let citations = [];
      if (s.citations) {
        try {
          citations = JSON.parse(s.citations);
        } catch {
          citations = [];
        }
      }

      // Get linked transactions
      const linkedTxs = linksBySuggestion.get(s.id) || [];
      const linkedTransactions = linkedTxs
        .map((link) => {
          const tx = transactionsById.get(link.transactionId);
          if (!tx) return null;
          return {
            id: tx.id,
            type: tx.type,
            quantity: tx.quantity,
            value: tx.value,
            price_per_share: tx.quantity > 0 ? tx.value / tx.quantity : 0,
            executed_at: tx.executedAt,
            match_type: link.matchType,
            confidence: link.confidence,
          };
        })
        .filter(Boolean);

      return {
        id: s.id,
        cycle_id: s.cycleId,
        symbol: s.symbol,
        stock_name: s.stockName,
        action: s.action,
        rationale: s.rationale,
        technical_score: s.technicalScore,
        confidence: s.confidence,
        quantity: s.quantity,
        allocation_amount: s.allocationAmount,
        current_price: s.currentPrice,
        target_price: s.targetPrice,
        status: s.status,
        superseded_by: s.supersededBy,
        superseded_reason: s.supersededReason,
        created_at: s.createdAt,
        expires_at: s.expiresAt,
        reviewed_at: s.reviewedAt,
        citations,
        linked_transactions: linkedTransactions,
      };
    });

    return new Response(JSON.stringify({ suggestions: formatted }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Suggestions GET error:", error);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const POST: APIRoute = async ({ request }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { id, status } = body;

    if (!id || !status || !["approved", "rejected"].includes(status)) {
      return new Response(
        JSON.stringify({
          error: "Invalid request. Need id and status (approved/rejected)",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    await db
      .update(schema.suggestions)
      .set({
        status: status as "approved" | "rejected",
        reviewedAt: new Date().toISOString(),
      })
      .where(eq(schema.suggestions.id, id));

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Suggestions POST error:", error);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
