/**
 * Intel API
 * GET: Get stock intel data (fundamentals, ValuePickr thesis) for a symbol
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../../lib/middleware/requireAuth";
import { db, schema } from "../../../lib/db";
import { eq } from "drizzle-orm";

export const GET: APIRoute = async ({ request, params }) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  const { symbol } = params;

  if (!symbol) {
    return new Response(JSON.stringify({ error: "Symbol is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const normalizedSymbol = symbol.toUpperCase();

    // Fetch stock intel
    const intel = await db
      .select()
      .from(schema.stockIntel)
      .where(eq(schema.stockIntel.symbol, normalizedSymbol))
      .limit(1);

    if (intel.length === 0) {
      return new Response(
        JSON.stringify({
          symbol: normalizedSymbol,
          fundamentals: null,
          valuepickr: null,
          updatedAt: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const data = intel[0];

    // Parse JSON fields
    let fundamentals = null;
    let valuepickr = null;

    if (data.fundamentals) {
      try {
        fundamentals = JSON.parse(data.fundamentals);
      } catch {}
    }

    if (data.socialSentiment) {
      try {
        valuepickr = JSON.parse(data.socialSentiment);
      } catch {}
    }

    return new Response(
      JSON.stringify({
        symbol: normalizedSymbol,
        fundamentals,
        valuepickr,
        updatedAt: data.updatedAt,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Intel GET error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Server error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
