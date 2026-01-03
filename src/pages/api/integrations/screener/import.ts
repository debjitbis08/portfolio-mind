/**
 * Screener Import API
 * POST: Import symbols from screener.in screens
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../../../lib/middleware/requireAuth";
import { ScreenerService } from "../../../../lib/scrapers/screener";

export const POST: APIRoute = async ({ request }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { email, password, screenUrl, screenUrls } = body;

    // Support both single URL (backward compat) and multiple URLs
    const urls: string[] = screenUrls || (screenUrl ? [screenUrl] : []);

    if (!email || urls.length === 0) {
      return new Response(
        JSON.stringify({ error: "Email and at least one Screen URL required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Run Import - pass empty string for userId (not used in single-user mode)
    console.log(`[Import API] Starting import for ${urls.length} URLs...`);

    const result = await ScreenerService.importScreens("", {
      email,
      password,
      screenUrls: urls,
    });

    // Trigger Intel Update (Async) for all symbols
    if (result.totalSymbols > 0) {
      const allSymbols = result.results.flatMap((r) => r.symbols);
      const { IntelService } = await import("../../../../lib/intel");
      IntelService.updateFundamentals(allSymbols).catch((err) =>
        console.error("Background intel update failed:", err)
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        imported: result.totalSymbols,
        results: result.results,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Import API Error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Import failed",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
