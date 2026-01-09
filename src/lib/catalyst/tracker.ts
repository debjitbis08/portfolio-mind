import {
  potentialCatalysts,
  catalystSignals,
  suggestions,
  intradayTransactions,
  settings,
} from "../db/schema";
import { db, getCatalystHoldings } from "../db";
import * as schema from "../db/schema";
import { eq, desc, and, gte } from "drizzle-orm";
import { dispatchSignal } from "./signal-dispatcher";
import {
  type CatalystAsset,
  type CatalystSignal,
  DEFAULT_CATALYST_CONFIG,
} from "./types";
import { getEnabledAssets } from "./news-monitor";
import { isIndianMarketOpen, getMarketStatusMessage } from "./market-hours";
import { validateMultipleTickers } from "./market-validator";
import { correctTickers } from "../symbol-matcher";
import { CatalystGeminiService } from "./catalyst-gemini";
import YahooFinance from "yahoo-finance2";

interface WatchCriteria {
  metric: "PRICE" | "VOLUME";
  direction: "UP" | "DOWN";
  thresholdPercent: number;
  timeoutHours: number;
}

// Initialize Yahoo Finance client
const yahooFinance = new YahooFinance();

/**
 * Capture base prices for catalysts marked as "pending_next_open".
 * Should be called at market open to set the opening price as base.
 */
async function capturePendingBasePrices(): Promise<void> {
  const pending = await db
    .select()
    .from(potentialCatalysts)
    .where(
      and(
        eq(potentialCatalysts.status, "monitoring"),
        eq(potentialCatalysts.basePriceType, "pending_next_open")
      )
    );

  if (pending.length === 0) {
    return;
  }

  console.log(
    `   💰 Capturing base prices for ${pending.length} pending catalyst(s)...`
  );

  for (const catalyst of pending) {
    const ticker = catalyst.primaryTicker;
    if (!ticker) continue;

    try {
      const tickersToTry = [ticker];
      if (ticker.endsWith(".NS")) {
        tickersToTry.push(ticker.replace(".NS", ".BO"));
      } else if (ticker.endsWith(".BO")) {
        tickersToTry.push(ticker.replace(".BO", ".NS"));
      }

      let quote: any = null;
      let finalTicker = ticker;

      for (const tryTicker of tickersToTry) {
        try {
          quote = await yahooFinance.quote(tryTicker);
          if (quote?.regularMarketPrice) {
            finalTicker = tryTicker;
            break;
          }
        } catch {
          continue;
        }
      }

      if (quote?.regularMarketPrice) {
        await db
          .update(potentialCatalysts)
          .set({
            basePrice: quote.regularMarketPrice,
            basePriceTicker: finalTicker,
            basePriceRecordedAt: new Date().toISOString(),
            basePriceType: "next_open",
          })
          .where(eq(potentialCatalysts.id, catalyst.id));

        console.log(
          `      ✅ ${ticker}: ₹${quote.regularMarketPrice.toFixed(
            2
          )} (market open)`
        );
      }
    } catch (error) {
      console.error(
        `      ❌ Error capturing base price for ${ticker}:`,
        error
      );
    }
  }
}

/**
 * Get recent intraday trades for the catalyst portfolio.
 * Used to provide context to AI for signal-to-suggestion conversion.
 */
async function getRecentIntradayTrades(days: number = 7): Promise<any[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const trades = await db
    .select()
    .from(intradayTransactions)
    .where(
      and(
        eq(intradayTransactions.portfolioType, "CATALYST"),
        gte(intradayTransactions.executedAt, cutoff.toISOString())
      )
    )
    .orderBy(desc(intradayTransactions.executedAt))
    .limit(20);

  return trades;
}

/**
 * Main loop for the tracker.
 * 1. Checks 'monitoring' potential catalysts.
 * 2. Reevaluates each potential with latest market data and potential new news.
 * 3. Creates signals when market confirms predicted movement.
 *
 * Note: Skips price validation when Indian market is closed,
 * but still checks for expiries.
 */
