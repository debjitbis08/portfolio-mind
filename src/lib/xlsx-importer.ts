import * as XLSX from "xlsx";
import { getSymbolMappings } from "./mappings";

// Types for Groww exports
export interface GrowwTransaction {
  stockName: string;
  symbol: string;
  isin: string;
  type: "BUY" | "SELL";
  quantity: number;
  value: number;
  productType: "DELIVERY" | "INTRADAY";
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
    throw new Error(
      "Could not find header row in Order History file. Please ensure you're uploading a valid Groww/Zerodha order history file."
    );
  }

  const headerRow = data[headerRowIndex] || [];
  const normalizeHeader = (value: unknown) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  const findHeaderIndex = (candidates: string[]) =>
    headerRow.findIndex((cell) =>
      candidates.includes(normalizeHeader(cell))
    );
  const productTypeIndex = findHeaderIndex([
    "product",
    "product type",
    "trade type",
    "order type",
  ]);

  const resolveProductType = (value: unknown): "DELIVERY" | "INTRADAY" => {
    const normalized = String(value || "")
      .trim()
      .toUpperCase();
    if (normalized.includes("INTRADAY") || normalized === "MIS") {
      return "INTRADAY";
    }
    if (normalized.includes("DELIVERY") || normalized === "CNC") {
      return "DELIVERY";
    }
    return "DELIVERY";
  };

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

    const productType =
      productTypeIndex >= 0
        ? resolveProductType(row[productTypeIndex])
        : "DELIVERY";

    // Parse date: "25-04-2022 10:51 AM"
    const executedAt = parseGrowwDateTime(executionDateTime);

    transactions.push({
      stockName: String(stockName),
      symbol: String(symbol),
      isin: String(isin),
      type: String(type).toUpperCase() as "BUY" | "SELL",
      quantity: Number(quantity),
      value: Number(value),
      productType,
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
    // If header not found, return empty array instead of throwing
    // This allows import to proceed without holdings reconciliation
    console.warn(
      "Could not find header row in Holdings Statement file - skipping reconciliation"
    );
    return [];
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

// ============================================================================
// ICICI Direct CSV Import Support
// ============================================================================

function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        i++;
      }
      row.push(cell);
      if (row.some((value) => value.trim() !== "")) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((value) => value.trim() !== "")) {
      rows.push(row);
    }
  }

  return rows;
}

function normalizeHeaderName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseNumberValue(value: string): number {
  const cleaned = value.replace(/[,\s]/g, "").replace(/[()]/g, "");
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseICICIDateTime(dateStr: string, timeStr?: string): Date {
  const trimmedDate = dateStr.trim();
  if (!trimmedDate) return new Date(dateStr);

  let baseDate: Date | null = null;
  const monthMatch = trimmedDate.match(/(\d{2})-([A-Za-z]{3})-(\d{4})/);
  if (monthMatch) {
    baseDate = parseICICIDate(trimmedDate);
  } else {
    const numericMatch = trimmedDate.match(/(\d{2})[/-](\d{2})[/-](\d{4})/);
    if (numericMatch) {
      const [, day, month, year] = numericMatch;
      baseDate = new Date(
        parseInt(year, 10),
        parseInt(month, 10) - 1,
        parseInt(day, 10)
      );
    } else {
      baseDate = new Date(trimmedDate);
    }
  }

  if (!timeStr) return baseDate;

  const timeMatch = timeStr.trim().match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!timeMatch) return baseDate;

  let hour = parseInt(timeMatch[1], 10);
  const minute = parseInt(timeMatch[2], 10);
  const second = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
  const ampm = timeMatch[4]?.toUpperCase();

  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;

  baseDate.setHours(hour, minute, second, 0);
  return baseDate;
}

