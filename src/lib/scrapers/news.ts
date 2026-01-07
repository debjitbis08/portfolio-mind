/**
 * Google News Scraper
 *
 * Fetches recent news for a stock using Google News RSS feeds,
 * then attempts to fetch article content (filtering paywalled ones).
 * Uses Gemini 2.5 Flash to summarize news sentiment and key events.
 *
 * No authentication required for RSS feeds.
 */

import { XMLParser } from "fast-xml-parser";
import { GEMINI_API_KEY } from "astro:env/server";

export interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  content?: string; // Article content if fetched
  isPaywalled?: boolean;
}

export interface StockNews {
  query: string;
  items: NewsItem[];
  fetched_at: string;
}

export interface NewsIntel {
  query: string;
  articles_found: number;
  articles_readable: number;
  sentiment_summary: string;
  key_events: string[];
  headlines: {
    title: string;
    source: string;
    date: string;
    url: string;
  }[];
  fetched_at: string;
}

// Known paywall indicators - more specific phrases to avoid false positives
// from site-wide "subscribe" buttons in nav/footer
const PAYWALL_INDICATORS = [
  "subscribe to continue",
  "subscribe to read",
  "subscription required",
  "sign in to read",
  "login to continue reading",
  "premium content",
  "exclusive to subscribers",
  "register to read the full",
  "unlock this article",
  "unlock full article",
  "member-only content",
  "already a subscriber",
  "become a member to read",
  "this content is for subscribers",
  "full article available to",
];

// Known free sources (usually accessible)
const FREE_SOURCES = [
  "moneycontrol",
  "economic times",
  "business standard",
  "livemint",
  "ndtv profit",
  "zeebiz",
  "outlook india",
  "business today",
  "reuters",
  "yahoo finance",
];

/**
 * Extract base64 string from Google News URL
 */
function extractBase64FromGoogleNewsUrl(
  sourceUrl: string
): { status: true; base64Str: string } | { status: false; message: string } {
  try {
    const url = new URL(sourceUrl);
    const pathParts = url.pathname.split("/");

    if (
      url.hostname === "news.google.com" &&
      pathParts.length > 1 &&
      (pathParts[pathParts.length - 2] === "articles" ||
        pathParts[pathParts.length - 2] === "read" ||
        pathParts[pathParts.length - 2] === "rss")
    ) {
      // Handle /rss/articles/ case
      const base64Part = pathParts[pathParts.length - 1];
      // Clean up query params if any
      const cleanBase64 = base64Part.split("?")[0];
      return { status: true, base64Str: cleanBase64 };
    }

    return { status: false, message: "Invalid Google News URL format" };
  } catch (e) {
    return {
      status: false,
      message: `Error extracting base64: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }
}

/**
 * Get signature and timestamp from Google News page for decoding
 */
async function getDecodingParams(
  base64Str: string
): Promise<
  | { status: true; signature: string; timestamp: string; base64Str: string }
  | { status: false; message: string }
> {
  const urls = [
    `https://news.google.com/articles/${base64Str}`,
    `https://news.google.com/rss/articles/${base64Str}`,
  ];

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) continue;

      const html = await response.text();

      // Extract data-n-a-sg (signature) and data-n-a-ts (timestamp) from c-wiz > div[jscontroller]
      const signatureMatch = html.match(/data-n-a-sg="([^"]+)"/);
      const timestampMatch = html.match(/data-n-a-ts="([^"]+)"/);

      if (signatureMatch && timestampMatch) {
        return {
          status: true,
          signature: signatureMatch[1],
          timestamp: timestampMatch[1],
          base64Str,
        };
      }
    } catch (e) {
      // Try next URL
      continue;
    }
  }

  return {
    status: false,
    message: "Failed to fetch decoding params from Google News",
  };
}

/**
 * Decode Google News URL using batchexecute API
 */
async function decodeGoogleNewsUrl(
  signature: string,
  timestamp: string,
  base64Str: string
): Promise<
  { status: true; decodedUrl: string } | { status: false; message: string }
