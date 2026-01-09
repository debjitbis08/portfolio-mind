/**
 * PIB (Press Information Bureau) RSS Feed
 *
 * Official source for Indian government press releases and Cabinet decisions.
 * Critical for policy-driven catalysts (PLI schemes, Budget allocations, etc.)
 *
 * Source: https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3&reg=3
 */

import { XMLParser } from "fast-xml-parser";
import type { NewsItem } from "../types";
import { fetchRssWithCache } from "./fetch-utils";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

// PIB RSS Feed URL (All Ministries, English, National)
const PIB_RSS_URL =
  "https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3&reg=3";

/**
 * Fetch news from PIB RSS feed.
 *
 * @param maxResults - Maximum number of articles to return
 * @param hoursAgo - Filter articles from last N hours
 * @returns Array of news items
 */
export async function fetchPibNews(
  maxResults: number = 20,
  hoursAgo: number = 24
): Promise<NewsItem[]> {
  try {
    // Fetch with retry and 10-minute cache
    const xml = await fetchRssWithCache(
      PIB_RSS_URL,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      },
      10 * 60 * 1000, // 10-minute cache (PIB updates infrequently)
      {
        maxRetries: 3,
        initialDelayMs: 2000,
        timeoutMs: 20000, // 20 second timeout
      }
    );
    const parsed = parser.parse(xml);

    const channel = parsed?.rss?.channel;
    if (!channel || !channel.item) {
      console.warn("[PIB-RSS] No items found in feed");
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
        source: "PIB (Govt of India)",
        sourceId: "pib-rss",
        sourcePriority: 0,
      });
    }

    console.log(
      `[PIB-RSS] Fetched ${newsItems.length} articles (last ${hoursAgo}h)`
    );
    return newsItems;
  } catch (error) {
    console.error("[PIB-RSS] Fetch error:", error);
    return [];
  }
}
