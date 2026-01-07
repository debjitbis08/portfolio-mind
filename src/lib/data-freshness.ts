/**
 * Data Freshness Validation
 *
 * Validates data staleness before Tier 2 (stock analysis) and Tier 3 (portfolio discovery) runs.
 * Provides granular freshness checks per data source with clear warnings.
 */

import { db, schema } from "./db";
import { eq, inArray } from "drizzle-orm";

// ============================================================================
// Types
// ============================================================================

export type FreshnessStatus = "fresh" | "aging" | "stale" | "missing";

export interface DataFreshnessCheck {
  source: string;
  status: FreshnessStatus;
  age_hours: number | null;
  ttl_hours: number;
  threshold_aging_hours: number; // When to show "aging" warning
  last_updated: string | null;
  warning?: string;
}

export interface StockFreshnessReport {
  symbol: string;
  overall_status: FreshnessStatus;
  checks: DataFreshnessCheck[];
  recommendation: string;
  can_proceed: boolean; // False if critical data is missing
  warnings: string[];
}

export interface PortfolioFreshnessReport {
  overall_status: FreshnessStatus;
  stock_reports: StockFreshnessReport[];
  summary: {
    total_stocks: number;
    fresh: number;
    aging: number;
    stale: number;
    missing_analysis: number;
  };
  recommendation: string;
  can_proceed: boolean;
  warnings: string[];
}

// ============================================================================
// TTL Configuration (aligned with existing logic)
// ============================================================================

// TTL in hours for each data source
const TTL_CONFIG = {
  VRS: 7 * 24, // 7 days
  FINANCIALS: 30 * 24, // 30 days
  VALUEPICKR: 3 * 24, // 3 days (auto-refreshed in stock-analyzer)
  CACHED_ANALYSIS: 7 * 24, // 7 days
  TECHNICAL: 5 / 60, // 5 minutes
};

