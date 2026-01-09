/**
 * Concalls API
 *
 * Endpoints for processing and retrieving concall highlights.
 */

import type { APIRoute } from "astro";
import { db, schema } from "../../lib/db";
import { eq, desc } from "drizzle-orm";
import {
  processConcallPDF,
  saveConcallHighlights,
  getConcallHighlights,
  scrapeScreenerDocuments,
  type DocumentLink,
} from "../../lib/scrapers/concall-processor";
import { getSymbolForStock } from "../../lib/mappings";

// ============================================================================
// POST /api/concalls - Process a concall PDF
// ============================================================================

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    let { symbol, pdfUrl, quarter, screenerUrl, email, password } = body;

    if (!symbol) {
      return new Response(JSON.stringify({ error: "Symbol is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // If screenerUrl provided but no credentials, fetch from database
    if (screenerUrl && !email) {
      const settings = await db
        .select()
        .from(schema.settings)
        .where(eq(schema.settings.id, 1))
        .limit(1);

      const data = settings[0];
      if (data?.screenerEmail && data?.screenerPassword) {
        email = data.screenerEmail;
        password = data.screenerPassword;
      } else {
        return new Response(
          JSON.stringify({
            error:
              "Screener credentials not configured. Please set them in Settings.",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // If screenerUrl provided, auto-discover and process transcripts
    if (screenerUrl && email) {
      // Apply symbol mapping before scraping
      const watchlistRecord = await db
        .select()
        .from(schema.watchlist)
        .where(eq(schema.watchlist.symbol, symbol))
        .limit(1);

      const companyName = watchlistRecord[0]?.name || symbol;
      const mappedSymbol = await getSymbolForStock(companyName, symbol);

      console.log(`[Concalls API] Mapped ${symbol} -> ${mappedSymbol}`);

      // Reconstruct URL with mapped symbol
      const mappedUrl = `https://www.screener.in/company/${mappedSymbol}/`;

      const documents = await scrapeScreenerDocuments(
        mappedUrl,
        email,
        password
      );
      // Group documents by quarter to handle mixed availability
      const docsByQuarter = new Map<string, DocumentLink[]>();

      documents.forEach((doc) => {
        // Use quarter if available, otherwise title (fallback behavior)
        const key = doc.quarter || doc.title;
        if (!docsByQuarter.has(key)) {
          docsByQuarter.set(key, []);
        }
        docsByQuarter.get(key)?.push(doc);
      });

      const processedDocs: DocumentLink[] = [];
      const priority = {
        transcript: 0,
        presentation: 1,
        summary: 2,
        annual_report: 3,
        other: 4,
      };

      // For each quarter, pick the best document
      for (const [quarter, quarterDocs] of docsByQuarter) {
        // Sort by priority
        quarterDocs.sort((a, b) => {
          const pA = priority[a.type as keyof typeof priority] ?? 99;
          const pB = priority[b.type as keyof typeof priority] ?? 99;
          return pA - pB;
        });

        // Pick top (best type)
        // We filter for supported types
        const bestDoc = quarterDocs.find((d) =>
          ["transcript", "presentation", "summary"].includes(d.type)
        );

        if (bestDoc) {
          processedDocs.push(bestDoc);
        }
      }

      // `processedDocs` are based on Map iteration which preserves insertion order (Screener list order).
      // We take up to 4.
      const targetDocuments = processedDocs.slice(0, 4);

      if (targetDocuments.length === 0) {
        return new Response(
          JSON.stringify({
            success: true,
            message:
              "No relevant documents (Transcript, Presentation, or Summary) found on Screener",
            documents: documents.map((d) => ({ title: d.title, type: d.type })),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // Process each target document
      const results = [];
      for (const doc of targetDocuments) {
        try {
          console.log(
            `[Concalls API] Processing ${doc.type} for ${
              doc.quarter || doc.title
            }`
          );
          const highlights = await processConcallPDF(
            doc.url,
            doc.quarter || "Unknown"
          );

          console.log(
            `[Concalls API] Attempting to save highlights for ${symbol}...`
          );
          await saveConcallHighlights(symbol, highlights);
          console.log(
            `[Concalls API] ✓ Successfully saved highlights for ${symbol} - ${highlights.quarter}`
          );

          results.push({
            quarter: doc.quarter,
            title: doc.title,
            success: true,
            type: doc.type,
          });
        } catch (error) {
          console.error(`[Concalls API] Error processing ${doc.title}:`, error);
          results.push({
            quarter: doc.quarter,
            title: doc.title,
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          symbol,
          processedCount: results.filter((r) => r.success).length,
          results,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Single PDF processing
    if (!pdfUrl) {
      return new Response(
        JSON.stringify({
          error: "Either pdfUrl or screenerUrl required",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!quarter) {
      return new Response(JSON.stringify({ error: "Quarter is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const highlights = await processConcallPDF(pdfUrl, quarter);
    await saveConcallHighlights(symbol, highlights);

    return new Response(
      JSON.stringify({
        success: true,
        symbol,
        quarter,
        highlights,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[Concalls API] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

// ============================================================================
// GET /api/concalls - Get concall highlights for a symbol
// ============================================================================

export const GET: APIRoute = async ({ url }) => {
  try {
    const symbolParam = url.searchParams.get("symbol");

    if (!symbolParam) {
      return new Response(
        JSON.stringify({ error: "Symbol query param required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const symbol = symbolParam.toUpperCase();
    const highlights = await getConcallHighlights(symbol);

    return new Response(
      JSON.stringify({
        symbol,
        count: highlights.length,
        highlights,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[Concalls API] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
