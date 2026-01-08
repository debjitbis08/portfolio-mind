# Catalyst Catcher - Swing Trading Signal System

## Status: PLANNING 🔵

> **Created:** 2026-01-08
>
> Awaiting approval before implementation.

## Goal

Build a **news-first swing trading signal system** that detects high-impact market catalysts (supply shocks, regulatory changes, demand shifts) and validates them with real-time price/volume data from Yahoo Finance. The system runs alongside Portfolio Mind, sharing infrastructure and code where appropriate.

---

## Architecture Overview

```
                        ┌──────────────────────────────────┐
                        │         TRIGGER: Cron/Manual     │
                        │     (Every 30 mins or on-demand) │
                        └────────────────┬─────────────────┘
                                         ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                      STEP 1: News Ingestion (NewsMonitor)                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  • Fetch Google News RSS for each asset in catalyst_watchlist               │
│  • Filter articles < 2 hours old                                            │
│  • Dedupe against processed_articles table                                  │
│  • Output: Fresh NewsItem[] per asset                                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                         ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                    STEP 2: LLM Analysis (CatalystEngine)                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  • For each news item, call Gemini Flash with skeptical analyst prompt      │
│  • Classify: NOISE | SUPPLY_SHOCK | DEMAND_SHOCK | REGULATORY | EARNINGS    │
│  • Score confidence (1-10) and extract reasoning                            │
│  • Filter: Only proceed if isCatalyst=true AND confidence > 7               │
└─────────────────────────────────────────────────────────────────────────────┘
                                         ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                   STEP 3: Market Validation (MarketValidator)               │
├─────────────────────────────────────────────────────────────────────────────┤
│  • Fetch quote from Yahoo Finance (reuse existing yahoo-finance2 setup)     │
│  • Check: Is volume elevated? Is price confirming sentiment?                │
│  • Avoid traps: Bullish catalyst + Red price = wait, not act                │
│  • Output: MarketConfirmation with price, volume, trend data                │
└─────────────────────────────────────────────────────────────────────────────┘
                                         ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                     STEP 4: Signal Dispatch (SignalDispatcher)              │
├─────────────────────────────────────────────────────────────────────────────┤
│  • Create CatalystSignal record in database                                 │
│  • Log to console with formatting                                           │
│  • (Optional) Send Telegram/Discord notification                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Models

### New Tables (in `src/lib/db/schema.ts`)

```typescript
// ============================================================================
// Catalyst Watchlist - Assets to monitor for swing trading
// ============================================================================

// Note: Same keyword can have multiple rows with different tickers
// e.g., "Crude Oil" -> ONGC.NS, "Crude Oil" -> BPCL.NS
// For global keywords like "OPEC", relatedTickers stores comma-separated list

export const catalystWatchlist = sqliteTable(
  "catalyst_watchlist",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    keyword: text("keyword").notNull(), // Search term: "Copper", "OPEC"
    ticker: text("ticker"), // Yahoo ticker: "HINDCOPPER.NS" (null for global keywords)
    assetType: text("asset_type", {
      enum: ["COMMODITY", "EQUITY", "ETF", "CURRENCY", "GLOBAL"],
    }).notNull(),
    relatedTickers: text("related_tickers"), // For GLOBAL: "ONGC.NS,BPCL.NS,IOC.NS"
    enabled: integer("enabled", { mode: "boolean" }).default(true),
    notes: text("notes"),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => [index("idx_catalyst_watchlist_keyword").on(table.keyword)]
);

// ============================================================================
// Processed Articles - Dedupe cache for news articles
// ============================================================================

export const processedArticles = sqliteTable(
  "processed_articles",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    articleUrl: text("article_url").notNull().unique(),
    articleTitle: text("article_title").notNull(),
    keyword: text("keyword").notNull(),
    isCatalyst: integer("is_catalyst", { mode: "boolean" }).default(false),
    analysisJson: text("analysis_json"), // LLM analysis result
    processedAt: text("processed_at").$defaultFn(() =>
      new Date().toISOString()
    ),
  },
  (table) => [
    index("idx_processed_articles_url").on(table.articleUrl),
    index("idx_processed_articles_keyword").on(table.keyword),
  ]
);

