/**
 * Google Finance Price Scraper
 *
 * Fallback for stocks not covered by Yahoo Finance (recent IPOs, obscure BSE stocks).
 * Scrapes current price from Google Finance website.
 */

import * as cheerio from "cheerio";

export interface GoogleFinanceQuote {
  symbol: string;
  name: string | null;
  price: number;
  change: number | null;
  changePercent: number | null;
  currency: string;
}

/**
 * Get current stock price from Google Finance
 * Tries both BSE and NSE suffixes
 */
export async function getGoogleFinanceQuote(
  symbol: string
): Promise<GoogleFinanceQuote | null> {
  const isBseCode = /^\d{5,6}$/.test(symbol);

  // Build Google Finance URLs to try
  // For BSE codes, try BSE first; for symbol names, try NSE first
  const suffixes = isBseCode
    ? [`${symbol}:BOM`, `${symbol}:NSE`] // BOM = Bombay (BSE)
    : [`${symbol}:NSE`, `${symbol}:BOM`];

  for (const gfSymbol of suffixes) {
    try {
      const quote = await scrapeGoogleFinance(gfSymbol);
      if (quote) {
        return { ...quote, symbol };
      }
    } catch (error) {
      console.error(`[GoogleFinance] Failed for ${gfSymbol}:`, error);
    }
  }

  return null;
}

/**
 * Scrape a single Google Finance quote page
 */
async function scrapeGoogleFinance(
  gfSymbol: string
): Promise<Omit<GoogleFinanceQuote, "symbol"> | null> {
  const url = `https://www.google.com/finance/quote/${gfSymbol}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!response.ok) {
    return null;
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  // Check if we got a valid stock page (not a search/error page)
  const priceElement = $("[data-last-price]");
  if (priceElement.length === 0) {
    return null;
  }

  // Extract price from data attribute (most reliable)
  const priceStr = priceElement.attr("data-last-price");
  if (!priceStr) {
    return null;
  }

  const price = parseFloat(priceStr);
  if (isNaN(price)) {
    return null;
  }

  // Extract company name
  const nameElement = $('[data-source="Ticker name"]').first();
  const name = nameElement.length > 0 ? nameElement.text().trim() : null;

  // Extract currency
  const currencyElement = $("[data-currency-code]");
  const currency = currencyElement.attr("data-currency-code") || "INR";

  // Extract change info (optional)
  let change: number | null = null;
  let changePercent: number | null = null;

  const changeElement = $("[data-last-price]")
    .parent()
    .find('[data-active="true"]')
    .first();
  if (changeElement.length > 0) {
    const changeText = changeElement.text();
    // Parse change text like "+₹12.50 (1.23%)" or "-₹5.00 (-0.50%)"
    const changeMatch = changeText.match(
      /([+-]?[\d,.]+)\s*\(([+-]?[\d.]+)%?\)/
    );
    if (changeMatch) {
      change = parseFloat(changeMatch[1].replace(/,/g, ""));
      changePercent = parseFloat(changeMatch[2]);
    }
  }

  return {
    name,
    price,
    change,
    changePercent,
    currency,
  };
}

/**
 * Get stock name from Google Finance (useful for obscure stocks)
 */
export async function getGoogleFinanceName(
  symbol: string
): Promise<string | null> {
  const quote = await getGoogleFinanceQuote(symbol);
  return quote?.name || null;
}
