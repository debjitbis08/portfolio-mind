import YahooFinance from "yahoo-finance2";
import { inArray } from "drizzle-orm";
import {
  db,
  schema,
  getCatalystHoldings,
  isPriceStale,
} from "../db";
import { getSymbolMappings } from "../mappings";
import {
  CatalystGeminiService,
  type CatalystHoldingForAnalysis,
} from "./catalyst-gemini";

const yahooFinance = new YahooFinance();

export async function runCatalystSuggestions(options?: {
  onProgress?: (pct: number, msg: string) => void;
}): Promise<{
  count: number;
  suggestions: Array<{
    id: string;
    symbol: string;
    action: string;
    status: string;
    confidence: number | null;
  }>;
}> {
  const onProgress = options?.onProgress;

  // Get catalyst holdings
  const holdings = await getCatalystHoldings();
  const symbols = holdings.map((h) => h.symbol);

  // Fetch prices for holdings
  const mappings = await getSymbolMappings();
  const mapSymbol = (s: string) => mappings[s] || s;
  const uniqueYahooSymbols = [...new Set(symbols.map(mapSymbol))];

  let quotes: Record<string, number> = {};

  if (uniqueYahooSymbols.length > 0) {
    // Check cache first
    const cachedPrices = await db
      .select()
      .from(schema.priceCache)
      .where(inArray(schema.priceCache.symbol, uniqueYahooSymbols));

    for (const cached of cachedPrices) {
      if (!isPriceStale(cached.updatedAt)) {
        quotes[cached.symbol] = cached.price;
      }
    }

    // Fetch missing from Yahoo
    const missingSymbols = uniqueYahooSymbols.filter((s) => !quotes[s]);
    if (missingSymbols.length > 0) {
      try {
        const nseSymbols = missingSymbols.map((s) => `${s}.NS`);
        const results = await yahooFinance.quote(nseSymbols);
        const arr = Array.isArray(results) ? results : [results];
        for (const q of arr) {
          if (q?.symbol && q.regularMarketPrice) {
            quotes[q.symbol.replace(".NS", "")] = q.regularMarketPrice;
          }
        }
      } catch (error) {
        console.warn("[Catalyst Suggestions] Yahoo fetch failed:", error);
      }
    }
  }

  // Fetch technical data
  const technicalData = await db.select().from(schema.technicalData);
  const techMap = new Map<string, (typeof technicalData)[0]>();
  for (const t of technicalData) {
    techMap.set(t.symbol, t);
  }

  // Build holdings for analysis
  const holdingsForAnalysis: CatalystHoldingForAnalysis[] = holdings.map(
    (h) => {
      const yahooSymbol = mapSymbol(h.symbol);
      const currentPrice = quotes[yahooSymbol] || quotes[h.symbol] || 0;
      const tech = techMap.get(yahooSymbol) || techMap.get(h.symbol);
      const investedValue = h.investedValue;
      const currentValue = currentPrice * h.quantity;
      const returnsPercent =
        investedValue > 0
          ? ((currentValue - investedValue) / investedValue) * 100
          : 0;

      return {
        symbol: h.symbol,
        stock_name: h.stockName,
        quantity: h.quantity,
        avg_buy_price: h.avgBuyPrice,
        current_price: currentPrice,
        returns_percent: returnsPercent,
        rsi_14: tech?.rsi14 ?? null,
        price_vs_sma50: tech?.priceVsSma50 ?? null,
        price_vs_sma200: tech?.priceVsSma200 ?? null,
      };
    }
  );

  // Get catalyst funds from settings
  const [settings] = await db.select().from(schema.settings).limit(1);
  const catalystFunds = settings?.catalystFunds ?? 0;

  console.log(
    `[Catalyst Suggestions] Analyzing ${holdingsForAnalysis.length} holdings with ₹${catalystFunds} available`
  );

  // Run catalyst analysis
  const suggestions = await CatalystGeminiService.analyzeCatalystPortfolio(
    holdingsForAnalysis,
    catalystFunds,
    onProgress
  );

  console.log(
    `[Catalyst Suggestions] Generated ${suggestions.length} suggestions`
  );

  const requestedCatalystIds = suggestions
    .map((s) => s.catalyst_id)
    .filter((id): id is string => Boolean(id));

  const existingCatalystIds = new Set<string>();
  if (requestedCatalystIds.length > 0) {
    const existing = await db
      .select({ id: schema.potentialCatalysts.id })
      .from(schema.potentialCatalysts)
      .where(inArray(schema.potentialCatalysts.id, requestedCatalystIds));

    for (const row of existing) {
      existingCatalystIds.add(row.id);
    }
  }

  // Save suggestions to database
  const savedSuggestions: Array<{
    id: string;
    symbol: string;
    action: string;
    status: string;
    confidence: number | null;
  }> = [];

  for (const suggestion of suggestions) {
    const catalystId =
      suggestion.catalyst_id && existingCatalystIds.has(suggestion.catalyst_id)
        ? suggestion.catalyst_id
        : null;

    if (suggestion.catalyst_id && !catalystId) {
      console.warn(
        `[Catalyst Suggestions] Unknown catalyst_id ${suggestion.catalyst_id}, storing suggestion without link`
      );
    }

    const [saved] = await db
      .insert(schema.suggestions)
      .values({
        symbol: suggestion.symbol,
        stockName: suggestion.stock_name,
        action: suggestion.action as any,
        rationale: suggestion.rationale,
        confidence: suggestion.confidence,
        quantity: suggestion.quantity,
        allocationAmount: suggestion.allocation_amount,
        currentPrice: suggestion.entry_price,
        targetPrice: suggestion.target_price,
        technicalScore: suggestion.technical_score,
        portfolioType: "CATALYST",
        status: "pending",
        citations: suggestion.citations
          ? JSON.stringify(suggestion.citations)
          : null,
        // Catalyst-specific fields
        stopLoss: suggestion.stop_loss,
        maxHoldDays: suggestion.max_hold_days,
        riskRewardRatio: suggestion.risk_reward_ratio,
        trailingStop: suggestion.trailing_stop ? 1 : 0,
        entryTrigger: suggestion.entry_trigger,
        exitCondition: suggestion.exit_condition,
        volatilityAtEntry: suggestion.volatility_at_entry,
        catalystId,
      })
      .returning();

    savedSuggestions.push({
      id: saved.id,
      symbol: saved.symbol,
      action: saved.action,
      status: saved.status,
      confidence: saved.confidence,
    });
  }

  return {
    count: savedSuggestions.length,
    suggestions: savedSuggestions,
  };
}
