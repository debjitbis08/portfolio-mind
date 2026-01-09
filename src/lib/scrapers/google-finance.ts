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
  // Check if symbol already has exchange suffix (e.g., "522195:BOM")
  if (symbol.includes(":")) {
    try {
      const quote = await scrapeGoogleFinance(symbol);
      if (quote) {
        // Return original symbol without suffix for consistency
        const baseSymbol = symbol.split(":")[0];
        return { ...quote, symbol: baseSymbol };
      }
    } catch (error) {
      console.error(`[GoogleFinance] Failed for pre-suffixed ${symbol}:`, error);
    }
    return null; // If pre-suffixed symbol fails, don't try alternatives
  }

  const isBseCode = /^\d{5,6}$/.test(symbol);

  // HEURISTIC: If symbol is all digits (BSE scrip code), it's BSE-only
  // Rationale:
  // - BSE uses numeric scrip codes (5-6 digits)
  // - NSE uses alphabetic symbols
  // - If a BSE stock is also on NSE, it has a DIFFERENT alphabetic symbol on NSE
  // - Therefore, a numeric symbol can ONLY exist on BSE, never on NSE
  // - Trying NSE with numeric codes often returns wrong/stale data from unrelated securities
  if (isBseCode) {
    console.log(`[GoogleFinance] ${symbol} is numeric (BSE scrip code), skipping NSE`);
    try {
      const quote = await scrapeGoogleFinance(`${symbol}:BOM`);
      if (quote) {
        return { ...quote, symbol };
      }
    } catch (error) {
      console.error(`[GoogleFinance] Failed for BSE scrip code ${symbol}:`, error);
    }
    return null;
  }

  // For alphabetic symbols, try both exchanges
  // NSE first (more liquid), then BSE as fallback
  const suffixes = [`${symbol}:NSE`, `${symbol}:BOM`];

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
