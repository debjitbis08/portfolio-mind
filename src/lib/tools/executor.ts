/**
 * Tool Executor
 *
 * Wrapper that handles:
 * - Rate limiting
 * - Error handling with retries
 * - Response caching (shared Supabase cache for multi-user)
 * - Logging
 */

import { getTool, getToolSource, type ToolResponse } from "./registry";
import { rateLimiter } from "./rate-limiter";
import { getCached, setCache } from "./cache";

// Simple in-memory cache for request deduplication within a single cycle
// (prevents same tool being called twice in parallel)
const requestCache: Map<string, { response: ToolResponse; timestamp: number }> =
  new Map();
const INMEMORY_CACHE_TTL_MS = 30 * 1000; // 30 seconds for in-cycle dedup

/**
 * Execute a tool by name with the given arguments
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const startTime = Date.now();

  // Get tool registration
  const tool = getTool(name);
  if (!tool) {
    console.error(`[Tools] Unknown tool: ${name}`);
    return {
      success: false,
      error: {
        code: "UNKNOWN",
        message: `Unknown tool: ${name}`,
        retryable: false,
      },
    };
  }

  // Check in-memory cache first (for same-cycle deduplication)
  const cacheKey = `${name}:${JSON.stringify(args)}`;
  const inMemoryCached = requestCache.get(cacheKey);
  if (
    inMemoryCached &&
    Date.now() - inMemoryCached.timestamp < INMEMORY_CACHE_TTL_MS
  ) {
    console.log(`[Tools] ${name}: in-memory cache hit`);
    return {
      ...inMemoryCached.response,
      meta: {
        ...inMemoryCached.response.meta,
        from_cache: true,
      },
    };
  }

  // Check shared Supabase cache (multi-user)
  const source = getToolSource(name) || "internal";
  try {
    const cached = await getCached(source, args);
    if (cached.hit && cached.data) {
      console.log(
        `[Tools] ${name}: shared cache hit (${cached.age_hours}h old)`
      );
      const response = cached.data as ToolResponse;
      return {
        ...response,
        meta: {
          ...response.meta,
          from_cache: true,
          cache_age_hours: cached.age_hours,
        },
      };
    }
  } catch (err) {
    // Cache miss or error - continue to execute
    console.log(`[Tools] ${name}: cache miss, executing...`);
  }

  // Acquire rate limit slot
  console.log(`[Tools] ${name}: acquiring rate limit for ${source}...`);

  try {
    const waitTime = await rateLimiter.acquire(source);
    if (waitTime > 0) {
      console.log(`[Tools] ${name}: waited ${Math.round(waitTime / 1000)}s`);
    }
  } catch (error) {
    console.error(`[Tools] ${name}: rate limiter error`, error);
    // Continue anyway - don't block on rate limiter errors
  }

  // Execute the tool
  console.log(`[Tools] ${name}: executing with args:`, args);

  try {
    const response = await tool.execute(args);
    const duration = Date.now() - startTime;

    // Log result
    if (response.success) {
      console.log(`[Tools] ${name}: success (${duration}ms)`);
    } else {
      console.warn(
        `[Tools] ${name}: failed - ${response.error?.code} (${duration}ms)`
      );
    }

    // Cache successful responses
    if (response.success) {
      // In-memory cache for same-cycle dedup
      requestCache.set(cacheKey, { response, timestamp: Date.now() });

      // Shared Supabase cache (fire and forget)
      setCache(source, args, response).catch(() => {});
    }

    return response;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[Tools] ${name}: exception (${duration}ms)`, error);

    // Determine error type
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    const isTimeout =
      errorMessage.includes("timeout") || errorMessage.includes("ETIMEDOUT");
    const isRateLimit =
      errorMessage.includes("429") || errorMessage.includes("rate limit");

    return {
      success: false,
      error: {
        code: isRateLimit ? "RATE_LIMITED" : isTimeout ? "TIMEOUT" : "UNKNOWN",
        message: errorMessage,
        retryable: isTimeout || isRateLimit,
      },
    };
  }
}

/**
 * Execute a tool with automatic retry for retryable errors
 */
export async function executeToolWithRetry(
  name: string,
  args: Record<string, unknown>,
  maxRetries: number = 1
): Promise<ToolResponse> {
  let lastResponse: ToolResponse;
  let attempts = 0;

  while (attempts <= maxRetries) {
    lastResponse = await executeTool(name, args);

    if (lastResponse.success || !lastResponse.error?.retryable) {
      return lastResponse;
    }

    attempts++;
    if (attempts <= maxRetries) {
      console.log(
        `[Tools] ${name}: retry ${attempts}/${maxRetries} after ${lastResponse.error.code}`
      );
      // Wait before retry (exponential backoff)
      await new Promise((resolve) =>
        setTimeout(resolve, 1000 * Math.pow(2, attempts))
      );
    }
  }

  return lastResponse!;
}

/**
 * Clear the request cache (useful between cycles)
 */
export function clearRequestCache() {
  requestCache.clear();
  console.log("[Tools] Request cache cleared");
}

/**
 * Get cache stats for debugging
 */
export function getCacheStats(): { size: number; entries: string[] } {
  return {
    size: requestCache.size,
    entries: Array.from(requestCache.keys()),
  };
}
