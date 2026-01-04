/**
 * Resolve a symbol to its underlying commodity if it's an ETF
 * For example: GOLDBEES → GOLD
 */

import { db, schema } from "../db";
import { eq } from "drizzle-orm";

export async function resolveSymbolToCommodity(
  symbol: string
): Promise<string> {
  // Check if this symbol is mapped to a commodity
  const mapping = await db
    .select()
    .from(schema.etfCommodityMappings)
    .where(eq(schema.etfCommodityMappings.symbol, symbol))
    .limit(1);

  if (mapping.length > 0) {
    // Return the commodity type (e.g., "GOLD", "SILVER")
    return mapping[0].commodityType;
  }

  // Not an ETF, return original symbol
  return symbol;
}

/**
 * Get display name for a symbol/commodity
 * For example: GOLD → "Gold", GOLDBEES → "Gold (via Nippon India ETF Gold BeES)"
 */
export async function getSymbolDisplayName(
  symbol: string
): Promise<{ resolved: string; displayName: string; isEtf: boolean }> {
  const mapping = await db
    .select()
    .from(schema.etfCommodityMappings)
    .where(eq(schema.etfCommodityMappings.symbol, symbol))
    .limit(1);

  if (mapping.length > 0) {
    const commodityType = mapping[0].commodityType;
    const etfName = mapping[0].notes || symbol;
    return {
      resolved: commodityType,
      displayName: `${
        commodityType.charAt(0) + commodityType.slice(1).toLowerCase()
      } (via ${etfName})`,
      isEtf: true,
    };
  }

  return {
    resolved: symbol,
    displayName: symbol,
    isEtf: false,
  };
}
