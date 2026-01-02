/**
 * Discovery Cycle API
 * POST: Run a discovery cycle to analyze holdings and generate suggestions
 * GET: Get cycle history
 */

import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { GeminiService, type HoldingForAnalysis } from "../../../lib/gemini";

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

    const userId = sessionData.session.user.id;

    // Create cycle run record
    const { data: cycleRun, error: cycleError } = await supabaseAdmin
      .from("cycle_runs")
      .insert({ user_id: userId })
      .select()
      .single();

    if (cycleError || !cycleRun) {
      return new Response(JSON.stringify({ error: "Failed to create cycle" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      // Query holdings directly from database (avoid internal fetch issues)
      const { data: dbHoldings, error: holdingsError } = await supabase
        .from("holdings")
        .select("*");

      if (holdingsError || !dbHoldings || dbHoldings.length === 0) {
        throw new Error(holdingsError?.message || "No holdings found");
      }

      // Fetch technical data
      const { data: technicalData } = await supabase
        .from("technical_data")
        .select("*");

      const techMap = new Map<string, any>();
      if (technicalData) {
        for (const t of technicalData) {
          techMap.set(t.symbol, t);
        }
      }

      // Build holdings with tech data for Gemini
      const holdings: HoldingForAnalysis[] = dbHoldings.map((h: any) => {
        const tech =
          techMap.get(h.symbol) ||
          techMap.get(`${h.symbol}.NS`) ||
          techMap.get(`${h.symbol}.BO`);

        const priceVsSma50 = tech?.price_vs_sma50
          ? Number(tech.price_vs_sma50)
          : null;
        const priceVsSma200 = tech?.price_vs_sma200
          ? Number(tech.price_vs_sma200)
          : null;
        const rsi14 = tech?.rsi_14 ? Number(tech.rsi_14) : null;

        // Build wait reasons
        const waitReasons: string[] = [];
        if (rsi14 && rsi14 > 40) waitReasons.push(`RSI ${rsi14.toFixed(0)}`);
        if (priceVsSma50 && priceVsSma50 > 15)
          waitReasons.push(`+${priceVsSma50.toFixed(0)}% SMA50`);
        if (priceVsSma200 && priceVsSma200 > 15)
          waitReasons.push(`+${priceVsSma200.toFixed(0)}% SMA200`);
        if (
          tech?.sma_200 &&
          tech?.current_price &&
          Number(tech.current_price) < Number(tech.sma_200)
        ) {
          waitReasons.push("Below SMA200");
        }

        return {
          symbol: h.symbol,
          stock_name: h.stock_name,
          quantity: h.quantity,
          avg_buy_price: h.avg_buy_price,
          current_price: tech?.current_price || 0,
          returns_percent:
            h.avg_buy_price > 0 && tech?.current_price
              ? ((Number(tech.current_price) - h.avg_buy_price) /
                  h.avg_buy_price) *
                100
              : 0,
          rsi_14: rsi14,
          price_vs_sma50: priceVsSma50,
          price_vs_sma200: priceVsSma200,
          is_wait_zone: waitReasons.length > 0,
          wait_reasons: waitReasons,
        };
      });

      // Run Gemini analysis
      const suggestions = await GeminiService.analyzePortfolio(holdings);

      // Store suggestions
      const suggestionRecords = suggestions.map((s) => ({
        user_id: userId,
        cycle_id: cycleRun.id,
        symbol: s.symbol,
        stock_name: s.stock_name,
        action: s.action,
        rationale: s.rationale,
        technical_score: s.technical_score,
        current_price: holdings.find((h) => h.symbol === s.symbol)
          ?.current_price,
        // New fields for BUY/SELL/MOVE actions
        quantity: s.quantity,
        allocation_amount: s.allocation_amount,
        sell_symbol: s.sell_symbol,
        sell_quantity: s.sell_quantity,
      }));

      const { error: insertError } = await supabaseAdmin
        .from("suggestions")
        .insert(suggestionRecords);

      if (insertError) {
        console.error("Failed to insert suggestions:", insertError);
      }

      // Update cycle as completed
      await supabaseAdmin
        .from("cycle_runs")
        .update({
          completed_at: new Date().toISOString(),
          symbols_analyzed: holdings.length,
          suggestions_count: suggestions.length,
          status: "completed",
        })
        .eq("id", cycleRun.id);

      return new Response(
        JSON.stringify({
          success: true,
          cycle_id: cycleRun.id,
          analyzed: holdings.length,
          suggestions: suggestions,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (err) {
      // Mark cycle as failed
      await supabaseAdmin
        .from("cycle_runs")
        .update({
          completed_at: new Date().toISOString(),
          status: "failed",
          error_message: err instanceof Error ? err.message : "Unknown error",
        })
        .eq("id", cycleRun.id);

      throw err;
    }
  } catch (error) {
    console.error("Cycle error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Cycle failed",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};

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

    // Get recent cycles
    const { data: cycles, error } = await supabase
      .from("cycle_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(10);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ cycles }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
