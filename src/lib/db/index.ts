/**
 * Database Client for Portfolio Mind
 *
 * SQLite connection and helpers.
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sql, eq, and, gt, lt, sum, max, desc } from "drizzle-orm";
import * as schema from "./schema";

// ============================================================================
// Database Connection
// ============================================================================

const DB_PATH = process.env.DATABASE_PATH || "./data/investor.db";

// Ensure data directory exists
import { mkdirSync } from "fs";
import { dirname } from "path";
try {
  mkdirSync(dirname(DB_PATH), { recursive: true });
} catch {
  // Directory already exists
}

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL"); // Better concurrent access

export const db = drizzle(sqlite, { schema });

// ============================================================================
// Holdings "View" - Computed from transactions
// ============================================================================

export interface Holding {
  isin: string;
  symbol: string;
  stockName: string;
  quantity: number;
  investedValue: number;
  avgBuyPrice: number;
}

/**
 * Get current holdings computed from transactions.
 * Replaces the PostgreSQL "holdings" view.
 */
export async function getHoldings(): Promise<Holding[]> {
  const result = await db
    .select({
      isin: schema.transactions.isin,
      symbol: schema.transactions.symbol,
      stockName: max(schema.transactions.stockName),
      buyQty: sum(
        sql`CASE WHEN ${schema.transactions.type} IN ('BUY', 'OPENING_BALANCE') THEN ${schema.transactions.quantity} ELSE 0 END`
      ),
      sellQty: sum(
        sql`CASE WHEN ${schema.transactions.type} = 'SELL' THEN ${schema.transactions.quantity} ELSE 0 END`
      ),
      buyValue: sum(
        sql`CASE WHEN ${schema.transactions.type} IN ('BUY', 'OPENING_BALANCE') THEN ${schema.transactions.value} ELSE 0 END`
      ),
      sellValue: sum(
        sql`CASE WHEN ${schema.transactions.type} = 'SELL' THEN ${schema.transactions.value} ELSE 0 END`
      ),
    })
    .from(schema.transactions)
    .where(eq(schema.transactions.status, "Executed"))
    .groupBy(schema.transactions.isin, schema.transactions.symbol);

  return result
    .map((row) => {
      const quantity = Number(row.buyQty || 0) - Number(row.sellQty || 0);
      const investedValue =
        Number(row.buyValue || 0) - Number(row.sellValue || 0);
      return {
        isin: row.isin,
        symbol: row.symbol,
        stockName: row.stockName || row.symbol,
        quantity,
        investedValue,
        avgBuyPrice: quantity > 0 ? investedValue / quantity : 0,
      };
    })
    .filter((h) => h.quantity > 0);
}

// ============================================================================
// Helper Functions (replacing PostgreSQL functions)
// ============================================================================

/**
 * Check if a cached price is stale.
 * Replaces is_price_stale() PostgreSQL function.
 */
export function isPriceStale(updatedAt: string | null): boolean {
  if (!updatedAt) return true;

  const cacheTime = new Date(updatedAt);
  const now = new Date();
  const cacheAgeMinutes = (now.getTime() - cacheTime.getTime()) / 60000;

  // Check if market hours (IST: 9:15 AM to 3:30 PM, Mon-Fri)
  const istOffset = 5.5 * 60 * 60 * 1000;
  const nowIST = new Date(now.getTime() + istOffset);
  const dayOfWeek = nowIST.getUTCDay();
  const minuteOfDay = nowIST.getUTCHours() * 60 + nowIST.getUTCMinutes();

  const isMarketHours =
    dayOfWeek >= 1 &&
    dayOfWeek <= 5 &&
    minuteOfDay >= 555 && // 9:15
    minuteOfDay <= 930; // 15:30

  if (isMarketHours) {
    return cacheAgeMinutes > 5; // 5 min cache during market hours
  } else {
    return cacheAgeMinutes > 30; // 30 min cache outside market hours
  }
}

/**
 * Check if a stock is in the "wait zone" (overextended).
 * Replaces is_wait_zone() PostgreSQL function.
 */
export function isWaitZone(tech: {
  rsi14: number | null;
  priceVsSma50: number | null;
  priceVsSma200: number | null;
  currentPrice: number | null;
  sma200: number | null;
}): boolean {
  if (!tech.rsi14 && !tech.priceVsSma50 && !tech.priceVsSma200) {
    return false;
  }

  return (
    (tech.rsi14 !== null && tech.rsi14 > 70) || // Overbought
    (tech.priceVsSma50 !== null && tech.priceVsSma50 > 20) || // Extended
    (tech.priceVsSma200 !== null && tech.priceVsSma200 > 40) || // Very extended
    (tech.currentPrice !== null &&
      tech.sma200 !== null &&
      tech.currentPrice < tech.sma200) // Downtrend
  );
}

// ============================================================================

/**
 * Seed reference data into the database.
 * Call this on app startup AFTER migrations have run.
 *
 * NOTE: Schema creation is handled by Drizzle migrations in /drizzle folder.
 * This function only seeds static reference data.
 */
export function seedReferenceData(): void {
  // Ensure settings has at least one row
  sqlite.exec(`INSERT OR IGNORE INTO settings (id) VALUES (1);`);

  // Seed common ETF-to-commodity mappings (Gold & Silver ETFs in India)
  sqlite.exec(`
    INSERT OR IGNORE INTO etf_commodity_mappings (symbol, commodity_type, notes) VALUES
      ('GOLDBEES', 'GOLD', 'Nippon India ETF Gold BeES'),
      ('GOLDSHARE', 'GOLD', 'UTI Gold ETF'),
      ('GOLDCASE', 'GOLD', 'ICICI Prudential Gold ETF'),
      ('AXISGOLD', 'GOLD', 'Axis Gold ETF'),
      ('HDFCGOLD', 'GOLD', 'HDFC Gold ETF'),
      ('KOTAKGOLD', 'GOLD', 'Kotak Gold ETF'),
      ('SILVERBEES', 'SILVER', 'Nippon India ETF Silver BeES'),
      ('ICICIBSILV', 'SILVER', 'ICICI Prudential Silver ETF'),
      ('HDFCSILVER', 'SILVER', 'HDFC Silver ETF');
  `);
}

// Seed reference data on module load
seedReferenceData();

export { schema };
