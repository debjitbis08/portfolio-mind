/**
 * API: Catalyst watchlist management
 *
 * GET /api/catalyst/watchlist - List all watchlist items
 * POST /api/catalyst/watchlist - Add new watchlist item
 * PATCH /api/catalyst/watchlist - Update watchlist item
 * DELETE /api/catalyst/watchlist?id=... - Remove watchlist item
 */

import type { APIRoute } from "astro";
import { db, schema } from "../../../lib/db";
import { desc, eq } from "drizzle-orm";

export const GET: APIRoute = async () => {
  try {
    const watchlist = await db
      .select()
      .from(schema.catalystWatchlist)
      .orderBy(desc(schema.catalystWatchlist.enabled), schema.catalystWatchlist.keyword);

    return new Response(JSON.stringify({ watchlist }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[API] Error fetching catalyst watchlist:", error);
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

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const {
      keyword,
      ticker,
      assetType,
      globalValidationTicker,
      relatedTickers,
      notes,
    } = body;

    if (!keyword || !assetType) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: keyword, assetType" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const [newItem] = await db
      .insert(schema.catalystWatchlist)
      .values({
        keyword,
        ticker: ticker || null,
        assetType,
        globalValidationTicker: globalValidationTicker || null,
        relatedTickers: relatedTickers || null,
        notes: notes || null,
        enabled: true,
      })
      .returning();

    return new Response(JSON.stringify({ item: newItem }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[API] Error adding watchlist item:", error);
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

export const PATCH: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { id, enabled, notes } = body;

    if (!id) {
      return new Response(
        JSON.stringify({ error: "Missing required field: id" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const updateData: any = {};
    if (enabled !== undefined) updateData.enabled = enabled;
    if (notes !== undefined) updateData.notes = notes;

    await db
      .update(schema.catalystWatchlist)
      .set(updateData)
      .where(eq(schema.catalystWatchlist.id, id));

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[API] Error updating watchlist item:", error);
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

export const DELETE: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (!id) {
    return new Response(
      JSON.stringify({ error: "Missing required parameter: id" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  try {
    await db
      .delete(schema.catalystWatchlist)
      .where(eq(schema.catalystWatchlist.id, id));

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[API] Error deleting watchlist item:", error);
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
