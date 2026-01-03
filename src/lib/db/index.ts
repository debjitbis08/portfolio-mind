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
// Database Initialization
// ============================================================================

/**
 * Initialize database tables.
 * Call this on app startup.
 */
export function initializeDatabase(): void {
  // Create tables if they don't exist
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      isin TEXT NOT NULL,
      symbol TEXT NOT NULL,
      stock_name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('BUY', 'SELL', 'OPENING_BALANCE')),
      quantity INTEGER NOT NULL,
      value REAL NOT NULL,
      exchange TEXT,
      exchange_order_id TEXT,
      executed_at TEXT NOT NULL,
      status TEXT DEFAULT 'Executed',
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS price_cache (
      symbol TEXT PRIMARY KEY,
      price REAL NOT NULL,
      change_percent REAL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS technical_data (
      symbol TEXT PRIMARY KEY,
      current_price REAL,
      rsi_14 REAL,
      sma_50 REAL,
      sma_200 REAL,
      price_vs_sma50 REAL,
      price_vs_sma200 REAL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS cycle_runs (
      id TEXT PRIMARY KEY,
      started_at TEXT,
      completed_at TEXT,
      symbols_analyzed INTEGER DEFAULT 0,
      suggestions_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS suggestions (
      id TEXT PRIMARY KEY,
      cycle_id TEXT REFERENCES cycle_runs(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL,
      stock_name TEXT,
      action TEXT NOT NULL CHECK (action IN ('BUY', 'SELL', 'HOLD', 'WATCH')),
      rationale TEXT NOT NULL,
      technical_score REAL,
      current_price REAL,
      target_price REAL,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
      created_at TEXT,
      expires_at TEXT,
      reviewed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      available_funds REAL DEFAULT 0,
      risk_profile TEXT DEFAULT 'balanced' CHECK (risk_profile IN ('conservative', 'balanced', 'aggressive')),
      notification_email TEXT,
      screener_urls TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS tool_cache (
      id TEXT PRIMARY KEY,
      cache_key TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL,
      query_args TEXT NOT NULL,
      response TEXT NOT NULL,
      created_at TEXT,
      expires_at TEXT NOT NULL,
      hit_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
      progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
      progress_message TEXT,
      result TEXT,
      error_message TEXT,
      created_at TEXT,
      started_at TEXT,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS stock_intel (
      symbol TEXT PRIMARY KEY,
      fundamentals TEXT,
      news_sentiment TEXT,
      social_sentiment TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS watchlist (
      symbol TEXT PRIMARY KEY,
      added_at TEXT,
      source TEXT DEFAULT 'manual',
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      created_at TEXT,
      expires_at TEXT NOT NULL
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_transactions_isin ON transactions(isin);
    CREATE INDEX IF NOT EXISTS idx_transactions_executed_at ON transactions(executed_at);
    CREATE INDEX IF NOT EXISTS idx_suggestions_pending ON suggestions(status);
    CREATE INDEX IF NOT EXISTS idx_tool_cache_key ON tool_cache(cache_key);
    CREATE INDEX IF NOT EXISTS idx_tool_cache_expires ON tool_cache(expires_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_pending ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);

    -- Ensure settings has at least one row
    INSERT OR IGNORE INTO settings (id) VALUES (1);
  `);
}

// Initialize on module load
initializeDatabase();

export { schema };
