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

  // Frontier Springs: BSE-only stock (scrip code: 522195, ISIN: INE572D01014)
  // Broker uses FRONTSP, but we normalize to 522195 for Screener compatibility
  // For price fetching, we need to force BOM exchange to avoid wrong prices
  FRONTSP: "522195", // Broker code → canonical BSE scrip code
  KPL: "539997",

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
// ... existing code ...

/**
 * Helper to get the best trading symbol for a given stock name/symbol pair
 * Checks mappings first, then falls back to the provided symbol.
 */
export async function getSymbolForStock(
  name: string,
  symbol: string
): Promise<string> {
  const mappings = await getSymbolMappings();

  // Check if symbol is mapped
  if (mappings[symbol]) {
    return mappings[symbol];
  }

  // Returns the original symbol if no mapping found
  return symbol;
}
