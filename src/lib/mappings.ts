/**
 * Stock Symbol Mappings Utility
 *
 * Handles mapping between platform-specific symbols (Groww, ICICI)
 * and standard trading symbols (NSE/BSE).
 */

import { db, schema } from "./db";
import { eq } from "drizzle-orm";

/**
 * Built-in mappings shared with all users.
 * These are platform-specific codes that need translation.
 */
export const BUILT_IN_MAPPINGS: Record<string, string> = {
  // Groww/General mappings
  GODAWARIP: "GPIL",

  // ICICI Direct mappings
  RELIND: "RELIANCE",
  BHADYN: "BDL",
  FAGBEA: "SCHAEFFLER",
  HINAER: "HAL",
  HONAUT: "HONAUT",
  COSFIL: "COSMOFIRST",
  POLI: "POLYCAB",
  RATMET: "RATNAMANI",
  PENIND: "PENIND",
  SBILIF: "SBILIFE",
  SRIPIP: "SRIKALAHASTHI",
  UNIPLY: "UNIPLY",
  CDSL: "CDSL",
  HUDCO: "HUDCO",
  DANISH: "DANISH-SM",
};

// Cache for merged mappings
let mappingsCache: Record<string, string> | null = null;
let lastFetchTime = 0;
const CACHE_TTL = 60000; // 1 minute

/**
 * Get all current symbol mappings (built-in + user).
 * Call once, then use the returned object for multiple lookups.
 */
export async function getSymbolMappings(): Promise<Record<string, string>> {
  const now = Date.now();
  if (mappingsCache && now - lastFetchTime < CACHE_TTL) {
    return mappingsCache;
  }

  try {
    const settings = await db
      .select({ symbolMappings: schema.settings.symbolMappings })
      .from(schema.settings)
      .where(eq(schema.settings.id, 1))
      .limit(1);

    let userMappings: Record<string, string> = {};
    const raw = settings[0]?.symbolMappings;
    if (raw) {
      try {
        userMappings = JSON.parse(raw);
      } catch {
        // ignore parse errors
      }
    }

    // User mappings override built-in
    mappingsCache = { ...BUILT_IN_MAPPINGS, ...userMappings };
    lastFetchTime = now;
    return mappingsCache;
  } catch {
    return BUILT_IN_MAPPINGS;
  }
}

/**
 * Clear the internal cache (call after saving new mappings)
 */
export function clearMappingsCache() {
  mappingsCache = null;
  lastFetchTime = 0;
}
