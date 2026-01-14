import YahooFinance from "yahoo-finance2";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  schema,
  getCatalystHoldings,
  isPriceStale,
} from "../db";
import { getSymbolMappings } from "../mappings";
import { normalizeSymbol } from "../symbol-matcher";
import {
  CatalystGeminiService,
  type CatalystHoldingForAnalysis,
  type CatalystSuggestion,
} from "./catalyst-gemini";
import { calculateCatalystPerformanceMetrics } from "./performance-metrics";

const yahooFinance = new YahooFinance();
const actionPriority: Record<CatalystSuggestion["action"], number> = {
  BUY: 4,
  SELL: 3,
  HOLD: 2,
  WATCH: 1,
};

const dedupeSuggestionsBySymbol = (
  suggestions: CatalystSuggestion[]
): CatalystSuggestion[] => {
  const deduped = new Map<string, CatalystSuggestion>();

  for (const suggestion of suggestions) {
    const normalized = normalizeSymbol(suggestion.symbol);
    if (!normalized) {
      continue;
    }

    const existing = deduped.get(normalized);
    if (!existing) {
      deduped.set(normalized, suggestion);
      continue;
    }

    const existingConfidence = existing.confidence ?? 0;
    const candidateConfidence = suggestion.confidence ?? 0;
    if (candidateConfidence > existingConfidence) {
      deduped.set(normalized, suggestion);
      continue;
    }

    if (candidateConfidence === existingConfidence) {
      const existingPriority = actionPriority[existing.action] ?? 0;
      const candidatePriority = actionPriority[suggestion.action] ?? 0;
      if (candidatePriority > existingPriority) {
        deduped.set(normalized, suggestion);
      }
    }
  }

  return Array.from(deduped.values());
};

const clampAllocationAmount = (
  suggestion: CatalystSuggestion,
  totalCapital: number
): CatalystSuggestion => {
  if (suggestion.action !== "BUY") {
    return suggestion;
  }

  const rawAllocation =
    typeof suggestion.allocation_amount === "number"
      ? suggestion.allocation_amount
      : null;

  if (!rawAllocation || rawAllocation <= 0 || totalCapital <= 0) {
    return { ...suggestion, allocation_amount: undefined };
  }

  const maxPerPosition = totalCapital * 0.2;
  const cappedAllocation = Math.min(rawAllocation, totalCapital, maxPerPosition);

  return {
    ...suggestion,
    allocation_amount: Number.isFinite(cappedAllocation)
      ? Math.round(cappedAllocation)
      : undefined,
  };
};

