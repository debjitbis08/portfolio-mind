import yahooFinance from "yahoo-finance2";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_SERVICE_ROLE_KEY } from "astro:env/server";
import { PUBLIC_SUPABASE_URL } from "astro:env/client";

// Initialize admin client for background jobs
const supabaseAdmin = createClient(
  PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

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
        // Yahoo Finance for Indian stocks often needs the suffix (which we have)
        // But the ID might need to be pure for some queries.
        // We assume symbols passed are like 'RELIANCE.NS'

        const quote = (await yahooFinance.quoteSummary(symbol, {
          modules: [
            "summaryDetail",
            "defaultKeyStatistics",
            "defaultKeyStatistics",
            "financialData",
            "assetProfile",
            "price",
          ],
        })) as any;

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
          // Extract and clean name: "Tata Consultancy Services Limited" -> "Tata Consultancy Services"
          const rawName =
            quote.price?.longName || quote.price?.shortName || symbol;
          const cleanName = rawName
            .replace(/ limited| ltd\.?| inc\.?| corp\.?| corporation/gi, "")
            .trim();

          const { ValuePickrService } = await import("./scrapers/valuepickr");
          socialSentiment = await ValuePickrService.getResearch(cleanName);
        } catch (err) {
          console.warn(`ValuePickr skip for ${symbol}:`, err);
        }

        // Upsert to DB
        const payload: any = {
          symbol,
          fundamentals,
          updated_at: new Date().toISOString(),
        };

        if (socialSentiment) {
          payload.social_sentiment = socialSentiment;
        }

        const { error } = await supabaseAdmin
          .from("stock_intel")
          .upsert(payload);

        if (error) {
          console.error(`Failed to update ${symbol}:`, error);
        } else {
          updates.push(symbol);
        }

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
