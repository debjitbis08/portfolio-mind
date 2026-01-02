/**
 * Job Status SSE Endpoint
 * GET /api/jobs/[id]/status - Server-Sent Events for job progress
 */

import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import {
  PUBLIC_SUPABASE_URL,
  PUBLIC_SUPABASE_ANON_KEY,
} from "astro:env/client";
import { SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY } from "astro:env/server";
import { GeminiService, type HoldingForAnalysis } from "../../../../lib/gemini";

export const GET: APIRoute = async ({ params, cookies }) => {
  const jobId = params.id;

  if (!jobId) {
    return new Response("Job ID required", { status: 400 });
  }

  const accessToken = cookies.get("sb-access-token")?.value;
  const refreshToken = cookies.get("sb-refresh-token")?.value;

  if (!accessToken || !refreshToken) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(
    PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: sessionData } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  if (!sessionData.session?.user) {
    return new Response("Invalid session", { status: 401 });
  }

  const userId = sessionData.session.user.id;

  // Get job and verify ownership
  const { data: job, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (error || !job) {
    return new Response("Job not found", { status: 404 });
  }

  // Create SSE response
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const updateProgress = async (progress: number, message: string) => {
        await supabaseAdmin
          .from("jobs")
          .update({ progress, progress_message: message, status: "running" })
          .eq("id", jobId);
        sendEvent({ progress, message, status: "running" });
      };

      try {
        // Start the job
        await supabaseAdmin
          .from("jobs")
          .update({ status: "running", started_at: new Date().toISOString() })
          .eq("id", jobId);

        sendEvent({
          progress: 0,
          message: "Starting discovery cycle...",
          status: "running",
        });

        // Step 1: Fetch holdings and user settings
        await updateProgress(10, "Fetching holdings and context...");

        const { data: dbHoldings, error: holdingsError } = await supabase
          .from("holdings")
          .select("*");

        if (holdingsError || !dbHoldings || dbHoldings.length === 0) {
          throw new Error(holdingsError?.message || "No holdings found");
        }

        // Fetch user settings for available funds
        const { data: settings } = await supabase
          .from("user_settings")
          .select("available_funds")
          .single();

        const availableFunds = settings?.available_funds || 0;

        // Step 2b: Fetch Fundamentals
        await updateProgress(
          20,
          "Gathering fundamental intel (PE, ROE, etc)..."
        );

        // Check which symbols need update (simplify: just update all for now or check missing)
        const symbols = dbHoldings.map((h: any) => h.symbol);

        // This runs in background, we can await it or let it run.
        // For accurate analysis, we should await.
        try {
          // Import dynamically to avoid top-level issues if any
          const { IntelService } = await import("../../../../lib/intel");
          await IntelService.updateFundamentals(symbols);
        } catch (err) {
          console.error(
            "Intel update failed, proceeding without new fundamentals:",
            err
          );
        }

        // Fetch rich data from DB
        const { data: stockIntel } = await supabase
          .from("stock_intel")
          .select("*")
          .in("symbol", symbols);

        const intelMap = new Map<string, any>();
        if (stockIntel) {
          for (const i of stockIntel) {
            intelMap.set(i.symbol, i);
          }
        }

        // Step 2: Fetch technical data
        await updateProgress(
          30,
          `Found ${dbHoldings.length} holdings. Loading technical data...`
        );

        const { data: technicalData } = await supabase
          .from("technical_data")
          .select("*");

        const techMap = new Map<string, any>();
        if (technicalData) {
          for (const t of technicalData) {
            techMap.set(t.symbol, t);
          }
        }

        // Step 3: Build holdings for analysis
        await updateProgress(40, "Preparing data for AI analysis...");

        const holdings: HoldingForAnalysis[] = dbHoldings.map((h: any) => {
          const tech =
            techMap.get(h.symbol) ||
            techMap.get(`${h.symbol}.NS`) ||
            techMap.get(`${h.symbol}.BO`);
          const intel =
            intelMap.get(h.symbol) ||
            intelMap.get(`${h.symbol}.NS`) ||
            intelMap.get(`${h.symbol}.BO`);

          const priceVsSma50 = tech?.price_vs_sma50
            ? Number(tech.price_vs_sma50)
            : null;
          const priceVsSma200 = tech?.price_vs_sma200
            ? Number(tech.price_vs_sma200)
            : null;
          const rsi14 = tech?.rsi_14 ? Number(tech.rsi_14) : null;

          const waitReasons: string[] = [];
          if (rsi14 && rsi14 > 40) waitReasons.push(`RSI ${rsi14.toFixed(0)}`);
          if (priceVsSma50 && priceVsSma50 > 15)
            waitReasons.push(`+${priceVsSma50.toFixed(0)}% SMA50`);
          if (priceVsSma200 && priceVsSma200 > 15)
            waitReasons.push(`+${priceVsSma200.toFixed(0)}% SMA200`);

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
            // Attach fundamentals
            fundamentals: intel?.fundamentals,
            // Attach qualitative intel (The Story)
            qualitative: intel?.social_sentiment,
          };
        });

        // Step 4: Run Gemini analysis
        await updateProgress(
          50,
          `Analyzing with Gemini AI (Cash: ₹${availableFunds.toLocaleString()})...`
        );

        // Pass available funds to analysis
        const suggestions = await GeminiService.analyzePortfolio(
          holdings,
          availableFunds
        );

        // Step 5: Filter actionable suggestions only (BUY/SELL/MOVE)
        await updateProgress(80, "Processing actionable suggestions...");

        // Gemini already filtered for actionable, but double check
        const actionableSuggestions = suggestions.filter((s) =>
          ["BUY", "SELL", "MOVE"].includes(s.action)
        );

        // Step 6: Store actionable suggestions
        if (actionableSuggestions.length > 0) {
          const suggestionRecords = actionableSuggestions.map((s) => ({
            user_id: userId,
            symbol: s.symbol,
            stock_name: s.stock_name,
            action: s.action,
            rationale: s.rationale,
            technical_score: s.technical_score,
            current_price: holdings.find((h) => h.symbol === s.symbol)
              ?.current_price,
            // New fields
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
            throw new Error("Failed to save suggestions");
          }
        } else {
          // No actionable suggestions found
          await updateProgress(
            90,
            "No actionable suggestions found. Your portfolio is likely well positioned."
          );
        }

        // Complete
        await updateProgress(
          100,
          `Completed! ${actionableSuggestions.length} actionable suggestions.`
        );

        const result = {
          analyzed: holdings.length,
          actionable: actionableSuggestions.length,
          suggestions: actionableSuggestions,
        };

        await supabaseAdmin
          .from("jobs")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
            result,
          })
          .eq("id", jobId);

        sendEvent({ status: "completed", result });
        controller.close();
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";

        await supabaseAdmin
          .from("jobs")
          .update({
            status: "failed",
            completed_at: new Date().toISOString(),
            error_message: errorMessage,
          })
          .eq("id", jobId);

        sendEvent({ status: "failed", error: errorMessage });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
};