// ============================================================================
// Catalyst Signals - Generated trade signals
// ============================================================================

export const catalystSignals = sqliteTable(
  "catalyst_signals",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    keyword: text("keyword").notNull(),
    ticker: text("ticker").notNull(),
    action: text("action", { enum: ["BUY_WATCH", "SELL_WATCH"] }).notNull(),

    // News context
    newsTitle: text("news_title").notNull(),
    newsUrl: text("news_url").notNull(),
    newsSource: text("news_source"),
    newsPubDate: text("news_pub_date"),

    // LLM analysis
    impactType: text("impact_type", {
      enum: ["SUPPLY_SHOCK", "DEMAND_SHOCK", "REGULATORY"],
    }).notNull(),
    sentiment: text("sentiment", { enum: ["BULLISH", "BEARISH"] }).notNull(),
    confidence: integer("confidence").notNull(), // 1-10
    reasoning: text("reasoning").notNull(),

    // Market validation
    currentPrice: real("current_price"),
    priceChangePercent: real("price_change_percent"),
    volumeSpike: integer("volume_spike", { mode: "boolean" }),

    // Status tracking
    status: text("status", {
      enum: ["active", "acted", "expired", "dismissed"],
    }).default("active"),
    actedAt: text("acted_at"),
    notes: text("notes"), // User notes

    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
    expiresAt: text("expires_at"), // Signals expire after 24-48h
  },
  (table) => [
    index("idx_catalyst_signals_status").on(table.status),
    index("idx_catalyst_signals_ticker").on(table.ticker),
  ]
);
```

### TypeScript Interfaces (in `src/lib/catalyst/types.ts`)

```typescript
export type Sentiment = "BULLISH" | "BEARISH" | "NEUTRAL";
export type ImpactType =
  | "SUPPLY_SHOCK"
  | "DEMAND_SHOCK"
  | "REGULATORY"
  | "NOISE";
// Note: EARNINGS removed - too noisy for swing trading signals
export type AssetType = "COMMODITY" | "EQUITY" | "ETF" | "CURRENCY";

export interface CatalystAsset {
  keyword: string;
  ticker: string;
  assetType: AssetType;
}

export interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
}

export interface AnalysisResult {
  isCatalyst: boolean;
  sentiment: Sentiment;
  impactType: ImpactType;
  confidence: number; // 1-10
  reasoning: string;
}

export interface MarketConfirmation {
  currentPrice: number;
  priceChangePercent: number;
  averageVolume: number;
  currentVolume: number;
  volumeSpike: boolean; // volume > 1.5x average
  isTrending: boolean; // price > SMA20
  priceConfirmsSentiment: boolean;
}

export interface CatalystSignal {
  asset: CatalystAsset;
  action: "BUY_WATCH" | "SELL_WATCH";
  news: NewsItem;
  analysis: AnalysisResult;
  technical: MarketConfirmation;
}
```

---

## Implementation Plan

### Phase 1: Schema & Types Foundation

#### [NEW] [types.ts](file:///home/debjit/code/portfolio-mind/src/lib/catalyst/types.ts)

- Define TypeScript interfaces for the catalyst system

#### [MODIFY] [schema.ts](file:///home/debjit/code/portfolio-mind/src/lib/db/schema.ts)

- Add `catalystWatchlist`, `processedArticles`, `catalystSignals` tables

#### Database Migration

- Generate and run Drizzle migration for new tables

---

### Phase 2: Core Engine Modules

#### [NEW] [news-monitor.ts](file:///home/debjit/code/portfolio-mind/src/lib/catalyst/news-monitor.ts)

Fetches news from Google News RSS:

- Reuse existing `fast-xml-parser` from news scraper
- Query format: `https://news.google.com/rss/search?q={keyword}+when:2h&hl=en-US&gl=US&ceid=US:en`
- Filter by recency (< 2 hours)
- Dedupe against `processedArticles` table

