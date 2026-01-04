/**
 * Action Notes API
 * GET: Get all notes for a suggestion
 * POST: Create a new note for a suggestion
 * DELETE: Delete a note
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../../lib/middleware/requireAuth";
import { db, schema } from "../../../lib/db";
import { eq, desc } from "drizzle-orm";

export const GET: APIRoute = async ({ request, url }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const suggestionId = url.searchParams.get("suggestionId");

    if (!suggestionId) {
      return new Response(
        JSON.stringify({ error: "suggestionId parameter is required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const notes = await db
      .select()
      .from(schema.actionNotes)
      .where(eq(schema.actionNotes.suggestionId, suggestionId))
      .orderBy(desc(schema.actionNotes.createdAt));

    return new Response(JSON.stringify({ notes }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Action notes GET error:", error);
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
    const { suggestionId, content } = body;

    // Validation
    if (!suggestionId || !content) {
      return new Response(
        JSON.stringify({
          error: "suggestionId and content are required",
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

    // Verify suggestion exists
    const suggestion = await db
      .select()
      .from(schema.suggestions)
      .where(eq(schema.suggestions.id, suggestionId))
      .limit(1);

    if (suggestion.length === 0) {
      return new Response(
        JSON.stringify({
          error: "Suggestion not found",
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Create note
    const note = await db
      .insert(schema.actionNotes)
      .values({
        suggestionId,
        content,
      })
      .returning();

    return new Response(JSON.stringify({ note: note[0] }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Action notes POST error:", error);
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

    await db.delete(schema.actionNotes).where(eq(schema.actionNotes.id, id));

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Action notes DELETE error:", error);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
