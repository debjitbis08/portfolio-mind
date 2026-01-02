import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance();

// Map Groww symbols to Yahoo Finance symbols where they differ
const SYMBOL_MAP: Record<string, string> = {
  GODAWARIP: "GPIL", // Godawari Power & Ispat
  // KPL is the same on Yahoo (KPL.BO), no mapping needed
  // Add more mappings as needed
};

function mapToYahooSymbol(growwSymbol: string): string {
  return SYMBOL_MAP[growwSymbol] || growwSymbol;
}

export const GET: APIRoute = async ({ request, cookies }) => {
  try {
    // Get user from cookies
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

    // User client for reading holdings (respects RLS)
    const supabase = createClient(supabaseUrl, supabaseKey);
    // Service role client for writing to cache (bypasses RLS)
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

    // Fetch holdings from view
    const { data: holdings, error } = await supabase
      .from("holdings")
      .select("*")
      .eq("user_id", userId);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!holdings || holdings.length === 0) {
      return new Response(JSON.stringify({ holdings: [], summary: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get unique symbols and fetch current prices
    const symbols = holdings.map((h) => h.symbol);
    let quotes: Record<string, number> = {};

    // Build map of yahoo symbol -> all holdings symbols that map to it
    const yahooToHoldings: Record<string, string[]> = {};
    for (const s of symbols) {
      const yahoo = mapToYahooSymbol(s);
      if (!yahooToHoldings[yahoo]) yahooToHoldings[yahoo] = [];
      yahooToHoldings[yahoo].push(s);
    }

    const uniqueYahooSymbols = [
      ...new Set(symbols.map((s) => mapToYahooSymbol(s))),
    ];

    // Step 1: Check cache for fresh prices
    const { data: cachedPrices } = await supabase
      .from("price_cache")
      .select("symbol, price, updated_at")
      .in("symbol", uniqueYahooSymbols);

    const now = new Date();
    const freshPrices: Record<string, number> = {};
    const staleSymbols: string[] = [];

    // Check which symbols have fresh cache vs need refresh
    for (const yahoo of uniqueYahooSymbols) {
      const cached = cachedPrices?.find((c) => c.symbol === yahoo);
      if (cached) {
        const cacheAge =
          (now.getTime() - new Date(cached.updated_at).getTime()) / 1000 / 60;
        // Simple staleness: 5 min during market hours (roughly 9-16 IST), 30 min otherwise
        const hour = now.getUTCHours() + 5.5; // Rough IST conversion
        const isMarketHours = hour >= 9 && hour <= 16;
        const maxAge = isMarketHours ? 5 : 30;

        if (cacheAge <= maxAge) {
          freshPrices[yahoo] = Number(cached.price);
        } else {
          staleSymbols.push(yahoo);
        }
      } else {
        staleSymbols.push(yahoo);
      }
    }

    // Step 2: Fetch stale/missing from Yahoo
    if (staleSymbols.length > 0) {
      try {
        // Try NSE first
        const nseSymbols = staleSymbols.map((s) => `${s}.NS`);
        const nseResults = await yahooFinance.quote(nseSymbols);
        const nseArray = Array.isArray(nseResults) ? nseResults : [nseResults];

        const pricesToCache: Array<{ symbol: string; price: number }> = [];

        for (const quote of nseArray) {
          if (quote?.symbol && quote.regularMarketPrice) {
            const yahoo = quote.symbol.replace(".NS", "");
            freshPrices[yahoo] = quote.regularMarketPrice;
            pricesToCache.push({
              symbol: yahoo,
              price: quote.regularMarketPrice,
            });
          }
        }

        // Try BSE for remaining
        const stillMissing = staleSymbols.filter((s) => !freshPrices[s]);
        if (stillMissing.length > 0) {
          try {
            const bseSymbols = stillMissing.map((s) => `${s}.BO`);
            const bseResults = await yahooFinance.quote(bseSymbols);
            const bseArray = Array.isArray(bseResults)
              ? bseResults
              : [bseResults];

            for (const quote of bseArray) {
              if (quote?.symbol && quote.regularMarketPrice) {
                const yahoo = quote.symbol.replace(".BO", "");
                freshPrices[yahoo] = quote.regularMarketPrice;
                pricesToCache.push({
                  symbol: yahoo,
                  price: quote.regularMarketPrice,
                });
              }
            }
          } catch (bseErr) {
            console.error("BSE fetch error:", bseErr);
          }
        }

        // Step 3: Update cache
        if (pricesToCache.length > 0) {
          await supabaseAdmin.from("price_cache").upsert(
            pricesToCache.map((p) => ({
              ...p,
              updated_at: new Date().toISOString(),
            })),
            { onConflict: "symbol" }
          );
        }
      } catch (err) {
        console.error("Yahoo Finance error:", err);
      }
    }

    // Map Yahoo symbols back to holdings symbols
    for (const [yahoo, price] of Object.entries(freshPrices)) {
      const holdingsSyms = yahooToHoldings[yahoo] || [yahoo];
      for (const hs of holdingsSyms) {
        quotes[hs] = price;
      }
    }

    // Enrich holdings with current prices and returns
    const enrichedHoldings = holdings.map((h) => {
      const currentPrice = quotes[h.symbol] || 0;
      const currentValue = currentPrice * h.quantity;
      const investedValue = h.invested_value;
      const returns = currentValue - investedValue;
      const returnsPercent =
        investedValue > 0 ? (returns / investedValue) * 100 : 0;

      return {
        ...h,
        current_price: currentPrice,
        current_value: currentValue,
        returns,
        returns_percent: returnsPercent,
      };
    });

    // Fetch technical data for all holdings
    const { data: technicalData } = await supabase
      .from("technical_data")
      .select("*");

    // Create lookup map for technical data
    const techMap = new Map<string, any>();
    if (technicalData) {
      for (const t of technicalData) {
        techMap.set(t.symbol, t);
      }
    }

    // Merge technical data into holdings
    const holdingsWithTech = enrichedHoldings.map((h) => {
      const yahooSymbol = mapToYahooSymbol(h.symbol);
      const tech = techMap.get(yahooSymbol) || techMap.get(h.symbol);

      // Determine wait zone reasons
      const waitReasons: string[] = [];
      if (tech) {
        if (tech.rsi_14 && Number(tech.rsi_14) > 70) {
          waitReasons.push(`RSI ${Number(tech.rsi_14).toFixed(0)}`);
        }
        if (tech.price_vs_sma50 && Number(tech.price_vs_sma50) > 20) {
          waitReasons.push(`+${Number(tech.price_vs_sma50).toFixed(0)}% SMA50`);
        }
        if (tech.price_vs_sma200 && Number(tech.price_vs_sma200) > 40) {
          waitReasons.push(
            `+${Number(tech.price_vs_sma200).toFixed(0)}% SMA200`
          );
        }
        if (
          tech.sma_200 &&
          tech.current_price &&
          Number(tech.current_price) < Number(tech.sma_200)
        ) {
          waitReasons.push("Below SMA200");
        }
      }

      return {
        ...h,
        rsi_14: tech?.rsi_14 ? Number(tech.rsi_14) : null,
        sma_50: tech?.sma_50 ? Number(tech.sma_50) : null,
        sma_200: tech?.sma_200 ? Number(tech.sma_200) : null,
        price_vs_sma50: tech?.price_vs_sma50
          ? Number(tech.price_vs_sma50)
          : null,
        price_vs_sma200: tech?.price_vs_sma200
          ? Number(tech.price_vs_sma200)
          : null,
        is_wait_zone: waitReasons.length > 0,
        wait_reasons: waitReasons,
      };
    });

    // Sort by current value descending
    holdingsWithTech.sort((a, b) => b.current_value - a.current_value);

    // Calculate summary
    const totalCurrentValue = holdingsWithTech.reduce(
      (sum, h) => sum + h.current_value,
      0
    );
    const totalInvestedValue = holdingsWithTech.reduce(
      (sum, h) => sum + h.invested_value,
      0
    );
    const totalReturns = totalCurrentValue - totalInvestedValue;
    const totalReturnsPercent =
      totalInvestedValue > 0 ? (totalReturns / totalInvestedValue) * 100 : 0;

    return new Response(
      JSON.stringify({
        holdings: holdingsWithTech,
        summary: {
          current_value: totalCurrentValue,
          invested_value: totalInvestedValue,
          total_returns: totalReturns,
          total_returns_percent: totalReturnsPercent,
          holdings_count: holdingsWithTech.length,
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Holdings API error:", error);
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
