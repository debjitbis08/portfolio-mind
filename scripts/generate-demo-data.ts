/**
 * Demo Data Generator for Portfolio Mind
 *
 * Generates Groww-format XLSX files with completely fictional stock data
 * for demo/testing purposes.
 *
 * Usage: npx tsx scripts/generate-demo-data.ts
 */

import * as XLSX from "xlsx";
import { mkdirSync, existsSync } from "fs";
import { join } from "path";

// ============================================================================
// Fictional Stock Data (Completely made up - not real companies)
// ============================================================================

interface DemoStock {
  name: string;
  symbol: string;
  isin: string;
  currentPrice: number;
  sector: string;
}

const DEMO_STOCKS: DemoStock[] = [
  // Large Cap Blue Chips
  {
    name: "Reliance Industries Ltd",
    symbol: "RELIANCE",
    isin: "INE002A01018",
    currentPrice: 1280,
    sector: "Conglomerate",
  },
  {
    name: "Tata Consultancy Services Ltd",
    symbol: "TCS",
    isin: "INE467B01029",
    currentPrice: 4150,
    sector: "IT Services",
  },
  {
    name: "HDFC Bank Ltd",
    symbol: "HDFCBANK",
    isin: "INE040A01034",
    currentPrice: 1720,
    sector: "Banking",
  },
  {
    name: "Infosys Ltd",
    symbol: "INFY",
    isin: "INE009A01021",
    currentPrice: 1890,
    sector: "IT Services",
  },
  {
    name: "ICICI Bank Ltd",
    symbol: "ICICIBANK",
    isin: "INE090A01021",
    currentPrice: 1280,
    sector: "Banking",
  },

  // Mid Cap Growth
  {
    name: "Bajaj Finance Ltd",
    symbol: "BAJFINANCE",
    isin: "INE296A01024",
    currentPrice: 7200,
    sector: "NBFC",
  },
  {
    name: "Asian Paints Ltd",
    symbol: "ASIANPAINT",
    isin: "INE021A01026",
    currentPrice: 2350,
    sector: "Paints",
  },
  {
    name: "Titan Company Ltd",
    symbol: "TITAN",
    isin: "INE280A01028",
    currentPrice: 3450,
    sector: "Consumer",
  },
  {
    name: "Avenue Supermarts Ltd",
    symbol: "DMART",
    isin: "INE192R01011",
    currentPrice: 3890,
    sector: "Retail",
  },
  {
    name: "ITC Ltd",
    symbol: "ITC",
    isin: "INE154A01025",
    currentPrice: 480,
    sector: "FMCG",
  },

  // Other Popular Stocks
  {
    name: "Hindustan Unilever Ltd",
    symbol: "HINDUNILVR",
    isin: "INE030A01027",
    currentPrice: 2450,
    sector: "FMCG",
  },
  {
    name: "Maruti Suzuki India Ltd",
    symbol: "MARUTI",
    isin: "INE585B01010",
    currentPrice: 11200,
    sector: "Auto",
  },
  {
    name: "Sun Pharmaceutical Industries Ltd",
    symbol: "SUNPHARMA",
    isin: "INE044A01036",
    currentPrice: 1780,
    sector: "Pharma",
  },
  {
    name: "Larsen & Toubro Ltd",
    symbol: "LT",
    isin: "INE018A01030",
    currentPrice: 3560,
    sector: "Infrastructure",
  },
  {
    name: "Kotak Mahindra Bank Ltd",
    symbol: "KOTAKBANK",
    isin: "INE237A01028",
    currentPrice: 1850,
    sector: "Banking",
  },

  // ETFs (real Nifty ETFs)
  {
    name: "Nippon India ETF Nifty BeES",
    symbol: "NIFTYBEES",
    isin: "INF204KB14I2",
    currentPrice: 265,
    sector: "ETF",
  },
  {
    name: "Nippon India ETF Gold BeES",
    symbol: "GOLDBEES",
    isin: "INF204KA1B16",
    currentPrice: 62,
    sector: "Gold ETF",
  },
];

