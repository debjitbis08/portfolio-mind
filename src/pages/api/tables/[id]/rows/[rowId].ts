/**
 * Individual Row API
 * PUT: Update a row
 * DELETE: Delete a row
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../../../../lib/middleware/requireAuth";
import { db, schema } from "../../../../../lib/db";
import { eq, and } from "drizzle-orm";

export const PUT: APIRoute = async ({ request, params }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const { id, rowId } = params;
    const body = await request.json();
    const { data } = body;

    if (!id || !rowId) {
      return new Response(
        JSON.stringify({ error: "Table ID and Row ID are required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (!data || typeof data !== "object") {
      return new Response(JSON.stringify({ error: "Row data is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check if row exists and belongs to the table
    const existing = await db
      .select()
      .from(schema.userTableRows)
      .where(
        and(
          eq(schema.userTableRows.id, rowId),
          eq(schema.userTableRows.tableId, id)
        )
      );

    if (existing.length === 0) {
      return new Response(JSON.stringify({ error: "Row not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Update row
    const row = await db
      .update(schema.userTableRows)
      .set({
        data: JSON.stringify(data),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.userTableRows.id, rowId))
      .returning();

    return new Response(
      JSON.stringify({
        row: {
          ...row[0],
          data: JSON.parse(row[0].data),
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Row PUT error:", error);
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
    const { id, rowId } = params;

    if (!id || !rowId) {
      return new Response(
        JSON.stringify({ error: "Table ID and Row ID are required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Delete row
    await db
      .delete(schema.userTableRows)
      .where(
        and(
          eq(schema.userTableRows.id, rowId),
          eq(schema.userTableRows.tableId, id)
        )
      );

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Row DELETE error:", error);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
