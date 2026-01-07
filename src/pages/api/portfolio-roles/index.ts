/**
 * Portfolio Roles API
 * GET: Fetch portfolio role for a symbol
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../../lib/middleware/requireAuth";
import { db, schema } from "../../../lib/db";
import { eq } from "drizzle-orm";

export const GET: APIRoute = async ({ request, url }) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const symbol = url.searchParams.get("symbol");

    if (!symbol) {
      return new Response(
        JSON.stringify({ error: "Symbol query param required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const normalizedSymbol = symbol.trim().toUpperCase();

    // Fetch portfolio role
    const result = await db
      .select()
      .from(schema.portfolioRoles)
      .where(eq(schema.portfolioRoles.symbol, normalizedSymbol))
      .limit(1);

    if (result.length === 0) {
      return new Response(JSON.stringify({ role: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ role: result[0].role, notes: result[0].notes }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Portfolio roles GET error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Server error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