// ============================================================================
// Transaction Generation Logic
// ============================================================================

interface GeneratedTransaction {
  stockName: string;
  symbol: string;
  isin: string;
  type: "BUY" | "SELL";
  quantity: number;
  value: number;
  exchange: string;
  exchangeOrderId: string;
  executionDateTime: string;
  status: string;
}

interface GeneratedHolding {
  stockName: string;
  isin: string;
  quantity: number;
  avgBuyPrice: number;
  buyValue: number;
  closingPrice: number;
  closingValue: number;
  unrealisedPnL: number;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function formatGrowwDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;
  return `${day}-${month}-${year} ${hour12}:${minutes} ${ampm}`;
}

function generateOrderId(): string {
  return `ORD${Date.now()}${randomInt(1000, 9999)}`;
}

function generateTransactions(): {
  transactions: GeneratedTransaction[];
  holdings: Map<
    string,
    { quantity: number; totalCost: number; stock: DemoStock }
  >;
} {
  const transactions: GeneratedTransaction[] = [];
  const holdings = new Map<
    string,
    { quantity: number; totalCost: number; stock: DemoStock }
  >();

  // Generate transactions over 2 years
  const startDate = new Date("2022-04-01");
  const endDate = new Date("2024-12-15");

  // Initial portfolio building (first 6 months - mostly buys)
  let currentDate = new Date(startDate);

  // Select 8-12 stocks to initially buy
  const portfolioStocks = [...DEMO_STOCKS]
    .sort(() => Math.random() - 0.5)
    .slice(0, randomInt(8, 12));

  for (const stock of portfolioStocks) {
    // Initial buy
    const buyDate = new Date(currentDate);
    buyDate.setDate(buyDate.getDate() + randomInt(1, 30));

    const quantity = randomInt(5, 50) * 5; // Multiples of 5
    const priceVariation = 0.7 + Math.random() * 0.4; // 70%-110% of current price
    const buyPrice =
      Math.round(stock.currentPrice * priceVariation * 100) / 100;
    const value = Math.round(quantity * buyPrice * 100) / 100;

    transactions.push({
      stockName: stock.name,
      symbol: stock.symbol,
      isin: stock.isin,
      type: "BUY",
      quantity,
      value,
      exchange: randomChoice(["NSE", "BSE"]),
      exchangeOrderId: generateOrderId(),
      executionDateTime: formatGrowwDate(buyDate),
      status: "Executed",
    });

    holdings.set(stock.symbol, {
      quantity,
      totalCost: value,
      stock,
    });

    currentDate = buyDate;
  }

  // Additional buys and some sells over time
  while (currentDate < endDate) {
    currentDate.setDate(currentDate.getDate() + randomInt(7, 45));
    if (currentDate >= endDate) break;

    // 70% chance of buy, 30% chance of sell
    const isBuy = Math.random() < 0.7;

    if (isBuy) {
      // Buy more of existing stock or new stock
      const addNew = Math.random() < 0.3;
      let stock: DemoStock;

      if (addNew) {
        // Pick a stock not in portfolio
        const available = DEMO_STOCKS.filter((s) => !holdings.has(s.symbol));
        if (available.length === 0) {
          stock = randomChoice([...holdings.values()]).stock;
        } else {
          stock = randomChoice(available);
        }
      } else {
        // Add to existing position
        stock = randomChoice([...holdings.values()]).stock;
      }

      const quantity = randomInt(5, 30) * 5;
      const priceVariation = 0.75 + Math.random() * 0.5;
      const buyPrice =
        Math.round(stock.currentPrice * priceVariation * 100) / 100;
      const value = Math.round(quantity * buyPrice * 100) / 100;

      transactions.push({
        stockName: stock.name,
        symbol: stock.symbol,
        isin: stock.isin,
        type: "BUY",
        quantity,
        value,
        exchange: randomChoice(["NSE", "BSE"]),
        exchangeOrderId: generateOrderId(),
        executionDateTime: formatGrowwDate(currentDate),
        status: "Executed",
      });

      const existing = holdings.get(stock.symbol) || {
        quantity: 0,
        totalCost: 0,
        stock,
      };
      holdings.set(stock.symbol, {
        quantity: existing.quantity + quantity,
        totalCost: existing.totalCost + value,
        stock,
      });
    } else {
      // Sell some of existing holdings
      const holdingsArray = [...holdings.entries()].filter(
        ([_, h]) => h.quantity > 10
      );
      if (holdingsArray.length > 0) {
        const [symbol, holding] = randomChoice(holdingsArray);
        const maxSell = Math.floor(holding.quantity * 0.5);
        if (maxSell >= 5) {
          const quantity = Math.min(maxSell, randomInt(5, 25) * 5);
          const priceVariation = 0.9 + Math.random() * 0.3;
          const sellPrice =
            Math.round(holding.stock.currentPrice * priceVariation * 100) / 100;
          const value = Math.round(quantity * sellPrice * 100) / 100;

          transactions.push({
            stockName: holding.stock.name,
            symbol: holding.stock.symbol,
            isin: holding.stock.isin,
            type: "SELL",
            quantity,
            value,
            exchange: randomChoice(["NSE", "BSE"]),
            exchangeOrderId: generateOrderId(),
            executionDateTime: formatGrowwDate(currentDate),
            status: "Executed",
          });

          const avgCost = holding.totalCost / holding.quantity;
          holdings.set(symbol, {
            quantity: holding.quantity - quantity,
            totalCost: (holding.quantity - quantity) * avgCost,
            stock: holding.stock,
          });

          // Remove if fully sold
          if (holdings.get(symbol)!.quantity <= 0) {
            holdings.delete(symbol);
          }
        }
      }
    }
  }

  // Sort transactions by date
  transactions.sort((a, b) => {
    const parseDate = (d: string) => {
      const [datePart, timePart, ampm] = d.split(" ");
      const [day, month, year] = datePart.split("-").map(Number);
      const [hour, minute] = timePart.split(":").map(Number);
      let h = hour;
      if (ampm === "PM" && h !== 12) h += 12;
      if (ampm === "AM" && h === 12) h = 0;
      return new Date(year, month - 1, day, h, minute);
    };
    return (
      parseDate(a.executionDateTime).getTime() -
      parseDate(b.executionDateTime).getTime()
    );
  });

  return { transactions, holdings };
}

