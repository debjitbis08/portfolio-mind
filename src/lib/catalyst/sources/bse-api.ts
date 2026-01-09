/**
 * BSE Corporate Announcements API
 *
 * Official BSE India API for corporate announcements.
 * This is the "source zero" for Indian stock market news - beats MoneyControl by ~10 minutes!
 *
 * API: https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w
 * Based on: https://github.com/BennyThadikaran/BseIndiaApi
 */

import type { NewsItem } from "../types";
import { fetchWithRetry } from "./fetch-utils";

const BSE_API_BASE = "https://api.bseindia.com/BseIndiaAPI/api";
const BSE_ANNOUNCEMENTS_ENDPOINT = `${BSE_API_BASE}/AnnSubCategoryGetData/w`;

/**
 * BSE Announcement type from API response
 */
interface BseAnnouncement {
  SCRIP_CD: string; // BSE scrip code
  NSURL: string; // PDF URL
  NEWSSUB: string; // Announcement title
  NEWS_DT: string; // Date (DD MMM YYYY format)
  SLONGNAME: string; // Company name
  ATTACHMENTNAME: string; // PDF filename
  CATEGORYNAME: string; // Category (e.g., "Company Update", "Board Meeting")
  More?: string; // Additional info
}

/**
 * BSE API response structure
 */
interface BseApiResponse {
  Table: BseAnnouncement[];
  Table1: Array<{ ROWCNT: number }>; // Total row count for pagination
}

/**
 * Format date for BSE API (YYYYMMDD)
 */
function formatBseDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

/**
 * Parse BSE date string (DD MMM YYYY) to ISO string
 */
function parseBseDate(dateStr: string): string {
  try {
    // "08 Jan 2026" -> ISO string
    const date = new Date(dateStr);
    return date.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

/**
 * Fetch corporate announcements from BSE API.
 *
 * @param hoursAgo - Fetch announcements from last N hours
 * @param maxResults - Maximum number of announcements to return
 * @returns Array of news items
 */
export async function fetchBseAnnouncements(
  hoursAgo: number = 4,
  maxResults: number = 50
): Promise<NewsItem[]> {
  const now = new Date();
  const fromDate = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000);

  // Build query parameters
  const params = new URLSearchParams({
    pageno: "1",
    strCat: "-1", // All categories
    subcategory: "-1", // All subcategories
    strPrevDate: formatBseDate(fromDate),
    strToDate: formatBseDate(now),
    strSearch: "P",
    strscrip: "", // All scrips
    strType: "C", // C = Equity, D = Debt, M = MF/ETF
  });

  const url = `${BSE_ANNOUNCEMENTS_ENDPOINT}?${params}`;

  try {
    const response = await fetchWithRetry(
      url,
      {
        headers: {
          // CRITICAL: The API validates that the request originated from this page
          Referer: "https://www.bseindia.com/corporates/ann.html",
          Origin: "https://www.bseindia.com",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
        },
      },
      {
        maxRetries: 3,
        initialDelayMs: 2000,
        timeoutMs: 30000, // 30s timeout for API
      }
    );

    if (!response.ok) {
      console.error(
        `[BSE-API] Failed to fetch: ${response.status} ${response.statusText}`
      );
      return [];
    }

    const text = await response.text();

    // Check if response is HTML (error page or redirect)
    if (text.trim().startsWith("<")) {
      console.warn(
        "[BSE-API] Received HTML instead of JSON - possible auth/redirect issue"
      );
      console.warn(`[BSE-API] URL attempted: ${url}`);
      return [];
    }

    const data: BseApiResponse = JSON.parse(text);

    if (!data.Table || !Array.isArray(data.Table)) {
      console.warn("[BSE-API] No announcements found in response");
      return [];
    }

    // Convert BSE announcements to NewsItem format
    const newsItems: NewsItem[] = [];
    for (const ann of data.Table) {
      if (newsItems.length >= maxResults) break;

      // Build announcement URL (PDF link)
      const pdfUrl = ann.NSURL ? `https://www.bseindia.com${ann.NSURL}` : "";

      // Build title: "Company Name: Announcement Title"
      const title = `${ann.SLONGNAME}: ${ann.NEWSSUB}`;

      newsItems.push({
        title,
        link:
          pdfUrl ||
          `https://www.bseindia.com/corporates/ann.html?scrip=${ann.SCRIP_CD}`,
        pubDate: parseBseDate(ann.NEWS_DT),
        source: `BSE (${ann.CATEGORYNAME})`,
        sourceId: "bse-api",
        sourcePriority: 0, // Level 0: Official exchange data
      });
    }

    console.log(
      `[BSE-API] Fetched ${newsItems.length} announcements (last ${hoursAgo}h)`
    );
    return newsItems;
  } catch (error) {
    console.error("[BSE-API] Fetch error:", error);
    return [];
  }
}

/**
 * Fetch announcements for a specific company by BSE scrip code.
 *
 * @param scripCode - BSE scrip code (e.g., "500325" for Reliance)
 * @param hoursAgo - Fetch announcements from last N hours
 * @returns Array of news items
 */
export async function fetchBseAnnouncementsByScript(
  scripCode: string,
  hoursAgo: number = 24
): Promise<NewsItem[]> {
  const now = new Date();
  const fromDate = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000);

  const params = new URLSearchParams({
    pageno: "1",
    strCat: "-1",
    subcategory: "-1",
    strPrevDate: formatBseDate(fromDate),
    strToDate: formatBseDate(now),
    strSearch: "P",
    strscrip: scripCode,
    strType: "C",
  });

  const url = `${BSE_ANNOUNCEMENTS_ENDPOINT}?${params}`;

  try {
    const response = await fetchWithRetry(
      url,
      {
        headers: {
          // CRITICAL: Same headers as main endpoint - BSE validates request origin
          "Referer": "https://www.bseindia.com/corporates/ann.html",
          "Origin": "https://www.bseindia.com",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
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
        `[BSE-API] Failed to fetch for scrip ${scripCode}: ${response.status}`
      );
      return [];
    }

    const text = await response.text();

    // Check if response is HTML (error page or redirect)
    if (text.trim().startsWith("<")) {
      console.warn(
        `[BSE-API] Received HTML instead of JSON for scrip ${scripCode} - possible auth/redirect issue`
      );
      return [];
    }

    const data: BseApiResponse = JSON.parse(text);

    if (!data.Table || !Array.isArray(data.Table)) {
      return [];
    }

    return data.Table.map((ann) => ({
      title: `${ann.SLONGNAME}: ${ann.NEWSSUB}`,
      link: ann.NSURL
        ? `https://www.bseindia.com${ann.NSURL}`
        : `https://www.bseindia.com/corporates/ann.html?scrip=${ann.SCRIP_CD}`,
      pubDate: parseBseDate(ann.NEWS_DT),
      source: `BSE (${ann.CATEGORYNAME})`,
      sourceId: "bse-api",
      sourcePriority: 0,
    }));
  } catch (error) {
    console.error(`[BSE-API] Error fetching for scrip ${scripCode}:`, error);
    return [];
  }
}
