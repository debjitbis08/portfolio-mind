/**
 * RBI (Reserve Bank of India) RSS Feeds
 *
 * Official source for banking regulations, monetary policy, and RBI actions.
 * Critical for banking sector catalysts (repo rate changes, penalties, etc.)
 *
 * Sources:
 * - Press Releases: https://rbi.org.in/pressreleases_rss.xml
 * - Notifications: https://rbi.org.in/notifications_rss.xml
 */

import { XMLParser } from "fast-xml-parser";
import type { NewsItem } from "../types";
import { fetchRssWithCache } from "./fetch-utils";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

// RBI RSS Feed URLs
const RBI_PRESS_RELEASES_URL = "https://rbi.org.in/pressreleases_rss.xml";
const RBI_NOTIFICATIONS_URL = "https://rbi.org.in/notifications_rss.xml";

/**
 * Fetch news from a single RBI RSS feed.
 */
async function fetchRbiFeed(
  feedUrl: string,
  sourceName: string,
  maxResults: number,
  hoursAgo: number
): Promise<NewsItem[]> {
  try {
    // Fetch with retry and 10-minute cache
    const xml = await fetchRssWithCache(
      feedUrl,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      },
      10 * 60 * 1000, // 10-minute cache (RBI updates infrequently)
      {
        maxRetries: 3,
        initialDelayMs: 2000,
        timeoutMs: 20000, // 20 second timeout
      }
    );
    const parsed = parser.parse(xml);

    const channel = parsed?.rss?.channel;
    if (!channel || !channel.item) {
      console.warn(`[${sourceName}] No items found in feed`);
      return [];
    }

    // Normalize to array
    const items = Array.isArray(channel.item) ? channel.item : [channel.item];

    // Filter by date and convert to NewsItem format
    const cutoffTime = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
    const newsItems: NewsItem[] = [];

    for (const item of items) {
      if (newsItems.length >= maxResults) break;

      const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
      if (pubDate < cutoffTime) continue;

      newsItems.push({
        title: item.title || "Untitled",
        link: item.link || "",
        pubDate: pubDate.toISOString(),
        source: sourceName,
        sourceId: "rbi-rss",
        sourcePriority: 0,
      });
    }

    return newsItems;
  } catch (error) {
    console.error(`[${sourceName}] Fetch error:`, error);
    return [];
  }
}

/**
 * Fetch RBI Press Releases.
 *
 * @param maxResults - Maximum number of articles to return
 * @param hoursAgo - Filter articles from last N hours
 * @returns Array of news items
 */
export async function fetchRbiPressReleases(
  maxResults: number = 10,
  hoursAgo: number = 24
): Promise<NewsItem[]> {
  const items = await fetchRbiFeed(
    RBI_PRESS_RELEASES_URL,
    "RBI Press Release",
    maxResults,
    hoursAgo
  );
  console.log(
    `[RBI-PRESS] Fetched ${items.length} articles (last ${hoursAgo}h)`
  );
  return items;
}

/**
 * Fetch RBI Notifications.
 *
 * @param maxResults - Maximum number of articles to return
 * @param hoursAgo - Filter articles from last N hours
 * @returns Array of news items
 */
export async function fetchRbiNotifications(
  maxResults: number = 10,
  hoursAgo: number = 24
): Promise<NewsItem[]> {
  const items = await fetchRbiFeed(
    RBI_NOTIFICATIONS_URL,
    "RBI Notification",
    maxResults,
    hoursAgo
  );
  console.log(
    `[RBI-NOTIFY] Fetched ${items.length} articles (last ${hoursAgo}h)`
  );
  return items;
}

/**
 * Fetch all RBI news (Press Releases + Notifications).
 *
 * @param maxPerFeed - Maximum number of articles per feed
 * @param hoursAgo - Filter articles from last N hours
 * @returns Combined array of news items
 */
export async function fetchAllRbiNews(
  maxPerFeed: number = 10,
  hoursAgo: number = 24
): Promise<NewsItem[]> {
  const [pressReleases, notifications] = await Promise.all([
    fetchRbiPressReleases(maxPerFeed, hoursAgo),
    fetchRbiNotifications(maxPerFeed, hoursAgo),
  ]);

  const allNews = [...pressReleases, ...notifications];

  // Deduplicate by link
  const seenLinks = new Set<string>();
  const deduped = allNews.filter((item) => {
    if (seenLinks.has(item.link)) return false;
    seenLinks.add(item.link);
    return true;
  });

  console.log(
    `[RBI-ALL] Combined ${deduped.length} unique articles from ${allNews.length} total`
  );
  return deduped;
}
