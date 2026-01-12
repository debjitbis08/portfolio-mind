/**
 * Catalyst Suggestions API
 *
 * Generate and manage AI-driven suggestions for the catalyst/swing trading portfolio.
 * Uses the CatalystGeminiService for short-term focused analysis.
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../../lib/middleware/requireAuth";
import { db, schema } from "../../../lib/db";
import { eq, desc, and } from "drizzle-orm";
import { runCatalystSuggestions } from "../../../lib/catalyst/suggestions-runner";

/**
 * GET: Retrieve catalyst portfolio suggestions
 */
export const GET: APIRoute = async ({ request }) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "pending";
  const limit = parseInt(url.searchParams.get("limit") || "20", 10);

  try {
    // Get catalyst suggestions
    let query = db
      .select()
      .from(schema.suggestions)
      .where(eq(schema.suggestions.portfolioType, "CATALYST"))
      .orderBy(desc(schema.suggestions.createdAt))
      .limit(limit);

    if (status !== "all") {
      query = db
        .select()
        .from(schema.suggestions)
        .where(
          and(
            eq(schema.suggestions.portfolioType, "CATALYST"),
            eq(
              schema.suggestions.status,
              status as "pending" | "approved" | "rejected" | "expired"
            )
          )
        )
        .orderBy(desc(schema.suggestions.createdAt))
        .limit(limit);
    }

    const suggestions = await query;

    return new Response(
      JSON.stringify({
        suggestions: suggestions.map((s) => ({
          id: s.id,
          symbol: s.symbol,
          stockName: s.stockName,
          action: s.action,
          rationale: s.rationale,
          confidence: s.confidence,
          quantity: s.quantity,
          allocationAmount: s.allocationAmount,
          currentPrice: s.currentPrice,
          targetPrice: s.targetPrice,
          technicalScore: s.technicalScore,
          status: s.status,
          citations: s.citations ? JSON.parse(s.citations) : [],
          createdAt: s.createdAt,
          expiresAt: s.expiresAt,
          reviewedAt: s.reviewedAt,
          // Catalyst-specific fields
          stopLoss: s.stopLoss,
          maxHoldDays: s.maxHoldDays,
          riskRewardRatio: s.riskRewardRatio,
          trailingStop: s.trailingStop,
          entryTrigger: s.entryTrigger,
          exitCondition: s.exitCondition,
          volatilityAtEntry: s.volatilityAtEntry,
          catalystId: s.catalystId,
        })),
        count: suggestions.length,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[Catalyst Suggestions] GET error:", error);
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

/**
 * POST: Generate new catalyst suggestions via AI analysis
 */
export const POST: APIRoute = async ({ request }) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    console.log("[Catalyst Suggestions] Starting analysis...");
    const result = await runCatalystSuggestions({
      onProgress: (pct, msg) => console.log(`[Catalyst] ${pct}% - ${msg}`),
    });

    return new Response(
      JSON.stringify({
        success: true,
        count: result.count,
        suggestions: result.suggestions,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[Catalyst Suggestions] POST error:", error);
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

/**
 * PATCH: Update suggestion status (approve/reject)
 */
export const PATCH: APIRoute = async ({ request }) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { id, status, notes } = body;

    if (!id || !status) {
      return new Response(
        JSON.stringify({ error: "id and status are required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (!["approved", "rejected", "expired"].includes(status)) {
      return new Response(JSON.stringify({ error: "Invalid status" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const [updated] = await db
      .update(schema.suggestions)
      .set({
        status: status as "approved" | "rejected" | "expired",
        reviewedAt: new Date().toISOString(),
      })
      .where(eq(schema.suggestions.id, id))
      .returning();

    if (!updated) {
      return new Response(JSON.stringify({ error: "Suggestion not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // If notes provided, save them
    if (notes) {
      await db.insert(schema.actionNotes).values({
        suggestionId: id,
        content: notes,
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        suggestion: {
          id: updated.id,
          symbol: updated.symbol,
          action: updated.action,
          status: updated.status,
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[Catalyst Suggestions] PATCH error:", error);
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
