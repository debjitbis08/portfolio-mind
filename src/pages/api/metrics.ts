/**
 * Performance Metrics API
 * Calculate and return metrics based on suggestion-transaction links
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../lib/middleware/requireAuth";
import { db, schema } from "../../lib/db";
import { eq, and, gte, sql, inArray } from "drizzle-orm";

interface MetricsResponse {
  summary: {
    total_approved: number;
    total_linked: number;
    hit_rate: number; // % of approved suggestions that have linked transactions
    avg_response_days: number | null;
    avg_gain_percent: number | null;
    total_realized_gain: number;
  };
  by_action: {
    action: string;
    count: number;
    linked: number;
    avg_gain_percent: number | null;
  }[];
  recent_links: {
    suggestion_id: string;
    symbol: string;
    action: string;
    transaction_value: number;
    gain_percent: number | null;
    days_to_act: number;
    linked_at: string;
  }[];
}

export const GET: APIRoute = async ({ request, url }) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const daysBack = parseInt(url.searchParams.get("days") || "90", 10);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);

    // Get approved/rejected suggestions from the lookback period
    const approvedSuggestions = await db
      .select()
      .from(schema.suggestions)
      .where(
        and(
          inArray(schema.suggestions.status, ["approved", "rejected"]),
          gte(schema.suggestions.createdAt, cutoffDate.toISOString())
        )
      );

    // Get all suggestion-transaction links
    const allLinks = await db.select().from(schema.suggestionTransactions);

    // Get suggestion IDs that have links
    const linkedSuggestionIds = new Set(allLinks.map((l) => l.suggestionId));

    // Get transaction details for all linked transactions
    const transactionIds = allLinks.map((l) => l.transactionId);
    const transactions =
      transactionIds.length > 0
        ? await db
            .select()
            .from(schema.transactions)
            .where(inArray(schema.transactions.id, transactionIds))
        : [];

    const transactionsById = new Map(transactions.map((t) => [t.id, t]));

    // Calculate hit rate
    const approvedCount = approvedSuggestions.filter(
      (s) => s.status === "approved"
    ).length;
    const linkedApprovedCount = approvedSuggestions.filter(
      (s) => s.status === "approved" && linkedSuggestionIds.has(s.id)
    ).length;
    const hitRate =
      approvedCount > 0 ? (linkedApprovedCount / approvedCount) * 100 : 0;

    // Calculate response time (days between approval and transaction)
    const responseTimes: number[] = [];
    const gains: number[] = [];
    const recentLinks: MetricsResponse["recent_links"] = [];

    for (const link of allLinks) {
      const suggestion = approvedSuggestions.find(
        (s) => s.id === link.suggestionId
      );
      const transaction = transactionsById.get(link.transactionId);

      if (suggestion && transaction && suggestion.reviewedAt) {
        const approvalDate = new Date(suggestion.reviewedAt);
        const txDate = new Date(transaction.executedAt);
        const daysDiff = Math.max(
          0,
          Math.floor(
            (txDate.getTime() - approvalDate.getTime()) / (1000 * 60 * 60 * 24)
          )
        );
        responseTimes.push(daysDiff);

        // Calculate gain for BUY suggestions (current price vs execution price)
        const pricePerShare =
          transaction.quantity > 0
            ? transaction.value / transaction.quantity
            : 0;
        let gainPercent: number | null = null;

        if (
          suggestion.action === "BUY" &&
          suggestion.currentPrice &&
          pricePerShare > 0
        ) {
          gainPercent =
            ((suggestion.currentPrice - pricePerShare) / pricePerShare) * 100;
          gains.push(gainPercent);
        }

        recentLinks.push({
          suggestion_id: suggestion.id,
          symbol: suggestion.symbol,
          action: suggestion.action,
          transaction_value: transaction.value,
          gain_percent: gainPercent,
          days_to_act: daysDiff,
          linked_at: link.createdAt || "",
        });
      }
    }

    // Sort recent links by link date
    recentLinks.sort((a, b) => b.linked_at.localeCompare(a.linked_at));

    // Calculate by-action breakdown
    const byAction: {
      [action: string]: { count: number; linked: number; gains: number[] };
    } = {};

    for (const suggestion of approvedSuggestions) {
      if (suggestion.status !== "approved") continue;

      if (!byAction[suggestion.action]) {
        byAction[suggestion.action] = { count: 0, linked: 0, gains: [] };
      }
      byAction[suggestion.action].count++;

      if (linkedSuggestionIds.has(suggestion.id)) {
        byAction[suggestion.action].linked++;
      }
    }

    // Calculate average gain for each action type
    for (const link of recentLinks) {
      if (link.gain_percent !== null && byAction[link.action]) {
        byAction[link.action].gains.push(link.gain_percent);
      }
    }

    const avgResponseDays =
      responseTimes.length > 0
        ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
        : null;

    const avgGainPercent =
      gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / gains.length : null;

    const totalRealizedGain = recentLinks.reduce((sum, l) => {
      if (l.gain_percent !== null) {
        return sum + (l.transaction_value * l.gain_percent) / 100;
      }
      return sum;
    }, 0);

    const response: MetricsResponse = {
      summary: {
        total_approved: approvedCount,
        total_linked: linkedApprovedCount,
        hit_rate: Math.round(hitRate * 10) / 10,
        avg_response_days: avgResponseDays
          ? Math.round(avgResponseDays * 10) / 10
          : null,
        avg_gain_percent: avgGainPercent
          ? Math.round(avgGainPercent * 10) / 10
          : null,
        total_realized_gain: Math.round(totalRealizedGain),
      },
      by_action: Object.entries(byAction).map(([action, data]) => ({
        action,
        count: data.count,
        linked: data.linked,
        avg_gain_percent:
          data.gains.length > 0
            ? Math.round(
                (data.gains.reduce((a, b) => a + b, 0) / data.gains.length) * 10
              ) / 10
            : null,
      })),
      recent_links: recentLinks.slice(0, 10),
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
