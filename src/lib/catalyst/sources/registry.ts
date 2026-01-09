/**
 * Source Registry
 *
 * Central registry of all news sources for the multi-lane catalyst detection system.
 */

import type { NewsSourceConfig, SourceFetchResult } from "./types";
import { fetchPibNews } from "./pib-rss";
import { fetchAllRbiNews } from "./rbi-rss";
import { fetchBseAnnouncements } from "./bse-api";
import { fetchDipamNews } from "./dipam-scraper";
import { fetchDpiitNews } from "./dpiit-scraper";
import { fetchIndianMarketNews } from "../news-monitor";
import {
  isSourceAvailable,
  recordSuccess,
  recordFailure,
} from "./circuit-breaker";

/**
 * All registered news sources.
 *
 * Sources are organized by lane (polling frequency):
 * - FAST (5 min): Exchange-level data and critical government sources
 * - OFFICIAL (15 min): Government press releases and regulations
 * - MEDIA (30 min): Verified financial news outlets
 * - AGGREGATOR (60 min): Broad market news aggregators
 */
export const NEWS_SOURCES: NewsSourceConfig[] = [
  // ========================================================================
  // FAST LANE (5 min) - Level 0 Sources (Phase 2)
  // ========================================================================
  {
    id: "bse-api",
    name: "BSE Corporate Announcements",
    type: "API",
    lane: "FAST",
    priority: 0,
    pollIntervalMinutes: 5,
    enabled: true,
    description:
      "BSE India official API. Corporate announcements, board meetings, results. Beats MoneyControl by ~10 minutes!",
    rateLimit: 12, // Max 12 requests per hour (1 per 5 min)
    fetch: async () => {
      // Fetch last 4 hours (BSE updates frequently)
      return fetchBseAnnouncements(4, 50);
    },
  },
  {
    id: "dipam-scraper",
    name: "DIPAM (PSU Disinvestment)",
    type: "SCRAPE",
    lane: "FAST",
    priority: 0,
    pollIntervalMinutes: 30, // DIPAM updates less frequently
    enabled: true,
    description:
      "Department of Investment and Public Asset Management. PSU strategic sales, disinvestment news.",
    fetch: async () => {
      return fetchDipamNews(20, 48);
    },
  },
  {
    id: "dpiit-scraper",
    name: "DPIIT (FDI & Trade Policy)",
    type: "SCRAPE",
    lane: "FAST",
    priority: 0,
    pollIntervalMinutes: 30, // DPIIT updates less frequently
    enabled: true,
    description:
      "Department for Promotion of Industry and Internal Trade. FDI policy, import restrictions, manufacturing updates.",
    fetch: async () => {
      return fetchDpiitNews(20, 48);
    },
  },

  // ========================================================================
  // OFFICIAL LANE (15 min) - Level 0 Sources (Phase 1)
  // ========================================================================
  {
    id: "pib-rss",
    name: "PIB (Press Information Bureau)",
    type: "RSS",
    lane: "OFFICIAL",
    priority: 0,
    pollIntervalMinutes: 15,
    enabled: true,
    description:
      "Official Indian government press releases. Cabinet decisions, PLI schemes, policy announcements.",
    fetch: async () => {
      // Fetch last 24 hours of PIB news (high quality, low frequency)
      return fetchPibNews(20, 24);
    },
  },
  {
    id: "rbi-rss",
    name: "RBI (Reserve Bank of India)",
    type: "RSS",
    lane: "OFFICIAL",
    priority: 0,
    pollIntervalMinutes: 15,
    enabled: true,
    description:
      "RBI press releases and notifications. Repo rate changes, banking penalties, regulatory actions.",
    fetch: async () => {
      // Fetch last 24 hours from both press releases and notifications
      return fetchAllRbiNews(10, 24);
    },
  },

  // ========================================================================
  // MEDIA LANE (30 min) - Level 1 Sources
  // ========================================================================
  {
    id: "india-market-news",
    name: "Indian Market News (ET, Mint, MoneyControl)",
    type: "RSS",
    lane: "MEDIA",
    priority: 1,
    pollIntervalMinutes: 30,
    enabled: true,
    description:
      "Aggregated RSS feeds from Economic Times, Livemint, and MoneyControl. General market news.",
    fetch: async () => {
      // Fetch last 4 hours from multiple sources
      return fetchIndianMarketNews(20, 4);
    },
  },

  // ========================================================================
  // AGGREGATOR LANE (60 min) - Level 3 Sources
  // ========================================================================
  {
    id: "google-news-india",
    name: "Google News India Business",
    type: "RSS",
    lane: "AGGREGATOR",
    priority: 3,
    pollIntervalMinutes: 60,
    enabled: true,
    description:
      "Google News India Business category. Catch-all for news from smaller sources.",
    fetch: async () => {
      // This is already included in fetchIndianMarketNews, but we keep it for visibility
      // In practice, we can disable this to avoid duplication
      return [];
    },
  },
];

