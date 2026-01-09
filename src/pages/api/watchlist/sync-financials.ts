/**
 * Batch sync financials for watchlist stocks
 * POST: Sync financials for all watchlist stocks (or selected subset)
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../../lib/middleware/requireAuth";
import { db, schema } from "../../../lib/db";
import { eq, inArray, and } from "drizzle-orm";
import {
  parseScreenerExcelBuffer,
  type FinancialPeriod,
} from "../../../lib/scrapers/screener-financials";
import { getSymbolForStock } from "../../../lib/mappings";
import puppeteer from "puppeteer";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";

interface SyncResult {
  symbol: string;
  success: boolean;
  periodsCount?: number;
  error?: string;
}

export const POST: APIRoute = async ({ request }) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json().catch(() => ({}));
    const { symbols: requestedSymbols } = body;

    // Get screener credentials
    const [settings] = await db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.id, 1))
      .limit(1);

    if (!settings?.screenerEmail || !settings?.screenerPassword) {
      return new Response(
        JSON.stringify({
          error:
            "Screener credentials not configured. Please set them in Settings.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get symbols to sync
    let symbolsToSync: string[] = [];
    if (requestedSymbols && Array.isArray(requestedSymbols)) {
      symbolsToSync = requestedSymbols;
    } else {
      // Get all watchlist stocks
      const watchlistStocks = await db.select().from(schema.watchlist);
      symbolsToSync = watchlistStocks.map((s) => s.symbol);
    }

    if (symbolsToSync.length === 0) {
      return new Response(JSON.stringify({ error: "No stocks to sync" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log(
      `[Batch Sync] Starting sync for ${symbolsToSync.length} stocks...`
    );

    // Launch browser once for all syncs
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const results: SyncResult[] = [];

    try {
      const page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );

      // Login once
      await page.goto("https://www.screener.in/login/", {
        waitUntil: "domcontentloaded",
      });
      await page.waitForSelector('input[name="username"]', { timeout: 30000 });
      await page.type('input[name="username"]', settings.screenerEmail, {
        delay: 80,
      });
      await page.type('input[name="password"]', settings.screenerPassword, {
        delay: 80,
      });
      await page.click('button[type="submit"]');
      await Promise.race([
        page
          .waitForNavigation({ waitUntil: "domcontentloaded" })
          .catch(() => {}),
        new Promise((r) => setTimeout(r, 5000)),
      ]);

      // Sync each stock
      for (const symbol of symbolsToSync) {
        try {
          console.log(`[Batch Sync] Syncing ${symbol}...`);

          // Get the watchlist record to retrieve company name
          const watchlistRecord = await db
            .select()
            .from(schema.watchlist)
            .where(eq(schema.watchlist.symbol, symbol))
            .limit(1);

          const companyName = watchlistRecord[0]?.name || symbol;

          // Apply symbol mapping (e.g., KPL -> 539997 for BSE stocks)
          const mappedSymbol = await getSymbolForStock(companyName, symbol);
          console.log(`[Batch Sync] Mapped ${symbol} -> ${mappedSymbol}`);

          const screenerUrl = `https://www.screener.in/company/${mappedSymbol}/`;

          // Navigate to company page
          await page.goto(screenerUrl, { waitUntil: "domcontentloaded" });
          await new Promise((r) => setTimeout(r, 2000));

          // Set up download handling
          const downloadPath = `/tmp/screener-excel-${Date.now()}-${symbol}`;
          mkdirSync(downloadPath, { recursive: true });

          // @ts-ignore
          const client = await page.target().createCDPSession();
          await client.send("Page.setDownloadBehavior", {
            behavior: "allow",
            downloadPath,
          });

          // Click export button
          let exportButton = await page.$(
            'button[aria-label="Export to Excel"]'
          );
          if (!exportButton) {
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
            exportButton = (await page.$('a[href*="export"]')) as any;
          }

          if (!exportButton) {
            results.push({
              symbol,
              success: false,
              error: "Export button not found",
            });
            continue;
          }

          await exportButton.click();
          await new Promise((r) => setTimeout(r, 5000));

          // Find downloaded file
          const files = readdirSync(downloadPath);
          const xlsxFile = files.find((f: string) => f.endsWith(".xlsx"));

          if (!xlsxFile) {
            results.push({ symbol, success: false, error: "Download failed" });
            rmSync(downloadPath, { recursive: true, force: true });
            continue;
          }

          const buffer = readFileSync(join(downloadPath, xlsxFile));
          const financials = parseScreenerExcelBuffer(buffer, symbol);

          // Save to database
          const allPeriods = [...financials.annual, ...financials.quarterly];
          let savedCount = 0;

          for (const period of allPeriods) {
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
            savedCount++;
          }

          // Cleanup
          rmSync(downloadPath, { recursive: true, force: true });

          results.push({ symbol, success: true, periodsCount: savedCount });

          // Rate limiting between stocks
          await new Promise((r) => setTimeout(r, 2000));
        } catch (err) {
          console.error(`[Batch Sync] Error syncing ${symbol}:`, err);
          results.push({
            symbol,
            success: false,
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }
    } finally {
      await browser.close();
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    console.log(
      `[Batch Sync] Completed: ${successCount} success, ${failCount} failed`
    );

    return new Response(
      JSON.stringify({
        success: true,
        total: symbolsToSync.length,
        synced: successCount,
        failed: failCount,
        results,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[Batch Sync] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Sync failed",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