export async function runCatalystTracker() {
  console.log("\n🕵️  Running Catalyst Tracker...");
  console.log(`   ${getMarketStatusMessage()}`);

  // Skip price validation when market is closed
  // (Global commodities still trade, but we trade Indian stocks)
  if (!isIndianMarketOpen()) {
    console.log("   ⏸️  Skipping price validation until market opens.");
    // Still check for expired items
    await expireStalePotentialCatalysts();
    return;
  }

  // Capture base prices for catalysts discovered after market close
  await capturePendingBasePrices();

  await checkAndReevaluatePotentialCatalysts();
  // await checkActiveOutcomes(); // TODO: Implement outcome tracking later
}

/**
 * Check and expire stale potential catalysts.
 * Called even when market is closed to clean up old items.
 */
async function expireStalePotentialCatalysts() {
  const monitors = await db
    .select()
    .from(potentialCatalysts)
    .where(eq(potentialCatalysts.status, "monitoring"));

  if (monitors.length === 0) {
    return;
  }

  let expiredCount = 0;
  for (const item of monitors) {
    try {
      const criteria = JSON.parse(item.watchCriteria) as WatchCriteria;
      const createdAt = new Date(item.createdAt || Date.now());
      const ageHours = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);

      if (ageHours > criteria.timeoutHours) {
        await db
          .update(potentialCatalysts)
          .set({ status: "expired" })
          .where(eq(potentialCatalysts.id, item.id));
        expiredCount++;
      }
    } catch (error) {
      console.error(`   Error checking expiry for ${item.id}:`, error);
    }
  }

  if (expiredCount > 0) {
    console.log(`   ⏰ Expired ${expiredCount} stale potential catalysts.`);
  }
}

/**
 * Check and reevaluate potential catalysts on every cycle.
 *
 * NEW BEHAVIOR:
 * 1. Fetches all monitoring catalysts
 * 2. For each catalyst, validates market movement against watch criteria
 * 3. Reevaluates predicted impact/potential based on latest market data
 * 4. Creates signal when criteria is met
 * 5. Updates or expires based on market behavior and time
 */
