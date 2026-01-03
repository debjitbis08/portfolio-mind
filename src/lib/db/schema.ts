/**
 * Drizzle ORM Schema for Portfolio Mind
 *
 * SQLite-based schema for self-hosted deployment.
 * Single-user mode - no user_id columns needed.
 */

import {
  sqliteTable,
  text,
  integer,
  real,
  index,
} from "drizzle-orm/sqlite-core";

// ============================================================================
// Transactions - Source of truth for portfolio data
// ============================================================================

export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    isin: text("isin").notNull(),
    symbol: text("symbol").notNull(),
    stockName: text("stock_name").notNull(),
    type: text("type", { enum: ["BUY", "SELL", "OPENING_BALANCE"] }).notNull(),
    quantity: integer("quantity").notNull(),
    value: real("value").notNull(),
    exchange: text("exchange"),
    exchangeOrderId: text("exchange_order_id"),
    executedAt: text("executed_at").notNull(), // ISO string
    status: text("status").default("Executed"),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("idx_transactions_isin").on(table.isin),
    index("idx_transactions_executed_at").on(table.executedAt),
  ]
);

// ============================================================================
// Price Cache - Cached stock prices
// ============================================================================

export const priceCache = sqliteTable("price_cache", {
  symbol: text("symbol").primaryKey(),
  price: real("price").notNull(),
  changePercent: real("change_percent"),
  updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
});

// ============================================================================
// Technical Data - RSI, SMA indicators
// ============================================================================

export const technicalData = sqliteTable("technical_data", {
  symbol: text("symbol").primaryKey(),
  currentPrice: real("current_price"),
  rsi14: real("rsi_14"),
  sma50: real("sma_50"),
  sma200: real("sma_200"),
  priceVsSma50: real("price_vs_sma50"),
  priceVsSma200: real("price_vs_sma200"),
  updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
});

// ============================================================================
// Cycle Runs - AI analysis run logs
// ============================================================================

export const cycleRuns = sqliteTable("cycle_runs", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  startedAt: text("started_at").$defaultFn(() => new Date().toISOString()),
  completedAt: text("completed_at"),
  symbolsAnalyzed: integer("symbols_analyzed").default(0),
  suggestionsCount: integer("suggestions_count").default(0),
  status: text("status", { enum: ["running", "completed", "failed"] }).default(
    "running"
  ),
  errorMessage: text("error_message"),
});

// ============================================================================
// Suggestions - AI-generated investment suggestions
// ============================================================================

export const suggestions = sqliteTable(
  "suggestions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    cycleId: text("cycle_id").references(() => cycleRuns.id, {
      onDelete: "cascade",
    }),
    symbol: text("symbol").notNull(),
    stockName: text("stock_name"),
    action: text("action", {
      enum: ["BUY", "SELL", "HOLD", "WATCH"],
    }).notNull(),
    rationale: text("rationale").notNull(),
    technicalScore: real("technical_score"),
    currentPrice: real("current_price"),
    targetPrice: real("target_price"),
    status: text("status", {
      enum: ["pending", "approved", "rejected", "expired"],
    }).default("pending"),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
    expiresAt: text("expires_at").$defaultFn(() => {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      return d.toISOString();
    }),
    reviewedAt: text("reviewed_at"),
  },
  (table) => [index("idx_suggestions_pending").on(table.status)]
);

// ============================================================================
// Settings - User settings (single row)
// ============================================================================

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
  availableFunds: real("available_funds").default(0),
  riskProfile: text("risk_profile", {
    enum: ["conservative", "balanced", "aggressive"],
  }).default("balanced"),
  notificationEmail: text("notification_email"),
  screenerUrls: text("screener_urls"), // JSON array stored as text
  symbolMappings: text("symbol_mappings"), // JSON object stored as text
  updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
});

// ============================================================================
// Tool Cache - Caches responses from external tools
// ============================================================================

export const toolCache = sqliteTable(
  "tool_cache",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    cacheKey: text("cache_key").notNull().unique(),
    source: text("source").notNull(),
    queryArgs: text("query_args").notNull(), // JSON
    response: text("response").notNull(), // JSON
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
    expiresAt: text("expires_at").notNull(),
    hitCount: integer("hit_count").default(0),
  },
  (table) => [
    index("idx_tool_cache_key").on(table.cacheKey),
    index("idx_tool_cache_expires").on(table.expiresAt),
  ]
);

// ============================================================================
// Jobs - Background job tracking
// ============================================================================

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    type: text("type").notNull(),
    status: text("status", {
      enum: ["pending", "running", "completed", "failed"],
    }).default("pending"),
    progress: integer("progress").default(0),
    progressMessage: text("progress_message"),
    result: text("result"), // JSON
    errorMessage: text("error_message"),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
  },
  (table) => [index("idx_jobs_pending").on(table.status)]
);

// ============================================================================
// Stock Intel - Aggregated research data
// ============================================================================

export const stockIntel = sqliteTable("stock_intel", {
  symbol: text("symbol").primaryKey(),
  fundamentals: text("fundamentals"), // JSON
  newsSentiment: text("news_sentiment"), // JSON
  socialSentiment: text("social_sentiment"), // JSON
  updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
});

// ============================================================================
// Watchlist - Imported symbols from screeners
// ============================================================================

export const watchlist = sqliteTable("watchlist", {
  symbol: text("symbol").primaryKey(),
  addedAt: text("added_at").$defaultFn(() => new Date().toISOString()),
  source: text("source").default("manual"), // 'screener', 'manual', 'ai_discovery'
  notes: text("notes"),
});

// ============================================================================
// Sessions - Authentication sessions
// ============================================================================

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    token: text("token").notNull().unique(),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [index("idx_sessions_token").on(table.token)]
);
