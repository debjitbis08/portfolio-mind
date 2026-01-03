/**
 * Commodity Holdings API
 *
 * CRUD operations for managing physical commodity holdings
 * (gold bars, silver coins, SGBs, digital gold, etc.)
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../lib/middleware/requireAuth";
import { db, schema } from "../../lib/db";
import { eq } from "drizzle-orm";

// Types
interface CommodityHoldingInput {
  commodityType:
    | "GOLD"
    | "SILVER"
    | "PLATINUM"
    | "COPPER"
    | "CRUDE_OIL"
    | "OTHER";
  name: string;
  holdingType?: "PHYSICAL" | "SGB" | "DIGITAL" | "OTHER";
  quantity: number;
  unit?: "GRAM" | "KG" | "OZ" | "UNIT";
  purchasePrice: number;
  purchaseDate: string;
  notes?: string;
}

/**
 * GET /api/commodity-holdings
 * List all commodity holdings with current values
 */
export const GET: APIRoute = async ({ request }) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const holdings = await db.select().from(schema.commodityHoldings);

    // Calculate values for each holding
    const enrichedHoldings = holdings.map((h) => {
      const investedValue = h.quantity * h.purchasePrice;
      return {
        id: h.id,
        commodityType: h.commodityType,
        name: h.name,
        holdingType: h.holdingType,
        quantity: h.quantity,
        unit: h.unit,
        purchasePrice: h.purchasePrice,
        purchaseDate: h.purchaseDate,
        investedValue,
        notes: h.notes,
        createdAt: h.createdAt,
        updatedAt: h.updatedAt,
      };
    });

    // Group by commodity type for summary
    const summary: Record<
      string,
      { totalQuantity: number; totalValue: number; unit: string }
    > = {};
    for (const h of enrichedHoldings) {
      const type = h.commodityType;
      if (!summary[type]) {
        summary[type] = {
          totalQuantity: 0,
          totalValue: 0,
          unit: h.unit || "GRAM",
        };
      }
      // Convert to base unit (grams) for aggregation
      let quantityInGrams = h.quantity;
      if (h.unit === "KG") quantityInGrams = h.quantity * 1000;
      if (h.unit === "OZ") quantityInGrams = h.quantity * 31.1035;

      summary[type].totalQuantity += quantityInGrams;
      summary[type].totalValue += h.investedValue;
    }

    return new Response(
      JSON.stringify({
        holdings: enrichedHoldings,
        summary,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Commodity Holdings GET error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};

/**
 * POST /api/commodity-holdings
 * Add a new commodity holding
 */
export const POST: APIRoute = async ({ request }) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const body = (await request.json()) as CommodityHoldingInput;

    // Validation
    if (
      !body.commodityType ||
      !body.name ||
      !body.quantity ||
      !body.purchasePrice ||
      !body.purchaseDate
    ) {
      return new Response(
        JSON.stringify({
          error:
            "Missing required fields: commodityType, name, quantity, purchasePrice, purchaseDate",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const validTypes = [
      "GOLD",
      "SILVER",
      "PLATINUM",
      "COPPER",
      "CRUDE_OIL",
      "OTHER",
    ];
    if (!validTypes.includes(body.commodityType)) {
      return new Response(
        JSON.stringify({
          error: `Invalid commodityType. Must be one of: ${validTypes.join(
            ", "
          )}`,
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const [inserted] = await db
      .insert(schema.commodityHoldings)
      .values({
        commodityType: body.commodityType,
        name: body.name,
        holdingType: body.holdingType || "PHYSICAL",
        quantity: body.quantity,
        unit: body.unit || "GRAM",
        purchasePrice: body.purchasePrice,
        purchaseDate: body.purchaseDate,
        notes: body.notes,
      })
      .returning();

    return new Response(JSON.stringify({ success: true, holding: inserted }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Commodity Holdings POST error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};

/**
 * PUT /api/commodity-holdings
 * Update an existing commodity holding
 */
export const PUT: APIRoute = async ({ request }) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const body = (await request.json()) as CommodityHoldingInput & {
      id: string;
    };

    if (!body.id) {
      return new Response(
        JSON.stringify({ error: "Missing required field: id" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const [updated] = await db
      .update(schema.commodityHoldings)
      .set({
        commodityType: body.commodityType,
        name: body.name,
        holdingType: body.holdingType,
        quantity: body.quantity,
        unit: body.unit,
        purchasePrice: body.purchasePrice,
        purchaseDate: body.purchaseDate,
        notes: body.notes,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.commodityHoldings.id, body.id))
      .returning();

    if (!updated) {
      return new Response(
        JSON.stringify({ error: "Commodity holding not found" }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify({ success: true, holding: updated }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Commodity Holdings PUT error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};

/**
 * DELETE /api/commodity-holdings
 * Delete a commodity holding
 */
export const DELETE: APIRoute = async ({ request }) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return new Response(
        JSON.stringify({ error: "Missing required query param: id" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const [deleted] = await db
      .delete(schema.commodityHoldings)
      .where(eq(schema.commodityHoldings.id, id))
      .returning();

    if (!deleted) {
      return new Response(
        JSON.stringify({ error: "Commodity holding not found" }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify({ success: true, deleted: id }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Commodity Holdings DELETE error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};
