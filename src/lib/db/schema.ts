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
      enum: ["BUY", "SELL", "HOLD", "WATCH", "RAISE_CASH"],
    }).notNull(),
    rationale: text("rationale").notNull(),
    technicalScore: real("technical_score"),
    currentPrice: real("current_price"),
    targetPrice: real("target_price"),
    status: text("status", {
      enum: ["pending", "approved", "rejected", "expired", "superseded"],
    }).default("pending"),
    confidence: integer("confidence"), // 1-10 scale
    quantity: integer("quantity"), // Shares to buy/sell
    allocationAmount: real("allocation_amount"), // Amount in ₹ to allocate
    supersededBy: text("superseded_by"), // ID of newer suggestion
    supersededReason: text("superseded_reason"),
    citations: text("citations"), // JSON array of citation objects
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
// Suggestion Transactions - Links suggestions to actual executed transactions
// ============================================================================

export const suggestionTransactions = sqliteTable(
  "suggestion_transactions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    suggestionId: text("suggestion_id")
      .references(() => suggestions.id, { onDelete: "cascade" })
      .notNull(),
    transactionId: text("transaction_id")
      .references(() => transactions.id, { onDelete: "cascade" })
      .notNull(),
    matchType: text("match_type", {
      enum: ["manual", "auto_symbol_date", "auto_price"],
    }).notNull(),
    confidence: integer("confidence").default(100), // 0-100
    notes: text("notes"),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("idx_suggestion_transactions_suggestion").on(table.suggestionId),
    index("idx_suggestion_transactions_transaction").on(table.transactionId),
  ]
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
  screenerEmail: text("screener_email"), // Screener.in login email
  screenerPassword: text("screener_password"), // Screener.in password
  symbolMappings: text("symbol_mappings"), // JSON object stored as text
  toolConfig: text("tool_config"), // JSON: { toolName: { enabled: boolean, ...options } }
  aiEnabled: integer("ai_enabled", { mode: "boolean" }).default(true),
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
  name: text("name"), // Stock name (useful for BSE code stocks)
  addedAt: text("added_at").$defaultFn(() => new Date().toISOString()),
  source: text("source").default("manual"), // 'screener', 'manual', 'ai_discovery'
  notes: text("notes"),
  interesting: integer("interesting", { mode: "boolean" }).default(false), // Mark as priority/interesting
});

// ============================================================================
// Commodity Holdings - Physical commodities (gold, silver, etc.)
// ============================================================================

export const commodityHoldings = sqliteTable("commodity_holdings", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  commodityType: text("commodity_type", {
    enum: ["GOLD", "SILVER", "PLATINUM", "COPPER", "CRUDE_OIL", "OTHER"],
  }).notNull(),
  name: text("name").notNull(), // e.g., "Physical Gold Bar", "Gold SGB 2024"
  holdingType: text("holding_type", {
    enum: ["PHYSICAL", "SGB", "DIGITAL", "OTHER"],
  }).default("PHYSICAL"),
  quantity: real("quantity").notNull(), // In grams or units
  unit: text("unit", { enum: ["GRAM", "KG", "OZ", "UNIT"] }).default("GRAM"),
  purchasePrice: real("purchase_price").notNull(), // Per unit at time of purchase
  purchaseDate: text("purchase_date").notNull(),
  notes: text("notes"),
  createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
});

// ============================================================================
// ETF Commodity Mappings - Maps ETF symbols to underlying commodity
// ============================================================================

/**
 * Maps ETF symbols (e.g., GOLDBEES, SILVERBEES) to their underlying commodity.
 * This enables the system to recognize gold ETFs as gold exposure.
 */
export const etfCommodityMappings = sqliteTable("etf_commodity_mappings", {
  symbol: text("symbol").primaryKey(), // e.g., "GOLDBEES", "SILVERBEES"
  commodityType: text("commodity_type", {
    enum: ["GOLD", "SILVER", "PLATINUM", "COPPER", "CRUDE_OIL", "OTHER"],
  }).notNull(),
  conversionFactor: real("conversion_factor").default(1), // Units of commodity per share
  notes: text("notes"),
});

// ============================================================================
// Company Notes - User notes at company/stock level
// ============================================================================