> {
  try {
    const url = "https://news.google.com/_/DotsSplashUi/data/batchexecute";

    const payload = [
      "Fbv4je",
      `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${base64Str}",${timestamp},"${signature}"]`,
    ];

    const body = `f.req=${encodeURIComponent(JSON.stringify([[payload]]))}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
      },
      body,
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { status: false, message: `HTTP ${response.status}` };
    }

    const text = await response.text();

    // Response format: first line is length, second line onwards is the data
    const lines = text.split("\n\n");
    if (lines.length < 2) {
      return { status: false, message: "Invalid response format" };
    }

    // Parse the JSON response
    const parsedData = JSON.parse(lines[1]);
    // The structure is [[["wrb.fr","Fbv4je","[...]",...]]]
    const dataStr = parsedData[0][2];
    const decodedData = JSON.parse(dataStr);
    const decodedUrl = decodedData[1];

    if (!decodedUrl || typeof decodedUrl !== "string") {
      return { status: false, message: "No decoded URL found in response" };
    }

    return { status: true, decodedUrl };
  } catch (e) {
    return {
      status: false,
      message: `Decode error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * Resolve Google News URL to actual article URL
 */
async function resolveGoogleNewsUrl(sourceUrl: string): Promise<string | null> {
  // Step 1: Extract base64 string
  const base64Result = extractBase64FromGoogleNewsUrl(sourceUrl);
  if (!base64Result.status) {
    console.warn(
      `[News] ${(base64Result as { status: false; message: string }).message}`
    );
    return null;
  }

  // Step 2: Get signature and timestamp
  const paramsResult = await getDecodingParams(base64Result.base64Str);
  if (!paramsResult.status) {
    console.warn(
      `[News] ${(paramsResult as { status: false; message: string }).message}`
    );
    return null;
  }

  // Step 3: Decode URL
  const decodeResult = await decodeGoogleNewsUrl(
    paramsResult.signature,
    paramsResult.timestamp,
    paramsResult.base64Str
  );
  if (!decodeResult.status) {
    console.warn(
      `[News] ${(decodeResult as { status: false; message: string }).message}`
    );
    return null;
  }

  return decodeResult.decodedUrl;
}

/**
 * Fetch article content from a URL
 * Returns null if paywalled or inaccessible
 */
async function fetchArticleContent(
  url: string,
  source: string
): Promise<string | null> {
  try {
    let targetUrl = url;

    // Google News uses encoded URLs - decode them to get the actual article
    if (
      url.includes("news.google.com/rss/articles/") ||
      url.includes("news.google.com/articles/")
    ) {
      console.log(`[News] Decoding Google News URL for ${source}...`);
      const resolvedUrl = await resolveGoogleNewsUrl(url);
      if (!resolvedUrl) {
        console.warn(`[News] Failed to decode Google News URL for ${source}`);
        return null;
      }
      targetUrl = resolvedUrl;
      console.log(`[News] Resolved to: ${targetUrl.substring(0, 80)}...`);
    }

    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (!response.ok) {
      console.warn(`[News] Failed to fetch ${targetUrl}: ${response.status}`);
      return null;
    }

    const html = await response.text();

    // Extract main content FIRST (this removes nav, header, footer, etc.)
    const content = extractMainContent(html);

    if (!content || content.length < 200) {
      return null;
    }

    // Check for paywall indicators in the EXTRACTED CONTENT, not raw HTML
    // This avoids false positives from site-wide "subscribe" buttons
    const contentLower = content.toLowerCase();
    for (const indicator of PAYWALL_INDICATORS) {
      if (contentLower.includes(indicator)) {
        console.log(`[News] Skipping paywalled article: ${source}`);
        return null;
      }
    }

    return content;
  } catch (error) {
    console.warn(`[News] Error fetching article from ${source}:`, error);
    return null;
  }
}

/**
 * Simple content extraction from HTML
 */
function extractMainContent(html: string): string {
  // Remove scripts, styles, and other non-content elements
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  // Try to find article body
  const articleMatch = text.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch) {
    text = articleMatch[1];
  }

  // Remove remaining HTML tags
  text = text.replace(/<[^>]+>/g, " ");

  // Decode HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  // Normalize whitespace
  text = text.replace(/\s+/g, " ").trim();

  // Return first 3000 chars (enough for summarization)
  return text.substring(0, 3000);
}

/**
 * Fetch recent news for a stock from Google News
 */
export async function fetchGoogleNews(
  query: string,
  maxResults: number = 5
): Promise<StockNews> {
  const encodedQuery = encodeURIComponent(`${query} stock India`);
  const rssUrl = `https://news.google.com/rss/search?q=${encodedQuery}&hl=en-IN&gl=IN&ceid=IN:en`;

  console.log(`[News] Fetching news for: ${query}`);

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

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
    });
    const result = parser.parse(xmlText);

    const channel = result?.rss?.channel;
    if (!channel) {
      return { query, items: [], fetched_at: new Date().toISOString() };
    }

    let items = channel.item || [];
    if (!Array.isArray(items)) {
      items = [items];
    }

    const newsItems: NewsItem[] = items
      .slice(0, maxResults)
      .map((item: any) => {
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

    console.log(`[News] Found ${newsItems.length} news items for ${query}`);

    return {
      query,
      items: newsItems,
      fetched_at: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`[News] Error fetching news for ${query}:`, error);
    return { query, items: [], fetched_at: new Date().toISOString() };
  }
}

