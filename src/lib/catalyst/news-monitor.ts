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
import { fetchArticleContent } from "../scrapers/article-content";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

// Google News RSS base URL (no geo filter for global coverage)
const GOOGLE_NEWS_RSS_BASE = "https://news.google.com/rss/search";
const DEFAULT_CONTENT_FETCH_LIMIT = 20;

// ============================================================================
// India-Focused News Sources
// ============================================================================

/**
 * Google News India Business category RSS feed.
 * This is the main business news section - covers ALL business news.
 */
const GOOGLE_NEWS_INDIA_BUSINESS =
  "https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pKVGlnQVAB?hl=en-IN&gl=IN&ceid=IN:en";

/**
 * Direct RSS feeds from major Indian financial news sources.
 * These provide higher quality, curated financial news.
 */
const INDIA_NEWS_RSS_FEEDS = [
  {
    url: GOOGLE_NEWS_INDIA_BUSINESS,
    source: "Google News India Business",
  },
  {
    url: "https://www.moneycontrol.com/rss/MCtopnews.xml",
    source: "MoneyControl",
  },
  {
    url: "https://economictimes.indiatimes.com/rssfeedstopstories.cms",
    source: "Economic Times",
  },
  {
    url: "https://www.livemint.com/rss/markets",
    source: "Livemint",
  },
];

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
 * Enrich a subset of news items with full content (HTML or PDF).
 */
export async function enrichNewsItemsWithContent(
  items: NewsItem[],
  maxItems: number = DEFAULT_CONTENT_FETCH_LIMIT
): Promise<NewsItem[]> {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const enriched: NewsItem[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (i < maxItems && item.link) {
      const result = await fetchArticleContent(item.link, item.source, {
        geminiApiKey,
      });
      if (result) {
        enriched.push({
          ...item,
          content: result.content,
          contentType: result.contentType,
          contentUrl: result.sourceUrl,
        });
        continue;
      }
    }

    enriched.push(item);
  }

  return enriched;
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
 *
 * Uses INSERT OR REPLACE to handle duplicate URLs gracefully.
 * This can happen when:
 * - Same article appears in multiple RSS feeds
 * - Same keyword is scanned multiple times in parallel
 * - Article URL is reprocessed after a restart
 */
export async function markAsProcessed(
  article: NewsItem,
  keyword: string,
  isCatalyst: boolean,
  analysisJson?: string
): Promise<void> {
  try {
    await db.insert(processedArticles).values({
      articleUrl: article.link,
      articleTitle: article.title,
      keyword,
      isCatalyst,
      analysisJson,
      sourceId: article.sourceId,
      sourcePriority: article.sourcePriority,
    }).onConflictDoUpdate({
      target: processedArticles.articleUrl,
      set: {
        // Update with latest analysis if reprocessed
        keyword,
        isCatalyst,
        analysisJson,
        sourceId: article.sourceId,
        sourcePriority: article.sourcePriority,
        processedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    // Log but don't throw - article is already processed
    console.warn(
      `[NewsMonitor] Failed to mark article as processed (already exists): ${article.link}`,
      error
    );
  }
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
  hoursAgo: number = 2,
  includeContent: boolean = true
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

    if (!includeContent || newItems.length === 0) {
      return newItems;
    }

    return enrichNewsItemsWithContent(newItems, maxResults);
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

// ============================================================================
// India-Focused News Fetching
// ============================================================================

/**
 * Fetch news from a direct RSS feed (not Google News).
 */
async function fetchFromRssFeed(
  feedUrl: string,
  sourceName: string,
  maxResults: number = 10,
  hoursAgo: number = 4
): Promise<NewsItem[]> {
  try {
    const response = await fetch(feedUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      console.error(
        `[NewsMonitor] Failed to fetch RSS from ${sourceName}: ${response.status}`
      );
      return [];
    }

    const xml = await response.text();
    const parsed = parser.parse(xml);

    const channel = parsed?.rss?.channel;
    if (!channel || !channel.item) {
      return [];
    }

    const items = Array.isArray(channel.item) ? channel.item : [channel.item];
    const cutoffTime = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);

    const newItems: NewsItem[] = [];
    for (const item of items) {
      if (newItems.length >= maxResults) break;

      const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
      if (pubDate < cutoffTime) continue;

      const newsItem: NewsItem = {
        title: item.title || "",
        link: item.link || "",
        pubDate: pubDate.toISOString(),
        source: sourceName,
      };

      if (!newsItem.link) continue;

      const processed = await isAlreadyProcessed(newsItem.link);
      if (!processed) {
        newItems.push(newsItem);
      }
    }

    return newItems;
  } catch (error) {
    console.error(`[NewsMonitor] Error fetching ${sourceName}:`, error);
    return [];
  }
}

/**
 * Fetch broad Indian market news from multiple sources.
 * This is the primary source for India-focused catalyst discovery.
 *
 * Sources:
 * 1. Google News with India-focused queries
 * 2. Direct RSS feeds from MoneyControl, ET, Livemint
 *
 * @param maxPerSource - Max articles per individual source
 * @param hoursAgo - How far back to search
 */
export async function fetchIndianMarketNews(
  maxPerSource: number = 20,
  hoursAgo: number = 4,
  includeContent: boolean = true
): Promise<NewsItem[]> {
  console.log("\n📰 Fetching broad Indian market news...");

  const allNews: NewsItem[] = [];
  const seenUrls = new Set<string>();

  // Helper to dedupe
  const addIfNew = (items: NewsItem[]) => {
    for (const item of items) {
      if (!seenUrls.has(item.link)) {
        seenUrls.add(item.link);
        allNews.push(item);
      }
    }
  };

  // Fetch from RSS feeds (includes Google News India Business category)
  for (const feed of INDIA_NEWS_RSS_FEEDS) {
    try {
      const news = await fetchFromRssFeed(
        feed.url,
        feed.source,
        maxPerSource,
        hoursAgo
      );
      addIfNew(news);
      console.log(`   [${feed.source}]: ${news.length} articles`);
    } catch (e) {
      console.error(`   [${feed.source}] Error:`, e);
    }
  }

  console.log(`   📊 Total unique articles: ${allNews.length}`);

  if (!includeContent || allNews.length === 0) {
    return allNews;
  }

  return enrichNewsItemsWithContent(
    allNews,
    Math.min(DEFAULT_CONTENT_FETCH_LIMIT, allNews.length)
  );
}
