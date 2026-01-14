/**
 * Database Client for Portfolio Mind
 *
 * SQLite connection and helpers.
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { sql, eq, and, gt, lt, sum, max, desc, inArray, or } from "drizzle-orm";
import * as schema from "./schema";

// ============================================================================
// Database Connection
// ============================================================================

const DB_PATH = process.env.DATABASE_PATH || "./data/investor.db";

// Ensure data directory exists
import { mkdirSync, existsSync } from "fs";
import { dirname, resolve } from "path";
try {
  mkdirSync(dirname(DB_PATH), { recursive: true });
} catch {
  // Directory already exists
}

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL"); // Better concurrent access

export const db = drizzle(sqlite, { schema });

// ============================================================================
// Automatic Migrations
// ============================================================================

/**
 * Run pending database migrations automatically on startup.
 * This ensures the database schema is always up-to-date when the app starts,
 * which is essential for desktop app distribution where users can't run CLI commands.
 *
 * All migration SQL files use IF NOT EXISTS syntax, making them idempotent
 * and safe to run on both fresh and existing databases.
 */
function runMigrations(): void {
  // Find the migrations folder - check multiple possible locations
  const possiblePaths = [
    resolve(process.cwd(), "drizzle"),
    resolve(dirname(DB_PATH), "../drizzle"),
    resolve(import.meta.dirname || "", "../../../../drizzle"),
  ];

  let migrationsFolder: string | null = null;
  for (const p of possiblePaths) {
    if (existsSync(p)) {
      migrationsFolder = p;
      break;
    }
  }

  if (!migrationsFolder) {
    console.warn(
      "[DB] Migrations folder not found, skipping automatic migrations"
    );
    return;
  }

  try {
    console.log(`[DB] Running migrations from: ${migrationsFolder}`);
    migrate(db, { migrationsFolder });
    console.log("[DB] Migrations completed successfully");
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }

    // Handle migration file mismatch (legacy DB has different migration history)
    const isMigrationMismatch =
      error.message.includes("No file") && error.message.includes("found in");

    // Handle duplicate column error (column already exists)
    const isDuplicateColumn = error.message.includes("duplicate column name");

    if (isMigrationMismatch) {
      console.warn(
        "[DB] Migration history mismatch - resetting and re-running migrations"
      );
      // Clear old migration history and retry
      // Migrations are idempotent (IF NOT EXISTS) so this is safe
      sqlite.exec("DROP TABLE IF EXISTS __drizzle_migrations");
      try {
        migrate(db, { migrationsFolder });
        console.log("[DB] Migrations completed successfully after reset");
      } catch (retryError) {
        console.error("[DB] Migration retry failed:", retryError);
        throw retryError;
      }
    } else if (isDuplicateColumn) {
      console.log("[DB] Column already exists, continuing...");
    } else if (error.message.includes("already been applied")) {
      console.log("[DB] All migrations already applied");
    } else {
      console.error("[DB] Migration failed:", error);
      throw error;
    }
  }

  // Populate FTS indexes for existing data (if FTS tables exist)
  populateFTSIndexes();
}

/**
 * Populate FTS indexes with existing data.
 * Called after schema fixes to ensure FTS is up-to-date for legacy databases.
 * Safe to run multiple times - clears and rebuilds FTS indexes.
 */
