/**
 * API: Fetch catalyst signals
 *
 * GET /api/catalyst/signals - List all active/recent signals
 * Query params:
 *   - status: filter by status (active, pending_market_open, acted, expired, dismissed)
 *   - limit: max results (default: 50)
 */

import type { APIRoute } from "astro";
import { db, schema } from "../../../lib/db";
import { desc, eq, and } from "drizzle-orm";

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const limitParam = url.searchParams.get("limit");

  const limit = limitParam ? parseInt(limitParam, 10) : 50;

  try {
    let query = db
      .select()
      .from(schema.catalystSignals)
      .orderBy(desc(schema.catalystSignals.createdAt))
      .limit(limit);

    // Filter by status if provided
    if (statusParam) {
      query = query.where(eq(schema.catalystSignals.status, statusParam as any));
    }

    const signals = await query;

    return new Response(JSON.stringify({ signals }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[API] Error fetching catalyst signals:", error);
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
 * PATCH /api/catalyst/signals - Update signal status
 */
export const PATCH: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { id, status, notes } = body;

    if (!id || !status) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: id, status" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const updateData: any = { status };
    if (notes !== undefined) {
      updateData.notes = notes;
    }
    if (status === "acted") {
      updateData.actedAt = new Date().toISOString();
    }

    await db
      .update(schema.catalystSignals)
      .set(updateData)
      .where(eq(schema.catalystSignals.id, id));

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[API] Error updating signal:", error);
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
