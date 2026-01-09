/**
 * Watchlist-Based BSE Announcement Tracker
 *
 * Monitors BSE corporate announcements for companies in your watchlist and holdings.
 * This enables targeted alerts for portfolio-relevant news.
 */

import { db } from "../db";
import { watchlist, transactions, bseNseMapping } from "../db/schema";
import { eq, sql } from "drizzle-orm";
import { fetchBseAnnouncementsByScript } from "./sources/bse-api";
import { mapNseToBse } from "./bse-nse-mapper";
import type { NewsItem } from "./types";

/**
 * Get all NSE symbols from watchlist
 */
export async function getWatchlistSymbols(): Promise<string[]> {
  try {
    const results = await db
      .select({ symbol: watchlist.symbol })
      .from(watchlist);

    return results.map((r) => r.symbol);
  } catch (error) {
    console.error("[WatchlistTracker] Error fetching watchlist:", error);
    return [];
  }
}

/**
 * Get all NSE symbols from portfolio holdings
 */
export async function getHoldingSymbols(): Promise<string[]> {
  try {
    // Get symbols with positive quantity (holdings)
    const results = await db
      .select({
        symbol: transactions.symbol,
        totalQty: sql<number>`SUM(CASE WHEN ${transactions.type} = 'BUY' OR ${transactions.type} = 'OPENING_BALANCE' THEN ${transactions.quantity} ELSE -${transactions.quantity} END)`,
      })
      .from(transactions)
      .groupBy(transactions.symbol)
      .having(
        sql`SUM(CASE WHEN ${transactions.type} = 'BUY' OR ${transactions.type} = 'OPENING_BALANCE' THEN ${transactions.quantity} ELSE -${transactions.quantity} END) > 0`
      );

    return results.map((r) => r.symbol);
  } catch (error) {
    console.error("[WatchlistTracker] Error fetching holdings:", error);
    return [];
  }
}

/**
 * Get combined watchlist + holdings (deduplicated)
 */
export async function getMonitoredSymbols(): Promise<string[]> {
  const [watchlistSymbols, holdingSymbols] = await Promise.all([
    getWatchlistSymbols(),
    getHoldingSymbols(),
  ]);

  // Deduplicate
  const allSymbols = Array.from(new Set([...watchlistSymbols, ...holdingSymbols]));

  console.log(
    `[WatchlistTracker] Monitoring ${allSymbols.length} symbols (${watchlistSymbols.length} watchlist + ${holdingSymbols.length} holdings)`
  );

  return allSymbols;
}

/**
 * Get BSE scrip codes for monitored symbols
 */
export async function getMonitoredBseCodes(): Promise<
  Array<{ bseCode: string; nseSymbol: string; companyName: string }>
> {
  const nseSymbols = await getMonitoredSymbols();

  const mappings: Array<{
    bseCode: string;
    nseSymbol: string;
    companyName: string;
  }> = [];

  for (const nseSymbol of nseSymbols) {
    const bseCode = await mapNseToBse(nseSymbol);
    if (bseCode) {
      // Get company name from mapping
      const result = await db
        .select({ companyName: bseNseMapping.companyName })
        .from(bseNseMapping)
        .where(eq(bseNseMapping.bseScripCode, bseCode))
        .limit(1);

      mappings.push({
        bseCode,
        nseSymbol,
        companyName: result[0]?.companyName || nseSymbol,
      });
    }
  }

  console.log(
    `[WatchlistTracker] Found ${mappings.length} BSE mappings for ${nseSymbols.length} monitored symbols`
  );

  return mappings;
}

/**
 * Fetch BSE announcements for all monitored companies
 *
 * @param hoursAgo - Fetch announcements from last N hours
 * @returns Array of news items with NSE symbol enrichment
 */
