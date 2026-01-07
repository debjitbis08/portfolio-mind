/**
 * Suggestion Upload Prompt API
 *
 * Checks if there are approved suggestions without matching transactions.
 * Used to prompt users to upload their latest transactions.
 *
 * GET: Returns unlinked approved suggestions from the last 7 days
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../../lib/middleware/requireAuth";
import { db, schema } from "../../../lib/db";
import { eq, and, gte, isNull, notInArray } from "drizzle-orm";

export const GET: APIRoute = async ({ request }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    // Get approved suggestions from yesterday only
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0); // Start of yesterday

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today

    const approvedSuggestions = await db
      .select()
      .from(schema.suggestions)
      .where(
        and(
          eq(schema.suggestions.status, "approved"),
          gte(schema.suggestions.reviewedAt || "", yesterday.toISOString())
        )
      );

    // Filter to only suggestions approved yesterday (not today)
    const yesterdayApproved = approvedSuggestions.filter((s) => {
      if (!s.reviewedAt) return false;
      const reviewedDate = new Date(s.reviewedAt);
      return reviewedDate >= yesterday && reviewedDate < today;
    });

    if (yesterdayApproved.length === 0) {
      return new Response(
        JSON.stringify({
          shouldPrompt: false,
          unlinkedSuggestions: [],
          message: "No approved suggestions from yesterday",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Get all linked suggestion IDs (use yesterday's approved suggestions)
    const suggestionIds = yesterdayApproved.map((s) => s.id);

    // Fetch all linked transactions for these suggestions
    const linkedSuggestions =
      suggestionIds.length > 0
        ? await db
            .select({ suggestionId: schema.suggestionTransactions.suggestionId })
            .from(schema.suggestionTransactions)
        : [];

    // Create a Set of linked suggestion IDs for fast lookup
    const linkedSuggestionIds = new Set(
      linkedSuggestions
        .filter((l) => suggestionIds.includes(l.suggestionId))
        .map((l) => l.suggestionId)
    );

    // Filter to only unlinked suggestions (from yesterday's approved)
    const unlinkedSuggestions = yesterdayApproved.filter(
      (s) => !linkedSuggestionIds.has(s.id)
    );

    // Only actions that require transactions
    const actionableUnlinked = unlinkedSuggestions.filter((s) =>
      ["BUY", "SELL"].includes(s.action)
    );

    if (actionableUnlinked.length === 0) {
      return new Response(
        JSON.stringify({
          shouldPrompt: false,
          unlinkedSuggestions: [],
          message: "All approved BUY/SELL suggestions are linked",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Format response
    const formatted = actionableUnlinked.map((s) => ({
      id: s.id,
      symbol: s.symbol,
      stock_name: s.stockName,
      action: s.action,
      reviewed_at: s.reviewedAt,
      allocation_amount: s.allocationAmount,
      quantity: s.quantity,
      current_price: s.currentPrice,
      days_since_approval: Math.floor(
        (Date.now() - new Date(s.reviewedAt || Date.now()).getTime()) /
          (1000 * 60 * 60 * 24)
      ),
    }));

    // Since we're only checking yesterday, urgency is always high
    const hasMultipleUnlinked = formatted.length >= 2;

    return new Response(
      JSON.stringify({
        shouldPrompt: true,
        unlinkedSuggestions: formatted,
        count: formatted.length,
        urgency: hasMultipleUnlinked ? "high" : "medium",
        message:
          formatted.length === 1
            ? `You approved ${formatted[0].action} ${formatted[0].symbol} yesterday`
            : `You approved ${formatted.length} suggestions yesterday without matching transactions`,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[upload-prompt] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Server error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};
