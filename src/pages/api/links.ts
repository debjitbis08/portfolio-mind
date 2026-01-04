/**
 * Company Links API
 * GET: Get all links for a symbol
 * POST: Create a new link (auto-fetch content)
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../lib/middleware/requireAuth";
import { db, schema } from "../../lib/db";
import { eq, desc } from "drizzle-orm";
import { resolveSymbolToCommodity } from "../../lib/utils/commodity-resolver";
import { fetchLinkContent } from "../../lib/utils/link-fetcher";

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

    const links = await db
      .select()
      .from(schema.companyLinks)
      .where(eq(schema.companyLinks.symbol, resolvedSymbol))
      .orderBy(desc(schema.companyLinks.createdAt));

    return new Response(JSON.stringify({ links }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Company links GET error:", error);
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
    const { symbol, url, title, description, tags } = body;

    // Validation
    if (!symbol || !url) {
      return new Response(
        JSON.stringify({ error: "symbol and url are required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid URL format" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Resolve ETF symbols to their underlying commodity
    const resolvedSymbol = await resolveSymbolToCommodity(symbol);

    // Fetch content from URL
    const fetchResult = await fetchLinkContent(url);

    // Use provided title or fetched title
    const finalTitle =
      title?.trim() || fetchResult.title || new URL(url).hostname;

    // Create link record
    const link = await db
      .insert(schema.companyLinks)
      .values({
        symbol: resolvedSymbol,
        url: url.trim(),
        title: finalTitle,
        description: description?.trim() || null,
        fetchedContent: fetchResult.content || null,
        fetchedAt: fetchResult.success ? new Date().toISOString() : null,
        tags: Array.isArray(tags) ? JSON.stringify(tags) : null,
      })
      .returning();

    return new Response(
      JSON.stringify({
        link: link[0],
        fetchStatus: {
          success: fetchResult.success,
          error: fetchResult.error,
        },
      }),
      {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Company links POST error:", error);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
