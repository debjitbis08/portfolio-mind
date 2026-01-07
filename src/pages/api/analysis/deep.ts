/**
 * Deep Analysis API
 *
 * POST: Start a deep analysis job for interesting stocks
 * Returns a job ID that can be polled for progress
 */

import type { APIRoute } from "astro";
import { db, schema, getHoldings } from "../../../lib/db";
import { eq } from "drizzle-orm";
import {
  analyzeInterestingStocks,
  analyzeStock,
  type AnalysisJobProgress,
} from "../../../lib/stock-analyzer";
import { checkBatchDataFreshness } from "../../../lib/data-freshness";

// In-memory job store (for single-user, single-instance deployment)
const activeJobs = new Map<
  string,
  {
    status: "pending" | "running" | "completed" | "failed";
    progress: AnalysisJobProgress;
    startedAt: string;
    completedAt?: string;
    error?: string;
    freshnessWarnings?: string[];
  }
>();

// POST - Start deep analysis job
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const { symbols, forceRefresh } = body as {
      symbols?: string[];
      forceRefresh?: boolean;
    };

    // Generate job ID
    const jobId = crypto.randomUUID();

    // Initialize job
    activeJobs.set(jobId, {
      status: "pending",
      progress: {
        total: 0,
        completed: 0,
        current: null,
        errors: [],
        results: [],
      },
      startedAt: new Date().toISOString(),
    });

    // Start analysis in background (non-blocking)
    (async () => {
      const job = activeJobs.get(jobId)!;
      job.status = "running";

      try {
        if (symbols && symbols.length > 0) {
          // Check data freshness for requested symbols
          const freshnessReports = await checkBatchDataFreshness(symbols);
          const allWarnings: string[] = [];

          for (const report of freshnessReports) {
            if (report.warnings.length > 0) {
              allWarnings.push(
                `${report.symbol}: ${report.warnings.join("; ")}`
              );
            }
          }

          if (allWarnings.length > 0) {
            job.freshnessWarnings = allWarnings;
            console.warn(`[Deep Analysis] Data freshness warnings:`, allWarnings);
          }

          // Analyze specific symbols
          job.progress.total = symbols.length;

          for (let i = 0; i < symbols.length; i++) {
            const symbol = symbols[i];
            job.progress.current = symbol;

            try {
              const result = await analyzeStock(symbol);
              job.progress.results.push({
                symbol,
                score: result?.opportunityScore ?? null,
                error: result ? undefined : "Analysis failed",
              });
            } catch (error) {
              const errorMsg =
                error instanceof Error ? error.message : "Unknown error";
              job.progress.errors.push(`${symbol}: ${errorMsg}`);
              job.progress.results.push({
                symbol,
                score: null,
                error: errorMsg,
              });
            }

            job.progress.completed = i + 1;

            // Rate limiting: 2 seconds between stocks
            if (i < symbols.length - 1) {
              await new Promise((resolve) => setTimeout(resolve, 2000));
            }
          }
        } else {
          // Analyze all interesting stocks
          const progress = await analyzeInterestingStocks((p) => {
            job.progress = p;
          });
          job.progress = progress;
        }

        job.status = "completed";
        job.completedAt = new Date().toISOString();
        job.progress.current = null;
      } catch (error) {
        job.status = "failed";
        job.error = error instanceof Error ? error.message : "Unknown error";
        job.completedAt = new Date().toISOString();
      }
    })();

    // Get estimated time
    let estimatedStocks = 0;
    if (symbols && symbols.length > 0) {
      estimatedStocks = symbols.length;
    } else {
      // Count must match analyzeInterestingStocks() logic exactly
      const interesting = await db
        .select({ symbol: schema.watchlist.symbol })
        .from(schema.watchlist)
        .where(eq(schema.watchlist.interesting, true));

      const delistedStocks = await db
        .select({ symbol: schema.watchlist.symbol })
        .from(schema.watchlist)
        .where(eq(schema.watchlist.delisted, true));
      const delistedSymbols = new Set(delistedStocks.map((s) => s.symbol));

      // Use getHoldings() to get actual holdings with qty > 0
      const holdings = await getHoldings();

      const interestingSymbols = new Set(
        interesting.map((s) => s.symbol).filter((s) => !delistedSymbols.has(s))
      );
      const holdingSymbols = new Set(
        holdings.map((h) => h.symbol).filter((s) => !delistedSymbols.has(s))
      );
      const allSymbols = new Set([...interestingSymbols, ...holdingSymbols]);
      estimatedStocks = allSymbols.size;
    }

    // ~30 seconds per stock (data gathering + LLM)
    const estimatedMinutes = Math.ceil((estimatedStocks * 30) / 60);

    return new Response(
      JSON.stringify({
        jobId,
        stocksQueued: estimatedStocks,
        estimatedMinutes,
        message: `Deep analysis started for ${estimatedStocks} stocks. Poll /api/analysis/deep/${jobId} for progress.`,
      }),
      {
        status: 202,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[Deep Analysis] POST error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500 }
    );
  }
};

// GET - List all jobs (for debugging)
export const GET: APIRoute = async () => {
  const jobs = Array.from(activeJobs.entries()).map(([id, job]) => ({
    id,
    status: job.status,
    total: job.progress.total,
    completed: job.progress.completed,
    errors: job.progress.errors.length,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
  }));

  return new Response(JSON.stringify({ jobs }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

// Export for use by status endpoint
export { activeJobs };