```typescript
export async function fetchCatalystNews(
  asset: CatalystAsset
): Promise<NewsItem[]>;
export async function isAlreadyProcessed(articleUrl: string): Promise<boolean>;
export async function markAsProcessed(
  article: NewsItem,
  analysis: AnalysisResult
): Promise<void>;
```

---

#### [NEW] [catalyst-engine.ts](file:///home/debjit/code/portfolio-mind/src/lib/catalyst/catalyst-engine.ts)

LLM-based news analysis using existing Gemini integration:

- Use `gemini-2.0-flash` for speed/cost
- System prompt: Skeptical hedge fund analyst persona
- Structured JSON output with Zod validation

```typescript
const SYSTEM_PROMPT = `
You are a senior commodities and equity analyst at a macro hedge fund.
You are skeptical of clickbait and opinion pieces.
Analyze the following news headline for the asset '{ASSET}'.

Determine if this is a **Material Catalyst** that changes Supply or Demand fundamentals:

SUPPLY_SHOCK (typically Bullish):
- Mine closures, strikes, worker shortages
- War/geopolitical disruption to production
- Weather destroying crops, floods at facilities
- Factory fires, refinery shutdowns

DEMAND_SHOCK (direction depends on context):
- New legislation mandating usage (Bullish)
- Tech breakthrough enabling new demand (Bullish)
- Major customer bankruptcy (Bearish)
- Tariffs reducing imports (context-dependent)

REGULATORY:
- New regulations impacting industry
- Antitrust actions
- Export/import restrictions

IMPORTANT - IGNORE THESE (Too Noisy):
- Earnings reports and guidance (already priced in by market makers)
- Quarterly results commentary

NOISE (Ignore):
- Analyst upgrades/downgrades without new data
- Generic market commentary
- Opinion pieces
- Price target changes

Return ONLY valid JSON matching this schema:
{ "isCatalyst": boolean, "sentiment": "BULLISH"|"BEARISH"|"NEUTRAL", "impactType": "...", "confidence": 1-10, "reasoning": "..." }
`;

export async function analyzeNewsItem(
  headline: string,
  asset: CatalystAsset
): Promise<AnalysisResult>;
```

---

#### [NEW] [market-validator.ts](file:///home/debjit/code/portfolio-mind/src/lib/catalyst/market-validator.ts)

Validates catalyst with market data using existing Yahoo Finance setup.

> [!IMPORTANT] > **Use Global Tickers for Validation**: Yahoo Finance has delayed/unreliable data for NSE/MCX symbols. Use global commodity futures (HG=F, CL=F) as proxies. If global copper is up +2% on volume, Hindalco/Hindustan Copper will follow.

```typescript
import yahooFinance from "yahoo-finance2";

// Mapping: keyword -> global validation ticker
const GLOBAL_VALIDATION_TICKERS: Record<string, string> = {
  Copper: "HG=F",
  "Crude Oil": "CL=F",
  "Natural Gas": "NG=F",
  Gold: "GC=F",
  Silver: "SI=F",
  Uranium: "URA", // Global X Uranium ETF
  Coffee: "KC=F",
  Wheat: "ZW=F",
};

export async function validateWithMarket(
  keyword: string,
  expectedSentiment: Sentiment
): Promise<MarketConfirmation>;

// Logic:
// - Look up global ticker for keyword (or use direct ticker if equity)
// - Fetch quote: regularMarketPrice, regularMarketVolume, averageDailyVolume10Day
// - Volume spike: currentVolume > averageVolume * 0.1 (scaled for time of day)
// - Sentiment confirmation: BULLISH + green price OR BEARISH + red price
```

---

#### [NEW] [signal-dispatcher.ts](file:///home/debjit/code/portfolio-mind/src/lib/catalyst/signal-dispatcher.ts)

Saves signals and dispatches notifications:

```typescript
export async function saveSignal(signal: CatalystSignal): Promise<string>; // Returns signal ID
export function formatSignalForConsole(signal: CatalystSignal): string;
// Future: export async function sendToTelegram(signal: CatalystSignal): Promise<void>;
```

