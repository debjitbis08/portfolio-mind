/**
 * Update Portfolio Role API Endpoint
 *
 * Allows manual updating of portfolio_role for a suggestion.
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../../lib/middleware/requireAuth";
import { db, schema } from "../../../lib/db";
import { eq } from "drizzle-orm";

export const POST: APIRoute = async ({ request }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { suggestionId, portfolioRole } = body;

    if (!suggestionId) {
      return new Response(
        JSON.stringify({ error: "suggestionId is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Validate portfolioRole if provided
    const validRoles = ["VALUE", "MOMENTUM", "CORE", "SPECULATIVE", "INCOME"];
    if (portfolioRole && !validRoles.includes(portfolioRole)) {
      return new Response(
        JSON.stringify({
          error: `Invalid portfolio role. Must be one of: ${validRoles.join(", ")}`,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Update the suggestion
    const result = await db
      .update(schema.suggestions)
      .set({
        portfolioRole: portfolioRole || null,
      })
      .where(eq(schema.suggestions.id, suggestionId))
      .returning();

    if (result.length === 0) {
      return new Response(
        JSON.stringify({ error: "Suggestion not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        suggestion: result[0],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error updating portfolio role:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to update portfolio role",
        details: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};
