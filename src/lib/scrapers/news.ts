/**
 * Google News Scraper
 *
 * Fetches recent news for a stock using Google News RSS feeds.
 * No authentication required.
 */

import { XMLParser } from "fast-xml-parser";

export interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
}

export interface StockNews {
  query: string;
  items: NewsItem[];
  fetched_at: string;
}

/**
 * Fetch recent news for a stock from Google News
 */
export async function fetchGoogleNews(
  query: string,
  maxResults: number = 5
): Promise<StockNews> {
  // Google News RSS URL for search
  const encodedQuery = encodeURIComponent(`${query} stock India`);
  const rssUrl = `https://news.google.com/rss/search?q=${encodedQuery}&hl=en-IN&gl=IN&ceid=IN:en`;

  console.log(`[GoogleNews] Fetching news for: ${query}`);

  try {
    const response = await fetch(rssUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const xmlText = await response.text();

    // Parse XML
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
    });
    const result = parser.parse(xmlText);

    // Extract news items
    const channel = result?.rss?.channel;
    if (!channel) {
      return {
        query,
        items: [],
        fetched_at: new Date().toISOString(),
      };
    }

    let items = channel.item || [];
    if (!Array.isArray(items)) {
      items = [items];
    }

    const newsItems: NewsItem[] = items
      .slice(0, maxResults)
      .map((item: any) => {
        // Extract source from title (Google News format: "Title - Source")
        const titleParts = (item.title || "").split(" - ");
        const source = titleParts.length > 1 ? titleParts.pop() : "Unknown";
        const title = titleParts.join(" - ");

        return {
          title: title.trim(),
          link: item.link || "",
          pubDate: item.pubDate || "",
          source: source?.trim() || "Unknown",
        };
      });

    console.log(
      `[GoogleNews] Found ${newsItems.length} news items for ${query}`
    );

    return {
      query,
      items: newsItems,
      fetched_at: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`[GoogleNews] Error fetching news for ${query}:`, error);
    return {
      query,
      items: [],
      fetched_at: new Date().toISOString(),
    };
  }
}

/**
 * Get a summary of recent news sentiment
 */
export function summarizeNewsSentiment(news: StockNews): string {
  if (news.items.length === 0) {
    return "No recent news found.";
  }

  const headlines = news.items
    .slice(0, 3)
    .map((item, idx) => `${idx + 1}. "${item.title}" (${item.source})`)
    .join("\n");

  return `Recent headlines:\n${headlines}`;
}
