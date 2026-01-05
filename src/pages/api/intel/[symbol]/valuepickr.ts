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

export const POST: APIRoute = async ({ params, request }) => {
  const { symbol } = params;
  if (!symbol) {
    return new Response(JSON.stringify({ error: "Symbol required" }), {
      status: 400,
    });
  }

  try {
    let url = null;
    try {
      const body = await request.json();
      url = body.url;
    } catch (e) {
      // Request body might be empty for refresh calls
    }

    let socialSentiment = null;

    const { ValuePickrService } = await import(
      "../../../../lib/scrapers/valuepickr"
    );

    if (url) {
      // Manual Add Mode
      console.log(`[ValuePickr] Manual add for ${symbol}: ${url}`);
      socialSentiment = await ValuePickrService.getResearchFromUrl(url);
    } else {
      // Refresh Mode
      console.log(`[ValuePickr] Refreshing for ${symbol}`);

      // Check if we already have a URL to refresh from
      const currentIntel = await db.query.stockIntel.findFirst({
        where: eq(schema.stockIntel.symbol, symbol),
      });

      let currentUrl = null;
      if (currentIntel?.socialSentiment) {
        try {
          const parsed = JSON.parse(currentIntel.socialSentiment);
          currentUrl = parsed.topic_url;
        } catch (e) {
          // ignore
        }
      }

      if (currentUrl) {
        // Refresh existing URL
        socialSentiment = await ValuePickrService.getResearchFromUrl(
          currentUrl
        );
      } else {
        // Try auto-discovery again
        // Clean name logic similar to intel.ts
        // For simplicity, we'll just try the symbol or fetch the name if possible.
        // Let's grab the name from fundamentals if available
        let searchName = symbol;
        if (currentIntel?.fundamentals) {
          // This is complex because we don't have the fundamentals object structure explicitly typed here easily
          // But we can try to fall back to symbol or just ask the scraper to search the symbol
        }

        // Better: Just use the symbol for search as the scraper handles it?
        // scraper.searchThread(symbol) might work if symbol is "TATACHEM" but forum title has "Tata Chemicals".
        // The scraper logic isn't perfect for "Symbol" -> "Name" conversion.
        // Ideally we should replicate the clean name logic from intel.ts or reuse it.
        // For now, let's just trigger a search with the symbol. If it fails, the user can manually add the URL.
        socialSentiment = await ValuePickrService.getResearch(symbol);
      }
    }

    if (!socialSentiment) {
      return new Response(
        JSON.stringify({ error: "Could not fetch ValuePickr data" }),
        { status: 404 }
      );
    }

    // Update DB
    await db
      .insert(schema.stockIntel)
      .values({
        symbol,
        socialSentiment: JSON.stringify(socialSentiment),
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: schema.stockIntel.symbol,
        set: {
          socialSentiment: JSON.stringify(socialSentiment),
          updatedAt: new Date().toISOString(),
        },
      });

    return new Response(
      JSON.stringify({ success: true, data: socialSentiment }),
      {
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error updating ValuePickr data:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
    });
  }
};
