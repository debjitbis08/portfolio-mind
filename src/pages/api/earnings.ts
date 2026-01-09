/**
 * Earnings API
 *
 * Endpoints for syncing and retrieving financial data.
 */

import type { APIRoute } from "astro";
import { db, schema } from "../../lib/db";
import { eq, and } from "drizzle-orm";
import {
  parseScreenerExcel,
  parseScreenerExcelBuffer,
  type FinancialPeriod,
} from "../../lib/scrapers/screener-financials";
import { getSymbolForStock } from "../../lib/mappings";
import puppeteer from "puppeteer";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { resolve, join } from "node:path";

// ============================================================================
// POST /api/earnings - Sync financials for a symbol
// ============================================================================

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    let { symbol, screenerUrl, email, password, localFile } = body;

    if (!symbol) {
      return new Response(JSON.stringify({ error: "Symbol is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // If screenerUrl provided but no credentials, fetch from database
    if (screenerUrl && !email) {
      const settings = await db
        .select()
        .from(schema.settings)
        .where(eq(schema.settings.id, 1))
        .limit(1);

      const data = settings[0];
      if (data?.screenerEmail && data?.screenerPassword) {
        email = data.screenerEmail;
        password = data.screenerPassword;
      } else {
        return new Response(
          JSON.stringify({
            error:
              "Screener credentials not configured. Please set them in Settings.",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    let financials;

    if (localFile) {
      // Parse from local file (for testing)
      const filePath = resolve(localFile);
      if (!existsSync(filePath)) {
        return new Response(JSON.stringify({ error: "File not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      financials = parseScreenerExcel(filePath);
    } else if (screenerUrl && email) {
      // Apply symbol mapping before downloading
      const watchlistRecord = await db
        .select()
        .from(schema.watchlist)
        .where(eq(schema.watchlist.symbol, symbol))
        .limit(1);

      const companyName = watchlistRecord[0]?.name || symbol;
      const mappedSymbol = await getSymbolForStock(companyName, symbol);

      console.log(`[Earnings API] Mapped ${symbol} -> ${mappedSymbol}`);

      // Reconstruct URL with mapped symbol
      const mappedUrl = `https://www.screener.in/company/${mappedSymbol}/`;

      // Download from Screener
      const excelBuffer = await downloadScreenerExcel(
        mappedUrl,
        email,
        password
      );
      financials = parseScreenerExcelBuffer(excelBuffer, symbol);
    } else {
      return new Response(
        JSON.stringify({
          error: "Either localFile or screenerUrl+email required",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Save to database
    const savedCount = await saveFinancialsToDb(
      symbol,
      financials.annual,
      financials.quarterly
    );

    return new Response(
      JSON.stringify({
        success: true,
        symbol,
        companyName: financials.companyName,
        annualPeriods: financials.annual.length,
        quarterlyPeriods: financials.quarterly.length,
        savedCount,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[Earnings API] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

// ============================================================================
// GET /api/earnings - Get financials for a symbol
// ============================================================================

export const GET: APIRoute = async ({ url }) => {
  try {
    const symbolParam = url.searchParams.get("symbol");
    const periodType = url.searchParams.get("type"); // 'annual' | 'quarterly' | null (all)

    if (!symbolParam) {
      return new Response(
        JSON.stringify({ error: "Symbol query param required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const symbol = symbolParam.toUpperCase();

    let query = db
      .select()
      .from(schema.companyFinancials)
      .where(eq(schema.companyFinancials.symbol, symbol));

    if (periodType === "annual" || periodType === "quarterly") {
      query = db
        .select()
        .from(schema.companyFinancials)
        .where(
          and(
            eq(schema.companyFinancials.symbol, symbol),
            eq(schema.companyFinancials.periodType, periodType)
          )
        );
    }

    const results = await query;

    // Sort by report date descending
    results.sort(
      (a, b) =>
        new Date(b.reportDate).getTime() - new Date(a.reportDate).getTime()
    );

    return new Response(
      JSON.stringify({
        symbol,
        count: results.length,
        financials: results,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[Earnings API] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Download Excel export from Screener using Puppeteer
 */
async function downloadScreenerExcel(
  screenerUrl: string,
  email: string,
  password?: string
): Promise<Buffer> {
  console.log(`[Earnings API] Downloading Excel from ${screenerUrl}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // Login
    await page.goto("https://www.screener.in/login/", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector('input[name="username"]', { timeout: 30000 });
    await page.type('input[name="username"]', email, { delay: 80 });
    if (password) {
      await page.type('input[name="password"]', password, { delay: 80 });
    }
    await page.click('button[type="submit"]');
    // Wait for navigation after login, with fallback timeout
    await Promise.race([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}),
      new Promise((r) => setTimeout(r, 5000)),
    ]);

    // Navigate to company page
    await page.goto(screenerUrl, { waitUntil: "domcontentloaded" });
    await new Promise((r) => setTimeout(r, 2000));

    // Set up download handling
    const downloadPath = `/tmp/screener-excel-${Date.now()}`;
    mkdirSync(downloadPath, { recursive: true });

    // @ts-ignore - CDPSession types
    const client = await page.target().createCDPSession();
    await client.send("Page.setDownloadBehavior", {
      behavior: "allow",
      downloadPath,
    });

    // Click the export button
    // Try multiple selectors: button with aria-label, button with text, or link
    let exportButton = await page.$('button[aria-label="Export to Excel"]');
    if (!exportButton) {
      // Fallback to text search
      const buttons = await page.$$("button");
      for (const btn of buttons) {
        const text = await page.evaluate((el) => el.textContent, btn);
        if (text?.includes("Export to Excel")) {
          exportButton = btn;
          break;
        }
      }
    }

    if (!exportButton) {
      // Fallback to old link selector just in case
      exportButton = (await page.$('a[href*="export"]')) as any;
    }

    if (!exportButton) {
      throw new Error("Export to Excel button not found");
    }
    await exportButton.click();

    // Wait for download
    await new Promise((r) => setTimeout(r, 5000));

    // Find the downloaded file
    const files = readdirSync(downloadPath);
    const xlsxFile = files.find((f: string) => f.endsWith(".xlsx"));
    if (!xlsxFile) {
      throw new Error("Downloaded Excel file not found");
    }

    const buffer = readFileSync(join(downloadPath, xlsxFile));

    // Cleanup
    rmSync(downloadPath, { recursive: true, force: true });

    return buffer;
  } finally {
    await browser.close();
  }
}

/**
 * Save parsed financials to database
 */
async function saveFinancialsToDb(
  symbol: string,
  annual: FinancialPeriod[],
  quarterly: FinancialPeriod[]
): Promise<number> {
  let count = 0;

  const allPeriods = [...annual, ...quarterly];

  for (const period of allPeriods) {
    // Check if already exists
    const existing = await db
      .select()
      .from(schema.companyFinancials)
      .where(
        and(
          eq(schema.companyFinancials.symbol, symbol),
          eq(schema.companyFinancials.reportDate, period.reportDate),
          eq(schema.companyFinancials.periodType, period.periodType)
        )
      )
      .get();

    if (existing) {
      // Update
      await db
        .update(schema.companyFinancials)
        .set({
          sales: period.sales,
          operatingProfit: period.operatingProfit,
          netProfit: period.netProfit,
          eps: period.eps,
          opmPercent: period.opmPercent,
          equity: period.equity,
          reserves: period.reserves,
          borrowings: period.borrowings,
          receivables: period.receivables,
          inventory: period.inventory,
          operatingCashFlow: period.operatingCashFlow,
          investingCashFlow: period.investingCashFlow,
          financingCashFlow: period.financingCashFlow,
          price: period.price,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.companyFinancials.id, existing.id));
    } else {
      // Insert
      await db.insert(schema.companyFinancials).values({
        symbol,
        periodType: period.periodType,
        reportDate: period.reportDate,
        sales: period.sales,
        operatingProfit: period.operatingProfit,
        netProfit: period.netProfit,
        eps: period.eps,
        opmPercent: period.opmPercent,
        equity: period.equity,
        reserves: period.reserves,
        borrowings: period.borrowings,
        receivables: period.receivables,
        inventory: period.inventory,
        operatingCashFlow: period.operatingCashFlow,
        investingCashFlow: period.investingCashFlow,
        financingCashFlow: period.financingCashFlow,
        price: period.price,
      });
    }
    count++;
  }

  return count;
}
