/**
 * Intel Service
 *
 * Fetches and stores fundamental data and research intel for stocks.
 */

import YahooFinance from "yahoo-finance2";
import { db, schema } from "./db";
import { eq } from "drizzle-orm";

// Initialize Yahoo Finance client
const yahooFinance = new YahooFinance();

export interface StockFundamentals {
  peRatio?: number;
  marketCap?: number;
  roe?: number;
  pbRatio?: number;
  eps?: number;
  sector?: string;
  industry?: string;
}

export class IntelService {
  /**
   * Fetch and store fundamentals for a list of symbols
   */
  static async updateFundamentals(symbols: string[]) {
    console.log(`Updating fundamentals for ${symbols.length} symbols...`);
    const updates = [];

    for (const symbol of symbols) {
      try {
        // Try NSE first, then BSE
        let yahooSymbol = `${symbol}.NS`;
        let quote: any = null;

        try {
          quote = await yahooFinance.quoteSummary(yahooSymbol, {
            modules: [
              "summaryDetail",
              "defaultKeyStatistics",
              "financialData",
              "assetProfile",
              "price",
            ],
          });
        } catch {
          // Try BSE
          yahooSymbol = `${symbol}.BO`;
          quote = await yahooFinance.quoteSummary(yahooSymbol, {
            modules: [
              "summaryDetail",
              "defaultKeyStatistics",
              "financialData",
              "assetProfile",
              "price",
            ],
          });
        }

        const fundamentals: StockFundamentals = {
          peRatio: quote.summaryDetail?.trailingPE,
          marketCap: quote.summaryDetail?.marketCap,
          roe: quote.financialData?.returnOnEquity,
          pbRatio: quote.defaultKeyStatistics?.priceToBook,
          eps: quote.defaultKeyStatistics?.trailingEps,
          sector: quote.assetProfile?.sector,
          industry: quote.assetProfile?.industry,
        };

        // Qualitative Intel (ValuePickr Query by Name)
        let socialSentiment = null;
        try {
          // Check for existing fresh qualitative intel first
          const existing = await db
            .select()
            .from(schema.stockIntel)
            .where(eq(schema.stockIntel.symbol, symbol))
            .limit(1);

          const now = new Date();
          const threeDaysAgo = new Date(
            now.getTime() - 3 * 24 * 60 * 60 * 1000
          );

          if (
            existing.length > 0 &&
            existing[0].socialSentiment &&
            existing[0].updatedAt &&
            new Date(existing[0].updatedAt) > threeDaysAgo
          ) {
            console.log(`[Intel] Using cached ValuePickr data for ${symbol}`);
            socialSentiment = JSON.parse(existing[0].socialSentiment);
          } else {
            // Fetch fresh if missing or stale
            const rawName =
              quote.price?.longName || quote.price?.shortName || symbol;
            const cleanName = rawName
              .replace(/ limited| ltd\.?| inc\.?| corp\.?| corporation/gi, "")
              .trim();

            const { ValuePickrService } = await import("./scrapers/valuepickr");
            socialSentiment = await ValuePickrService.getResearch(cleanName);
          }
        } catch (err) {
          console.warn(`ValuePickr skip for ${symbol}:`, err);
        }

        // Upsert to DB
        await db
          .insert(schema.stockIntel)
          .values({
            symbol,
            fundamentals: JSON.stringify(fundamentals),
            socialSentiment: socialSentiment
              ? JSON.stringify(socialSentiment)
              : null,
            updatedAt: new Date().toISOString(),
          })
          .onConflictDoUpdate({
            target: schema.stockIntel.symbol,
            set: {
              fundamentals: JSON.stringify(fundamentals),
              socialSentiment: socialSentiment
                ? JSON.stringify(socialSentiment)
                : null,
              updatedAt: new Date().toISOString(),
            },
          });

        updates.push(symbol);

        // Rate limiting
        await new Promise((r) => setTimeout(r, 1000));
      } catch (err) {
        console.error(
          `Error fetching for ${symbol}:`,
          err instanceof Error ? err.message : err
        );
      }
    }

    return updates;
  }
}
