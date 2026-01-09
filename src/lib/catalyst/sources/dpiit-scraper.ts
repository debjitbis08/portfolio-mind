/**
 * DPIIT (Department for Promotion of Industry and Internal Trade) Scraper
 *
 * Official source for FDI policy, trade restrictions, and manufacturing policy.
 * Critical for sector-wide catalyst detection (e.g., Chinese import curbs).
 *
 * Source: https://www.dpiit.gov.in/whats-new
 */

import { load } from "cheerio";
import type { NewsItem } from "../types";
import { fetchWithRetry } from "./fetch-utils";

const DPIIT_WHATS_NEW_URL = "https://www.dpiit.gov.in/whats-new";

/**
 * Fetch latest news from DPIIT website.
 *
 * Scrapes the "What's New" section which contains:
 * - FDI policy changes
 * - Import/export restrictions
 * - Manufacturing policy updates
 * - Trade notifications
 *
 * @param maxResults - Maximum number of items to return
 * @param hoursAgo - Filter items from last N hours (best effort)
 * @returns Array of news items
 */
export async function fetchDpiitNews(
  maxResults: number = 20,
  hoursAgo: number = 48 // DPIIT updates infrequently
): Promise<NewsItem[]> {
  try {
    const response = await fetchWithRetry(
      DPIIT_WHATS_NEW_URL,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      },
      {
        maxRetries: 3,
        initialDelayMs: 2000,
        timeoutMs: 30000,
      }
    );

    if (!response.ok) {
      console.error(
        `[DPIIT] Failed to fetch: ${response.status} ${response.statusText}`
      );
      return [];
    }

    const html = await response.text();
    const $ = load(html);

    const newsItems: NewsItem[] = [];

    // DPIIT uses various structures, try multiple selectors
    const selectors = [
      ".view-content .views-row", // Drupal structure
      ".content-list li", // List structure
      ".whats-new-item", // Custom class
      "table tbody tr", // Table structure
      ".announcement-item", // Alternative
    ];

    for (const selector of selectors) {
      const items = $(selector);

      if (items.length > 0) {
        items.each((_, element) => {
          if (newsItems.length >= maxResults) return false;

          const $item = $(element);

          // Extract title
          let title =
            $item.find("a").first().text().trim() ||
            $item.find(".title").text().trim() ||
            $item.find("td").first().text().trim();

          // Extract link
          let link = $item.find("a").first().attr("href") || "";
          if (link && !link.startsWith("http")) {
            link = `https://www.dpiit.gov.in${link}`;
          }

          // Extract date if available
          let dateText =
            $item.find(".date").text().trim() ||
            $item.find(".field-content").text().trim() ||
            $item.find("td").eq(1).text().trim();

          // Parse date
          let pubDate: string;
          if (dateText) {
            try {
              const parsed = new Date(dateText);
              pubDate = parsed.toISOString();
            } catch {
              pubDate = new Date().toISOString();
            }
          } else {
            pubDate = new Date().toISOString();
          }

          // Only add if we have both title and link
          if (title && link) {
            newsItems.push({
              title: title,
              link: link,
              pubDate: pubDate,
              source: "DPIIT (Govt of India)",
              sourceId: "dpiit-scraper",
              sourcePriority: 0, // Level 0: Official government source
            });
          }
        });

        if (newsItems.length > 0) break;
      }
    }

    // Fallback: Generic link scraping for PDFs and notifications
    if (newsItems.length === 0) {
      $("a").each((_, element) => {
        if (newsItems.length >= maxResults) return false;

        const $link = $(element);
        const href = $link.attr("href");
        const text = $link.text().trim();

        // Look for PDF links or policy announcements
        if (
          href &&
          text.length > 10 &&
          (href.includes(".pdf") ||
            href.includes("notification") ||
            href.includes("policy") ||
            text.toLowerCase().includes("fdi") ||
            text.toLowerCase().includes("import"))
        ) {
          const fullLink = href.startsWith("http")
            ? href
            : `https://www.dpiit.gov.in${href}`;

          newsItems.push({
            title: text,
            link: fullLink,
            pubDate: new Date().toISOString(),
            source: "DPIIT (Govt of India)",
            sourceId: "dpiit-scraper",
            sourcePriority: 0,
          });
        }
      });
    }

    console.log(`[DPIIT] Fetched ${newsItems.length} items from whats-new`);
    return newsItems;
  } catch (error) {
    console.error("[DPIIT] Fetch error:", error);
    return [];
  }
}