function populateFTSIndexes(): void {
  try {
    // Check if FTS tables exist
    const ftsExists = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='research_fts'"
      )
      .get();

    if (!ftsExists) {
      // FTS tables don't exist yet - migration hasn't run
      return;
    }

    console.log("[DB] Populating FTS indexes...");

    // Clear and repopulate research FTS
    sqlite.exec("DELETE FROM research_fts");
    sqlite.exec(`
      INSERT INTO research_fts(id, symbol, title, content)
      SELECT id, symbol, title, content FROM company_research
    `);

    // Clear and repopulate notes FTS
    sqlite.exec("DELETE FROM notes_fts");
    sqlite.exec(`
      INSERT INTO notes_fts(id, symbol, content)
      SELECT id, symbol, content FROM company_notes
    `);

    // Clear and repopulate links FTS
    sqlite.exec("DELETE FROM links_fts");
    sqlite.exec(`
      INSERT INTO links_fts(id, symbol, title, fetched_content)
      SELECT id, symbol, title, COALESCE(fetched_content, '') FROM company_links
    `);

    console.log("[DB] FTS indexes populated successfully");
  } catch (error) {
    // FTS tables might not exist yet, that's fine
    if (error instanceof Error && !error.message.includes("no such table")) {
      console.warn("[DB] Could not populate FTS indexes:", error);
    }
  }
}

// Run migrations on module load (before seeding)
runMigrations();

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
 * Portfolio type for dual-portfolio architecture.
 */
export type PortfolioType = "LONGTERM" | "CATALYST";

/**
 * Get current holdings computed from transactions.
 * Replaces the PostgreSQL "holdings" view.
 * Also merges intraday transactions (temporary manual trades) at read-time.
 *
 * @param portfolioType - Filter by portfolio type (default: LONGTERM)
 */
export async function getHoldings(
  portfolioType: PortfolioType = "LONGTERM"
): Promise<Holding[]> {
  // Get regular transactions filtered by portfolio type
  const result = await db
    .select({
      isin: max(schema.transactions.isin),
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
      buyCharges: sum(
        sql`CASE WHEN ${schema.transactions.type} IN ('BUY', 'OPENING_BALANCE') THEN ${schema.transactions.totalCharges} ELSE 0 END`
      ),
      sellCharges: sum(
        sql`CASE WHEN ${schema.transactions.type} = 'SELL' THEN ${schema.transactions.totalCharges} ELSE 0 END`
      ),
    })
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.status, "Executed"),
        eq(schema.transactions.portfolioType, portfolioType)
      )
    )
    .groupBy(schema.transactions.symbol);

  const holdings: Holding[] = result.map((row) => {
    const quantity = Number(row.buyQty || 0) - Number(row.sellQty || 0);
    const investedValue =
      Number(row.buyValue || 0) +
      Number(row.buyCharges || 0) -
      (Number(row.sellValue || 0) - Number(row.sellCharges || 0));
    const resolvedIsin = row.isin || row.symbol;
    return {
      isin: resolvedIsin,
      symbol: row.symbol,
      stockName: row.stockName || row.symbol,
      quantity,
      investedValue,
      avgBuyPrice: quantity > 0 ? investedValue / quantity : 0,
    };
  });

  const normalizeSymbol = (symbol: string) =>
    symbol.replace(/\.NS$|\.BO$/i, "").trim();
  const holdingsBySymbol = new Map<string, Holding>();
  for (const holding of holdings) {
    holdingsBySymbol.set(normalizeSymbol(holding.symbol), holding);
  }

  // Merge intraday transactions (temporary manual trades) filtered by portfolio type
  const intradayTxs = await db
    .select()
    .from(schema.intradayTransactions)
    .where(eq(schema.intradayTransactions.portfolioType, portfolioType));
  const intradayBySymbol = new Map<
    string,
    {
      symbol: string;
      stockName: string;
      quantity: number;
      investedValue: number;
      lastPrice: number;
    }
  >();

  for (const tx of intradayTxs) {
    const normalizedSymbol = normalizeSymbol(tx.symbol);
    const value = tx.quantity * tx.pricePerShare;
    const netValue =
      tx.type === "BUY"
        ? value + (tx.totalCharges || 0)
        : value - (tx.totalCharges || 0);
    const qtyDelta = tx.type === "BUY" ? tx.quantity : -tx.quantity;
    const valDelta = tx.type === "BUY" ? netValue : -netValue;
    const existing = intradayBySymbol.get(normalizedSymbol) || {
      symbol: tx.symbol,
      stockName: tx.stockName || tx.symbol,
      quantity: 0,
      investedValue: 0,
      lastPrice: tx.pricePerShare,
    };

    if (!existing.stockName && tx.stockName) existing.stockName = tx.stockName;
    existing.quantity += qtyDelta;
    existing.investedValue += valDelta;
    existing.lastPrice = tx.pricePerShare;
    intradayBySymbol.set(normalizedSymbol, existing);
  }

  for (const intraday of intradayBySymbol.values()) {
    const existing = holdingsBySymbol.get(normalizeSymbol(intraday.symbol));
    if (existing) {
      existing.quantity += intraday.quantity;
      existing.investedValue += intraday.investedValue;
      existing.avgBuyPrice =
        existing.quantity > 0 ? existing.investedValue / existing.quantity : 0;
    } else if (intraday.quantity > 0) {
      holdings.push({
        isin: "", // Intraday transactions don't have ISIN
        symbol: intraday.symbol,
        stockName: intraday.stockName || intraday.symbol,
        quantity: intraday.quantity,
        investedValue: intraday.investedValue,
        avgBuyPrice:
          intraday.quantity > 0
            ? intraday.investedValue / intraday.quantity
            : intraday.lastPrice,
      });
    }
  }

  return holdings.filter((h) => h.quantity > 0);
}

