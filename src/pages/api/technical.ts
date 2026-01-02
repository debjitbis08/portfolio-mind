/**
 * Technical Data API
 * GET: Fetch technical data for all holdings
 * POST: Refresh technical data
 */

import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import {
  getTechnicalData,
  type TechnicalData,
} from "../../lib/technical-indicators";

// Symbol mapping (same as holdings.ts)
const SYMBOL_MAP: Record<string, string> = {
  GODAWARIP: "GPIL",
};

function mapToYahooSymbol(growwSymbol: string): string {
  return SYMBOL_MAP[growwSymbol] || growwSymbol;
}

export const GET: APIRoute = async ({ cookies }) => {
  try {
    const accessToken = cookies.get("sb-access-token")?.value;
    const refreshToken = cookies.get("sb-refresh-token")?.value;

    if (!accessToken || !refreshToken) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
    const supabaseKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    // Get cached technical data
    const { data: technicalData, error } = await supabase
      .from("technical_data")
      .select("*");

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ data: technicalData || [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const POST: APIRoute = async ({ cookies }) => {
  try {
    const accessToken = cookies.get("sb-access-token")?.value;
    const refreshToken = cookies.get("sb-refresh-token")?.value;

    if (!accessToken || !refreshToken) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
    const supabaseKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
    const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

    const supabase = createClient(supabaseUrl, supabaseKey);
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const { data: sessionData } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (!sessionData.session?.user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get user's holdings
    const { data: holdings, error: holdingsError } = await supabase
      .from("holdings")
      .select("symbol");

    if (holdingsError || !holdings) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch holdings" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Get unique symbols with Yahoo mapping
    const symbols = [
      ...new Set(holdings.map((h) => mapToYahooSymbol(h.symbol))),
    ];

    const results: TechnicalData[] = [];
    const errors: string[] = [];

    // Fetch technical data for each symbol
    for (const symbol of symbols) {
      try {
        const data = await getTechnicalData(symbol);
        if (data) {
          results.push(data);

          // Store in database
          await supabaseAdmin.from("technical_data").upsert(
            {
              symbol,
              current_price: data.currentPrice,
              rsi_14: data.rsi14,
              sma_50: data.sma50,
              sma_200: data.sma200,
              price_vs_sma50: data.priceVsSma50,
              price_vs_sma200: data.priceVsSma200,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "symbol" }
          );
        }
      } catch (err) {
        errors.push(`${symbol}: ${err}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        updated: results.length,
        errors: errors.length > 0 ? errors : undefined,
        data: results,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
