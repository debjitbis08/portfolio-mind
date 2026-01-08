/**
 * Screener.in Scraper Service
 *
 * Scrapes stocks from screener.in screens using puppeteer.
 */

import puppeteer, { type Browser, type Page } from "puppeteer";
import { db, schema } from "../db";
import { eq } from "drizzle-orm";
import * as path from "path";

interface ScreenerConfig {
  email: string;
  password?: string;
  screenUrls: string[];
}

interface StockInfo {
  symbol: string;
  name: string;
}

interface ImportResult {
  url: string;
  symbols: string[];
  error?: string;
}

// Helper to add random delay (bot detection mitigation)
function randomDelay(min: number, max: number): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

export class ScreenerService {
  /**
   * Scrape multiple screens from Screener.in in a single session
   */
  static async importScreens(
    _userId: string, // Unused in single-user mode
    config: ScreenerConfig
  ): Promise<{ results: ImportResult[]; totalSymbols: number }> {
    console.log(`[Screener] Starting import for ${config.email}...`);
    console.log(`[Screener] URLs to process: ${config.screenUrls.length}`);

    const browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
      ],
    });

    const results: ImportResult[] = [];
    let allStocks: StockInfo[] = [];

    try {
      const page = await browser.newPage();

      await page.setUserAgent(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );
      await page.setViewport({ width: 1280, height: 800 });
      page.setDefaultTimeout(60000);

      // Step 1: Login
      const loginSuccess = await this.login(
        page,
        config.email,
        config.password
      );
      if (!loginSuccess) {
        throw new Error("Login failed. Please check your credentials.");
      }

      console.log("[Screener] Login successful!");
      await randomDelay(1000, 2000);

      // Step 2: Visit each screen URL
      for (const url of config.screenUrls) {
        console.log(`[Screener] Processing: ${url}`);
        try {
          const stocks = await this.extractStocksFromScreen(page, url);
          results.push({ url, symbols: stocks.map((s) => s.symbol) });
          allStocks = [...allStocks, ...stocks];
          console.log(`[Screener] Found ${stocks.length} stocks from ${url}`);
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : "Unknown error";
          console.error(`[Screener] Error on ${url}:`, errorMsg);
          results.push({ url, symbols: [], error: errorMsg });
        }
        await randomDelay(2000, 4000);
      }

      // Step 3: Save all stocks to watchlist (dedupe by symbol)
      if (allStocks.length > 0) {
        const stockMap = new Map<string, StockInfo>();
        for (const stock of allStocks) {
          const key = stock.symbol.toUpperCase();
          if (!stockMap.has(key)) {
            stockMap.set(key, stock);
          }
        }

        for (const stock of stockMap.values()) {
          await db
            .insert(schema.watchlist)
            .values({
              symbol: stock.symbol.toUpperCase(),
              name: stock.name || null,
              source: "screener",
              notes: "Imported from Screener.in",
            })
            .onConflictDoUpdate({
              target: schema.watchlist.symbol,
              set: {
                name: stock.name || null,
                source: "screener",
                notes: "Imported from Screener.in",
              },
            });
        }

        console.log(
          `[Screener] Saved ${stockMap.size} unique stocks to watchlist`
        );
      }

      return { results, totalSymbols: allStocks.length };
    } catch (error) {
      console.error("[Screener] Import Error:", error);
      await this.saveDebugScreenshot(browser);
      throw error;
    } finally {
      await browser.close();
    }
  }

  /**
   * Login to Screener.in
   */
  private static async login(
    page: Page,
    email: string,
    password?: string
  ): Promise<boolean> {
    console.log("[Screener] Loading login page...");

    await page.goto("https://www.screener.in/login/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForSelector('input[name="username"]', { timeout: 30000 });
    await randomDelay(500, 1000);

    console.log("[Screener] Entering credentials...");
    await page.type('input[name="username"]', email, { delay: 80 });
    await randomDelay(300, 600);

    if (password) {
      await page.type('input[name="password"]', password, { delay: 80 });
    }
    await randomDelay(500, 1000);

    console.log("[Screener] Submitting login...");
    await page.click('button[type="submit"]');
    await randomDelay(3000, 5000);

    const currentUrl = page.url();
    console.log("[Screener] Current URL after login:", currentUrl);

    const errorMessage = await page.evaluate(() => {
      const errorEl = document.querySelector(
        ".errorlist, .error, .alert-danger"
      );
      return errorEl?.textContent?.trim() || null;
    });

    if (errorMessage) {
      console.error("[Screener] Login error:", errorMessage);
      return false;
    }

    if (currentUrl.includes("/login/")) {
      const isLoggedIn = await page.evaluate(() => {
        const logoutLink = document.querySelector('a[href*="logout"]');
        const userMenu = document.querySelector(".user-menu, .account-menu");
        return !!(logoutLink || userMenu);
      });

      if (!isLoggedIn) {
        await page.goto("https://www.screener.in/", {
          waitUntil: "domcontentloaded",
        });
        await randomDelay(1000, 2000);
      }
    }

    const finalUrl = page.url();
    return !finalUrl.includes("/login/");
  }

  /**
   * Extract stocks (symbol + name) from a screen URL
   */
  private static async extractStocksFromScreen(
    page: Page,
    screenUrl: string
  ): Promise<StockInfo[]> {
    await page.goto(screenUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    try {
      await page.waitForSelector("table.data-table", { timeout: 15000 });
    } catch {
      const noResults = await page.evaluate(() => {
        const body = document.body.textContent || "";
        return body.includes("No results") || body.includes("No companies");
      });
      if (noResults) return [];
      throw new Error("Could not find data table on screen page");
    }

    await randomDelay(500, 1000);

    const stocks = await page.evaluate(() => {
      const links = Array.from(
        document.querySelectorAll(
          'table.data-table tbody tr td a[href^="/company/"]'
        )
      );
      return links
        .map((link) => {
          const href = link.getAttribute("href") || "";
          const parts = href.split("/");
          const symbol = parts[2] || "";
          // Get the visible text as the stock name
          const name = link.textContent?.trim() || symbol;
          return { symbol, name };
        })
        .filter((s) => s.symbol && s.symbol.length > 0);
    });

    return stocks;
  }

  /**
   * Save debug screenshot
   */
  private static async saveDebugScreenshot(browser: Browser): Promise<void> {
    try {
      const pages = await browser.pages();
      if (pages.length > 0) {
        const screenshotPath = path.join(
          "/tmp",
          `screener-debug-${Date.now()}.png`
        );
        await pages[0].screenshot({ path: screenshotPath, fullPage: true });
        console.log(`[Screener] Debug screenshot saved: ${screenshotPath}`);
      }
    } catch {
      // ignore
    }
  }

  /**
   * Legacy single-URL method for backward compatibility
   */
  static async importScreen(
    userId: string,
    config: { email: string; password?: string; screenUrl: string }
  ): Promise<string[]> {
    const result = await this.importScreens(userId, {
      email: config.email,
      password: config.password,
      screenUrls: [config.screenUrl],
    });
    return result.results[0]?.symbols || [];
  }
}
