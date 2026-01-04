/**
 * Link Content Fetcher
 *
 * Fetches and cleans web page content for storage.
 * Uses @mozilla/readability for article extraction.
 */

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

export interface FetchResult {
  title: string;
  content: string;
  success: boolean;
  error?: string;
}

const FETCH_TIMEOUT = 10000; // 10 seconds
const MAX_CONTENT_LENGTH = 50000; // 50KB

/**
 * Fetches a URL and extracts readable content
 */
export async function fetchLinkContent(url: string): Promise<FetchResult> {
  try {
    // Validate URL
    const parsedUrl = new URL(url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return {
        title: "",
        content: "",
        success: false,
        error: "Only HTTP/HTTPS URLs are supported",
      };
    }

    // Fetch with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; PortfolioMind/1.0; +https://github.com/portfolio-mind)",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      return {
        title: "",
        content: "",
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return {
        title: "",
        content: "",
        success: false,
        error: `Unsupported content type: ${contentType}`,
      };
    }

    const html = await response.text();

    // Parse HTML and extract readable content
    const { document } = parseHTML(html);
    const reader = new Readability(document);
    const article = reader.parse();

    if (!article) {
      // Fallback: try to extract title at least
      const titleEl = document.querySelector("title");
      const title = titleEl?.textContent?.trim() || parsedUrl.hostname;

      return {
        title,
        content: "",
        success: true, // Partial success - got title but no content
        error: "Could not extract article content",
      };
    }

    // Clean and truncate content
    let content = article.textContent?.trim() || "";
    if (content.length > MAX_CONTENT_LENGTH) {
      content = content.substring(0, MAX_CONTENT_LENGTH) + "...[truncated]";
    }

    return {
      title: article.title || parsedUrl.hostname,
      content,
      success: true,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    // Handle specific error types
    if (errorMessage.includes("abort")) {
      return {
        title: "",
        content: "",
        success: false,
        error: "Request timed out",
      };
    }

    return {
      title: "",
      content: "",
      success: false,
      error: errorMessage,
    };
  }
}
