import * as XLSX from "xlsx";

// Types for Groww exports
export interface GrowwTransaction {
  stockName: string;
  symbol: string;
  isin: string;
  type: "BUY" | "SELL";
  quantity: number;
  value: number;
  exchange: string;
  exchangeOrderId: string;
  executedAt: Date;
  status: string;
}

export interface GrowwHolding {
  stockName: string;
  isin: string;
  quantity: number;
  avgBuyPrice: number;
  buyValue: number;
  closingPrice: number;
  closingValue: number;
  unrealisedPnL: number;
}

export interface ReconciliationResult {
  computed: Map<string, { quantity: number; value: number }>;
  actual: Map<string, GrowwHolding & { symbol: string }>;
  adjustments: Array<{
    isin: string;
    symbol: string;
    stockName: string;
    quantityDiff: number;
    valueDiff: number;
  }>;
}

/**
 * Parse Groww Order History XLSX file
 */
export function parseOrderHistory(buffer: ArrayBuffer): GrowwTransaction[] {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });

  const transactions: GrowwTransaction[] = [];

  // Find header row (contains "Stock name", "Symbol", etc.)
  let headerRowIndex = -1;
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (row && row[0] === "Stock name") {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    throw new Error("Could not find header row in Order History file");
  }

  // Parse data rows
  for (let i = headerRowIndex + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[0]) continue;

    const [
      stockName,
      symbol,
      isin,
      type,
      quantity,
      value,
      exchange,
      exchangeOrderId,
      executionDateTime,
      status,
    ] = row;

    // Parse date: "25-04-2022 10:51 AM"
    const executedAt = parseGrowwDateTime(executionDateTime);

    transactions.push({
      stockName: String(stockName),
      symbol: String(symbol),
      isin: String(isin),
      type: String(type).toUpperCase() as "BUY" | "SELL",
      quantity: Number(quantity),
      value: Number(value),
      exchange: String(exchange),
      exchangeOrderId: String(exchangeOrderId),
      executedAt,
      status: String(status),
    });
  }

  return transactions;
}

/**
 * Parse Groww Holdings Statement XLSX file
 */
export function parseHoldingsStatement(buffer: ArrayBuffer): GrowwHolding[] {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });

  const holdings: GrowwHolding[] = [];

  // Find header row (contains "Stock Name", "ISIN", etc.)
  let headerRowIndex = -1;
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (row && row[0] === "Stock Name") {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    throw new Error("Could not find header row in Holdings Statement file");
  }

  // Parse data rows
  for (let i = headerRowIndex + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[0]) continue;

    const [
      stockName,
      isin,
      quantity,
      avgBuyPrice,
      buyValue,
      closingPrice,
      closingValue,
      unrealisedPnL,
    ] = row;

    holdings.push({
      stockName: String(stockName),
      isin: String(isin),
      quantity: Number(quantity),
      avgBuyPrice: Number(avgBuyPrice),
      buyValue: Number(buyValue),
      closingPrice: Number(closingPrice),
      closingValue: Number(closingValue),
      unrealisedPnL: Number(unrealisedPnL),
    });
  }

  return holdings;
}

/**
 * Compare computed holdings from transactions with actual holdings
 * Now groups by SYMBOL (not ISIN) to handle stock splits/bonus
 */
export function reconcile(
  transactions: GrowwTransaction[],
  actualHoldings: GrowwHolding[]
): ReconciliationResult {
  // Compute holdings from transactions - GROUP BY SYMBOL
  const computed = new Map<
    string,
    { quantity: number; value: number; stockName: string; symbol: string }
  >();

  for (const tx of transactions) {
    if (tx.status !== "Executed") continue;

    // Clean symbol (remove $ and other special chars)
    const cleanSymbol = tx.symbol.replace(/[$]/g, "");

    const existing = computed.get(cleanSymbol) || {
      quantity: 0,
      value: 0,
      stockName: tx.stockName,
      symbol: cleanSymbol,
    };

    if (tx.type === "BUY") {
      existing.quantity += tx.quantity;
      existing.value += tx.value;
    } else {
      existing.quantity -= tx.quantity;
      existing.value -= tx.value;
    }

    computed.set(cleanSymbol, existing);
  }

  // Build actual holdings map - need to extract symbol from transactions
  // Since holdings don't have symbol, we need to match by ISIN or stock name
  const actual = new Map<string, GrowwHolding & { symbol: string }>();

  // Build maps from transactions
  const isinToSymbol = new Map<string, string>();
  const stockNameToSymbol = new Map<string, string>();

  for (const tx of transactions) {
    const cleanSymbol = tx.symbol.replace(/[$]/g, "");
    isinToSymbol.set(tx.isin, cleanSymbol);
    // Also map by normalized stock name (first 10 chars, uppercase, no spaces)
    const normalizedName = tx.stockName
      .slice(0, 15)
      .replace(/\s+/g, "")
      .toUpperCase();
    stockNameToSymbol.set(normalizedName, cleanSymbol);
  }

  for (const h of actualHoldings) {
    // Try to find symbol: 1) by ISIN, 2) by stock name, 3) fallback
    const normalizedName = h.stockName
      .slice(0, 15)
      .replace(/\s+/g, "")
      .toUpperCase();
    const symbol =
      isinToSymbol.get(h.isin) ||
      stockNameToSymbol.get(normalizedName) ||
      h.stockName.slice(0, 10).replace(/\s+/g, "").toUpperCase();
    actual.set(symbol, { ...h, symbol });
  }

  // Find discrepancies
  const adjustments: ReconciliationResult["adjustments"] = [];

  // Check each actual holding
  for (const [symbol, holding] of actual) {
    const comp = computed.get(symbol);
    const computedQty = comp?.quantity || 0;
    const computedVal = comp?.value || 0;

    const quantityDiff = holding.quantity - computedQty;
    const valueDiff = holding.buyValue - computedVal;

    if (quantityDiff !== 0 || Math.abs(valueDiff) > 1) {
      adjustments.push({
        isin: holding.isin,
        symbol,
        stockName: holding.stockName,
        quantityDiff,
        valueDiff,
      });
    }
  }

  return {
    computed: new Map(
      [...computed].map(([k, v]) => [
        k,
        { quantity: v.quantity, value: v.value },
      ])
    ),
    actual,
    adjustments,
  };
}

/**
 * Parse Groww date format: "25-04-2022 10:51 AM"
 */
function parseGrowwDateTime(dateStr: string): Date {
  const match = dateStr.match(
    /(\d{2})-(\d{2})-(\d{4})\s+(\d{1,2}):(\d{2})\s+(AM|PM)/i
  );
  if (!match) {
    return new Date(dateStr);
  }

  const [, day, month, year, hour, minute, ampm] = match;
  let h = parseInt(hour, 10);
  if (ampm.toUpperCase() === "PM" && h !== 12) h += 12;
  if (ampm.toUpperCase() === "AM" && h === 12) h = 0;

  return new Date(
    parseInt(year),
    parseInt(month) - 1,
    parseInt(day),
    h,
    parseInt(minute)
  );
}
