/**
 * Deep Analysis API
 *
 * POST: Start a deep analysis job for interesting stocks
 * Returns a job ID that can be polled for progress
 */

import type { APIRoute } from "astro";
import { db, schema, getHoldings } from "../../../lib/db";
import { eq, inArray } from "drizzle-orm";
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
    dataWarnings?: Array<{
      symbol: string;
      missing: string[];
      stale: string[];
      details: Record<string, string | null>;
    }>;
  }
>();

const FINANCIALS_STALE_DAYS = 30;
const CONCALL_STALE_DAYS = 180;
const TECHNICALS_STALE_MINUTES = 5;

function formatAgeDays(ageDays: number): string {
  return `${Math.round(ageDays)}d`;
}

function formatAgeMinutes(ageMinutes: number): string {
  if (ageMinutes < 60) return `${Math.round(ageMinutes)}m`;
  const hours = ageMinutes / 60;
  return `${Math.round(hours)}h`;
}

// POST - Start deep analysis job
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const { symbols, forceRefresh, confirmMissingData } = body as {
      symbols?: string[];
      forceRefresh?: boolean;
      confirmMissingData?: boolean;
    };

    const resolveSymbols = async (): Promise<string[]> => {
      if (symbols && symbols.length > 0) {
        return symbols;
      }

      const interesting = await db
        .select({ symbol: schema.watchlist.symbol })
        .from(schema.watchlist)
        .where(eq(schema.watchlist.interesting, true));

      const delistedStocks = await db
        .select({ symbol: schema.watchlist.symbol })
        .from(schema.watchlist)
        .where(eq(schema.watchlist.delisted, true));
      const delistedSymbols = new Set(delistedStocks.map((s) => s.symbol));

      const holdings = await getHoldings();

      const interestingSymbols = new Set(
        interesting.map((s) => s.symbol).filter((s) => !delistedSymbols.has(s))
      );
      const holdingSymbols = new Set(
        holdings.map((h) => h.symbol).filter((s) => !delistedSymbols.has(s))
      );
      return Array.from(new Set([...interestingSymbols, ...holdingSymbols]));
    };

    const getMissingDataWarnings = async (
      targetSymbols: string[]
    ): Promise<
      Array<{
        symbol: string;
        missing: string[];
        stale: string[];
        details: Record<string, string | null>;
      }>
    > => {
      if (targetSymbols.length === 0) return [];

      const now = Date.now();

      const financialRows = await db
        .select({
          symbol: schema.companyFinancials.symbol,
          updatedAt: schema.companyFinancials.updatedAt,
        })
        .from(schema.companyFinancials)
        .where(inArray(schema.companyFinancials.symbol, targetSymbols));

      const financialsMap = new Map<string, string>();
      for (const row of financialRows) {
        if (!row.updatedAt) continue;
        const current = financialsMap.get(row.symbol);
        if (!current || new Date(row.updatedAt) > new Date(current)) {
          financialsMap.set(row.symbol, row.updatedAt);
        }
      }

      const concallRows = await db
        .select({
          symbol: schema.concallHighlights.symbol,
          callDate: schema.concallHighlights.callDate,
          createdAt: schema.concallHighlights.createdAt,
        })
        .from(schema.concallHighlights)
        .where(inArray(schema.concallHighlights.symbol, targetSymbols));

      const concallMap = new Map<string, string>();
      for (const row of concallRows) {
        const candidate = row.callDate || row.createdAt;
        if (!candidate) continue;
        const current = concallMap.get(row.symbol);
        if (!current || new Date(candidate) > new Date(current)) {
          concallMap.set(row.symbol, candidate);
        }
      }

      const technicalRows = await db
        .select({
          symbol: schema.technicalData.symbol,
          updatedAt: schema.technicalData.updatedAt,
        })
        .from(schema.technicalData)
        .where(inArray(schema.technicalData.symbol, targetSymbols));

      const technicalMap = new Map(
        technicalRows.map((row) => [row.symbol, row.updatedAt || null])
      );

      const issues: Array<{
        symbol: string;
        missing: string[];
        stale: string[];
        details: Record<string, string | null>;
      }> = [];

      for (const symbol of targetSymbols) {
        const missing: string[] = [];
        const stale: string[] = [];
        const details: Record<string, string | null> = {
          financials_updated_at: financialsMap.get(symbol) || null,
          concall_updated_at: concallMap.get(symbol) || null,
          technicals_updated_at: technicalMap.get(symbol) || null,
        };

        const financialsUpdated = financialsMap.get(symbol) || null;
        if (!financialsUpdated) {
          missing.push("Financials missing");
        } else {
          const ageDays =
            (now - new Date(financialsUpdated).getTime()) /
            (1000 * 60 * 60 * 24);
          if (ageDays > FINANCIALS_STALE_DAYS) {
            stale.push(
              `Financials stale (${formatAgeDays(ageDays)} old, > ${FINANCIALS_STALE_DAYS}d)`
            );
          }
        }

        const concallUpdated = concallMap.get(symbol) || null;
        if (!concallUpdated) {
          missing.push("Concall highlights missing");
        } else {
          const ageDays =
            (now - new Date(concallUpdated).getTime()) /
            (1000 * 60 * 60 * 24);
          if (ageDays > CONCALL_STALE_DAYS) {
            stale.push(
              `Concall highlights old (${formatAgeDays(ageDays)} old, > ${CONCALL_STALE_DAYS}d)`
            );
          }
        }

        const technicalUpdated = technicalMap.get(symbol) || null;
        if (!technicalUpdated) {
          missing.push("Technicals missing");
        } else {
          const ageMinutes =
            (now - new Date(technicalUpdated).getTime()) / (1000 * 60);
          if (ageMinutes > TECHNICALS_STALE_MINUTES) {
            stale.push(
              `Technicals stale (${formatAgeMinutes(ageMinutes)} old, > ${TECHNICALS_STALE_MINUTES}m)`
            );
          }
        }

        if (missing.length > 0 || stale.length > 0) {
          issues.push({ symbol, missing, stale, details });
        }
      }

      return issues;
    };

    const targetSymbols = await resolveSymbols();
    const dataWarnings = await getMissingDataWarnings(targetSymbols);

    if (dataWarnings.length > 0 && !confirmMissingData) {
      return new Response(
        JSON.stringify({
          needsConfirmation: true,
          issues: dataWarnings,
          message:
            "Tier 2 analysis has missing or stale inputs. Review issues and re-run with confirmMissingData=true to proceed.",
        }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      );
    }

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
      dataWarnings: dataWarnings.length > 0 ? dataWarnings : undefined,
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
              const result = await analyzeStock(symbol, {
                allowMissingInputs: Boolean(confirmMissingData),
              });
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
          const progress = await analyzeInterestingStocks(
            (p) => {
              job.progress = p;
            },
            2000,
            true,
            Boolean(confirmMissingData)
          );
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
    const estimatedStocks = targetSymbols.length;

    // ~30 seconds per stock (data gathering + LLM)
    const estimatedMinutes = Math.ceil((estimatedStocks * 30) / 60);

    return new Response(
      JSON.stringify({
        jobId,
        stocksQueued: estimatedStocks,
        estimatedMinutes,
        dataWarnings: dataWarnings.length > 0 ? dataWarnings : undefined,
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