---

#### [NEW] [index.ts](file:///home/debjit/code/portfolio-mind/src/lib/catalyst/index.ts)

Main orchestrator that ties everything together:

```typescript
export async function runCatalystScan(options?: {
  assets?: CatalystAsset[]; // Override watchlist
}): Promise<CatalystSignal[]>;
```

---

### Phase 3: API Endpoints

#### [NEW] [scan.ts](file:///home/debjit/code/portfolio-mind/src/pages/api/catalyst/scan.ts)

- POST: Trigger a manual catalyst scan
- Returns job ID for progress tracking (reuse existing `jobs` table)

#### [NEW] [signals.ts](file:///home/debjit/code/portfolio-mind/src/pages/api/catalyst/signals.ts)

- GET: List recent signals with filters (status, ticker)
- PUT: Update signal status (acted, dismissed)

#### [NEW] [watchlist.ts](file:///home/debjit/code/portfolio-mind/src/pages/api/catalyst/watchlist.ts)

- GET: List monitored assets
- POST: Add new asset to monitor
- DELETE: Remove asset

---

### Phase 4: Script for Manual/Cron Execution

#### [NEW] [run-catalyst-scan.ts](file:///home/debjit/code/portfolio-mind/scripts/run-catalyst-scan.ts)

Standalone script for manual runs or cron jobs:

```typescript
// Usage: npx tsx scripts/run-catalyst-scan.ts
// Or with cron: */30 * * * * cd /path/to/portfolio-mind && npx tsx scripts/run-catalyst-scan.ts
```

---

### Phase 5: UI (Optional, Future)

If needed, add a simple UI page:

- `/catalyst` - List active signals
- Signal cards with news context, LLM reasoning, market data
- Quick actions: Mark as acted, Dismiss

---

## Code Reuse Summary

| Existing Module   | Reuse For                          |
| ----------------- | ---------------------------------- |
| `yahoo-finance2`  | Market validation (quote fetching) |
| `fast-xml-parser` | RSS feed parsing (from news.ts)    |
| Gemini API setup  | LLM analysis (from gemini.ts)      |
| `jobs` table      | Job tracking for scan API          |
| `toolCache`       | Can cache LLM analysis results     |

---

## Verification Plan

### Automated Tests

1. Run scan script with test watchlist: `npx tsx scripts/run-catalyst-scan.ts`
2. Verify signals are saved to database
3. Check console output formatting

### Manual Verification

1. Add commodity assets (Copper, Oil) to watchlist via API
2. Trigger scan and observe LLM analysis quality
3. Verify volume spike detection logic with Yahoo Finance data

---

## Calibration Mode (Paper Trading)

> [!IMPORTANT] > **Run in paper mode for 1 week before trusting signals.** This allows prompt tuning based on real-world false positive rates.

### Paper Run Setup

```typescript
// In catalyst config or environment
const PAPER_MODE = true; // Set false after calibration
const OPPORTUNITIES_LOG = "./logs/opportunities.log";
```

### Log Format

```
[2026-01-08T14:00:00Z] [Copper] ["Chile mine strike affects 10% global supply"]
  -> LLM: SUPPLY_SHOCK (Confidence: 9, BULLISH)
  -> Global HG=F: +1.2%, Vol: 1.8x avg
  -> 1hr Later: HG=F +2.8%, HINDCOPPER.NS +3.1%
  -> VERDICT: ✅ GOOD CALL
```

### Implementation

1. **Initial Run**: Log all signals, don't persist to `catalyst_signals` table
2. **1-Hour Callback**: Cron job checks price 1hr after each logged opportunity
3. **Scoring**: Calculate hit rate (prediction matched 1hr price direction)
4. **Prompt Tuning**: Adjust based on patterns (e.g., "Earnings always wrong → remove from prompt")

### Calibration Learnings to Track

