import { potentialCatalysts, catalystSignals } from "../db/schema";
import { db } from "../db";
import { eq, or, and, isNotNull } from "drizzle-orm";
import yahooFinance from "yahoo-finance2";
import { dispatchSignal } from "./signal-dispatcher";
import {
  type CatalystAsset,
  type CatalystSignal,
  DEFAULT_CATALYST_CONFIG,
} from "./types";
import { getEnabledAssets } from "./news-monitor";

interface WatchCriteria {
  metric: "PRICE" | "VOLUME";
  direction: "UP" | "DOWN";
  thresholdPercent: number;
  timeoutHours: number;
}

/**
 * Main loop for the tracker.
 * 1. Checks 'monitoring' potential catalysts.
 * 2. Checks active signals for outcomes.
 */
export async function runCatalystTracker() {
  console.log("\n🕵️  Running Catalyst Tracker...");

  await checkPotentialCatalysts();
  // await checkActiveOutcomes(); // TODO: Implement outcome tracking later
}

async function checkPotentialCatalysts() {
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
      const symbols = JSON.parse(item.affectedSymbols) as string[]; // ["RELIANCE.NS", ...]
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

      // Check market for EACH symbol
      let confirmed = false;
      let confirmingTicker = "";
      let marketDataSnapshot: any = null;

      for (const ticker of symbols) {
        try {
          const quote = (await yahooFinance.quote(ticker)) as any;
          const currentPrice = quote.regularMarketPrice;
          const openPrice = quote.regularMarketOpen || quote.previousClose;

          if (!currentPrice || !openPrice) continue;

          const priceChange = ((currentPrice - openPrice) / openPrice) * 100;
          const volume = quote.regularMarketVolume || 0;
          // Simplified volume check (no average available in simple quote usually, need validation ticker logic if strictly robust)

          // Check Criteria
          // Example: Price DROP > 2%
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
          }

          // Log the check
          log.push({
            time: new Date().toISOString(),
            ticker,
            price: currentPrice,
            change: priceChange,
            met: confirmed,
          });

          if (confirmed) {
            confirmingTicker = ticker;
            marketDataSnapshot = {
              ticker,
              currentPrice,
              priceChangePercent: priceChange,
              volume,
            };
            break;
          }
        } catch (err) {
          console.error(`   Error checking ${ticker}:`, err);
        }
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
        const relatedAsset =
          allAssets.find((a) => a.ticker === confirmingTicker) ||
          (allAssets[0] as CatalystAsset); // Fallback

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
          technical: {
            ...marketDataSnapshot,
            averageVolume: 0,
            volumeRatio: 0,
            volumeSpike: false,
            isTrending: true,
            priceConfirmsSentiment: true,
          },
          status: "active",
          createdAt: new Date().toISOString(),
        };

        // Use default config but ensure we save to DB (not paper mode if intended for production)
        const config = { ...DEFAULT_CATALYST_CONFIG, paperMode: false };
        await dispatchSignal(signal, config);
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
