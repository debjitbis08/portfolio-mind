/**
 * Technical Analysis Tools
 *
 * Provides RSI, SMAs, and wait zone checks.
 * Uses the existing technical-indicators module.
 */

import { registerToolExecutor, type ToolResponse } from "./registry";
import {
  getTechnicalData,
  checkWaitZone as checkWaitZoneInternal,
} from "../technical-indicators";

interface GetTechnicalsArgs {
  symbol: string;
}

interface CheckWaitZoneArgs {
  symbol: string;
}

/**
 * Get technical indicators for a stock
 */
async function getTechnicals(
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const { symbol } = args as unknown as GetTechnicalsArgs;

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

  try {
    const cleanSymbol = symbol.trim().toUpperCase();
    console.log(`[Technicals Tool] Fetching data for: ${cleanSymbol}`);

    const data = await getTechnicalData(cleanSymbol);

    if (!data) {
      return {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: `Could not fetch technical data for ${cleanSymbol}. Symbol may be invalid or have insufficient history.`,
          retryable: false,
        },
      };
    }

    return {
      success: true,
      data: {
        symbol: data.symbol,
        current_price: data.currentPrice,
        rsi_14: data.rsi14,
        sma_50: data.sma50,
        sma_200: data.sma200,
        price_vs_sma50_pct: data.priceVsSma50,
        price_vs_sma200_pct: data.priceVsSma200,
        zone_status: data.zoneStatus, // New: BUY, WAIT_TOO_HOT, or WAIT_TOO_COLD
        is_wait_zone: data.isWaitZone, // Backward compatibility
        wait_reasons: data.waitReasons,
      },
      meta: {
        source: "yahoo",
      },
    };
  } catch (error) {
    console.error("[Technicals Tool] Error:", error);

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    const isTimeout =
      errorMessage.includes("timeout") || errorMessage.includes("ETIMEDOUT");

    return {
      success: false,
      error: {
        code: isTimeout ? "TIMEOUT" : "UNKNOWN",
        message: errorMessage,
        retryable: isTimeout,
      },
    };
  }
}

/**
 * Check if a stock is in wait zone
 */
async function checkWaitZone(
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const { symbol } = args as unknown as CheckWaitZoneArgs;

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

  try {
    const cleanSymbol = symbol.trim().toUpperCase();
    console.log(`[WaitZone Tool] Checking: ${cleanSymbol}`);

    const data = await getTechnicalData(cleanSymbol);

    if (!data) {
      return {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: `Could not fetch data for ${cleanSymbol}`,
          retryable: false,
        },
      };
    }

    return {
      success: true,
      data: {
        symbol: cleanSymbol,
        zone_status: data.zoneStatus, // New: BUY, WAIT_TOO_HOT, or WAIT_TOO_COLD
        is_wait_zone: data.isWaitZone, // Backward compatibility
        reasons: data.waitReasons,
        current_price: data.currentPrice,
        rsi_14: data.rsi14,
      },
      meta: {
        source: "internal",
      },
    };
  } catch (error) {
    console.error("[WaitZone Tool] Error:", error);
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

// Register the executors
registerToolExecutor("get_technicals", getTechnicals);
registerToolExecutor("check_wait_zone", checkWaitZone);

export { getTechnicals, checkWaitZone };