| Pattern          | Expected Outcome | Actual             | Action                |
| ---------------- | ---------------- | ------------------ | --------------------- |
| Earnings calls   | High confidence  | Often wrong        | ❌ Remove from prompt |
| Mine strikes     | SUPPLY_SHOCK     | Usually correct    | ✅ Keep               |
| Analyst upgrades | NOISE            | Correctly filtered | ✅ Good               |
| Weather events   | Depends          | TBD                | Observe               |

---

## Initial Watchlist (Seed Data)

**Focus: Indian markets with global news coverage**

News queries are kept global (no geo-filter) to catch international supply shocks that affect Indian prices (e.g., Chile copper mine strike → MCX Copper, OPEC cuts → ONGC).

### Commodities (MCX/Global proxies)

| Keyword     | Ticker        | Asset Type | Global Validation | Notes                               |
| ----------- | ------------- | ---------- | ----------------- | ----------------------------------- |
| Copper      | HINDCOPPER.NS | EQUITY     | HG=F              | Hindustan Copper (MCX copper proxy) |
| Crude Oil   | ONGC.NS       | EQUITY     | CL=F              | ONGC moves with Brent               |
| Crude Oil   | BPCL.NS       | EQUITY     | CL=F              | OMCs inversely correlate            |
| Natural Gas | GAIL.NS       | EQUITY     | NG=F              | Natural gas exposure                |
| Gold        | GOLDBEES.NS   | ETF        | GC=F              | Gold ETF                            |
| Silver      | SILVERBEES.NS | ETF        | SI=F              | Silver ETF                          |
| Uranium     | -             | COMMODITY  | URA               | Track via Global X Uranium ETF      |
| Coffee      | -             | COMMODITY  | KC=F              | Coffee futures                      |

### Equities (High-Impact Sectors)

| Keyword              | Ticker         | Asset Type | Notes                     |
| -------------------- | -------------- | ---------- | ------------------------- |
| Semiconductors India | DIXON.NS       | EQUITY     | Electronics manufacturing |
| Apple supplier India | TATAELXSI.NS   | EQUITY     | Tech services             |
| EV battery India     | TATAMOTORS.NS  | EQUITY     | EV play                   |
| Lithium              | EXIDEIND.NS    | EQUITY     | Battery/Lithium exposure  |
| Sugar exports        | BALRAMCHIN.NS  | EQUITY     | Commodity cycle           |
| Fertilizer shortage  | CHAMBALFERT.NS | EQUITY     | Urea, DAP                 |
| Suez Canal           | ADANIPORTS.NS  | EQUITY     | Shipping disruption       |
| Defense India        | HAL.NS         | EQUITY     | Hindustan Aeronautics     |
| Defense India        | BEL.NS         | EQUITY     | Bharat Electronics        |
| Defense India        | BHARATFORGE.NS | EQUITY     | Bharat Forge              |

### Global Keywords (No ticker - affects multiple)

| Keyword           | Related Indian Plays  | Why Monitor                |
| ----------------- | --------------------- | -------------------------- |
| OPEC              | ONGC, BPCL, IOC       | Oil price catalyst         |
| Taiwan China      | DIXON, TATAELXSI      | Semiconductor supply chain |
| Red Sea shipping  | ADANIPORTS, logistics | Freight costs              |
| Monsoon India     | CHAMBALFERT, GNFC     | Agri sector                |
| RBI interest rate | HDFCBANK, ICICIBANK   | Financials                 |

---

## News Query Strategy

```typescript
// Global news - no geo filter to catch international events
const BASE_URL = "https://news.google.com/rss/search";
const query = `${keyword}+when:2h`; // Last 2 hours, global

// Example: Copper mine strike in Chile should trigger Hindustan Copper review
```

---

## User Review Required

> [!IMPORTANT] > **Multi-Ticker Keywords**: Some keywords (like "OPEC") affect multiple tickers. The system should support mapping one keyword to multiple related Indian stocks.

> [!NOTE] > **Scan Frequency**: Default 30 minutes. Can be adjusted based on rate limiting observations.

> [!NOTE] > **Telegram Integration**: Deferred to Phase 5. For now, signals are logged to console and saved to database.
