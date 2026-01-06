/**
 * Manual VRS Research API
 * POST: Save or update manual research metrics for a stock
 * DELETE: Remove VRS research data for a stock
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../../lib/middleware/requireAuth";
import { db, schema } from "../../../lib/db";
import { eq } from "drizzle-orm";
import { addSource } from "../../../lib/utils/source-utils";

export const POST: APIRoute = async ({ request }) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const {
      symbol,
      recPrice,
      recDate,
      exitPrice,
      exitDate,
      status,
      analystNote,
      rationale,
      risks,
      researchContent,
    } = body;

    if (!symbol) {
      return new Response(JSON.stringify({ error: "Symbol is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const normalizedSymbol = symbol.toUpperCase().trim();

    // Validate status
    const validStatus = status === "Exited" ? "Exited" : "Buy";

    // Prepare data
    const researchData = {
      symbol: normalizedSymbol,
      recPrice: recPrice ? parseFloat(recPrice) : null,
      recDate: recDate || null,
      exitPrice: exitPrice ? parseFloat(exitPrice) : null,
      exitDate: exitDate || null,
      status: validStatus as "Buy" | "Exited",
      analystNote: analystNote || null,
      rationale: rationale || null,
      risks: risks || null,
      researchContent: researchContent || null,
      fetchedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Upsert into vrs_research
    await db
      .insert(schema.vrsResearch)
      .values(researchData)
      .onConflictDoUpdate({
        target: schema.vrsResearch.symbol,
        set: researchData,
      });

    // Update the source in watchlist to include 'vrs'
    const existingStock = await db
      .select()
      .from(schema.watchlist)
      .where(eq(schema.watchlist.symbol, normalizedSymbol))
      .limit(1);

    if (existingStock.length > 0) {
      const currentSource = existingStock[0].source || "";
      const newSource = addSource(currentSource, "vrs");

      await db
        .update(schema.watchlist)
        .set({ source: newSource })
        .where(eq(schema.watchlist.symbol, normalizedSymbol));
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Manual VRS API error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Server error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const url = new URL(request.url);
    const symbol = url.searchParams.get("symbol");

    if (!symbol) {
      return new Response(JSON.stringify({ error: "Symbol is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const normalizedSymbol = symbol.toUpperCase().trim();

    // Delete VRS research data
    await db
      .delete(schema.vrsResearch)
      .where(eq(schema.vrsResearch.symbol, normalizedSymbol));

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Delete VRS API error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Server error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
