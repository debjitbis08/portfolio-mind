/**
 * Financials Tool
 *
 * Provides access to company financial data including cash flow,
 * profit/loss, and balance sheet metrics for earnings quality checks.
 */

import { registerToolExecutor, type ToolResponse } from "./registry";
import { db, schema } from "../db";
import { eq, desc } from "drizzle-orm";

interface GetFinancialsArgs {
  symbol: string;
  period_type?: "annual" | "quarterly" | "both";
  num_periods?: number;
}

/**
 * Get financial data for a company
 */
async function getFinancials(
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const {
    symbol,
    period_type = "annual",
    num_periods = 4,
  } = args as unknown as GetFinancialsArgs;

  if (!symbol || symbol.trim().length === 0) {
    return {
      success: false,
      error: {
        code: "PARSE_ERROR",
        message: "Symbol parameter is required",
        retryable: false,
      },
    };
  }

  const cleanSymbol = symbol.trim().toUpperCase();
  console.log(`[Financials Tool] Fetching data for: ${cleanSymbol}`);

  try {
    // Build query based on period type
    let periodFilter: "annual" | "quarterly" | undefined;
    if (period_type === "annual" || period_type === "quarterly") {
      periodFilter = period_type;
    }

    // Fetch financial data from database
    let query = db
      .select()
      .from(schema.companyFinancials)
      .where(eq(schema.companyFinancials.symbol, cleanSymbol))
      .orderBy(desc(schema.companyFinancials.reportDate))
      .limit(Math.min(num_periods || 8, 20));

    const financials = await query;

    // Filter by period type if specified
    const filtered = periodFilter
      ? financials.filter((f) => f.periodType === periodFilter)
      : financials;

    if (filtered.length === 0) {
      return {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: `No financial data found for ${cleanSymbol}. Try syncing financials from Screener.`,
          retryable: false,
        },
      };
    }

    // Format data for agent consumption
    const formattedData = filtered.map((f) => {
      // Calculate cash flow quality metrics
      const cfoCoverageRatio =
        f.netProfit && f.operatingCashFlow && f.netProfit !== 0
          ? f.operatingCashFlow / f.netProfit
          : null;

      // Flag potential earnings quality issues
      const earningsQualityFlags: string[] = [];

      if (f.operatingCashFlow !== null && f.netProfit !== null) {
        // CFO should be at least 50% of Net Profit for healthy companies
        if (f.operatingCashFlow < f.netProfit * 0.5) {
          earningsQualityFlags.push(
            "⚠️ CFO significantly lower than Net Profit - check receivables"
          );
        }
        // Negative CFO with positive profit is a major red flag
        if (f.operatingCashFlow < 0 && f.netProfit > 0) {
          earningsQualityFlags.push(
            "🚨 NEGATIVE CFO with positive profit - earnings quality concern!"
          );
        }
        // CFO much higher than profit is usually good (conservative accounting)
        if (f.operatingCashFlow > f.netProfit * 1.5) {
          earningsQualityFlags.push(
            "✅ CFO exceeds Net Profit - conservative accounting"
          );
        }
      }

      return {
        period: f.reportDate,
        period_type: f.periodType,
        // P&L metrics
        sales_cr: f.sales,
        operating_profit_cr: f.operatingProfit,
        net_profit_cr: f.netProfit,
        opm_percent: f.opmPercent,
        eps: f.eps,
        // Cash Flow metrics (key for earnings quality)
        operating_cash_flow_cr: f.operatingCashFlow,
        investing_cash_flow_cr: f.investingCashFlow,
        financing_cash_flow_cr: f.financingCashFlow,
        // Derived metrics
        cfo_to_net_profit_ratio: cfoCoverageRatio
          ? Number(cfoCoverageRatio.toFixed(2))
          : null,
        earnings_quality_flags: earningsQualityFlags,
        // Balance sheet snapshot
        borrowings_cr: f.borrowings,
        receivables_cr: f.receivables,
        inventory_cr: f.inventory,
      };
    });

    // Summary analysis
    const latestAnnual = formattedData.find((f) => f.period_type === "annual");
    const cfoRatio = latestAnnual?.cfo_to_net_profit_ratio;
    const summary = {
      symbol: cleanSymbol,
      periods_available: formattedData.length,
      latest_annual_period: latestAnnual?.period || null,
      cash_flow_check:
        cfoRatio !== null && cfoRatio !== undefined
          ? cfoRatio >= 0.7
            ? "✅ CFO covers Net Profit well"
            : cfoRatio >= 0.3
            ? "⚠️ CFO below Net Profit - investigate"
            : "🚨 CFO significantly below Net Profit - red flag"
          : "❓ Cash flow data not available",
    };

    return {
      success: true,
      data: {
        summary,
        financials: formattedData,
      },
      meta: {
        source: "company_financials_db",
      },
    };
  } catch (error) {
    console.error("[Financials Tool] Error:", error);
    return {
      success: false,
      error: {
        code: "UNKNOWN",
        message: error instanceof Error ? error.message : "Unknown error",
        retryable: true,
      },
    };
  }
}

// Register the executor
registerToolExecutor("get_financials", getFinancials);

export { getFinancials };
