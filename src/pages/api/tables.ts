/**
 * User Tables API
 * GET: Get all tables for a symbol
 * POST: Create a new table
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../lib/middleware/requireAuth";
import { db, schema } from "../../lib/db";
import { eq, desc } from "drizzle-orm";
import { resolveSymbolToCommodity } from "../../lib/utils/commodity-resolver";

export interface ColumnDefinition {
  id: string;
  name: string;
  type: "text" | "number" | "percent" | "date" | "checkbox" | "select" | "url";
  options?: string[]; // For select type only
}

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

    const tables = await db
      .select()
      .from(schema.userTables)
      .where(eq(schema.userTables.symbol, resolvedSymbol))
      .orderBy(desc(schema.userTables.createdAt));

    // Get row counts for each table
    const tablesWithCounts = await Promise.all(
      tables.map(async (table) => {
        const rows = await db
          .select()
          .from(schema.userTableRows)
          .where(eq(schema.userTableRows.tableId, table.id));
        return {
          ...table,
          columns: JSON.parse(table.columns) as ColumnDefinition[],
          rowCount: rows.length,
        };
      })
    );

    return new Response(JSON.stringify({ tables: tablesWithCounts }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Tables GET error:", error);
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
    const { symbol, name, columns } = body;

    // Validation
    if (!symbol || !name) {
      return new Response(
        JSON.stringify({ error: "symbol and name are required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (!columns || !Array.isArray(columns) || columns.length === 0) {
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
            error: `Invalid column type: ${
              col.type
            }. Valid types: ${validTypes.join(", ")}`,
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      if (col.type === "select" && (!col.options || col.options.length === 0)) {
        return new Response(
          JSON.stringify({
            error: `Select column "${col.name}" must have options`,
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
    }

    // Resolve ETF symbols to their underlying commodity
    const resolvedSymbol = await resolveSymbolToCommodity(symbol);

    // Create table record
    const table = await db
      .insert(schema.userTables)
      .values({
        symbol: resolvedSymbol,
        name: name.trim(),
        columns: JSON.stringify(columns),
      })
      .returning();

    return new Response(
      JSON.stringify({
        table: {
          ...table[0],
          columns: JSON.parse(table[0].columns) as ColumnDefinition[],
          rowCount: 0,
        },
      }),
      {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Tables POST error:", error);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
