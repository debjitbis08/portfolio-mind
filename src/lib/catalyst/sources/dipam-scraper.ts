/**
 * DIPAM (Department of Investment and Public Asset Management) Scraper
 *
 * Official source for PSU disinvestment news.
 * Critical for public sector bank and PSU catalyst detection.
 *
 * Source: https://dipam.gov.in/whatsnewlist
 */

import { load } from "cheerio";
import type { NewsItem } from "../types";
import { fetchWithRetry } from "./fetch-utils";

const DIPAM_WHATS_NEW_URL = "https://dipam.gov.in/whatsnewlist";

/**
 * Fetch latest news from DIPAM website.
 *
 * Scrapes the "What's New" section which contains:
 * - Disinvestment announcements
 * - PSU strategic sale updates
 * - Government shareholding changes
 *
 * @param maxResults - Maximum number of items to return
 * @param hoursAgo - Filter items from last N hours (best effort)
 * @returns Array of news items
 */
export async function fetchDipamNews(
  maxResults: number = 20,
  hoursAgo: number = 48 // DIPAM updates infrequently, check last 48h
): Promise<NewsItem[]> {
  try {
    const response = await fetchWithRetry(
      DIPAM_WHATS_NEW_URL,
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
        `[DIPAM] Failed to fetch: ${response.status} ${response.statusText}`
      );
      return [];
    }

    const html = await response.text();
    const $ = load(html);

    const newsItems: NewsItem[] = [];

    // DIPAM lists news in table format or list items
    // We'll try multiple selectors to be robust
    const selectors = [
      ".view-content .views-row", // Common Drupal structure
      ".item-list ul li", // List structure
      "table.views-table tbody tr", // Table structure
      ".whatsnew-item", // Custom class (if exists)
    ];

    for (const selector of selectors) {
      const items = $(selector);

      if (items.length > 0) {
        items.each((_, element) => {
          if (newsItems.length >= maxResults) return false;

          const $item = $(element);

          // Extract title (try multiple patterns)
          let title =
            $item.find("a").first().text().trim() ||
            $item.find(".views-field-title").text().trim() ||
            $item.find("td").first().text().trim();

          // Extract link
          let link = $item.find("a").first().attr("href") || "";
          if (link && !link.startsWith("http")) {
            link = `https://dipam.gov.in${link}`;
          }

          // Extract date (DIPAM often shows dates like "05-Jan-2026")
          let dateText =
            $item.find(".views-field-field-event-date").text().trim() ||
            $item.find(".date").text().trim() ||
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
              source: "DIPAM (Govt of India)",
              sourceId: "dipam-scraper",
              sourcePriority: 0, // Level 0: Official government source
            });
          }
        });

        // If we found items with this selector, stop trying others
        if (newsItems.length > 0) break;
      }
    }

    // If no items found with selectors, try fallback generic scraping
    if (newsItems.length === 0) {
      $("a").each((_, element) => {
        if (newsItems.length >= maxResults) return false;

        const $link = $(element);
        const href = $link.attr("href");
        const text = $link.text().trim();

        // Look for PDF or announcement links
        if (
          href &&
          text.length > 10 &&
          (href.includes("upload") ||
            href.includes(".pdf") ||
            text.toLowerCase().includes("disinvest"))
        ) {
          const fullLink = href.startsWith("http")
            ? href
            : `https://dipam.gov.in${href}`;

          newsItems.push({
            title: text,
            link: fullLink,
            pubDate: new Date().toISOString(),
            source: "DIPAM (Govt of India)",
            sourceId: "dipam-scraper",
            sourcePriority: 0,
          });
        }
      });
    }

    console.log(
      `[DIPAM] Fetched ${newsItems.length} items from whatsnewlist`
    );
    return newsItems;
  } catch (error) {
    console.error("[DIPAM] Fetch error:", error);
    return [];
  }
}
