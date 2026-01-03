/**
 * Commodities Tool
 *
 * Fetches current spot prices for precious metals (gold, silver, etc.)
 * Uses metals.dev API for India-specific pricing (MCX/IBJA).
 */

import { registerToolExecutor, type ToolResponse } from "./registry";
import { getCached, setCache } from "./cache";

// metals.dev API (free tier)
const METALS_API_BASE = "https://api.metals.dev/v1";

interface MetalsLatestResponse {
  status: string;
  currency: string;
  unit: string;
  timestamps: {
    metal: string;
    currency: string;
  };
  metals: {
    gold?: number;
    silver?: number;
    platinum?: number;
    palladium?: number;
    [key: string]: number | undefined;
  };
}

interface GetCommodityPricesArgs {
  commodities?: string; // Optional comma-separated list: "gold,silver"
}

/**
 * Fetch commodity prices from metals.dev API
 */
async function fetchMetalsPrices(
  apiKey: string,
  currency: string = "INR"
): Promise<MetalsLatestResponse | null> {
  try {
    const url = `${METALS_API_BASE}/latest?api_key=${apiKey}&currency=${currency}&unit=gram`;
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      console.error(
        `[Commodities] API error: ${response.status} ${response.statusText}`
      );
      return null;
    }

    return (await response.json()) as MetalsLatestResponse;
  } catch (error) {
    console.error("[Commodities] Fetch error:", error);
    return null;
  }
}

/**
 * Get current commodity prices
 */
async function getCommodityPrices(
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const { commodities } = args as unknown as GetCommodityPricesArgs;

  // Check which commodities to fetch (default: gold, silver)
  const requestedCommodities = commodities
    ? commodities
        .toLowerCase()
        .split(",")
        .map((c) => c.trim())
    : ["gold", "silver"];

  // Check cache first
  const cacheKey = { commodities: requestedCommodities.sort().join(",") };
  const cached = await getCached("metals_api", cacheKey);

  if (cached.hit) {
    return {
      success: true,
      data: cached.data,
      meta: {
        from_cache: true,
        cache_age_hours: cached.age_hours,
        source: "metals_api",
      },
    };
  }

  // Get API key from environment
  const apiKey = process.env.METALS_API_KEY;
  if (!apiKey) {
    // If no API key, return a helpful message with mock data for development
    console.warn(
      "[Commodities] METALS_API_KEY not set, returning placeholder data"
    );

    const placeholderData = {
      found: true,
      note: "Using placeholder data - set METALS_API_KEY for live prices",
      currency: "INR",
      unit: "gram",
      prices: {
        gold: requestedCommodities.includes("gold")
          ? { price_per_gram: 7500, price_per_10g: 75000 }
          : undefined,
        silver: requestedCommodities.includes("silver")
          ? { price_per_gram: 90, price_per_kg: 90000 }
          : undefined,
      },
      instructions:
        "These are placeholder prices. Set METALS_API_KEY environment variable for live MCX/IBJA prices.",
    };

    return {
      success: true,
      data: placeholderData,
      meta: {
        source: "metals_api",
        fetched_at: new Date().toISOString(),
      },
    };
  }

  try {
    console.log(
      `[Commodities] Fetching prices for: ${requestedCommodities.join(", ")}`
    );

    const metalsData = await fetchMetalsPrices(apiKey);

    if (!metalsData || metalsData.status !== "success") {
      return {
        success: false,
        error: {
          code: "UNKNOWN",
          message: "Failed to fetch commodity prices from API",
          retryable: true,
        },
      };
    }

    // Build response with requested commodities
    const prices: Record<
      string,
      { price_per_gram: number; price_per_10g?: number; price_per_kg?: number }
    > = {};

    for (const commodity of requestedCommodities) {
      const price = metalsData.metals[commodity];
      if (price !== undefined) {
        prices[commodity] = {
          price_per_gram: Math.round(price * 100) / 100,
          price_per_10g:
            commodity === "gold"
              ? Math.round(price * 10 * 100) / 100
              : undefined,
          price_per_kg:
            commodity !== "gold"
              ? Math.round(price * 1000 * 100) / 100
              : undefined,
        };
      }
    }

    const result = {
      found: Object.keys(prices).length > 0,
      currency: metalsData.currency,
      unit: metalsData.unit,
      timestamp: metalsData.timestamps.metal,
      prices,
      instructions:
        "Use these prices to evaluate commodity exposure in the portfolio. Compare with Gold ETF holdings - if ETF NAV is significantly different from spot, there may be premium/discount.",
    };

    // Cache the result
    await setCache("metals_api", cacheKey, result);

    return {
      success: true,
      data: result,
      meta: {
        source: "metals_api",
        fetched_at: new Date().toISOString(),
      },
    };
  } catch (error) {
    console.error("[Commodities] Error:", error);

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
registerToolExecutor("get_commodity_prices", getCommodityPrices);

export { getCommodityPrices };
