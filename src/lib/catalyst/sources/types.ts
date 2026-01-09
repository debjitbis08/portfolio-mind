/**
 * Source Registry Types
 *
 * Defines the interface for pluggable news sources in the multi-lane system.
 */

import type { NewsItem } from "../types";

/**
 * Source types categorized by data retrieval method
 */
export type SourceType = "RSS" | "API" | "SCRAPE" | "SOCIAL";

/**
 * Priority lanes for news source polling
 * - FAST: 1 min (exchange-level events)
 * - OFFICIAL: 15 min (government policy, regulations)
 * - SOCIAL: 5 min (global events, rumors)
 * - MEDIA: 30 min (verified news)
 * - AGGREGATOR: 60 min (catch-all)
 */
export type SourceLane = "FAST" | "OFFICIAL" | "SOCIAL" | "MEDIA" | "AGGREGATOR";

/**
 * Source priority level for AI confidence weighting
 * - Level 0: Official exchanges, regulators (highest trust)
 * - Level 1: Verified media (high trust)
 * - Level 2: Social media (medium trust, needs confirmation)
 * - Level 3: Aggregators (lowest priority)
 */
export type SourcePriority = 0 | 1 | 2 | 3;

/**
 * Result of a source fetch operation
 */
export interface SourceFetchResult {
  source: string;
  success: boolean;
  itemsFound: number;
  newItems: NewsItem[];
  error?: string;
  fetchedAt: string;
}

/**
 * Configuration for a news source
 */
export interface NewsSourceConfig {
  /** Unique identifier for the source */
  id: string;

  /** Human-readable name */
  name: string;

  /** Source type (RSS, API, etc.) */
  type: SourceType;

  /** Priority lane for polling frequency */
  lane: SourceLane;

  /** Source priority for AI confidence weighting */
  priority: SourcePriority;

  /** Polling interval in minutes */
  pollIntervalMinutes: number;

  /** Whether this source is currently enabled */
  enabled: boolean;

  /** Fetch function that returns news items */
  fetch: () => Promise<NewsItem[]>;

  /** Optional description */
  description?: string;

  /** Optional rate limit (requests per hour) */
  rateLimit?: number;
}

/**
 * Statistics for a news source
 */
export interface SourceStats {
  sourceId: string;
  totalFetches: number;
  successfulFetches: number;
  failedFetches: number;
  totalItemsFetched: number;
  lastFetchAt?: string;
  lastError?: string;
  averageFetchTimeMs?: number;
}