function parseICICIAction(value: string): "BUY" | "SELL" | null {
  const normalized = value.trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === "BUY" || normalized === "B") return "BUY";
  if (normalized === "SELL" || normalized === "S") return "SELL";
  if (normalized.includes("BUY")) return "BUY";
  if (normalized.includes("SELL")) return "SELL";
  return null;
}

function extractSymbolCandidate(value: string, series?: string): string {
  let symbol = value.trim();
  if (!symbol) return symbol;

  const seriesTrimmed = series?.trim();
  if (seriesTrimmed && symbol.endsWith(` ${seriesTrimmed}`)) {
    symbol = symbol.slice(0, -(seriesTrimmed.length + 1)).trim();
  }

  if (symbol.includes(" ")) {
    const firstToken = symbol.split(/\s+/)[0];
    if (firstToken.length >= 2 && firstToken === firstToken.toUpperCase()) {
      symbol = firstToken;
    }
  }

  return symbol.replace(/[^A-Za-z0-9]/g, "");
}

export interface ICICIDirectTransaction {
  stockSymbol: string;
  companyName: string;
  isinCode: string;
  action: "BUY" | "SELL";
  quantity: number;
  transactionPrice: number;
  brokerage: number;
  transactionCharges: number;
  stampDuty: number;
  segment: string;
  sttPaid: boolean;
  transactionDate: Date;
  exchange: string;
}

export interface ICICIDirectHolding {
  stockSymbol: string;
  companyName: string;
  isinCode: string;
  quantity: number;
  avgCostPrice: number;
  currentMarketPrice: number;
  valueAtCost: number;
  valueAtMarketPrice: number;
  unrealizedPnL: number;
}

/**
 * Parse ICICI Direct date format: "DD-Mon-YYYY" (e.g., "21-Mar-2018")
 */
function parseICICIDate(dateStr: string): Date {
  const months: Record<string, number> = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
  };

  const match = dateStr.match(/(\d{2})-([A-Za-z]{3})-(\d{4})/);
  if (!match) {
    return new Date(dateStr);
  }

  const [, day, monthStr, year] = match;
  const month = months[monthStr] ?? 0;

  return new Date(parseInt(year), month, parseInt(day));
}

/**
 * Parse ICICI Direct PortFolioEqtAll.csv (transactions)
 */
export function parseICICIDirectTransactions(
  csvText: string
): ICICIDirectTransaction[] {
  const lines = csvText.trim().split(/\r?\n/);
  const transactions: ICICIDirectTransaction[] = [];

  // Skip header row
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Parse CSV (simple split - ICICI CSVs don't have quoted fields with commas)
    const cols = line.split(",");
    if (cols.length < 14) continue;

    const [
      stockSymbol,
      companyName,
      isinCode,
      action,
      quantity,
      transactionPrice,
      brokerage,
      transactionCharges,
      stampDuty,
      segment,
      sttStatus,
      _remarks,
      transactionDate,
      exchange,
    ] = cols;

    transactions.push({
      stockSymbol: stockSymbol.trim(),
      companyName: companyName.trim(),
      isinCode: isinCode.trim(),
      action: action.trim().toUpperCase() as "BUY" | "SELL",
      quantity: parseInt(quantity.trim(), 10) || 0,
      transactionPrice: parseFloat(transactionPrice.trim()) || 0,
      brokerage: parseFloat(brokerage.trim()) || 0,
      transactionCharges: parseFloat(transactionCharges.trim()) || 0,
      stampDuty: parseFloat(stampDuty.trim()) || 0,
      segment: segment.trim(),
      sttPaid: sttStatus.trim() === "STT Paid",
      transactionDate: parseICICIDate(transactionDate.trim()),
      exchange: exchange.trim(),
    });
  }

  return transactions;
}

/**
 * Parse ICICI Direct Tradebook report CSV (transactions)
 */
