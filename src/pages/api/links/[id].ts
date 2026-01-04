/**
 * Individual Link API
 * GET: Get a single link
 * PUT: Update a link (title, description, or re-fetch content)
 * DELETE: Delete a link
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../../lib/middleware/requireAuth";
import { db, schema } from "../../../lib/db";
import { eq } from "drizzle-orm";
import { fetchLinkContent } from "../../../lib/utils/link-fetcher";

export const GET: APIRoute = async ({ request, params }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const { id } = params;

    if (!id) {
      return new Response(JSON.stringify({ error: "Link ID is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const links = await db
      .select()
      .from(schema.companyLinks)
      .where(eq(schema.companyLinks.id, id));

    if (links.length === 0) {
      return new Response(JSON.stringify({ error: "Link not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ link: links[0] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Link GET error:", error);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const PUT: APIRoute = async ({ request, params }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const { id } = params;
    const body = await request.json();
    const { title, description, refetch } = body;

    if (!id) {
      return new Response(JSON.stringify({ error: "Link ID is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get the existing link
    const existing = await db
      .select()
      .from(schema.companyLinks)
      .where(eq(schema.companyLinks.id, id));

    if (existing.length === 0) {
      return new Response(JSON.stringify({ error: "Link not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const currentLink = existing[0];

    // Build update object
    const updates: {
      title?: string;
      description?: string | null;
      fetchedContent?: string | null;
      fetchedAt?: string | null;
    } = {};

    if (title !== undefined) {
      if (title.trim().length === 0) {
        return new Response(
          JSON.stringify({ error: "Title cannot be empty" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      updates.title = title.trim();
    }

    if (description !== undefined) {
      updates.description = description?.trim() || null;
    }

    // Re-fetch content if requested
    let fetchStatus = null;
    if (refetch === true) {
      const fetchResult = await fetchLinkContent(currentLink.url);
      updates.fetchedContent = fetchResult.content || null;
      updates.fetchedAt = fetchResult.success ? new Date().toISOString() : null;
      fetchStatus = {
        success: fetchResult.success,
        error: fetchResult.error,
      };
    }

    // Update link
    const link = await db
      .update(schema.companyLinks)
      .set(updates)
      .where(eq(schema.companyLinks.id, id))
      .returning();

    return new Response(
      JSON.stringify({
        link: link[0],
        ...(fetchStatus && { fetchStatus }),
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Link PUT error:", error);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const DELETE: APIRoute = async ({ request, params }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const { id } = params;

    if (!id) {
      return new Response(JSON.stringify({ error: "Link ID is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    await db.delete(schema.companyLinks).where(eq(schema.companyLinks.id, id));

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Link DELETE error:", error);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
