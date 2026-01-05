/**
 * Screener Financials Parser
 *
 * Parses the "Data Sheet" from Screener.in Excel exports to extract
 * structured financial data (P&L, Balance Sheet, Cash Flow).
 */

import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";

// ============================================================================
// Types
// ============================================================================

export interface ParsedFinancials {
  symbol: string;
  companyName: string;
  annual: FinancialPeriod[];
  quarterly: FinancialPeriod[];
}

export interface FinancialPeriod {
  reportDate: string; // ISO date
  periodType: "annual" | "quarterly";

  // P&L
  sales: number | null;
  operatingProfit: number | null;
  netProfit: number | null;
  eps: number | null;
  opmPercent: number | null;

  // Balance Sheet
  equity: number | null;
  reserves: number | null;
  borrowings: number | null;
  receivables: number | null;
  inventory: number | null;

  // Cash Flow
  operatingCashFlow: number | null;
  investingCashFlow: number | null;
  financingCashFlow: number | null;

  // Price
  price: number | null;
}

// ============================================================================
// Excel Date Conversion
// ============================================================================

/**
 * Convert Excel serial date to ISO date string
 * Excel uses days since 1900-01-01 (with a leap year bug)
 */
function excelDateToISO(serial: number): string {
  // Excel incorrectly considers 1900 as a leap year, so we adjust
  const excelEpoch = new Date(1899, 11, 30);
  const date = new Date(excelEpoch.getTime() + serial * 24 * 60 * 60 * 1000);
  return date.toISOString().split("T")[0];
}

/**
 * Safely get a numeric value from a cell
 */
function getNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return isNaN(num) ? null : num;
}

// ============================================================================
// Row Indices in Data Sheet (0-indexed after header)
// ============================================================================

const ROW_INDICES = {
  // Meta
  COMPANY_NAME: 0,

  // Annual P&L (rows 15-30 in Excel, 0-indexed: 14-29)
  ANNUAL_REPORT_DATE: 15,
  ANNUAL_SALES: 16,
  ANNUAL_NET_PROFIT: 29,

  // Quarterly (rows 40-49)
  QUARTERLY_REPORT_DATE: 40,
  QUARTERLY_SALES: 41,
  QUARTERLY_EXPENSES: 42,
  QUARTERLY_NET_PROFIT: 48,
  QUARTERLY_OPERATING_PROFIT: 49,

  // Balance Sheet (rows 55-69)
  BS_REPORT_DATE: 55,
  BS_EQUITY: 56,
  BS_RESERVES: 57,
  BS_BORROWINGS: 58,
  BS_RECEIVABLES: 66,
  BS_INVENTORY: 67,

  // Cash Flow (rows 80-84)
  CF_REPORT_DATE: 80,
  CF_OPERATING: 81,
  CF_INVESTING: 82,
  CF_FINANCING: 83,

  // Price (row 89)
  PRICE: 89,
};

// ============================================================================
// Parser
// ============================================================================

/**
 * Parse Screener Excel export and extract structured financials
 */
