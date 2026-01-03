/**
 * Suggestions API
 * GET: Get pending suggestions
 * POST: Update suggestion status (approve/reject)
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../lib/middleware/requireAuth";
import { db, schema } from "../../lib/db";
import { eq, desc } from "drizzle-orm";

export const GET: APIRoute = async ({ request, url }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const statusFilter = url.searchParams.get("status") || "pending";

    const suggestions = await db
      .select()
      .from(schema.suggestions)
      .where(
        eq(
          schema.suggestions.status,
          statusFilter as
            | "pending"
            | "approved"
            | "rejected"
            | "expired"
            | "superseded"
        )
      )
      .orderBy(desc(schema.suggestions.createdAt));

    // Convert to snake_case for API response consistency
    const formatted = suggestions.map((s) => ({
      id: s.id,
      cycle_id: s.cycleId,
      symbol: s.symbol,
      stock_name: s.stockName,
      action: s.action,
      rationale: s.rationale,
      technical_score: s.technicalScore,
      confidence: s.confidence,
      current_price: s.currentPrice,
      target_price: s.targetPrice,
      status: s.status,
      superseded_by: s.supersededBy,
      superseded_reason: s.supersededReason,
      created_at: s.createdAt,
      expires_at: s.expiresAt,
      reviewed_at: s.reviewedAt,
    }));

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
