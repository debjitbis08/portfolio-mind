/**
 * Individual Table API
 * GET: Get a single table with its rows
 * PUT: Update table name or columns
 * DELETE: Delete table (cascades to rows)
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../../lib/middleware/requireAuth";
import { db, schema } from "../../../lib/db";
import { eq } from "drizzle-orm";
import type { ColumnDefinition } from "../tables";

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

    const table = tables[0];

    // Get all rows for this table
    const rows = await db
      .select()
      .from(schema.userTableRows)
      .where(eq(schema.userTableRows.tableId, id));

    return new Response(
      JSON.stringify({
        table: {
          ...table,
          columns: JSON.parse(table.columns) as ColumnDefinition[],
        },
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
    console.error("Table GET error:", error);
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
    const { name, columns } = body;

    if (!id) {
      return new Response(JSON.stringify({ error: "Table ID is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check if table exists
    const existing = await db
      .select()
      .from(schema.userTables)
      .where(eq(schema.userTables.id, id));

    if (existing.length === 0) {
      return new Response(JSON.stringify({ error: "Table not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Build update object
    const updates: {
      name?: string;
      columns?: string;
      updatedAt?: string;
    } = {
      updatedAt: new Date().toISOString(),
    };

    if (name !== undefined) {
      if (name.trim().length === 0) {
        return new Response(JSON.stringify({ error: "Name cannot be empty" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      updates.name = name.trim();
    }

    if (columns !== undefined) {
      if (!Array.isArray(columns) || columns.length === 0) {
        return new Response(
          JSON.stringify({ error: "At least one column is required" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Validate column definitions
      const validTypes = [
        "text",
        "number",
        "percent",
        "date",
        "checkbox",
        "select",
        "url",
      ];
      for (const col of columns) {
        if (!col.id || !col.name || !col.type) {
          return new Response(
            JSON.stringify({
              error: "Each column must have id, name, and type",
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        if (!validTypes.includes(col.type)) {
          return new Response(
            JSON.stringify({
              error: `Invalid column type: ${col.type}`,
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
      }

      updates.columns = JSON.stringify(columns);
    }

    // Update table
    const table = await db
      .update(schema.userTables)
      .set(updates)
      .where(eq(schema.userTables.id, id))
      .returning();

    return new Response(
      JSON.stringify({
        table: {
          ...table[0],
          columns: JSON.parse(table[0].columns) as ColumnDefinition[],
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Table PUT error:", error);
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
      return new Response(JSON.stringify({ error: "Table ID is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Delete table (rows cascade automatically via FK)
    await db.delete(schema.userTables).where(eq(schema.userTables.id, id));

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Table DELETE error:", error);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