/**
 * Use Gemini 2.5 Flash to summarize news articles
 */
async function summarizeWithLLM(
  query: string,
  articles: { title: string; source: string; content: string }[]
): Promise<{ sentiment_summary: string; key_events: string[] }> {
  if (articles.length === 0) {
    return {
      sentiment_summary: "No readable articles found to analyze.",
      key_events: [],
    };
  }

  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const articlesText = articles
      .map(
        (a, i) =>
          `### Article ${i + 1}: ${a.title} (${a.source})\n\n${a.content}`
      )
      .join("\n\n---\n\n");

    const prompt = `You are analyzing recent news articles about "${query}" (Indian stock).

## Articles

${articlesText}

---

Please provide a COMPREHENSIVE summary. Do NOT skip important details. This is for investment decisions with real money.

1. **SENTIMENT SUMMARY** (2-3 sentences): What is the overall news sentiment? Is news positive, negative, or neutral for the stock? What's the main narrative?

2. **KEY EVENTS** (bullet list, be thorough): List ALL significant events mentioned. Include:
   - Regulatory/government actions (policy changes, approvals, investigations, fines)
   - Corporate actions (acquisitions, demergers, stock splits, buybacks)
   - Financial results and guidance changes
   - Management changes or statements
   - Industry/sector developments
   - Any risks or concerns raised

   List 5-10 key points. Do NOT summarize away important details.

Format your response exactly as:
SENTIMENT:
[Your sentiment summary]

KEY_EVENTS:
- [Event 1]
- [Event 2]
- [Event 3]`;

    console.log("[News] Summarizing with Gemini 2.5 Flash...");

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const text = response.text || "";

    const sentimentMatch = text.match(
      /SENTIMENT:\s*([\s\S]*?)(?=KEY_EVENTS:|$)/i
    );
    const keyEventsMatch = text.match(/KEY_EVENTS:\s*([\s\S]*?)$/i);

    const keyEventsText = keyEventsMatch?.[1]?.trim() || "";
    const keyEvents = keyEventsText
      .split("\n")
      .map((line) => line.replace(/^[-•*]\s*/, "").trim())
      .filter((line) => line.length > 0);

    return {
      sentiment_summary:
        sentimentMatch?.[1]?.trim() || "Unable to determine sentiment",
      key_events: keyEvents,
    };
  } catch (error) {
    console.error("[News] LLM summarization failed:", error);
    return {
      sentiment_summary: "Summarization failed.",
      key_events: [],
    };
  }
}

/**
 * Main entry point: Fetch news, get content, and summarize
 */
export async function getNewsIntel(
  query: string,
  targetReadableArticles: number = 5
): Promise<NewsIntel> {
  // Fetch more articles than needed so we have buffer for failures (404, 403, paywalls)
  const fetchLimit = Math.min(targetReadableArticles * 3, 15);
  const news = await fetchGoogleNews(query, fetchLimit);

  if (news.items.length === 0) {
    return {
      query,
      articles_found: 0,
      articles_readable: 0,
      sentiment_summary: `No recent news found for "${query}".`,
      key_events: [],
      headlines: [],
      fetched_at: new Date().toISOString(),
    };
  }

  // Try to fetch content for articles until we hit target or exhaust sources
  const articlesWithContent: {
    title: string;
    source: string;
    content: string;
  }[] = [];

  for (const item of news.items) {
    // Stop once we have enough readable articles
    if (articlesWithContent.length >= targetReadableArticles) {
      break;
    }

    // Try to fetch content from all sources - paywall detection happens after fetch
    const content = await fetchArticleContent(item.link, item.source);
    if (content) {
      articlesWithContent.push({
        title: item.title,
        source: item.source,
        content,
      });
    }

    // Small delay between fetches
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(
    `[News] Fetched content for ${articlesWithContent.length}/${news.items.length} articles (target: ${targetReadableArticles})`
  );

  // Summarize with LLM (even if we only have headlines)
  let summary: { sentiment_summary: string; key_events: string[] };

  if (articlesWithContent.length > 0) {
    summary = await summarizeWithLLM(query, articlesWithContent);
  } else {
    // Fallback: summarize just headlines
    summary = await summarizeWithLLM(
      query,
      news.items.map((item) => ({
        title: item.title,
        source: item.source,
        content: `Headline: ${item.title}`,
      }))
    );
  }

  return {
    query,
    articles_found: news.items.length,
    articles_readable: articlesWithContent.length,
    sentiment_summary: summary.sentiment_summary,
    key_events: summary.key_events,
    headlines: news.items.map((item) => ({
      title: item.title,
      source: item.source,
      date: item.pubDate,
      url: item.link,
    })),
    fetched_at: news.fetched_at,
  };
}

// Keep old function for backwards compatibility
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
