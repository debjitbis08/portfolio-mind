/**
 * Suggestion-Transaction Links API
 * Manage links between AI suggestions and executed transactions
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../lib/middleware/requireAuth";
import { db, schema } from "../../lib/db";
import { eq, and, or } from "drizzle-orm";

/**
 * GET: Query links by suggestionId or transactionId
 * POST: Create a link
 * DELETE: Remove a link
 */

export const GET: APIRoute = async ({ request, url }) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const suggestionId = url.searchParams.get("suggestionId");
    const transactionId = url.searchParams.get("transactionId");

    if (!suggestionId && !transactionId) {
      return new Response(
        JSON.stringify({
          error: "Either suggestionId or transactionId is required",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const conditions = [];
    if (suggestionId) {
      conditions.push(
        eq(schema.suggestionTransactions.suggestionId, suggestionId)
      );
    }
    if (transactionId) {
      conditions.push(
        eq(schema.suggestionTransactions.transactionId, transactionId)
      );
    }

    const links = await db
      .select()
      .from(schema.suggestionTransactions)
      .where(or(...conditions));

    return new Response(JSON.stringify({ links }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error fetching links:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const POST: APIRoute = async ({ request }) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { suggestionId, transactionId, matchType, confidence, notes } = body;

    if (!suggestionId || !transactionId || !matchType) {
      return new Response(
        JSON.stringify({
          error: "suggestionId, transactionId, and matchType are required",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Check if link already exists
    const existing = await db
      .select()
      .from(schema.suggestionTransactions)
      .where(
        and(
          eq(schema.suggestionTransactions.suggestionId, suggestionId),
          eq(schema.suggestionTransactions.transactionId, transactionId)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      return new Response(
        JSON.stringify({ error: "Link already exists", link: existing[0] }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      );
    }

    // Create the link
    const [link] = await db
      .insert(schema.suggestionTransactions)
      .values({
        suggestionId,
        transactionId,
        matchType,
        confidence: confidence || 100,
        notes: notes || null,
      })
      .returning();

    return new Response(JSON.stringify({ success: true, link }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error creating link:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const id = url.searchParams.get("id");

    if (!id) {
      return new Response(JSON.stringify({ error: "Link id is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    await db
      .delete(schema.suggestionTransactions)
      .where(eq(schema.suggestionTransactions.id, id));

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error deleting link:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
