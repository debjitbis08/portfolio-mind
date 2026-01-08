/**
 * News Monitor - Google News RSS Fetcher for Catalyst Detection
 *
 * Fetches recent news from Google News RSS feeds for monitored keywords.
 * Implements deduplication via the processed_articles table.
 */

import { XMLParser } from "fast-xml-parser";
import { db } from "../db";
import { processedArticles, catalystWatchlist } from "../db/schema";
import { eq, and, desc } from "drizzle-orm";
import type { NewsItem, CatalystAsset } from "./types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

// Google News RSS base URL (no geo filter for global coverage)
const GOOGLE_NEWS_RSS_BASE = "https://news.google.com/rss/search";

/**
 * Build Google News RSS URL for a keyword.
 * Uses 'when:2h' to get articles from last 2 hours.
 */
function buildRssUrl(keyword: string, hoursAgo: number = 2): string {
  const query = encodeURIComponent(`${keyword} when:${hoursAgo}h`);
  return `${GOOGLE_NEWS_RSS_BASE}?q=${query}&hl=en-US&gl=US&ceid=US:en`;
}

/**
 * Parse RSS item to NewsItem format.
 */
function parseRssItem(item: any): NewsItem {
  // Extract source from title (Google News format: "Title - Source")
  const titleParts = (item.title || "").split(" - ");
  const source = titleParts.length > 1 ? titleParts.pop() : "Unknown";
  const title = titleParts.join(" - ");

  return {
    title: title,
    link: item.link || "",
    pubDate: item.pubDate || new Date().toISOString(),
    source: source || "Unknown",
  };
}

/**
 * Check if an article has already been processed.
 */
export async function isAlreadyProcessed(articleUrl: string): Promise<boolean> {
  const existing = await db
    .select({ id: processedArticles.id })
    .from(processedArticles)
    .where(eq(processedArticles.articleUrl, articleUrl))
    .limit(1);

  return existing.length > 0;
}

/**
 * Mark an article as processed with its analysis result.
 */
export async function markAsProcessed(
  article: NewsItem,
  keyword: string,
  isCatalyst: boolean,
  analysisJson?: string
): Promise<void> {
  await db.insert(processedArticles).values({
    articleUrl: article.link,
    articleTitle: article.title,
    keyword,
    isCatalyst,
    analysisJson,
  });
}

/**
 * Fetch news from Google News RSS for a specific keyword.
 * Returns only new (unprocessed) articles.
 *
 * @param keyword - Search keyword (e.g., "Copper", "OPEC")
 * @param maxResults - Maximum number of new articles to return
 * @param hoursAgo - How far back to search (default: 2 hours)
 */
export async function fetchCatalystNews(
  keyword: string,
  maxResults: number = 5,
  hoursAgo: number = 2
): Promise<NewsItem[]> {
  const url = buildRssUrl(keyword, hoursAgo);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      console.error(
        `[NewsMonitor] Failed to fetch RSS for "${keyword}": ${response.status}`
      );
      return [];
    }

    const xml = await response.text();
    const parsed = parser.parse(xml);

    const channel = parsed?.rss?.channel;
    if (!channel || !channel.item) {
      return [];
    }

    // Normalize to array (single item comes as object)
    const items = Array.isArray(channel.item) ? channel.item : [channel.item];

    // Filter out already processed articles
    const newItems: NewsItem[] = [];
    for (const item of items) {
      if (newItems.length >= maxResults) break;

      const newsItem = parseRssItem(item);
      if (!newsItem.link) continue;

      const processed = await isAlreadyProcessed(newsItem.link);
      if (!processed) {
        newItems.push(newsItem);
      }
    }

    return newItems;
  } catch (error) {
    console.error(`[NewsMonitor] Error fetching news for "${keyword}":`, error);
    return [];
  }
}

/**
 * Get all enabled assets from the watchlist.
 */
export async function getEnabledAssets(): Promise<CatalystAsset[]> {
  const rows = await db
    .select()
    .from(catalystWatchlist)
    .where(eq(catalystWatchlist.enabled, true));

  return rows.map((row) => ({
    id: row.id,
    keyword: row.keyword,
    ticker: row.ticker,
    assetType: row.assetType as CatalystAsset["assetType"],
    relatedTickers: row.relatedTickers?.split(",").map((t) => t.trim()),
    globalValidationTicker: row.globalValidationTicker || undefined,
    notes: row.notes || undefined,
    enabled: row.enabled ?? true,
  }));
}

/**
 * Get unique keywords from watchlist (for batch fetching).
 * One keyword may map to multiple tickers.
 */
export async function getUniqueKeywords(): Promise<string[]> {
  const rows = await db
    .select({ keyword: catalystWatchlist.keyword })
    .from(catalystWatchlist)
    .where(eq(catalystWatchlist.enabled, true));

  const unique = new Set(rows.map((r) => r.keyword));
  return Array.from(unique);
}

/**
 * Get assets for a specific keyword.
 */
export async function getAssetsForKeyword(
  keyword: string
): Promise<CatalystAsset[]> {
  const rows = await db
    .select()
    .from(catalystWatchlist)
    .where(
      and(
        eq(catalystWatchlist.keyword, keyword),
        eq(catalystWatchlist.enabled, true)
      )
    );

  return rows.map((row) => ({
    id: row.id,
    keyword: row.keyword,
    ticker: row.ticker,
    assetType: row.assetType as CatalystAsset["assetType"],
    relatedTickers: row.relatedTickers?.split(",").map((t) => t.trim()),
    globalValidationTicker: row.globalValidationTicker || undefined,
    notes: row.notes || undefined,
    enabled: row.enabled ?? true,
  }));
}

/**
 * Get recently processed articles for a keyword (for debugging).
 */
export async function getRecentProcessedArticles(
  keyword: string,
  limit: number = 10
) {
  return db
    .select()
    .from(processedArticles)
    .where(eq(processedArticles.keyword, keyword))
    .orderBy(desc(processedArticles.processedAt))
    .limit(limit);
}
