/**
 * Rate Limiter
 *
 * Centralized rate limiting for external API calls.
 * Prevents bans from aggressive scraping.
 */

interface RateLimitConfig {
  source: string;
  maxRequests: number;
  windowMs: number; // Time window in milliseconds
  minDelayMs: number; // Minimum delay between requests
}

const LIMITS: Record<string, RateLimitConfig> = {
  screener: {
    source: "screener",
    maxRequests: 1, // Very conservative - 1 per day
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    minDelayMs: 10000,
  },
  valuepickr: {
    source: "valuepickr",
    maxRequests: 12,
    windowMs: 60000, // 1 minute
    minDelayMs: 5000,
  },
  reddit: {
    source: "reddit",
    maxRequests: 30,
    windowMs: 60000,
    minDelayMs: 2000,
  },
  yahoo: {
    source: "yahoo",
    maxRequests: 60,
    windowMs: 60000,
    minDelayMs: 1000,
  },
  news: {
    source: "news",
    maxRequests: 12,
    windowMs: 60000,
    minDelayMs: 5000,
  },
  google_news: {
    source: "google_news",
    maxRequests: 20,
    windowMs: 60000,
    minDelayMs: 3000,
  },
  internal: {
    source: "internal",
    maxRequests: 1000, // No real limit
    windowMs: 60000,
    minDelayMs: 0,
  },
};

class RateLimiter {
  // Track request timestamps per source
  private requests: Map<string, number[]> = new Map();

  // Track last request time for minimum delay enforcement
  private lastRequest: Map<string, number> = new Map();

  /**
   * Acquire a rate limit slot. Blocks until request is allowed.
   * Returns the wait time in ms (0 if no wait was needed).
   */
  async acquire(source: string): Promise<number> {
    const config = LIMITS[source];
    if (!config) {
      console.warn(`[RateLimiter] Unknown source: ${source}, allowing`);
      return 0;
    }

    const now = Date.now();
    let waitTime = 0;

    // Check minimum delay since last request
    const lastReq = this.lastRequest.get(source) || 0;
    const timeSinceLast = now - lastReq;

    if (timeSinceLast < config.minDelayMs) {
      waitTime = config.minDelayMs - timeSinceLast;
    }

    // Check window-based rate limit
    const windowStart = now - config.windowMs;
    const recentRequests = (this.requests.get(source) || []).filter(
      (t) => t > windowStart
    );

    if (recentRequests.length >= config.maxRequests) {
      // Need to wait until oldest request expires
      const oldestInWindow = recentRequests[0];
      const windowWait = oldestInWindow + config.windowMs - now;
      waitTime = Math.max(waitTime, windowWait);
    }

    // Wait if needed
    if (waitTime > 0) {
      console.log(
        `[RateLimiter] ${source}: waiting ${Math.round(waitTime / 1000)}s`
      );
      await this.sleep(waitTime);
    }

    // Record this request
    const updatedNow = Date.now();
    this.lastRequest.set(source, updatedNow);

    const requests = this.requests.get(source) || [];
    requests.push(updatedNow);
    // Clean old entries
    this.requests.set(
      source,
      requests.filter((t) => t > updatedNow - config.windowMs)
    );

    return waitTime;
  }

  /**
   * Check if a request can be made immediately (non-blocking)
   */
  canMakeRequest(source: string): boolean {
    const config = LIMITS[source];
    if (!config) return true;

    const now = Date.now();

    // Check minimum delay
    const lastReq = this.lastRequest.get(source) || 0;
    if (now - lastReq < config.minDelayMs) {
      return false;
    }

    // Check window limit
    const windowStart = now - config.windowMs;
    const recentRequests = (this.requests.get(source) || []).filter(
      (t) => t > windowStart
    );

    return recentRequests.length < config.maxRequests;
  }

  /**
   * Get wait time until next allowed request (in ms)
   */
  getWaitTime(source: string): number {
    const config = LIMITS[source];
    if (!config) return 0;

    const now = Date.now();
    let waitTime = 0;

    // Check minimum delay
    const lastReq = this.lastRequest.get(source) || 0;
    const timeSinceLast = now - lastReq;
    if (timeSinceLast < config.minDelayMs) {
      waitTime = config.minDelayMs - timeSinceLast;
    }

    // Check window limit
    const windowStart = now - config.windowMs;
    const recentRequests = (this.requests.get(source) || []).filter(
      (t) => t > windowStart
    );

    if (recentRequests.length >= config.maxRequests) {
      const oldestInWindow = recentRequests[0];
      const windowWait = oldestInWindow + config.windowMs - now;
      waitTime = Math.max(waitTime, windowWait);
    }

    return waitTime;
  }

  /**
   * Get current status for a source (for debugging/logging)
   */
  getStatus(source: string): {
    requestsInWindow: number;
    maxRequests: number;
    canMakeRequest: boolean;
    waitTimeMs: number;
  } {
    const config = LIMITS[source];
    if (!config) {
      return {
        requestsInWindow: 0,
        maxRequests: 1000,
        canMakeRequest: true,
        waitTimeMs: 0,
      };
    }

    const now = Date.now();
    const windowStart = now - config.windowMs;
    const recentRequests = (this.requests.get(source) || []).filter(
      (t) => t > windowStart
    );

    return {
      requestsInWindow: recentRequests.length,
      maxRequests: config.maxRequests,
      canMakeRequest: this.canMakeRequest(source),
      waitTimeMs: this.getWaitTime(source),
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const rateLimiter = new RateLimiter();
