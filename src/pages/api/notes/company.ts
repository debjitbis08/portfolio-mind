/**
 * Company Notes API
 * GET: Get all notes for a symbol
 * POST: Create a new note for a symbol
 * DELETE: Delete a note
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../../lib/middleware/requireAuth";
import { db, schema } from "../../../lib/db";
import { eq, desc } from "drizzle-orm";
import { resolveSymbolToCommodity } from "../../../lib/utils/commodity-resolver";

export const GET: APIRoute = async ({ request, url }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const symbol = url.searchParams.get("symbol");

    if (!symbol) {
      return new Response(
        JSON.stringify({ error: "Symbol parameter is required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Resolve ETF symbols to their underlying commodity
    const resolvedSymbol = await resolveSymbolToCommodity(symbol);

    const notes = await db
      .select()
      .from(schema.companyNotes)
      .where(eq(schema.companyNotes.symbol, resolvedSymbol))
      .orderBy(desc(schema.companyNotes.createdAt));

    return new Response(JSON.stringify({ notes }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Company notes GET error:", error);
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
    const { symbol, content } = body;

    // Validation
    if (!symbol || !content) {
      return new Response(
        JSON.stringify({
          error: "symbol and content are required",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (content.length > 500) {
      return new Response(
        JSON.stringify({
          error: "Note content cannot exceed 500 characters",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Resolve ETF symbols to their underlying commodity
    const resolvedSymbol = await resolveSymbolToCommodity(symbol);

    // Create note
    const note = await db
      .insert(schema.companyNotes)
      .values({
        symbol: resolvedSymbol,
        content,
      })
      .returning();

    return new Response(JSON.stringify({ note: note[0] }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Company notes POST error:", error);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return new Response(JSON.stringify({ error: "Note ID is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    await db.delete(schema.companyNotes).where(eq(schema.companyNotes.id, id));

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Company notes DELETE error:", error);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
