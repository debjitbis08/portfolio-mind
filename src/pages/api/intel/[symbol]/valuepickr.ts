import type { APIRoute } from "astro";
import { db, schema } from "../../../../lib/db";
import { eq } from "drizzle-orm";

export const DELETE: APIRoute = async ({ params }) => {
  const { symbol } = params;
  if (!symbol) {
    return new Response(JSON.stringify({ error: "Symbol required" }), {
      status: 400,
    });
  }

  try {
    // 1. Fetch current intel
    const intel = await db.query.stockIntel.findFirst({
      where: eq(schema.stockIntel.symbol, symbol),
    });

    if (!intel) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
      });
    }

    // 2. Remove only socialSentiment (where ValuePickr data lives)
    // We keep fundamentals and newsSentiment
    await db
      .update(schema.stockIntel)
      .set({
        socialSentiment: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.stockIntel.symbol, symbol));

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
    });
  } catch (error) {
    console.error("Error deleting ValuePickr data:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
    });
  }
};
