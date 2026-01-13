/**
 * Catalyst Trades API
 *
 * Returns broker + intraday trades for the catalyst portfolio.
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../../lib/middleware/requireAuth";
import { getCatalystTrades } from "../../../lib/catalyst/trades";

export const GET: APIRoute = async ({ request }) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const trades = await getCatalystTrades();
    return new Response(JSON.stringify({ trades }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[Catalyst Trades] API error:", error);
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
