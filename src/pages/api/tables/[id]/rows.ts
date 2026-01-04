/**
 * Table Rows API
 * GET: Get all rows for a table
 * POST: Create a new row
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../../../lib/middleware/requireAuth";
import { db, schema } from "../../../../lib/db";
import { eq, desc } from "drizzle-orm";

export const GET: APIRoute = async ({ request, params }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const { id } = params;

    if (!id) {
      return new Response(JSON.stringify({ error: "Table ID is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Verify table exists
    const tables = await db
      .select()
      .from(schema.userTables)
      .where(eq(schema.userTables.id, id));

    if (tables.length === 0) {
      return new Response(JSON.stringify({ error: "Table not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const rows = await db
      .select()
      .from(schema.userTableRows)
      .where(eq(schema.userTableRows.tableId, id))
      .orderBy(desc(schema.userTableRows.createdAt));

    return new Response(
      JSON.stringify({
        rows: rows.map((row) => ({
          ...row,
          data: JSON.parse(row.data),
        })),
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Table rows GET error:", error);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const POST: APIRoute = async ({ request, params }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const { id } = params;
    const body = await request.json();
    const { data } = body;

    if (!id) {
      return new Response(JSON.stringify({ error: "Table ID is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!data || typeof data !== "object") {
      return new Response(JSON.stringify({ error: "Row data is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Verify table exists
    const tables = await db
      .select()
      .from(schema.userTables)
      .where(eq(schema.userTables.id, id));

    if (tables.length === 0) {
      return new Response(JSON.stringify({ error: "Table not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Create row
    const row = await db
      .insert(schema.userTableRows)
      .values({
        tableId: id,
        data: JSON.stringify(data),
      })
      .returning();

    return new Response(
      JSON.stringify({
        row: {
          ...row[0],
          data: JSON.parse(row[0].data),
        },
      }),
      {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Table rows POST error:", error);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