export function parseICICIDirectTradebookTransactions(
  csvText: string
): ICICIDirectTransaction[] {
  const rows = parseCsvRows(csvText);
  if (rows.length === 0) return [];

  const headerAliases = {
    stockSymbol: [
      "stock",
      "stocksymbol",
      "symbol",
      "securitysymbol",
      "scripsymbol",
      "tradingsymbol",
      "scripcode",
    ],
    companyName: [
      "companyname",
      "securityname",
      "scripname",
      "stockname",
      "security",
      "scrip",
    ],
    isinCode: ["isin", "isincode"],
    action: ["action", "buysell", "buysellflag", "tradetype", "transactiontype"],
    quantity: ["quantity", "qty", "tradeqty", "tradequantity", "tradedquantity"],
    transactionPrice: ["tradeprice", "price", "rate", "traderate", "executedrate"],
    transactionDate: ["tradedate", "transactiondate", "date"],
    transactionTime: ["tradetime", "time"],
    exchange: ["exchange", "exch"],
    segment: ["segment", "segmenttype", "product"],
    brokerage: ["brokerage", "brokerageamount", "brokeragecharges"],
    transactionCharges: ["transactioncharges", "transactioncharge", "exchangecharges", "othercharges"],
    stampDuty: ["stampduty"],
    sttPaid: ["stt", "sttpaid", "sttstatus"],
    series: ["series"],
  } as const;

  const findHeaderIndex = (headers: string[], aliases: readonly string[]) => {
    const normalizedHeaders = headers.map(normalizeHeaderName);
    const normalizedAliases = aliases.map(normalizeHeaderName);
    for (let i = 0; i < normalizedHeaders.length; i++) {
      const header = normalizedHeaders[i];
      for (const alias of normalizedAliases) {
        if (header === alias || header.includes(alias)) {
          return i;
        }
      }
    }
    return -1;
  };

  let headerRowIndex = -1;
  let headerRow: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const candidate = rows[i];
    const actionIdx = findHeaderIndex(candidate, headerAliases.action);
    const qtyIdx = findHeaderIndex(candidate, headerAliases.quantity);
    const priceIdx = findHeaderIndex(candidate, headerAliases.transactionPrice);
    const dateIdx = findHeaderIndex(candidate, headerAliases.transactionDate);

    if (actionIdx >= 0 && qtyIdx >= 0 && priceIdx >= 0 && dateIdx >= 0) {
      headerRowIndex = i;
      headerRow = candidate;
      break;
    }
  }

  if (headerRowIndex === -1) {
    throw new Error(
      "Could not find header row in ICICI Direct Tradebook file. Please ensure you're uploading a valid tradebook report."
    );
  }

  const headerIndex = {
    stockSymbol: findHeaderIndex(headerRow, headerAliases.stockSymbol),
    companyName: findHeaderIndex(headerRow, headerAliases.companyName),
    isinCode: findHeaderIndex(headerRow, headerAliases.isinCode),
    action: findHeaderIndex(headerRow, headerAliases.action),
    quantity: findHeaderIndex(headerRow, headerAliases.quantity),
    transactionPrice: findHeaderIndex(headerRow, headerAliases.transactionPrice),
    transactionDate: findHeaderIndex(headerRow, headerAliases.transactionDate),
    transactionTime: findHeaderIndex(headerRow, headerAliases.transactionTime),
    exchange: findHeaderIndex(headerRow, headerAliases.exchange),
    segment: findHeaderIndex(headerRow, headerAliases.segment),
    brokerage: findHeaderIndex(headerRow, headerAliases.brokerage),
    transactionCharges: findHeaderIndex(headerRow, headerAliases.transactionCharges),
    stampDuty: findHeaderIndex(headerRow, headerAliases.stampDuty),
    sttPaid: findHeaderIndex(headerRow, headerAliases.sttPaid),
    series: findHeaderIndex(headerRow, headerAliases.series),
  };

  const transactions: ICICIDirectTransaction[] = [];
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const getValue = (index: number) => (index >= 0 ? row[index]?.trim() ?? "" : "");

    const actionValue = getValue(headerIndex.action);
    const action = parseICICIAction(actionValue);
    if (!action) continue;

    const quantity = parseNumberValue(getValue(headerIndex.quantity));
    if (quantity <= 0) continue;

    const transactionPrice = parseNumberValue(getValue(headerIndex.transactionPrice));
    const transactionDate = parseICICIDateTime(
      getValue(headerIndex.transactionDate),
      getValue(headerIndex.transactionTime)
    );

    const series = getValue(headerIndex.series);
    const rawSymbol = getValue(headerIndex.stockSymbol);
    const rawName = getValue(headerIndex.companyName);
    const stockSymbol = rawSymbol
      ? extractSymbolCandidate(rawSymbol, series)
      : extractSymbolCandidate(rawName, series);
    const companyName = rawName || stockSymbol || rawSymbol || "";

    transactions.push({
      stockSymbol:
        stockSymbol ||
        companyName.slice(0, 10).replace(/\s+/g, "").toUpperCase(),
      companyName: companyName || stockSymbol || rawSymbol || "",
      isinCode: getValue(headerIndex.isinCode),
      action,
      quantity,
      transactionPrice,
      brokerage: parseNumberValue(getValue(headerIndex.brokerage)),
      transactionCharges: parseNumberValue(getValue(headerIndex.transactionCharges)),
      stampDuty: parseNumberValue(getValue(headerIndex.stampDuty)),
      segment: getValue(headerIndex.segment),
      sttPaid: getValue(headerIndex.sttPaid).toLowerCase().includes("paid"),
      transactionDate,
      exchange: getValue(headerIndex.exchange),
    });
  }

  return transactions;
}