export function parseScreenerExcel(filePath: string): ParsedFinancials {
  // Read file ourselves to avoid xlsx's internal fs issues with Vite SSR
  const buffer = readFileSync(filePath);
  const workbook = XLSX.read(buffer);
  const dataSheet = workbook.Sheets["Data Sheet"];

  if (!dataSheet) {
    throw new Error("Data Sheet not found in Excel file");
  }

  const data = XLSX.utils.sheet_to_json<unknown[]>(dataSheet, { header: 1 });

  // Extract company name
  const companyName = String(data[0]?.[1] || "Unknown");

  // Determine symbol from filename or company name
  const symbol = companyName
    .replace(/\s+LTD\.?$/i, "")
    .replace(/\s+LIMITED$/i, "")
    .replace(/\s+/g, "")
    .toUpperCase();

  // Parse annual data
  const annualDates =
    (data[ROW_INDICES.ANNUAL_REPORT_DATE] as unknown[])?.slice(1) || [];
  const annualSales =
    (data[ROW_INDICES.ANNUAL_SALES] as unknown[])?.slice(1) || [];
  const annualNetProfit =
    (data[ROW_INDICES.ANNUAL_NET_PROFIT] as unknown[])?.slice(1) || [];

  // Balance sheet data
  const bsDates =
    (data[ROW_INDICES.BS_REPORT_DATE] as unknown[])?.slice(1) || [];
  const bsEquity = (data[ROW_INDICES.BS_EQUITY] as unknown[])?.slice(1) || [];
  const bsReserves =
    (data[ROW_INDICES.BS_RESERVES] as unknown[])?.slice(1) || [];
  const bsBorrowings =
    (data[ROW_INDICES.BS_BORROWINGS] as unknown[])?.slice(1) || [];
  const bsReceivables =
    (data[ROW_INDICES.BS_RECEIVABLES] as unknown[])?.slice(1) || [];
  const bsInventory =
    (data[ROW_INDICES.BS_INVENTORY] as unknown[])?.slice(1) || [];

  // Cash flow data
  const cfOperating =
    (data[ROW_INDICES.CF_OPERATING] as unknown[])?.slice(1) || [];
  const cfInvesting =
    (data[ROW_INDICES.CF_INVESTING] as unknown[])?.slice(1) || [];
  const cfFinancing =
    (data[ROW_INDICES.CF_FINANCING] as unknown[])?.slice(1) || [];

  // Price data
  const prices = (data[ROW_INDICES.PRICE] as unknown[])?.slice(1) || [];

  // Build annual periods
  const annual: FinancialPeriod[] = [];
  for (let i = 0; i < annualDates.length; i++) {
    const dateSerial = getNumber(annualDates[i]);
    if (!dateSerial) continue;

    const sales = getNumber(annualSales[i]);
    const netProfit = getNumber(annualNetProfit[i]);
    const opmPercent = sales && netProfit ? (netProfit / sales) * 100 : null;

    annual.push({
      reportDate: excelDateToISO(dateSerial),
      periodType: "annual",
      sales,
      operatingProfit: null, // Not directly in annual data
      netProfit,
      eps: null, // Would need to calculate
      opmPercent,
      equity: getNumber(bsEquity[i]),
      reserves: getNumber(bsReserves[i]),
      borrowings: getNumber(bsBorrowings[i]),
      receivables: getNumber(bsReceivables[i]),
      inventory: getNumber(bsInventory[i]),
      operatingCashFlow: getNumber(cfOperating[i]),
      investingCashFlow: getNumber(cfInvesting[i]),
      financingCashFlow: getNumber(cfFinancing[i]),
      price: getNumber(prices[i]),
    });
  }

  // Parse quarterly data
  const quarterlyDates =
    (data[ROW_INDICES.QUARTERLY_REPORT_DATE] as unknown[])?.slice(1) || [];
  const quarterlySales =
    (data[ROW_INDICES.QUARTERLY_SALES] as unknown[])?.slice(1) || [];
  const quarterlyNetProfit =
    (data[ROW_INDICES.QUARTERLY_NET_PROFIT] as unknown[])?.slice(1) || [];
  const quarterlyOperatingProfit =
    (data[ROW_INDICES.QUARTERLY_OPERATING_PROFIT] as unknown[])?.slice(1) || [];

  const quarterly: FinancialPeriod[] = [];
  for (let i = 0; i < quarterlyDates.length; i++) {
    const dateSerial = getNumber(quarterlyDates[i]);
    if (!dateSerial) continue;

    const sales = getNumber(quarterlySales[i]);
    const operatingProfit = getNumber(quarterlyOperatingProfit[i]);
    const opmPercent =
      sales && operatingProfit ? (operatingProfit / sales) * 100 : null;

    quarterly.push({
      reportDate: excelDateToISO(dateSerial),
      periodType: "quarterly",
      sales,
      operatingProfit,
      netProfit: getNumber(quarterlyNetProfit[i]),
      eps: null,
      opmPercent,
      equity: null, // Balance sheet not per quarter
      reserves: null,
      borrowings: null,
      receivables: null,
      inventory: null,
      operatingCashFlow: null,
      investingCashFlow: null,
      financingCashFlow: null,
      price: null,
    });
  }

  return {
    symbol,
    companyName,
    annual,
    quarterly,
  };
}

/**
 * Parse Excel buffer (for downloaded files)
 */
