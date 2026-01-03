/**
 * Tool Cache Service
 *
 * SQLite-backed cache for tool responses.
 * - All queries share the same cache
 * - Different TTL per source
 * - Automatic expiry handling
 */

import { db, schema } from "../db";
import { eq, gt, lt } from "drizzle-orm";
import crypto from "crypto";

// TTL configuration per source (in seconds)
const SOURCE_TTL: Record<string, number> = {
  valuepickr: 12 * 60 * 60, // 12 hours - thesis doesn't change often
  google_news: 2 * 60 * 60, // 2 hours - news changes frequently
  reddit: 1 * 60 * 60, // 1 hour - sentiment can shift
  yahoo: 30 * 60, // 30 minutes - prices change during market
  internal: 5 * 60, // 5 minutes - internal computations
  screener: 24 * 60 * 60, // 24 hours - already cached in watchlist
};

/**
 * Generate a cache key from source and args
 */
function generateCacheKey(
  source: string,
  args: Record<string, unknown>
): string {
  const argsHash = crypto
    .createHash("md5")
    .update(JSON.stringify(args))
    .digest("hex")
    .substring(0, 12);
  return `${source}:${argsHash}`;
}

/**
 * Get cached response if available and not expired
 */
export async function getCached(
  source: string,
  args: Record<string, unknown>
): Promise<{ hit: boolean; data?: unknown; age_hours?: number }> {
  const cacheKey = generateCacheKey(source, args);
  const now = new Date().toISOString();

  try {
    const entries = await db
      .select()
      .from(schema.toolCache)
      .where(eq(schema.toolCache.cacheKey, cacheKey))
      .limit(1);

    if (entries.length === 0) {
      return { hit: false };
    }

    const entry = entries[0];

    // Check expiry
    if (entry.expiresAt < now) {
      return { hit: false };
    }

    // Update hit count (fire and forget)
    db.update(schema.toolCache)
      .set({ hitCount: (entry.hitCount || 0) + 1 })
      .where(eq(schema.toolCache.id, entry.id))
      .then(() => {});

    const ageMs = Date.now() - new Date(entry.createdAt || now).getTime();
    const ageHours = Math.round((ageMs / (60 * 60 * 1000)) * 10) / 10;

    console.log(
      `[Cache] HIT for ${source}:${Object.values(args)[0]} (${ageHours}h old)`
    );

    return {
      hit: true,
      data: JSON.parse(entry.response),
      age_hours: ageHours,
    };
  } catch (err) {
    console.warn("[Cache] Error fetching cache:", err);
    return { hit: false };
  }
}

/**
 * Store a response in cache
 */
export async function setCache(
  source: string,
  args: Record<string, unknown>,
  response: unknown
): Promise<void> {
  const cacheKey = generateCacheKey(source, args);
  const ttlSeconds = SOURCE_TTL[source] || 60 * 60; // Default 1 hour

  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  try {
    await db
      .insert(schema.toolCache)
      .values({
        cacheKey,
        source,
        queryArgs: JSON.stringify(args),
        response: JSON.stringify(response),
        expiresAt,
        hitCount: 0,
      })
      .onConflictDoUpdate({
        target: schema.toolCache.cacheKey,
        set: {
          response: JSON.stringify(response),
          expiresAt,
          hitCount: 0,
          createdAt: new Date().toISOString(),
        },
      });

    console.log(
      `[Cache] SET for ${source}:${Object.values(args)[0]} (TTL: ${Math.round(
        ttlSeconds / 60
      )}m)`
    );
  } catch (err) {
    console.warn("[Cache] Error setting cache:", err);
  }
}

/**
 * Clean up expired cache entries
 */
export async function cleanupExpired(): Promise<number> {
  try {
    const now = new Date().toISOString();
    await db
      .delete(schema.toolCache)
      .where(lt(schema.toolCache.expiresAt, now));
    console.log("[Cache] Cleaned up expired entries");
    return 0;
  } catch (err) {
    console.error("[Cache] Cleanup exception:", err);
    return 0;
  }
}

/**
 * Get cache stats for monitoring
 */
export async function getCacheStats(): Promise<{
  total_entries: number;
  expired_entries: number;
  by_source: Record<string, number>;
}> {
  try {
    const now = new Date().toISOString();

    const allEntries = await db.select().from(schema.toolCache);
    const validEntries = allEntries.filter((e) => e.expiresAt > now);

    const bySource: Record<string, number> = {};
    for (const entry of validEntries) {
      bySource[entry.source] = (bySource[entry.source] || 0) + 1;
    }

    return {
      total_entries: allEntries.length,
      expired_entries: allEntries.length - validEntries.length,
      by_source: bySource,
    };
  } catch (err) {
    console.error("[Cache] Stats error:", err);
    return { total_entries: 0, expired_entries: 0, by_source: {} };
  }
}