/**
 * Parse ICICI Direct PortFolioEqtSummary.csv (current holdings)
 */
export function parseICICIDirectHoldings(
  csvText: string
): ICICIDirectHolding[] {
  const lines = csvText.trim().split(/\r?\n/);
  const holdings: ICICIDirectHolding[] = [];

  // Skip header row
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = line.split(",");
    if (cols.length < 12) continue;

    const [
      stockSymbol,
      companyName,
      isinCode,
      qty,
      avgCostPrice,
      currentMarketPrice,
      _changePercent,
      valueAtCost,
      valueAtMarketPrice,
      _realizedPnL,
      unrealizedPnL,
    ] = cols;

    holdings.push({
      stockSymbol: stockSymbol.trim(),
      companyName: companyName.trim(),
      isinCode: isinCode.trim(),
      quantity: parseInt(qty.trim(), 10) || 0,
      avgCostPrice: parseFloat(avgCostPrice.trim()) || 0,
      currentMarketPrice:
        parseFloat(currentMarketPrice.replace(/[+\s]/g, "").trim()) || 0,
      valueAtCost: parseFloat(valueAtCost.trim()) || 0,
      valueAtMarketPrice: parseFloat(valueAtMarketPrice.trim()) || 0,
      unrealizedPnL: parseFloat(unrealizedPnL.replace(/[()]/g, "").trim()) || 0,
    });
  }

  return holdings;
}

/**
 * Convert ICICI Direct transactions to the common GrowwTransaction format
 * This allows reusing the existing reconciliation logic
 */
export async function convertICICIToGrowwFormat(
  iciciTransactions: ICICIDirectTransaction[]
): Promise<GrowwTransaction[]> {
  const mappings = await getSymbolMappings();
  const mapSymbol = (s: string) => mappings[s] || s;

  return iciciTransactions.map((tx) => ({
    stockName: tx.companyName,
    symbol: mapSymbol(tx.stockSymbol),
    isin: tx.isinCode,
    type: tx.action,
    quantity: tx.quantity,
    value: tx.quantity * tx.transactionPrice,
    productType: "DELIVERY",
    exchange: tx.exchange,
    exchangeOrderId: "",
    executedAt: tx.transactionDate,
    status: "Executed",
  }));
}
