/**
 * Update Portfolio Role API Endpoint
 *
 * Allows manual updating of portfolio_role for a stock.
 */

import type { APIRoute} from "astro";
import { requireAuth } from "../../../lib/middleware/requireAuth";
import { db, schema } from "../../../lib/db";
import { eq } from "drizzle-orm";

export const POST: APIRoute = async ({ request }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { symbol, portfolioRole, notes } = body;

    if (!symbol) {
      return new Response(
        JSON.stringify({ error: "symbol is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!portfolioRole) {
      return new Response(
        JSON.stringify({ error: "portfolioRole is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Validate portfolioRole
    const validRoles = ["VALUE", "MOMENTUM", "CORE", "SPECULATIVE", "INCOME"];
    if (!validRoles.includes(portfolioRole)) {
      return new Response(
        JSON.stringify({
          error: `Invalid portfolio role. Must be one of: ${validRoles.join(", ")}`,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Check if role exists for this symbol
    const existing = await db
      .select()
      .from(schema.portfolioRoles)
      .where(eq(schema.portfolioRoles.symbol, symbol))
      .limit(1);

    let result;
    if (existing.length > 0) {
      // Update existing
      result = await db
        .update(schema.portfolioRoles)
        .set({
          role: portfolioRole,
          notes: notes || null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.portfolioRoles.symbol, symbol))
        .returning();
    } else {
      // Insert new
      result = await db
        .insert(schema.portfolioRoles)
        .values({
          symbol,
          role: portfolioRole,
          notes: notes || null,
        })
        .returning();
    }

    return new Response(
      JSON.stringify({
        success: true,
        portfolioRole: result[0],
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
