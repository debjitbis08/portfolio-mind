/**
 * Job Status SSE Endpoint
 * GET /api/jobs/[id]/status - Server-Sent Events for job progress
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../../../lib/middleware/requireAuth";
import { db, getHoldings, schema } from "../../../../lib/db";
import { eq, inArray, and } from "drizzle-orm";
import { GeminiService, type HoldingForAnalysis } from "../../../../lib/gemini";

export const GET: APIRoute = async ({ params, request }) => {
  const jobId = params.id;

  if (!jobId) {
    return new Response("Job ID required", { status: 400 });
  }

  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  // Get job
  const [job] = await db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId))
    .limit(1);

  if (!job) {
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
        await db
          .update(schema.jobs)
          .set({ progress, progressMessage: message, status: "running" })
          .where(eq(schema.jobs.id, jobId));
        sendEvent({ progress, message, status: "running" });
      };

      try {
        // Start the job
        await db
          .update(schema.jobs)
          .set({ status: "running", startedAt: new Date().toISOString() })
          .where(eq(schema.jobs.id, jobId));

        sendEvent({
          progress: 0,
          message: "Starting discovery cycle...",
          status: "running",
        });

        // Step 1: Fetch holdings
        await updateProgress(10, "Fetching holdings and context...");

        const dbHoldings = await getHoldings();

        if (dbHoldings.length === 0) {
          throw new Error("No holdings found");
        }

        // Fetch settings for available funds
        const [settings] = await db
          .select()
          .from(schema.settings)
          .where(eq(schema.settings.id, 1))
          .limit(1);

        const availableFunds = settings?.availableFunds || 0;

        // Parse tool config
        let toolConfig = null;
        if (settings?.toolConfig) {
          try {
            toolConfig = JSON.parse(settings.toolConfig);
          } catch {
            toolConfig = null;
          }
        }

        // Get delisted stocks to skip
        const delistedStocks = await db
          .select({ symbol: schema.watchlist.symbol })
          .from(schema.watchlist)
          .where(eq(schema.watchlist.delisted, true));
        const delistedSymbols = new Set(delistedStocks.map((s) => s.symbol));

        // Filter out delisted holdings
        const activeHoldings = dbHoldings.filter(
          (h) => !delistedSymbols.has(h.symbol)
        );

        if (delistedSymbols.size > 0) {
          const skipped = dbHoldings.length - activeHoldings.length;
          console.log(`[Job] Skipping ${skipped} delisted stock(s)`);
        }

        // Step 2: Fetch Fundamentals
        await updateProgress(20, "Gathering fundamental intel...");

        const symbols = activeHoldings.map((h) => h.symbol);

        try {
          const { IntelService } = await import("../../../../lib/intel");
          await IntelService.updateFundamentals(symbols);
        } catch (err) {
          console.error("Intel update failed:", err);
        }

        // Fetch stock intel
        const stockIntel = await db
          .select()
          .from(schema.stockIntel)
          .where(inArray(schema.stockIntel.symbol, symbols));

        const intelMap = new Map<string, (typeof stockIntel)[0]>();
        for (const i of stockIntel) {
          intelMap.set(i.symbol, i);
        }

        // Step 3: Fetch technical data
        await updateProgress(
          30,
          `Found ${activeHoldings.length} holdings. Loading technical data...`
        );

        const technicalData = await db.select().from(schema.technicalData);

        const techMap = new Map<string, (typeof technicalData)[0]>();
        for (const t of technicalData) {
          techMap.set(t.symbol, t);
        }

        // Step 4: Build holdings for analysis (using activeHoldings without delisted)
        await updateProgress(40, "Preparing data for AI analysis...");

        const holdings: HoldingForAnalysis[] = activeHoldings.map((h) => {
          const tech =
            techMap.get(h.symbol) ||
            techMap.get(`${h.symbol}.NS`) ||
            techMap.get(`${h.symbol}.BO`);
          const intel =
            intelMap.get(h.symbol) ||
            intelMap.get(`${h.symbol}.NS`) ||
            intelMap.get(`${h.symbol}.BO`);

          const priceVsSma50 = tech?.priceVsSma50 ?? null;
          const priceVsSma200 = tech?.priceVsSma200 ?? null;
          const rsi14 = tech?.rsi14 ?? null;

          const waitReasons: string[] = [];
          if (rsi14 && rsi14 > 40) waitReasons.push(`RSI ${rsi14.toFixed(0)}`);
          if (priceVsSma50 && priceVsSma50 > 15)
            waitReasons.push(`+${priceVsSma50.toFixed(0)}% SMA50`);
          if (priceVsSma200 && priceVsSma200 > 15)
            waitReasons.push(`+${priceVsSma200.toFixed(0)}% SMA200`);

          return {
            symbol: h.symbol,
            stock_name: h.stockName,
            quantity: h.quantity,
            avg_buy_price: h.avgBuyPrice,
            current_price: tech?.currentPrice || 0,
            returns_percent:
              h.avgBuyPrice > 0 && tech?.currentPrice
                ? ((tech.currentPrice - h.avgBuyPrice) / h.avgBuyPrice) * 100
                : 0,
            rsi_14: rsi14,
            price_vs_sma50: priceVsSma50,
            price_vs_sma200: priceVsSma200,
            is_wait_zone: waitReasons.length > 0,
            wait_reasons: waitReasons,
            fundamentals: intel?.fundamentals
              ? JSON.parse(intel.fundamentals)
              : undefined,
            qualitative: intel?.socialSentiment
              ? JSON.parse(intel.socialSentiment)
              : undefined,
          };
        });

        // Step 5: Run Gemini analysis (Tier 3 - uses cached stock analysis)
        await updateProgress(
          50,
          `Analyzing with Gemini AI Tier 3 (Cash: ₹${availableFunds.toLocaleString()})...`
        );

        const suggestions = await GeminiService.analyzeWithCachedData(
          holdings,
          availableFunds,
          (progress, message, toolCall) => {
            const effectiveProgress = Math.max(50, Math.min(progress, 90));
            sendEvent({
              progress: effectiveProgress,
              message,
              status: "running",
              toolCall: toolCall
                ? {
                    tool: toolCall.tool,
                    args: toolCall.args,
                    success: toolCall.result?.success,
                  }
                : undefined,
            });
          },
          toolConfig
        );

        // Step 6: Filter actionable suggestions
        await updateProgress(90, "Processing actionable suggestions...");

        const actionableSuggestions = suggestions.filter((s) =>
          ["BUY", "SELL", "MOVE", "RAISE_CASH"].includes(s.action)
        );

        // Step 7: Store suggestions (with supersession logic)
        if (actionableSuggestions.length > 0) {
          for (const s of actionableSuggestions) {
            // Check for existing pending suggestions for this symbol
            const existingPending = await db
              .select({ id: schema.suggestions.id })
              .from(schema.suggestions)
              .where(
                and(
                  eq(schema.suggestions.symbol, s.symbol),
                  eq(schema.suggestions.status, "pending")
                )
              );

            // Insert the new suggestion
            const [newSuggestion] = await db
              .insert(schema.suggestions)
              .values({
                symbol: s.symbol,
                stockName: s.stock_name,
                action: s.action as
                  | "BUY"
                  | "SELL"
                  | "HOLD"
                  | "WATCH"
                  | "RAISE_CASH",
                rationale: s.rationale || s.reason,
                technicalScore: s.technical_score,
                confidence: s.confidence,
                quantity: s.quantity || null,
                allocationAmount: s.allocation_amount || null,
                currentPrice: holdings.find((h) => h.symbol === s.symbol)
                  ?.current_price,
              })
              .returning({ id: schema.suggestions.id });

            // Supersede existing pending suggestions for this symbol
            if (existingPending.length > 0 && newSuggestion) {
              for (const old of existingPending) {
                await db
                  .update(schema.suggestions)
                  .set({
                    status: "superseded",
                    supersededBy: newSuggestion.id,
                    supersededReason: "Replaced by newer analysis",
                    reviewedAt: new Date().toISOString(),
                  })
                  .where(eq(schema.suggestions.id, old.id));
              }
            }
          }
        } else {
          await updateProgress(
            90,
            "No actionable suggestions found. Portfolio is well positioned."
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

        await db
          .update(schema.jobs)
          .set({
            status: "completed",
            completedAt: new Date().toISOString(),
            result: JSON.stringify(result),
          })
          .where(eq(schema.jobs.id, jobId));

        sendEvent({ status: "completed", result });
        controller.close();
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";

        await db
          .update(schema.jobs)
          .set({
            status: "failed",
            completedAt: new Date().toISOString(),
            errorMessage,
          })
          .where(eq(schema.jobs.id, jobId));

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