export function parseScreenerExcelBuffer(
  buffer: Buffer,
  symbol: string
): ParsedFinancials {
  const workbook = XLSX.read(buffer);
  const dataSheet = workbook.Sheets["Data Sheet"];

  if (!dataSheet) {
    throw new Error("Data Sheet not found in Excel file");
  }

  const data = XLSX.utils.sheet_to_json<unknown[]>(dataSheet, { header: 1 });

  // Extract company name
  const companyName = String(data[0]?.[1] || "Unknown");

  // Use provided symbol or derive from company name
  const derivedSymbol =
    symbol ||
    companyName
      .replace(/\s+LTD\.?$/i, "")
      .replace(/\s+LIMITED$/i, "")
      .replace(/\s+/g, "")
      .toUpperCase();

  // Parse annual data
  const annualDates =
    (data[ROW_INDICES.ANNUAL_REPORT_DATE] as unknown[])?.slice(1) || [];
  const annualSales =
    (data[ROW_INDICES.ANNUAL_SALES] as unknown[])?.slice(1) || [];
  const annualNetProfit =
    (data[ROW_INDICES.ANNUAL_NET_PROFIT] as unknown[])?.slice(1) || [];

  // Balance sheet data
  const bsEquity = (data[ROW_INDICES.BS_EQUITY] as unknown[])?.slice(1) || [];
  const bsReserves =
    (data[ROW_INDICES.BS_RESERVES] as unknown[])?.slice(1) || [];
  const bsBorrowings =
    (data[ROW_INDICES.BS_BORROWINGS] as unknown[])?.slice(1) || [];
  const bsReceivables =
    (data[ROW_INDICES.BS_RECEIVABLES] as unknown[])?.slice(1) || [];
  const bsInventory =
    (data[ROW_INDICES.BS_INVENTORY] as unknown[])?.slice(1) || [];

  // Cash flow data
  const cfOperating =
    (data[ROW_INDICES.CF_OPERATING] as unknown[])?.slice(1) || [];
  const cfInvesting =
    (data[ROW_INDICES.CF_INVESTING] as unknown[])?.slice(1) || [];
  const cfFinancing =
    (data[ROW_INDICES.CF_FINANCING] as unknown[])?.slice(1) || [];

  // Price data
  const prices = (data[ROW_INDICES.PRICE] as unknown[])?.slice(1) || [];

  // Build annual periods
  const annual: FinancialPeriod[] = [];
  for (let i = 0; i < annualDates.length; i++) {
    const dateSerial = getNumber(annualDates[i]);
    if (!dateSerial) continue;

    const sales = getNumber(annualSales[i]);
    const netProfit = getNumber(annualNetProfit[i]);
    const opmPercent = sales && netProfit ? (netProfit / sales) * 100 : null;

    annual.push({
      reportDate: excelDateToISO(dateSerial),
      periodType: "annual",
      sales,
      operatingProfit: null,
      netProfit,
      eps: null,
      opmPercent,
      equity: getNumber(bsEquity[i]),
      reserves: getNumber(bsReserves[i]),
      borrowings: getNumber(bsBorrowings[i]),
      receivables: getNumber(bsReceivables[i]),
      inventory: getNumber(bsInventory[i]),
      operatingCashFlow: getNumber(cfOperating[i]),
      investingCashFlow: getNumber(cfInvesting[i]),
      financingCashFlow: getNumber(cfFinancing[i]),
      price: getNumber(prices[i]),
    });
  }

  // Parse quarterly data
  const quarterlyDates =
    (data[ROW_INDICES.QUARTERLY_REPORT_DATE] as unknown[])?.slice(1) || [];
  const quarterlySales =
    (data[ROW_INDICES.QUARTERLY_SALES] as unknown[])?.slice(1) || [];
  const quarterlyNetProfit =
    (data[ROW_INDICES.QUARTERLY_NET_PROFIT] as unknown[])?.slice(1) || [];
  const quarterlyOperatingProfit =
    (data[ROW_INDICES.QUARTERLY_OPERATING_PROFIT] as unknown[])?.slice(1) || [];

  const quarterly: FinancialPeriod[] = [];
  for (let i = 0; i < quarterlyDates.length; i++) {
    const dateSerial = getNumber(quarterlyDates[i]);
    if (!dateSerial) continue;

    const sales = getNumber(quarterlySales[i]);
    const operatingProfit = getNumber(quarterlyOperatingProfit[i]);
    const opmPercent =
      sales && operatingProfit ? (operatingProfit / sales) * 100 : null;

    quarterly.push({
      reportDate: excelDateToISO(dateSerial),
      periodType: "quarterly",
      sales,
      operatingProfit,
      netProfit: getNumber(quarterlyNetProfit[i]),
      eps: null,
      opmPercent,
      equity: null,
      reserves: null,
      borrowings: null,
      receivables: null,
      inventory: null,
      operatingCashFlow: null,
      investingCashFlow: null,
      financingCashFlow: null,
      price: null,
    });
  }

  return {
    symbol: derivedSymbol,
    companyName,
    annual,
    quarterly,
  };
}
