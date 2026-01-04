/**
 * Individual Research Document API
 * GET: Get a single research document
 * PUT: Update a research document
 * DELETE: Delete a research document
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../../lib/middleware/requireAuth";
import { db, schema } from "../../../lib/db";
import { eq } from "drizzle-orm";

export const GET: APIRoute = async ({ request, params }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const { id } = params;

    if (!id) {
      return new Response(
        JSON.stringify({ error: "Document ID is required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const documents = await db
      .select()
      .from(schema.companyResearch)
      .where(eq(schema.companyResearch.id, id));

    if (documents.length === 0) {
      return new Response(JSON.stringify({ error: "Document not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ document: documents[0] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Research GET error:", error);
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
    const { title, content, tags } = body;

    if (!id) {
      return new Response(
        JSON.stringify({ error: "Document ID is required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Validation
    if (title !== undefined && title.trim().length === 0) {
      return new Response(JSON.stringify({ error: "Title cannot be empty" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (content !== undefined && content.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Content cannot be empty" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Build update object
    const updates: {
      title?: string;
      content?: string;
      tags?: string | null;
      updatedAt: string;
    } = {
      updatedAt: new Date().toISOString(),
    };

    if (title !== undefined) {
      updates.title = title.trim();
    }

    if (content !== undefined) {
      updates.content = content.trim();
    }

    if (tags !== undefined) {
      updates.tags = Array.isArray(tags) ? JSON.stringify(tags) : null;
    }

    // Update document
    const document = await db
      .update(schema.companyResearch)
      .set(updates)
      .where(eq(schema.companyResearch.id, id))
      .returning();

    if (document.length === 0) {
      return new Response(JSON.stringify({ error: "Document not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ document: document[0] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Research PUT error:", error);
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
      return new Response(
        JSON.stringify({ error: "Document ID is required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    await db
      .delete(schema.companyResearch)
      .where(eq(schema.companyResearch.id, id));

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Research DELETE error:", error);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