export const companyNotes = sqliteTable(
  "company_notes",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    symbol: text("symbol").notNull(),
    content: text("content").notNull(),
    tags: text("tags"), // JSON array of tag strings
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [index("idx_company_notes_symbol").on(table.symbol)]
);

// ============================================================================
// Action Notes - User notes attached to AI suggestions
// ============================================================================

export const actionNotes = sqliteTable(
  "action_notes",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    suggestionId: text("suggestion_id")
      .references(() => suggestions.id, {
        onDelete: "cascade",
      })
      .notNull(),
    content: text("content").notNull(),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [index("idx_action_notes_suggestion").on(table.suggestionId)]
);

// ============================================================================
// Company Research - User-created research documents
// ============================================================================

export const companyResearch = sqliteTable(
  "company_research",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    symbol: text("symbol").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(), // Markdown content
    tags: text("tags"), // JSON array of tag strings
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [index("idx_company_research_symbol").on(table.symbol)]
);

// ============================================================================
// Company Links - User bookmarked URLs with fetched content
// ============================================================================

export const companyLinks = sqliteTable(
  "company_links",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    symbol: text("symbol").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    description: text("description"), // Optional user note
    fetchedContent: text("fetched_content"), // Cleaned page content
    fetchedAt: text("fetched_at"), // When content was last fetched
    tags: text("tags"), // JSON array of tag strings
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [index("idx_company_links_symbol").on(table.symbol)]
);

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

// ============================================================================
// User Tables - User-defined flexible tables
// ============================================================================

export const userTables = sqliteTable(
  "user_tables",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    symbol: text("symbol").notNull(), // Company-level tables only for now (no global tables yet)
    name: text("name").notNull(),
    columns: text("columns").notNull(), // JSON array of column definitions
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [index("idx_user_tables_symbol").on(table.symbol)]
);

// ============================================================================
// User Table Rows - Data rows for user-defined tables
// ============================================================================

export const userTableRows = sqliteTable(
  "user_table_rows",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tableId: text("table_id")
      .references(() => userTables.id, {
        onDelete: "cascade",
      })
      .notNull(),
    data: text("data").notNull(), // JSON object with column values
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [index("idx_user_table_rows_table_id").on(table.tableId)]
);

// ============================================================================
// Company Financials - Structured quarterly/annual financial data
// ============================================================================

export const companyFinancials = sqliteTable(
  "company_financials",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    symbol: text("symbol").notNull(),
    periodType: text("period_type", {
      enum: ["annual", "quarterly"],
    }).notNull(),
    reportDate: text("report_date").notNull(), // ISO date string

    // P&L (in Crores)
    sales: real("sales"),
    operatingProfit: real("operating_profit"),
    netProfit: real("net_profit"),
    eps: real("eps"),
    opmPercent: real("opm_percent"),

    // Balance Sheet
    equity: real("equity"),
    reserves: real("reserves"),
    borrowings: real("borrowings"),
    receivables: real("receivables"),
    inventory: real("inventory"),

    // Cash Flow
    operatingCashFlow: real("operating_cash_flow"),
    investingCashFlow: real("investing_cash_flow"),
    financingCashFlow: real("financing_cash_flow"),

    // Price at report date
    price: real("price"),

    // Metadata
    source: text("source").default("screener"),
    updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("idx_company_financials_symbol").on(table.symbol),
    index("idx_company_financials_period").on(table.symbol, table.reportDate),
  ]
);

// ============================================================================
// Concall Highlights - AI-extracted key points from earnings calls
// ============================================================================

export const concallHighlights = sqliteTable(
  "concall_highlights",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    symbol: text("symbol").notNull(),
    quarter: text("quarter").notNull(), // "Q3 FY25"
    callDate: text("call_date"), // ISO date
    sourceUrl: text("source_url"),

    // Structured highlights (stored as text, can be JSON)
    managementGuidance: text("management_guidance"),
    keyNumbers: text("key_numbers"), // JSON: {"capex": "500cr", "orderBook": "2000cr"}
    positives: text("positives"),
    risksDiscussed: text("risks_discussed"),
    analystConcerns: text("analyst_concerns"),

    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [index("idx_concall_highlights_symbol").on(table.symbol)]
);
