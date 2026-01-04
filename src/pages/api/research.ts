/**
 * Company Research API
 * GET: Get all research documents for a symbol
 * POST: Create a new research document
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../lib/middleware/requireAuth";
import { db, schema } from "../../lib/db";
import { eq, desc } from "drizzle-orm";
import { resolveSymbolToCommodity } from "../../lib/utils/commodity-resolver";

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

    const documents = await db
      .select()
      .from(schema.companyResearch)
      .where(eq(schema.companyResearch.symbol, resolvedSymbol))
      .orderBy(desc(schema.companyResearch.updatedAt));

    return new Response(JSON.stringify({ documents }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Company research GET error:", error);
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
    const { symbol, title, content } = body;

    // Validation
    if (!symbol || !title || !content) {
      return new Response(
        JSON.stringify({
          error: "symbol, title, and content are required",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (title.trim().length === 0) {
      return new Response(
        JSON.stringify({
          error: "Title cannot be empty",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (content.trim().length === 0) {
      return new Response(
        JSON.stringify({
          error: "Content cannot be empty",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Resolve ETF symbols to their underlying commodity
    const resolvedSymbol = await resolveSymbolToCommodity(symbol);

    // Create research document
    const document = await db
      .insert(schema.companyResearch)
      .values({
        symbol: resolvedSymbol,
        title: title.trim(),
        content: content.trim(),
      })
      .returning();

    return new Response(JSON.stringify({ document: document[0] }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Company research POST error:", error);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
