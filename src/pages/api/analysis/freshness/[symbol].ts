/**
 * Per-Stock Freshness Status API
 *
 * GET: Returns detailed data freshness for a specific stock
 *
 * Used by CompanyDetails page to show:
 * - Age of VRS data
 * - Age of Financials
 * - Age of ValuePickr data
 * - Age of cached Tier 2 analysis
 * - Per-source warnings
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../../../lib/middleware/requireAuth";
import { checkStockDataFreshness } from "../../../../lib/data-freshness";
import { getCachedAnalysis } from "../../../../lib/stock-analyzer";
import { db, schema } from "../../../../lib/db";
import { eq } from "drizzle-orm";

export const GET: APIRoute = async ({ request, params }) => {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  const { symbol } = params;

  if (!symbol) {
    return new Response(
      JSON.stringify({ error: "Symbol parameter is required" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  try {
    // Get base freshness report (VRS, Financials, ValuePickr)
    const report = await checkStockDataFreshness(symbol);

    // Add cached analysis check
    const cached = await getCachedAnalysis([symbol]);
    const analysis = cached.get(symbol);

    if (analysis && analysis.analyzedAt) {
      const ageMs = Date.now() - new Date(analysis.analyzedAt).getTime();
      const ageHours = ageMs / (60 * 60 * 1000);
      const ttlHours = 7 * 24; // 7 days
      const thresholdHours = 5 * 24; // 5 days

      let status: "fresh" | "aging" | "stale";
      let warning: string | undefined;

      if (ageHours > ttlHours) {
        status = "stale";
        warning = `Cached analysis is ${Math.round(
          ageHours
        )} hours old (TTL: ${ttlHours}h) - needs refresh`;
      } else if (ageHours > thresholdHours) {
        status = "aging";
        warning = `Cached analysis is ${Math.round(
          ageHours
        )} hours old - approaching TTL of ${ttlHours}h`;
      } else {
        status = "fresh";
      }

      report.checks.push({
        source: "Cached Analysis (Tier 2)",
        status,
        age_hours: ageHours,
        ttl_hours: ttlHours,
        threshold_aging_hours: thresholdHours,
        last_updated: analysis.analyzedAt,
        warning,
      });

      // Update overall status if analysis is stale/aging
      if (status === "stale" && report.overall_status !== "stale") {
        report.overall_status = "stale";
        report.recommendation =
          "Cached analysis is stale. Run Tier 2 to refresh.";
      } else if (
        status === "aging" &&
        report.overall_status === "fresh"
      ) {
        report.overall_status = "aging";
        report.recommendation =
          "Cached analysis approaching expiry. Consider running Tier 2.";
      }
    } else {
      // No cached analysis exists
      report.checks.push({
        source: "Cached Analysis (Tier 2)",
        status: "missing",
        age_hours: null,
        ttl_hours: 168,
        threshold_aging_hours: 120,
        last_updated: null,
        warning: "No Tier 2 analysis found. Run deep analysis for this stock.",
      });

      if (report.overall_status === "fresh") {
        report.overall_status = "missing";
      }
    }

    // Get technical data age
    const technicalData = await db
      .select({ updatedAt: schema.technicalData.updatedAt })
      .from(schema.technicalData)
      .where(eq(schema.technicalData.symbol, symbol))
      .limit(1);

    if (technicalData.length > 0 && technicalData[0].updatedAt) {
      const techAgeMs =
        Date.now() - new Date(technicalData[0].updatedAt).getTime();
      const techAgeHours = techAgeMs / (60 * 60 * 1000);
      const techTtlHours = 5 / 60; // 5 minutes

      let techStatus: "fresh" | "aging" | "stale";
      let techWarning: string | undefined;

      if (techAgeHours > techTtlHours) {
        techStatus = "stale";
        techWarning = "Technical data is outdated";
      } else if (techAgeHours > techTtlHours * 0.6) {
        techStatus = "aging";
      } else {
        techStatus = "fresh";
      }

      report.checks.push({
        source: "Technical Data",
        status: techStatus,
        age_hours: techAgeHours,
        ttl_hours: techTtlHours,
        threshold_aging_hours: techTtlHours * 0.6,
        last_updated: technicalData[0].updatedAt,
        warning: techWarning,
      });
    }

    // Add metadata
    const responseWithMeta = {
      ...report,
      last_checked: new Date().toISOString(),
    };

    return new Response(JSON.stringify(responseWithMeta), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(`[Freshness API] Error for ${symbol}:`, error);
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
