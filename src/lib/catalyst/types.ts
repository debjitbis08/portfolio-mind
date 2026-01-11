/**
 * Catalyst Catcher - Type Definitions
 *
 * Types for the news-first swing trading signal system.
 * Detects high-impact catalysts (supply shocks, regulatory changes)
 * and validates with real-time market data.
 */

// ============================================================================
// Core Enums
// ============================================================================

export type Sentiment = "BULLISH" | "BEARISH" | "NEUTRAL";

/**
 * Types of market-moving catalysts.
 * Note: EARNINGS intentionally excluded - too noisy, already priced in.
 */
export type ImpactType =
  | "SUPPLY_SHOCK"
  | "DEMAND_SHOCK"
  | "REGULATORY"
  | "NOISE";

export type AssetType = "COMMODITY" | "EQUITY" | "ETF" | "CURRENCY" | "GLOBAL";

export type SignalStatus =
  | "active"
  | "pending_market_open"
  | "acted"
  | "expired"
  | "dismissed";

// ============================================================================
// Watchlist & Assets
// ============================================================================

export interface CatalystAsset {
  id: string;
  keyword: string;
  ticker: string | null; // null for global keywords like "OPEC"
  assetType: AssetType;
  relatedTickers?: string[]; // For GLOBAL type: ["ONGC.NS", "BPCL.NS"]
  globalValidationTicker?: string; // e.g., "HG=F" for Copper validation
  notes?: string;
  enabled: boolean;
}

// ============================================================================
// News Data
// ============================================================================

export interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  sourceId?: string; // ID from source registry (e.g., "pib-rss", "rbi-rss")
  sourcePriority?: number; // 0=Official, 1=Media, 2=Social, 3=Aggregator
  content?: string;
  contentType?: "html" | "pdf";
  contentUrl?: string;
}

// ============================================================================
// LLM Analysis
// ============================================================================

export interface AnalysisResult {
  isCatalyst: boolean;
  sentiment: Sentiment;
  impactType: ImpactType;
  confidence: number; // 1-10
  reasoning: string;
}

// ============================================================================
// Market Validation
// ============================================================================

export interface MarketConfirmation {
  ticker: string; // The ticker used for validation (global or direct)
  currentPrice: number;
  priceChangePercent: number;
  averageVolume: number;
  currentVolume: number;
  volumeRatio: number; // currentVolume / averageVolume
  volumeSpike: boolean; // volumeRatio > 1.5 (adjusted for time of day)
  isTrending: boolean; // price > SMA20 (if available)
  priceConfirmsSentiment: boolean; // BULLISH+green or BEARISH+red
}

// ============================================================================
// Trade Signals
// ============================================================================

export interface CatalystSignal {
  id?: string;
  asset: CatalystAsset;
  action: "BUY_WATCH" | "SELL_WATCH";
  news: NewsItem;
  analysis: AnalysisResult;
  technical: MarketConfirmation;
  status: SignalStatus;
  createdAt: string;
  expiresAt?: string;
  actedAt?: string;
  notes?: string;
}

// ============================================================================
// Calibration / Paper Trading
// ============================================================================

/**
 * Single price checkpoint for verification.
 */
export interface PriceCheckpoint {
  checkedAt: string;
  price: number;
  priceChangeFromSignal: number; // % change from basePrice
  verdict: "GOOD_CALL" | "BAD_CALL" | "NEUTRAL";
}

/**
 * Extended checkpoint that includes both global and Indian stock prices.
 */
export interface ExtendedCheckpoint extends PriceCheckpoint {
  indianStockPrice?: number; // Price of the Indian stock (e.g., HINDCOPPER.NS)
  indianStockChange?: number; // % change from signal time
}

export interface OpportunityLogEntry {
  id: string; // Unique ID for tracking
  timestamp: string;
  keyword: string;
  headline: string;
  summary?: string; // Batch analysis summary

  // Indian stock to buy (the actual trading target)
  indianTicker?: string; // e.g., "HINDCOPPER.NS"
  indianBasePrice?: number; // Price at signal time

  llmPrediction: {
    impactType: ImpactType;
    confidence: number;
    sentiment: Sentiment;
  };
  marketState: {
    globalTicker: string;
    basePrice: number; // Global ticker price at signal time
    priceChangePercent: number;
    volumeRatio: number;
  };
  // Multi-interval verification checkpoints
  checkpoints?: {
    after1hr?: ExtendedCheckpoint;
    nextSession?: ExtendedCheckpoint;
    after24hr?: ExtendedCheckpoint;
  };
  // Final verdict (based on best checkpoint result)
  finalVerdict?: "GOOD_CALL" | "BAD_CALL" | "NEUTRAL" | "PENDING";
  notes?: string;
}

// ============================================================================
// Global Ticker Mappings (for validation)
// ============================================================================

/**
 * Yahoo Finance global tickers for commodity validation.
 * NSE/MCX data is often delayed; global futures are more reliable.
 */
export const GLOBAL_VALIDATION_TICKERS: Record<string, string> = {
  Copper: "HG=F",
  "Crude Oil": "CL=F",
  "Natural Gas": "NG=F",
  Gold: "GC=F",
  Silver: "SI=F",
  Uranium: "URA", // Global X Uranium ETF
  Coffee: "KC=F",
  Wheat: "ZW=F",
  Lithium: "LIT", // Global X Lithium ETF
};

// ============================================================================
// Configuration
// ============================================================================

export interface CatalystConfig {
  paperMode: boolean; // Log only, don't persist signals
  scanIntervalMinutes: number; // Default: 30
  newsMaxAgeHours: number; // Default: 2
  confidenceThreshold: number; // Default: 7
  opportunitiesLogPath: string;
}

export const DEFAULT_CATALYST_CONFIG: CatalystConfig = {
  paperMode: false, // Start in paper mode for calibration
  scanIntervalMinutes: 30,
  newsMaxAgeHours: 2,
  confidenceThreshold: 7,
  opportunitiesLogPath: "./logs/opportunities.log",
};