const supersedeDuplicatePendingSuggestions = async (): Promise<number> => {
  const pendingSuggestions = await db
    .select({
      id: schema.suggestions.id,
      symbol: schema.suggestions.symbol,
      createdAt: schema.suggestions.createdAt,
    })
    .from(schema.suggestions)
    .where(
      and(
        eq(schema.suggestions.portfolioType, "CATALYST"),
        eq(schema.suggestions.status, "pending")
      )
    )
    .orderBy(desc(schema.suggestions.createdAt));

  const primaryBySymbol = new Map<string, string>();
  const supersedeTargets = new Map<string, string[]>();

  for (const pending of pendingSuggestions) {
    const normalized = normalizeSymbol(pending.symbol);
    if (!normalized) {
      continue;
    }

    const primaryId = primaryBySymbol.get(normalized);
    if (!primaryId) {
      primaryBySymbol.set(normalized, pending.id);
      continue;
    }

    const targets = supersedeTargets.get(primaryId) ?? [];
    targets.push(pending.id);
    supersedeTargets.set(primaryId, targets);
  }

  let supersededCount = 0;
  for (const [primaryId, duplicateIds] of supersedeTargets) {
    if (duplicateIds.length === 0) {
      continue;
    }

    await db
      .update(schema.suggestions)
      .set({
        status: "superseded",
        supersededBy: primaryId,
        supersededReason: "Superseded by newer pending suggestion",
        reviewedAt: new Date().toISOString(),
      })
      .where(inArray(schema.suggestions.id, duplicateIds));

    supersededCount += duplicateIds.length;
  }

  return supersededCount;
};

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

  const supersededDuplicates = await supersedeDuplicatePendingSuggestions();
  if (supersededDuplicates > 0) {
    console.log(
      `[Catalyst Suggestions] Superseded ${supersededDuplicates} duplicate pending suggestions`
    );
  }

  // Get catalyst holdings
  const holdings = await getCatalystHoldings();
  const symbols = holdings.map((h) => h.symbol);

  // Fetch prices for holdings
  const mappings = await getSymbolMappings();
  const mapSymbol = (s: string) => mappings[s] || s;
  const uniqueYahooSymbols = [...new Set(symbols.map(mapSymbol))];

  let quotes: Record<string, { price: number; adv10d: number | null }> = {};

  if (uniqueYahooSymbols.length > 0) {
    // Check cache first
    const cachedPrices = await db
      .select()
      .from(schema.priceCache)
      .where(inArray(schema.priceCache.symbol, uniqueYahooSymbols));

    for (const cached of cachedPrices) {
      if (!isPriceStale(cached.updatedAt)) {
        quotes[cached.symbol] = { price: cached.price, adv10d: null };
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
            const normalized = q.symbol.replace(".NS", "");
            const adv10d =
              typeof q.averageDailyVolume10Day === "number"
                ? q.averageDailyVolume10Day
                : typeof q.averageDailyVolume3Month === "number"
                ? q.averageDailyVolume3Month
                : null;
            quotes[normalized] = {
              price: q.regularMarketPrice,
              adv10d,
            };
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
      const quote = quotes[yahooSymbol] || quotes[h.symbol] || {
        price: 0,
        adv10d: null,
      };
      const currentPrice = quote.price;
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
        adv_10d: quote.adv10d,
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
  const totalHoldingsValue = holdingsForAnalysis.reduce(
    (sum, holding) => sum + holding.current_price * holding.quantity,
    0
  );
  const totalCapital = totalHoldingsValue + catalystFunds;
  const performanceMetrics = await calculateCatalystPerformanceMetrics();
  const rawSuggestions = await CatalystGeminiService.analyzeCatalystPortfolio(
    holdingsForAnalysis,
    catalystFunds,
    performanceMetrics,
    onProgress
  );

  const suggestions = dedupeSuggestionsBySymbol(rawSuggestions).map((s) =>
    clampAllocationAmount(s, totalCapital)
  );
  if (suggestions.length !== rawSuggestions.length) {
    console.log(
      `[Catalyst Suggestions] Deduped ${rawSuggestions.length - suggestions.length} repeated suggestion(s)`
    );
  }

  console.log(
    `[Catalyst Suggestions] Generated ${suggestions.length} suggestions`
  );

  const suggestionSymbols = [
    ...new Set(suggestions.map((s) => s.symbol).filter(Boolean)),
  ];
  const normalizedSuggestionSymbols = [
    ...new Set(suggestionSymbols.map((s) => normalizeSymbol(s))),
  ];
  const pendingSymbolCandidates = new Set<string>();
  for (const symbol of normalizedSuggestionSymbols) {
    pendingSymbolCandidates.add(symbol);
    pendingSymbolCandidates.add(`${symbol}.NS`);
    pendingSymbolCandidates.add(`${symbol}.BO`);
    pendingSymbolCandidates.add(`${symbol}.BSE`);
    pendingSymbolCandidates.add(`${symbol}.NSE`);
  }

  const pendingBySymbol = new Map<string, { id: string }>();
  if (pendingSymbolCandidates.size > 0) {
    const pendingSuggestions = await db
      .select({
        id: schema.suggestions.id,
        symbol: schema.suggestions.symbol,
        createdAt: schema.suggestions.createdAt,
      })
      .from(schema.suggestions)
      .where(
        and(
          eq(schema.suggestions.portfolioType, "CATALYST"),
          eq(schema.suggestions.status, "pending"),
          inArray(
            schema.suggestions.symbol,
            Array.from(pendingSymbolCandidates)
          )
        )
      )
      .orderBy(desc(schema.suggestions.createdAt));

    for (const pending of pendingSuggestions) {
      const normalizedSymbol = normalizeSymbol(pending.symbol);
      if (!pendingBySymbol.has(normalizedSymbol)) {
        pendingBySymbol.set(normalizedSymbol, { id: pending.id });
      }
    }
  }

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

    const existingPending = pendingBySymbol.get(
      normalizeSymbol(suggestion.symbol)
    );
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const [saved] = existingPending
      ? await db
          .update(schema.suggestions)
          .set({
            stockName: suggestion.stock_name,
            action: suggestion.action as any,
            rationale: suggestion.rationale,
            confidence: suggestion.confidence,
            quantity: suggestion.quantity,
            allocationAmount: suggestion.allocation_amount,
            currentPrice: suggestion.entry_price,
            targetPrice: suggestion.target_price,
            technicalScore: suggestion.technical_score,
            status: "pending",
            citations: suggestion.citations
              ? JSON.stringify(suggestion.citations)
              : null,
            // Catalyst-specific fields
            stopLoss: suggestion.stop_loss,
            minHoldHours: suggestion.min_hold_hours,
            maxHoldDays: suggestion.max_hold_days,
            riskRewardRatio: suggestion.risk_reward_ratio,
            trailingStop: suggestion.trailing_stop ? 1 : 0,
            entryTrigger: suggestion.entry_trigger,
            exitCondition: suggestion.exit_condition,
            volatilityAtEntry: suggestion.volatility_at_entry,
            catalystId,
            createdAt: new Date().toISOString(),
            expiresAt: expiresAt.toISOString(),
          })
          .where(eq(schema.suggestions.id, existingPending.id))
          .returning()
      : await db
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
            minHoldHours: suggestion.min_hold_hours,
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