/**
 * Get holdings for the catalyst/short-term trading portfolio.
 * Convenience wrapper for getHoldings("CATALYST").
 */
export async function getCatalystHoldings(): Promise<Holding[]> {
  const linkedIds = await db
    .select({ transactionId: schema.suggestionTransactions.transactionId })
    .from(schema.suggestionTransactions)
    .innerJoin(
      schema.suggestions,
      eq(schema.suggestionTransactions.suggestionId, schema.suggestions.id)
    )
    .where(eq(schema.suggestions.portfolioType, "CATALYST"));

  const linkedTransactionIds = linkedIds.map((row) => row.transactionId);

  const catalystTransactions = await db
    .select({
      isin: schema.transactions.isin,
      symbol: schema.transactions.symbol,
      stockName: schema.transactions.stockName,
      type: schema.transactions.type,
      quantity: schema.transactions.quantity,
      value: schema.transactions.value,
      totalCharges: schema.transactions.totalCharges,
    })
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.status, "Executed"),
        linkedTransactionIds.length > 0
          ? or(
              eq(schema.transactions.portfolioType, "CATALYST"),
              inArray(schema.transactions.id, linkedTransactionIds)
            )
          : eq(schema.transactions.portfolioType, "CATALYST")
      )
    );

  const holdingsBySymbol = new Map<
    string,
    { isin: string; symbol: string; stockName: string; quantity: number; investedValue: number }
  >();

  for (const tx of catalystTransactions) {
    const existing = holdingsBySymbol.get(tx.symbol) || {
      isin: tx.isin,
      symbol: tx.symbol,
      stockName: tx.stockName,
      quantity: 0,
      investedValue: 0,
    };

    if (!existing.isin) existing.isin = tx.isin;
    if (!existing.stockName) existing.stockName = tx.stockName;

    if (tx.type === "BUY" || tx.type === "OPENING_BALANCE") {
      existing.quantity += tx.quantity;
      existing.investedValue += tx.value + (tx.totalCharges || 0);
    } else if (tx.type === "SELL") {
      existing.quantity -= tx.quantity;
      existing.investedValue -= tx.value - (tx.totalCharges || 0);
    }

    holdingsBySymbol.set(tx.symbol, existing);
  }

  const holdings: Holding[] = Array.from(holdingsBySymbol.values()).map(
    (row) => ({
      isin: row.isin || row.symbol,
      symbol: row.symbol,
      stockName: row.stockName || row.symbol,
      quantity: row.quantity,
      investedValue: row.investedValue,
      avgBuyPrice: row.quantity > 0 ? row.investedValue / row.quantity : 0,
    })
  );

  const normalizeSymbol = (symbol: string) =>
    symbol.replace(/\.NS$|\.BO$/i, "").trim();
  const holdingsByNormalizedSymbol = new Map<string, Holding>();
  for (const holding of holdings) {
    holdingsByNormalizedSymbol.set(normalizeSymbol(holding.symbol), holding);
  }

  // Merge intraday transactions (temporary manual trades) filtered by portfolio type
  const intradayTxs = await db
    .select()
    .from(schema.intradayTransactions)
    .where(eq(schema.intradayTransactions.portfolioType, "CATALYST"));
  const intradayBySymbol = new Map<
    string,
    {
      symbol: string;
      stockName: string;
      quantity: number;
      investedValue: number;
      lastPrice: number;
    }
  >();

  for (const tx of intradayTxs) {
    const normalizedSymbol = normalizeSymbol(tx.symbol);
    const value = tx.quantity * tx.pricePerShare;
    const netValue =
      tx.type === "BUY"
        ? value + (tx.totalCharges || 0)
        : value - (tx.totalCharges || 0);
    const qtyDelta = tx.type === "BUY" ? tx.quantity : -tx.quantity;
    const valDelta = tx.type === "BUY" ? netValue : -netValue;
    const existing = intradayBySymbol.get(normalizedSymbol) || {
      symbol: tx.symbol,
      stockName: tx.stockName || tx.symbol,
      quantity: 0,
      investedValue: 0,
      lastPrice: tx.pricePerShare,
    };

    if (!existing.stockName && tx.stockName) existing.stockName = tx.stockName;
    existing.quantity += qtyDelta;
    existing.investedValue += valDelta;
    existing.lastPrice = tx.pricePerShare;
    intradayBySymbol.set(normalizedSymbol, existing);
  }

  for (const intraday of intradayBySymbol.values()) {
    const existing = holdingsByNormalizedSymbol.get(
      normalizeSymbol(intraday.symbol)
    );
    if (existing) {
      existing.quantity += intraday.quantity;
      existing.investedValue += intraday.investedValue;
      existing.avgBuyPrice =
        existing.quantity > 0 ? existing.investedValue / existing.quantity : 0;
    } else if (intraday.quantity > 0) {
      holdings.push({
        isin: "",
        symbol: intraday.symbol,
        stockName: intraday.stockName || intraday.symbol,
        quantity: intraday.quantity,
        investedValue: intraday.investedValue,
        avgBuyPrice:
          intraday.quantity > 0
            ? intraday.investedValue / intraday.quantity
            : intraday.lastPrice,
      });
    }
  }

  return holdings.filter((h) => h.quantity > 0);
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

  // Weekend (Saturday = 6, Sunday = 0)
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  const isMarketHours =
    dayOfWeek >= 1 &&
    dayOfWeek <= 5 &&
    minuteOfDay >= 555 && // 9:15
    minuteOfDay <= 930; // 15:30

  if (isMarketHours) {
    // During market hours: 5 min cache
    return cacheAgeMinutes > 5;
  } else if (isWeekend) {
    // Weekends: 24 hour cache (markets closed, no point refreshing)
    return cacheAgeMinutes > 1440; // 24 hours
  } else {
    // Weekday after-hours: 2 hour cache
    return cacheAgeMinutes > 120;
  }
}

/**
 * Check if a stock is in the "wait zone" (overextended).
 * Replaces is_wait_zone() PostgreSQL function.
 * @deprecated Use getZoneStatus() from zone-status.ts for richer context
 */
export function isWaitZone(tech: {
  rsi14: number | null;
  priceVsSma50: number | null;
  priceVsSma200: number | null;
  currentPrice: number | null;
  sma200: number | null;
}): boolean {
  // Import and use the new zone status logic
  const { getZoneStatus, ZoneStatus } = require("../zone-status");
  return getZoneStatus(tech) !== ZoneStatus.BUY_ZONE;
}

// Re-export zone status utilities for convenience
export {
  getZoneStatus,
  getZoneReasons,
  ZoneStatus,
  PortfolioRole,
} from "../zone-status";

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
