/**
 * API endpoint to fetch potential catalysts (discovered but not yet confirmed)
 */

import type { APIRoute } from "astro";
import { db } from "../../../lib/db";
import { potentialCatalysts } from "../../../lib/db/schema";
import { eq, desc, or } from "drizzle-orm";

export const GET: APIRoute = async ({ request, url }) => {
  try {
    const status = url.searchParams.get("status");

    let query = db.select().from(potentialCatalysts);

    // Filter by status if provided
    if (status && status !== "all") {
      query = query.where(eq(potentialCatalysts.status, status as any));
    } else {
      // Default: show monitoring and confirmed potentials
      query = query.where(
        or(
          eq(potentialCatalysts.status, "monitoring"),
          eq(potentialCatalysts.status, "confirmed")
        )
      );
    }

    const results = await query.orderBy(desc(potentialCatalysts.createdAt));

    // Parse JSON fields
    const potentials = results.map((p) => ({
      ...p,
      affectedSymbols: JSON.parse(p.affectedSymbols || "[]"),
      watchCriteria: JSON.parse(p.watchCriteria || "{}"),
      relatedArticleIds: JSON.parse(p.relatedArticleIds || "[]"),
      sourceCitations: JSON.parse(p.sourceCitations || "[]"),
      validationLog: JSON.parse(p.validationLog || "[]"),
    }));

    return new Response(JSON.stringify(potentials), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("Error fetching potential catalysts:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to fetch potential catalysts",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }
};

/**
 * POST: Confirm or invalidate a potential catalyst
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const { id, action } = await request.json();

    if (!id || !action) {
      return new Response(
        JSON.stringify({ error: "Missing id or action" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (action === "confirm") {
      // Update status to confirmed
      await db
        .update(potentialCatalysts)
        .set({
          status: "confirmed",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(potentialCatalysts.id, id));
    } else if (action === "invalidate") {
      // Update status to invalidated
      await db
        .update(potentialCatalysts)
        .set({
          status: "invalidated",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(potentialCatalysts.id, id));
    } else {
      return new Response(
        JSON.stringify({ error: "Invalid action" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error updating potential catalyst:", error);
    return new Response(
      JSON.stringify({ error: "Failed to update potential catalyst" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};