async function checkAndReevaluatePotentialCatalysts() {
  // 1. Fetch all monitoring items
  const monitors = await db
    .select()
    .from(potentialCatalysts)
    .where(eq(potentialCatalysts.status, "monitoring"));

  if (monitors.length === 0) {
    console.log("   No items to monitor.");
    return;
  }

  console.log(`   Checking ${monitors.length} potential catalysts...`);

  // Cache configs to map ticker -> asset info
  const allAssets = await getEnabledAssets();

  for (const item of monitors) {
    try {
      // Parse data
      const criteria = JSON.parse(item.watchCriteria) as WatchCriteria;
      const rawSymbols = JSON.parse(item.affectedSymbols) as string[]; // ["RELIANCE.NS", ...]
      const symbols = correctTickers(rawSymbols); // Auto-correct common AI mistakes
      const log = item.validationLog ? JSON.parse(item.validationLog) : [];

      // Check expiry
      const createdAt = new Date(item.createdAt || Date.now());
      const ageHours = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
      if (ageHours > criteria.timeoutHours) {
        console.log(
          `   ❌ Item ${item.id.slice(0, 6)} expired (Age: ${ageHours.toFixed(
            1
          )}h > ${criteria.timeoutHours}h)`
        );
        await db
          .update(potentialCatalysts)
          .set({ status: "expired" })
          .where(eq(potentialCatalysts.id, item.id));
        continue;
      }

      // Check market for EACH symbol using the market-validator utility
      const expectedSentiment =
        criteria.direction === "UP" ? "BULLISH" : "BEARISH";
      const marketResults = await validateMultipleTickers(
        symbols,
        expectedSentiment
      );

      let confirmed = false;
      let confirmingTicker = "";
      let marketDataSnapshot: any = null;

      // Track best performing ticker for reevaluation
      let bestPerformance = {
        ticker: "",
        change: -Infinity,
        data: null as any,
      };

      // Check each symbol's market data against criteria
      for (const [ticker, marketData] of Array.from(marketResults.entries())) {
        // Calculate price change from BASE price (discovery time) instead of previous close
        let priceChange = marketData.priceChangePercent;

        if (item.basePrice && item.basePrice > 0) {
          // Use base price from discovery time for accurate % change
          priceChange =
            ((marketData.currentPrice - item.basePrice) / item.basePrice) * 100;
        }

        // Track performance for reevaluation
        const performanceScore =
          criteria.direction === "UP" ? priceChange : -priceChange;
        if (performanceScore > bestPerformance.change) {
          bestPerformance = { ticker, change: priceChange, data: marketData };
        }

        // Log the check
        log.push({
          time: new Date().toISOString(),
          ticker,
          price: marketData.currentPrice,
          basePrice: item.basePrice || null,
          change: priceChange,
          met: false, // Will update if confirmed
        });

        // Check Criteria
        if (criteria.metric === "PRICE") {
          if (
            criteria.direction === "DOWN" &&
            priceChange <= -criteria.thresholdPercent
          ) {
            confirmed = true;
          } else if (
            criteria.direction === "UP" &&
            priceChange >= criteria.thresholdPercent
          ) {
            confirmed = true;
          }
        } else if (criteria.metric === "VOLUME") {
          // Use volume ratio from market validator
          if (
            criteria.direction === "UP" &&
            marketData.volumeRatio >= criteria.thresholdPercent / 100
          ) {
            confirmed = true;
          }
        }

        if (confirmed) {
          confirmingTicker = ticker;
          marketDataSnapshot = {
            ticker: marketData.ticker,
            currentPrice: marketData.currentPrice,
            priceChangePercent: marketData.priceChangePercent,
            averageVolume: marketData.averageVolume,
            currentVolume: marketData.currentVolume,
            volumeRatio: marketData.volumeRatio,
            volumeSpike: marketData.volumeSpike,
            isTrending: marketData.isTrending,
            priceConfirmsSentiment: marketData.priceConfirmsSentiment,
          };
          // Update log entry to mark as met
          log[log.length - 1].met = true;
          break;
        }
      }

      // REEVALUATION: Log current potential status
      if (!confirmed && bestPerformance.ticker) {
        const progressPercent =
          criteria.direction === "UP"
            ? (bestPerformance.change / criteria.thresholdPercent) * 100
            : (-bestPerformance.change / criteria.thresholdPercent) * 100;

        console.log(
          `   🔄 [${item.id.slice(0, 6)}] Monitoring: ${
            bestPerformance.ticker
          } ${criteria.direction} ` +
            `${bestPerformance.change.toFixed(2)}% (${progressPercent.toFixed(
              0
            )}% to target ${criteria.direction === "UP" ? "+" : "-"}${
              criteria.thresholdPercent
            }%)`
        );
      }

      // Update DB
      if (confirmed) {
        console.log(
          `   ✅ CONFIRMED: ${item.predictedImpact} on ${confirmingTicker}`
        );

        await db
          .update(potentialCatalysts)
          .set({
            status: "confirmed",
            validationLog: JSON.stringify(log),
          })
          .where(eq(potentialCatalysts.id, item.id));

        // Create formal Signal
        // Find the asset or create a temporary one for the confirming ticker
        let relatedAsset = allAssets.find((a) => a.ticker === confirmingTicker);

        if (!relatedAsset) {
          // Extract company name from ticker (remove .NS/.BO suffix)
          const tickerBase = confirmingTicker.replace(/\.(NS|BO)$/, "");

          relatedAsset = {
            id: `temp-${confirmingTicker}`,
            keyword: tickerBase,
            ticker: confirmingTicker,
            assetType: "EQUITY",
            enabled: true,
          };
        }

        const signal: CatalystSignal = {
          asset: relatedAsset,
          action: criteria.direction === "UP" ? "BUY_WATCH" : "SELL_WATCH",
          // We don't have the original 'news' item object easily reconstructible here without fetching.
          // For now, we stub it or fetch relation.
          news: {
            title: "AI Discovery: " + item.predictedImpact,
            link: "",
            source: "AI",
            pubDate: new Date().toISOString(),
          },
          analysis: {
            isCatalyst: true,
            sentiment: criteria.direction === "UP" ? "BULLISH" : "BEARISH",
            impactType: "REGULATORY", // Simplified default
            confidence: 8,
            reasoning: `AI Validation Confirmed: ${criteria.metric} moved ${criteria.direction} on ${confirmingTicker}`,
          },
          technical: marketDataSnapshot,
          status: "active",
          createdAt: new Date().toISOString(),
        };

        // Use default config but ensure we save to DB (not paper mode if intended for production)
        const config = { ...DEFAULT_CATALYST_CONFIG, paperMode: false };
        await dispatchSignal(signal, config);

        // === SIGNAL → SUGGESTION CONVERSION ===
        // Create a portfolio-aware suggestion using AI analysis
        try {
          // Fetch catalyst portfolio context
          const [settingsRow] = await db.select().from(settings).limit(1);
          const catalystFunds = settingsRow?.catalystFunds || 0;

          // Get current catalyst holdings
          const holdingsRaw = await getCatalystHoldings();
          const catalystHoldings = holdingsRaw.map((h) => ({
            symbol: h.symbol,
            stock_name: h.stockName,
            quantity: h.quantity,
            avg_buy_price: h.avgBuyPrice,
            current_price: 0, // Will be filled by market data if needed
            returns_percent: 0,
          }));

          // Get recent intraday trades
          const recentTrades = await getRecentIntradayTrades(7);

          console.log(
            `   🤖 Analyzing signal for suggestion (Cash: ₹${catalystFunds.toLocaleString(
              "en-IN"
            )})...`
          );

          const suggestion = await CatalystGeminiService.analyzeSignal(
            {
              ticker: confirmingTicker,
              newsTitle: item.predictedImpact || signal.news.title,
              sentiment: signal.analysis.sentiment,
              impactType: signal.analysis.impactType,
              confidence: signal.analysis.confidence,
            },
            {
              availableFunds: catalystFunds,
              currentHoldings: catalystHoldings,
              recentTrades: recentTrades,
            }
          );

          if (suggestion) {
            await db.insert(suggestions).values({
              symbol: suggestion.symbol,
              stockName: relatedAsset?.keyword || confirmingTicker,
              action: suggestion.action as
                | "BUY"
                | "SELL"
                | "HOLD"
                | "WATCH"
                | "RAISE_CASH",
              rationale: suggestion.rationale,
              currentPrice: marketDataSnapshot?.currentPrice || 0,
              targetPrice: suggestion.target_price || null,
              confidence: suggestion.confidence,
              quantity: suggestion.quantity || null,
              allocationAmount: suggestion.allocation_amount || null,
              portfolioType: "CATALYST",
              status: "pending",
            });

            console.log(
              `   📝 Created CATALYST suggestion: ${suggestion.action} ${suggestion.symbol}`
            );
          } else {
            console.log(
              `   ⏸️  No suggestion created (AI returned PASS: ${
                catalystFunds === 0 ? "no cash" : "see reasoning"
              })`
            );
          }
        } catch (suggError) {
          console.error(`   ⚠️  Failed to create suggestion:`, suggError);
          // Signal is still created, just no suggestion
        }
      } else {
        // Just update log
        await db
          .update(potentialCatalysts)
          .set({ validationLog: JSON.stringify(log) })
          .where(eq(potentialCatalysts.id, item.id));
      }
    } catch (error) {
      console.error(`   Error processing monitor item ${item.id}:`, error);
    }
  }
}