export async function fetchWatchlistAnnouncements(
  hoursAgo: number = 24
): Promise<NewsItem[]> {
  console.log(
    `[WatchlistTracker] Fetching BSE announcements for watchlist/holdings (last ${hoursAgo}h)`
  );

  const monitored = await getMonitoredBseCodes();

  if (monitored.length === 0) {
    console.log(
      "[WatchlistTracker] No BSE mappings found for monitored symbols"
    );
    return [];
  }

  // Fetch announcements for each company in parallel
  const fetchPromises = monitored.map(async (company) => {
    try {
      const announcements = await fetchBseAnnouncementsByScript(
        company.bseCode,
        hoursAgo
      );

      // Enrich with NSE symbol for correlation
      return announcements.map((announcement) => ({
        ...announcement,
        // Add NSE symbol to source for easier correlation
        source: `${announcement.source} [${company.nseSymbol}]`,
        // Store NSE symbol in a custom field (extend NewsItem type if needed)
        // For now, add it to the title
        title: `[${company.nseSymbol}] ${announcement.title}`,
      }));
    } catch (error) {
      console.error(
        `[WatchlistTracker] Error fetching for ${company.nseSymbol} (BSE: ${company.bseCode}):`,
        error
      );
      return [];
    }
  });

  const results = await Promise.all(fetchPromises);
  const allAnnouncements = results.flat();

  console.log(
    `[WatchlistTracker] Fetched ${allAnnouncements.length} announcements for ${monitored.length} companies`
  );

  return allAnnouncements;
}

/**
 * Fetch announcements for a specific NSE symbol
 *
 * @param nseSymbol - NSE symbol (e.g., "RELIANCE")
 * @param hoursAgo - Fetch announcements from last N hours
 * @returns Array of news items
 */
export async function fetchAnnouncementsForSymbol(
  nseSymbol: string,
  hoursAgo: number = 24
): Promise<NewsItem[]> {
  console.log(
    `[WatchlistTracker] Fetching BSE announcements for ${nseSymbol} (last ${hoursAgo}h)`
  );

  const bseCode = await mapNseToBse(nseSymbol);

  if (!bseCode) {
    console.warn(
      `[WatchlistTracker] No BSE mapping found for ${nseSymbol}. Add to bse_nse_mapping table.`
    );
    return [];
  }

  try {
    const announcements = await fetchBseAnnouncementsByScript(bseCode, hoursAgo);

    console.log(
      `[WatchlistTracker] Found ${announcements.length} announcements for ${nseSymbol}`
    );

    return announcements;
  } catch (error) {
    console.error(
      `[WatchlistTracker] Error fetching for ${nseSymbol} (BSE: ${bseCode}):`,
      error
    );
    return [];
  }
}

/**
 * Get announcement summary for monitored companies
 *
 * Useful for dashboards/reports to show recent activity
 */
export async function getAnnouncementSummary(hoursAgo: number = 24): Promise<{
  totalAnnouncements: number;
  companiesWithAnnouncements: number;
  totalMonitored: number;
  announcements: Array<{
    nseSymbol: string;
    companyName: string;
    count: number;
    latestTitle: string;
    latestDate: string;
  }>;
}> {
  const monitored = await getMonitoredBseCodes();
  const totalMonitored = monitored.length;

  const summaries = await Promise.all(
    monitored.map(async (company) => {
      const announcements = await fetchBseAnnouncementsByScript(
        company.bseCode,
        hoursAgo
      );

      if (announcements.length === 0) return null;

      return {
        nseSymbol: company.nseSymbol,
        companyName: company.companyName,
        count: announcements.length,
        latestTitle: announcements[0]?.title || "",
        latestDate: announcements[0]?.pubDate || "",
      };
    })
  );

  const validSummaries = summaries.filter((s) => s !== null) as Array<{
    nseSymbol: string;
    companyName: string;
    count: number;
    latestTitle: string;
    latestDate: string;
  }>;

  const totalAnnouncements = validSummaries.reduce(
    (sum, s) => sum + s.count,
    0
  );

  console.log(
    `[WatchlistTracker] Summary: ${totalAnnouncements} announcements for ${validSummaries.length}/${totalMonitored} companies`
  );

  return {
    totalAnnouncements,
    companiesWithAnnouncements: validSummaries.length,
    totalMonitored,
    announcements: validSummaries.sort((a, b) => b.count - a.count), // Sort by count descending
  };
}