function generateHoldingsFromComputed(
  holdings: Map<
    string,
    { quantity: number; totalCost: number; stock: DemoStock }
  >
): GeneratedHolding[] {
  const result: GeneratedHolding[] = [];

  for (const [_, holding] of holdings) {
    if (holding.quantity <= 0) continue;

    const avgBuyPrice =
      Math.round((holding.totalCost / holding.quantity) * 100) / 100;
    const closingPrice = holding.stock.currentPrice;
    const closingValue =
      Math.round(holding.quantity * closingPrice * 100) / 100;
    const buyValue = Math.round(holding.quantity * avgBuyPrice * 100) / 100;

    result.push({
      stockName: holding.stock.name,
      isin: holding.stock.isin,
      quantity: holding.quantity,
      avgBuyPrice,
      buyValue,
      closingPrice,
      closingValue,
      unrealisedPnL: Math.round((closingValue - buyValue) * 100) / 100,
    });
  }

  return result;
}

// ============================================================================
// XLSX Generation
// ============================================================================

function createOrderHistoryXLSX(
  transactions: GeneratedTransaction[]
): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();

  // Header rows (mimicking Groww format)
  const data: (string | number)[][] = [
    ["Order History"],
    [],
    [
      "Stock name",
      "Symbol",
      "ISIN",
      "Type",
      "Quantity",
      "Value",
      "Exchange",
      "Exchange Order ID",
      "Execution Date & Time",
      "Status",
    ],
  ];

  // Add transaction rows
  for (const tx of transactions) {
    data.push([
      tx.stockName,
      tx.symbol,
      tx.isin,
      tx.type,
      tx.quantity,
      tx.value,
      tx.exchange,
      tx.exchangeOrderId,
      tx.executionDateTime,
      tx.status,
    ]);
  }

  const sheet = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(workbook, sheet, "Order History");

  return workbook;
}

