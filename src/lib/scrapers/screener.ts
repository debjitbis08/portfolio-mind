import puppeteer from "puppeteer";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_SERVICE_ROLE_KEY } from "astro:env/server";
import { PUBLIC_SUPABASE_URL } from "astro:env/client";

const supabaseAdmin = createClient(
  PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

interface ScreenerConfig {
  email: string;
  password?: string;
  screenUrl: string;
}

export class ScreenerService {
  /**
   * Scrape a private screen from Screener.in using user credentials
   * Credentials are used only for this session and not stored.
   */
  static async importScreen(
    userId: string,
    config: ScreenerConfig
  ): Promise<string[]> {
    console.log(`Starting Screener import for ${config.email}...`);

    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    try {
      const page = await browser.newPage();

      // 1. Login
      await page.goto("https://www.screener.in/login/", {
        waitUntil: "networkidle0",
      });

      await page.type('input[name="username"]', config.email);
      if (config.password) {
        await page.type('input[name="password"]', config.password);
      }

      await Promise.all([
        page.click('button[type="submit"]'),
        page.waitForNavigation({ waitUntil: "networkidle0" }),
      ]);

      // Check for login failure
      if (page.url().includes("/login/")) {
        throw new Error("Login failed. Please check your credentials.");
      }

      // 2. Navigate to Screen
      console.log(`Navigating to screen: ${config.screenUrl}`);
      await page.goto(config.screenUrl, { waitUntil: "networkidle2" });

      // 3. Extract Symbols
      // Screener tables usually have stock links like /company/RELIANCE/
      const symbols = await page.evaluate(() => {
        const links = Array.from(
          document.querySelectorAll(
            'table.data-table tbody tr td a[href^="/company/"]'
          )
        );
        return links
          .map((link) => {
            const href = link.getAttribute("href") || "";
            // extract symbol from /company/SYMBOL/ or /company/SYMBOL/consolidated/
            const parts = href.split("/");
            return parts[2];
          })
          .filter((s) => s);
      });

      console.log(`Found ${symbols.length} symbols:`, symbols);

      if (symbols.length === 0) {
        throw new Error("No symbols found on this screen.");
      }

      // 4. Store in Watchlist
      const records = symbols.map((symbol) => ({
        user_id: userId,
        symbol: symbol.toUpperCase(),
        source: "screener",
        notes: `Imported from ${config.screenUrl}`,
      }));

      // Use upsert to avoid duplicates
      const { error } = await supabaseAdmin
        .from("watchlist")
        .upsert(records, { onConflict: "symbol" });

      if (error) {
        console.error("Database error:", error);
        throw new Error("Failed to save to watchlist");
      }

      return symbols;
    } catch (error) {
      console.error("Screener Import Error:", error);
      throw error;
    } finally {
      await browser.close();
    }
  }
}