// Aging thresholds (when to start warning before TTL expires)
const AGING_THRESHOLD = {
  VRS: 5 * 24, // Warn after 5 days (TTL is 7 days)
  FINANCIALS: 20 * 24, // Warn after 20 days (TTL is 30 days)
  VALUEPICKR: 2 * 24, // Warn after 2 days (TTL is 3 days)
  CACHED_ANALYSIS: 5 * 24, // Warn after 5 days (TTL is 7 days)
  TECHNICAL: 3 / 60, // Warn after 3 minutes (TTL is 5 minutes)
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate age in hours from ISO timestamp
 */
function getAgeHours(timestamp: string | null): number | null {
  if (!timestamp) return null;
  const ageMs = Date.now() - new Date(timestamp).getTime();
  return ageMs / (60 * 60 * 1000);
}

/**
 * Determine freshness status based on age and thresholds
 */
function getFreshnessStatus(
  ageHours: number | null,
  ttlHours: number,
  agingThresholdHours: number
): FreshnessStatus {
  if (ageHours === null) return "missing";
  if (ageHours > ttlHours) return "stale";
  if (ageHours > agingThresholdHours) return "aging";
  return "fresh";
}

/**
 * Build warning message based on status
 */
function getWarningMessage(
  source: string,
  status: FreshnessStatus,
  ageHours: number | null,
  ttlHours: number
): string | undefined {
  if (status === "missing") {
    if (source === "VRS" || source === "ValuePickr") {
      return `${source} data not available (acceptable for some stocks)`;
    }
    return `${source} data not available - analysis may be incomplete`;
  }

  if (status === "stale") {
    return `${source} data is ${Math.round(ageHours!)} hours old (TTL: ${ttlHours}h) - consider refreshing`;
  }

  if (status === "aging") {
    return `${source} data is ${Math.round(ageHours!)} hours old - approaching TTL of ${ttlHours}h`;
  }

  return undefined;
}

/**
 * Determine overall status from multiple checks
 */
function getOverallStatus(checks: DataFreshnessCheck[]): FreshnessStatus {
  // Priority: stale > aging > missing > fresh
  if (checks.some((c) => c.status === "stale")) return "stale";
  if (checks.some((c) => c.status === "aging")) return "aging";

  // Missing is only a problem if it's critical data
  const missingCritical = checks.filter(
    (c) => c.status === "missing" && c.source === "Financials"
  );
  if (missingCritical.length > 0) return "missing";

  return "fresh";
}

// ============================================================================
// Stock-Level Validation (for Tier 2)
// ============================================================================

/**
 * Check data freshness for a single stock before Tier 2 analysis
 *
 * @param symbol - Stock symbol to check
 * @returns Freshness report with granular checks per data source
 */
export async function checkStockDataFreshness(
  symbol: string
): Promise<StockFreshnessReport> {
  const checks: DataFreshnessCheck[] = [];

  // 1. Check VRS Data
  const vrs = await db
    .select({ fetchedAt: schema.vrsResearch.fetchedAt })
    .from(schema.vrsResearch)
    .where(eq(schema.vrsResearch.symbol, symbol))
    .limit(1);

  const vrsAge = vrs.length > 0 ? getAgeHours(vrs[0].fetchedAt) : null;
  const vrsStatus = getFreshnessStatus(
    vrsAge,
    TTL_CONFIG.VRS,
    AGING_THRESHOLD.VRS
  );

  checks.push({
    source: "VRS",
    status: vrsStatus,
    age_hours: vrsAge,
    ttl_hours: TTL_CONFIG.VRS,
    threshold_aging_hours: AGING_THRESHOLD.VRS,
    last_updated: vrs.length > 0 ? vrs[0].fetchedAt : null,
    warning: getWarningMessage("VRS", vrsStatus, vrsAge, TTL_CONFIG.VRS),
  });

  // 2. Check Financials
  const financials = await db
    .select({ updatedAt: schema.companyFinancials.updatedAt })
    .from(schema.companyFinancials)
    .where(eq(schema.companyFinancials.symbol, symbol))
    .orderBy(schema.companyFinancials.updatedAt)
    .limit(1);

  const financialsAge =
    financials.length > 0 ? getAgeHours(financials[0].updatedAt) : null;
  const financialsStatus = getFreshnessStatus(
    financialsAge,
    TTL_CONFIG.FINANCIALS,
    AGING_THRESHOLD.FINANCIALS
  );

  checks.push({
    source: "Financials",
    status: financialsStatus,
    age_hours: financialsAge,
    ttl_hours: TTL_CONFIG.FINANCIALS,
    threshold_aging_hours: AGING_THRESHOLD.FINANCIALS,
    last_updated: financials.length > 0 ? financials[0].updatedAt : null,
    warning: getWarningMessage(
      "Financials",
      financialsStatus,
      financialsAge,
      TTL_CONFIG.FINANCIALS
    ),
  });

  // 3. Check ValuePickr (stored in stockIntel.socialSentiment)
  const valuepickr = await db
    .select({
      updatedAt: schema.stockIntel.updatedAt,
      socialSentiment: schema.stockIntel.socialSentiment,
    })
    .from(schema.stockIntel)
    .where(eq(schema.stockIntel.symbol, symbol))
    .limit(1);

  const vpAge =
    valuepickr.length > 0 && valuepickr[0].socialSentiment
      ? getAgeHours(valuepickr[0].updatedAt)
      : null;
  const vpStatus = getFreshnessStatus(
    vpAge,
    TTL_CONFIG.VALUEPICKR,
    AGING_THRESHOLD.VALUEPICKR
  );

  checks.push({
    source: "ValuePickr",
    status: vpStatus,
    age_hours: vpAge,
    ttl_hours: TTL_CONFIG.VALUEPICKR,
    threshold_aging_hours: AGING_THRESHOLD.VALUEPICKR,
    last_updated: valuepickr.length > 0 ? valuepickr[0].updatedAt : null,
    warning: getWarningMessage(
      "ValuePickr",
      vpStatus,
      vpAge,
      TTL_CONFIG.VALUEPICKR
    ),
  });

  // Build report
  const overall = getOverallStatus(checks);
  const warnings = checks
    .filter((c) => c.warning)
    .map((c) => c.warning as string);

  let recommendation = "";
  if (overall === "stale") {
    recommendation =
      "Some data sources are stale. Consider refreshing before analysis.";
  } else if (overall === "aging") {
    recommendation =
      "Some data sources are aging. Analysis will proceed but may need refresh soon.";
  } else if (overall === "missing") {
    recommendation =
      "Critical data (Financials) is missing. Analysis may be incomplete.";
  } else {
    recommendation = "All data sources are fresh. Safe to proceed.";
  }

  return {
    symbol,
    overall_status: overall,
    checks,
    recommendation,
    can_proceed: true, // For Tier 2, we always proceed (even with stale data), just warn
    warnings,
  };
}

// ============================================================================
// Portfolio-Level Validation (for Tier 3)
// ============================================================================

/**
 * Check data freshness for portfolio discovery (Tier 3)
 *
 * Validates cached analysis age and technical data for all eligible stocks.
 *
 * @param symbols - Array of stock symbols to check
 * @returns Portfolio-level freshness report
 */
export async function checkPortfolioDataFreshness(
  symbols: string[]
): Promise<PortfolioFreshnessReport> {
  if (symbols.length === 0) {
    return {
      overall_status: "missing",
      stock_reports: [],
      summary: {
        total_stocks: 0,
        fresh: 0,
        aging: 0,
        stale: 0,
        missing_analysis: 0,
      },
      recommendation: "No stocks to analyze",
      can_proceed: false,
      warnings: ["No eligible stocks for portfolio analysis"],
    };
  }

  // Get cached analysis for all symbols
  const cachedAnalysis = await db
    .select({
      symbol: schema.stockAnalysisCache.symbol,
      analyzedAt: schema.stockAnalysisCache.analyzedAt,
      expiresAt: schema.stockAnalysisCache.expiresAt,
    })
    .from(schema.stockAnalysisCache)
    .where(inArray(schema.stockAnalysisCache.symbol, symbols));

  const analysisMap = new Map(
    cachedAnalysis.map((a) => [a.symbol, a])
  );

  // Get technical data freshness
  const technicalData = await db
    .select({
      symbol: schema.technicalData.symbol,
      updatedAt: schema.technicalData.updatedAt,
    })
    .from(schema.technicalData)
    .where(inArray(schema.technicalData.symbol, symbols));

  const technicalMap = new Map(
    technicalData.map((t) => [t.symbol, t])
  );

  // Build per-stock reports
  const stockReports: StockFreshnessReport[] = [];
  const summary = {
    total_stocks: symbols.length,
    fresh: 0,
    aging: 0,
    stale: 0,
    missing_analysis: 0,
  };

  for (const symbol of symbols) {
    const checks: DataFreshnessCheck[] = [];

    // Check cached analysis
    const analysis = analysisMap.get(symbol);
    const analysisAge = analysis ? getAgeHours(analysis.analyzedAt) : null;
    const analysisStatus = getFreshnessStatus(
      analysisAge,
      TTL_CONFIG.CACHED_ANALYSIS,
      AGING_THRESHOLD.CACHED_ANALYSIS
    );

    checks.push({
      source: "Cached Analysis (Tier 2)",
      status: analysisStatus,
      age_hours: analysisAge,
      ttl_hours: TTL_CONFIG.CACHED_ANALYSIS,
      threshold_aging_hours: AGING_THRESHOLD.CACHED_ANALYSIS,
      last_updated: analysis?.analyzedAt || null,
      warning: getWarningMessage(
        "Cached Analysis",
        analysisStatus,
        analysisAge,
        TTL_CONFIG.CACHED_ANALYSIS
      ),
    });

    // Check technical data
    const technical = technicalMap.get(symbol);
    const technicalAge = technical ? getAgeHours(technical.updatedAt) : null;
    const technicalStatus = getFreshnessStatus(
      technicalAge,
      TTL_CONFIG.TECHNICAL,
      AGING_THRESHOLD.TECHNICAL
    );

    checks.push({
      source: "Technical Data",
      status: technicalStatus,
      age_hours: technicalAge,
      ttl_hours: TTL_CONFIG.TECHNICAL,
      threshold_aging_hours: AGING_THRESHOLD.TECHNICAL,
      last_updated: technical?.updatedAt || null,
      warning: getWarningMessage(
        "Technical Data",
        technicalStatus,
        technicalAge,
        TTL_CONFIG.TECHNICAL
      ),
    });

    // For portfolio summary, only consider Cached Analysis status
    // Technical data has a very short TTL (5min) and refreshes automatically
    const overall = analysisStatus;
    const warnings = checks
      .filter((c) => c.warning)
      .map((c) => c.warning as string);

    // Update summary based on Cached Analysis status only
    if (analysisStatus === "missing") {
      summary.missing_analysis++;
    } else if (analysisStatus === "stale") {
      summary.stale++;
    } else if (analysisStatus === "aging") {
      summary.aging++;
    } else {
      summary.fresh++;
    }

    let recommendation = "";
    if (analysisStatus === "missing") {
      recommendation = `No Tier 2 analysis found. Run deep analysis for ${symbol} first.`;
    } else if (overall === "stale") {
      recommendation = `Cached analysis is stale. Re-run Tier 2 for ${symbol}.`;
    } else if (overall === "aging") {
      recommendation = `Analysis is aging but usable for ${symbol}.`;
    } else {
      recommendation = `Data is fresh for ${symbol}.`;
    }

    stockReports.push({
      symbol,
      overall_status: overall,
      checks,
      recommendation,
      can_proceed: analysisStatus !== "missing", // Block if no cached analysis
      warnings,
    });
  }

  // Determine overall portfolio status
  const portfolioWarnings: string[] = [];
  let can_proceed = true;
  let overall_status: FreshnessStatus = "fresh";

  if (summary.missing_analysis > 0) {
    overall_status = "missing";
    can_proceed = false;
    portfolioWarnings.push(
      `${summary.missing_analysis} stock(s) missing Tier 2 analysis`
    );
  } else if (summary.stale > 0) {
    overall_status = "stale";
    portfolioWarnings.push(
      `${summary.stale} stock(s) have stale cached analysis`
    );
  } else if (summary.aging > 0) {
    overall_status = "aging";
    portfolioWarnings.push(`${summary.aging} stock(s) have aging data`);
  }

  // Add per-stock warnings
  stockReports.forEach((r) => {
    if (r.warnings.length > 0) {
      portfolioWarnings.push(`${r.symbol}: ${r.warnings.join("; ")}`);
    }
  });

  let recommendation = "";
  if (!can_proceed) {
    recommendation = `Cannot proceed with Tier 3. ${summary.missing_analysis} stock(s) need Tier 2 analysis first.`;
  } else if (overall_status === "stale") {
    recommendation = `Portfolio has stale data. Consider refreshing Tier 2 analysis for ${summary.stale} stock(s). Use ?force=true to proceed anyway.`;
  } else if (overall_status === "aging") {
    recommendation = `Portfolio data is aging but acceptable. Tier 3 can proceed.`;
  } else {
    recommendation = `All portfolio data is fresh. Safe to proceed with Tier 3.`;
  }

  return {
    overall_status,
    stock_reports: stockReports,
    summary,
    recommendation,
    can_proceed,
    warnings: portfolioWarnings,
  };
}

// ============================================================================
// Batch Validation (for Tier 2 batch runs)
// ============================================================================

/**
 * Check freshness for multiple stocks (used in batch Tier 2 jobs)
 *
 * @param symbols - Array of stock symbols
 * @returns Array of stock freshness reports
 */
export async function checkBatchDataFreshness(
  symbols: string[]
): Promise<StockFreshnessReport[]> {
  return Promise.all(symbols.map((s) => checkStockDataFreshness(s)));
}
