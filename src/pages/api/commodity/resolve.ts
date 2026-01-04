/**
 * Commodity Resolver API
 * GET: Resolve a symbol to its underlying commodity and get display name
 */

import type { APIRoute } from "astro";
import { getSymbolDisplayName } from "../../../lib/utils/commodity-resolver";

export const GET: APIRoute = async ({ url }) => {
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

    const result = await getSymbolDisplayName(symbol);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Commodity resolver GET error:", error);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