/**
 * Get all enabled sources.
 */
export function getEnabledSources(): NewsSourceConfig[] {
  return NEWS_SOURCES.filter((s) => s.enabled);
}

/**
 * Get sources by lane.
 */
export function getSourcesByLane(
  lane: NewsSourceConfig["lane"]
): NewsSourceConfig[] {
  return NEWS_SOURCES.filter((s) => s.enabled && s.lane === lane);
}

/**
 * Get a source by ID.
 */
export function getSourceById(id: string): NewsSourceConfig | undefined {
  return NEWS_SOURCES.find((s) => s.id === id);
}

/**
 * Get polling intervals for each lane (in minutes).
 */
export const LANE_INTERVALS = {
  FAST: 1,
  OFFICIAL: 15,
  SOCIAL: 5,
  MEDIA: 30,
  AGGREGATOR: 60,
} as const;

/**
 * Get all sources that should run at a given interval.
 *
 * @param currentMinute - Current minute of the hour (0-59)
 * @returns Sources that should run now
 */
export function getSourcesForInterval(
  currentMinute: number
): NewsSourceConfig[] {
  const sources: NewsSourceConfig[] = [];

  for (const source of getEnabledSources()) {
    const interval = source.pollIntervalMinutes;

    // Check if current minute is a multiple of the interval
    if (currentMinute % interval === 0) {
      sources.push(source);
    }
  }

  return sources;
}

/**
 * Fetch from a source with circuit breaker protection.
 *
 * Wraps the source's fetch function with:
 * - Circuit breaker logic (skip if open)
 * - Success/failure recording
 * - Result formatting
 *
 * @param source - Source configuration
 * @returns Fetch result with metadata
 */
export async function fetchFromSource(
  source: NewsSourceConfig
): Promise<SourceFetchResult> {
  const startTime = Date.now();

  // Check circuit breaker
  if (!isSourceAvailable(source.id)) {
    console.warn(
      `[SourceRegistry] ${source.name}: Circuit breaker is OPEN, skipping`
    );
    return {
      source: source.name,
      success: false,
      itemsFound: 0,
      newItems: [],
      error: "Circuit breaker is OPEN",
      fetchedAt: new Date().toISOString(),
    };
  }

  try {
    const items = await source.fetch();
    const fetchTime = Date.now() - startTime;

    // Record success
    recordSuccess(source.id);

    console.log(
      `[SourceRegistry] ${source.name}: Fetched ${items.length} items in ${fetchTime}ms`
    );

    return {
      source: source.name,
      success: true,
      itemsFound: items.length,
      newItems: items,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    const fetchTime = Date.now() - startTime;

    // Record failure
    recordFailure(source.id);

    console.error(
      `[SourceRegistry] ${source.name}: Failed after ${fetchTime}ms:`,
      error
    );

    return {
      source: source.name,
      success: false,
      itemsFound: 0,
      newItems: [],
      error: (error as Error).message || "Unknown error",
      fetchedAt: new Date().toISOString(),
    };
  }
}

/**
 * Fetch from multiple sources in parallel.
 *
 * @param sources - Array of source configurations
 * @returns Array of fetch results
 */
export async function fetchFromSources(
  sources: NewsSourceConfig[]
): Promise<SourceFetchResult[]> {
  const promises = sources.map((source) => fetchFromSource(source));
  return Promise.all(promises);
}
