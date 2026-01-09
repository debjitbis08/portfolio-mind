/**
 * Fetch Utilities for News Sources
 *
 * Provides retry logic, exponential backoff, and caching for RSS/API fetches.
 */

interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  timeoutMs?: number;
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelayMs: 1000, // 1 second
  maxDelayMs: 10000, // 10 seconds
  backoffMultiplier: 2,
  timeoutMs: 15000, // 15 seconds
};

/**
 * Sleep for a given duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch with timeout support
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Fetch with retry and exponential backoff.
 *
 * Retries on network errors and 5xx server errors.
 * Does NOT retry on 4xx client errors (permanent failures).
 *
 * @param url - URL to fetch
 * @param options - Fetch options
 * @param retryOptions - Retry configuration
 * @returns Response object
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retryOptions: RetryOptions = {}
): Promise<Response> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...retryOptions };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options, opts.timeoutMs);

      // Success: 2xx or 3xx
      if (response.ok || response.status < 400) {
        return response;
      }

      // Client errors (4xx): Don't retry, permanent failure
      if (response.status >= 400 && response.status < 500) {
        console.warn(
          `[fetchWithRetry] Client error ${response.status} for ${url} - not retrying`
        );
        return response;
      }

      // Server errors (5xx): Retry
      if (response.status >= 500) {
        lastError = new Error(
          `Server error: ${response.status} ${response.statusText}`
        );
        console.warn(
          `[fetchWithRetry] Server error ${response.status} for ${url}, attempt ${attempt + 1}/${opts.maxRetries + 1}`
        );
      }
    } catch (error) {
      lastError = error as Error;

      // AbortError means timeout
      if ((error as Error).name === "AbortError") {
        console.warn(
          `[fetchWithRetry] Timeout for ${url}, attempt ${attempt + 1}/${opts.maxRetries + 1}`
        );
      } else {
        console.warn(
          `[fetchWithRetry] Network error for ${url}, attempt ${attempt + 1}/${opts.maxRetries + 1}:`,
          error
        );
      }
    }

    // Don't sleep after the last attempt
    if (attempt < opts.maxRetries) {
      const delay = Math.min(
        opts.initialDelayMs * Math.pow(opts.backoffMultiplier, attempt),
        opts.maxDelayMs
      );
      console.log(`[fetchWithRetry] Retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }

  // All retries exhausted
  throw new Error(
    `Failed to fetch ${url} after ${opts.maxRetries + 1} attempts: ${lastError?.message || "Unknown error"}`
  );
}

/**
 * In-memory cache for RSS feeds.
 * Key: URL, Value: { data, fetchedAt }
 */
interface CacheEntry {
  data: string;
  fetchedAt: number;
}

const RSS_CACHE = new Map<string, CacheEntry>();

/**
 * Fetch RSS feed with caching.
 *
 * Caches the raw XML response to avoid hitting the same feed multiple times.
 * Cache is time-based: if data is older than cacheTTL, refetch.
 *
 * @param url - RSS feed URL
 * @param options - Fetch options
 * @param cacheTTL - Cache time-to-live in milliseconds (default: 5 min)
 * @param retryOptions - Retry configuration
 * @returns Raw XML text
 */
export async function fetchRssWithCache(
  url: string,
  options: RequestInit = {},
  cacheTTL: number = 5 * 60 * 1000, // 5 minutes
  retryOptions: RetryOptions = {}
): Promise<string> {
  const now = Date.now();

  // Check cache
  const cached = RSS_CACHE.get(url);
  if (cached && now - cached.fetchedAt < cacheTTL) {
    console.log(`[fetchRssWithCache] Cache hit for ${url} (age: ${Math.round((now - cached.fetchedAt) / 1000)}s)`);
    return cached.data;
  }

  // Cache miss or expired: fetch fresh data
  console.log(`[fetchRssWithCache] Cache miss for ${url}, fetching...`);
  const response = await fetchWithRetry(url, options, retryOptions);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch RSS from ${url}: ${response.status} ${response.statusText}`
    );
  }

  const xml = await response.text();

  // Store in cache
  RSS_CACHE.set(url, {
    data: xml,
    fetchedAt: now,
  });

  return xml;
}

/**
 * Clear the RSS cache (useful for testing or manual refresh).
 */
export function clearRssCache(): void {
  RSS_CACHE.clear();
  console.log("[fetchRssWithCache] Cache cleared");
}

/**
 * Get cache statistics.
 */
export function getRssCacheStats(): {
  size: number;
  entries: Array<{ url: string; age: number }>;
} {
  const now = Date.now();
  return {
    size: RSS_CACHE.size,
    entries: Array.from(RSS_CACHE.entries()).map(([url, entry]) => ({
      url,
      age: Math.round((now - entry.fetchedAt) / 1000), // seconds
    })),
  };
}