function createHoldingsXLSX(holdings: GeneratedHolding[]): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();

  // Header rows (mimicking Groww format)
  const data: (string | number)[][] = [
    ["Holdings Statement"],
    [],
    [
      "Stock Name",
      "ISIN",
      "Quantity",
      "Avg Buy Price",
      "Buy Value",
      "Closing Price",
      "Closing Value",
      "Unrealised P&L",
    ],
  ];

  // Add holding rows
  for (const h of holdings) {
    data.push([
      h.stockName,
      h.isin,
      h.quantity,
      h.avgBuyPrice,
      h.buyValue,
      h.closingPrice,
      h.closingValue,
      h.unrealisedPnL,
    ]);
  }

  const sheet = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(workbook, sheet, "Holdings");

  return workbook;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const demoDir = join(process.cwd(), "demo");
  const transactionsDir = join(demoDir, "transactions");
  const dbDir = join(demoDir, "db");

  // Create directories
  if (!existsSync(transactionsDir)) {
    mkdirSync(transactionsDir, { recursive: true });
  }
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  console.log("🎲 Generating demo portfolio data...\n");

  // Generate data
  const { transactions, holdings } = generateTransactions();
  const holdingsData = generateHoldingsFromComputed(holdings);

  console.log(`📊 Generated ${transactions.length} transactions`);
  console.log(`📦 Current holdings: ${holdingsData.length} stocks\n`);

  // Calculate portfolio stats
  let totalInvested = 0;
  let totalCurrent = 0;
  for (const h of holdingsData) {
    totalInvested += h.buyValue;
    totalCurrent += h.closingValue;
  }

  console.log("📈 Portfolio Summary:");
  console.log(`   Invested: ₹${totalInvested.toLocaleString("en-IN")}`);
  console.log(`   Current:  ₹${totalCurrent.toLocaleString("en-IN")}`);
  console.log(
    `   P&L:      ₹${(totalCurrent - totalInvested).toLocaleString(
      "en-IN"
    )} (${((totalCurrent / totalInvested - 1) * 100).toFixed(1)}%)`
  );
  console.log();

  // Create XLSX files
  const today = new Date();
  const dateStr = `${String(today.getDate()).padStart(2, "0")}-${String(
    today.getMonth() + 1
  ).padStart(2, "0")}-${today.getFullYear()}`;

  const orderHistoryFile = join(
    transactionsDir,
    `Demo_Order_History_${dateStr}.xlsx`
  );
  const holdingsFile = join(
    transactionsDir,
    `Demo_Holdings_Statement_${dateStr}.xlsx`
  );

  const orderHistoryWB = createOrderHistoryXLSX(transactions);
  XLSX.writeFile(orderHistoryWB, orderHistoryFile);
  console.log(`✅ Created: ${orderHistoryFile}`);

  const holdingsWB = createHoldingsXLSX(holdingsData);
  XLSX.writeFile(holdingsWB, holdingsFile);
  console.log(`✅ Created: ${holdingsFile}`);

  console.log("\n🚀 To run the app with demo data:");
  console.log("   DATABASE_PATH=./demo/db/investor.db pnpm dev");
  console.log(
    "\n   Then import the files from demo/transactions/ in the Settings page."
  );
}

main().catch(console.error);
