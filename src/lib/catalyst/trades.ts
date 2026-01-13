import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../db";

export type CatalystTrade = {
  id: string;
  symbol: string;
  stockName: string | null;
  type: "BUY" | "SELL";
  quantity: number;
  pricePerShare: number;
  executedAt: string | null;
  createdAt: string | null;
  portfolioType: "LONGTERM" | "CATALYST";
  source: "BROKER" | "INTRADAY";
};

type BrokerRow = {
  id: string;
  symbol: string;
  stockName: string;
  type: "BUY" | "SELL" | "OPENING_BALANCE";
  quantity: number;
  value: number;
  executedAt: string;
  createdAt: string | null;
  portfolioType: "LONGTERM" | "CATALYST";
};

type IntradayRow = {
  id: string;
  symbol: string;
  stockName: string | null;
  type: "BUY" | "SELL";
  quantity: number;
  pricePerShare: number;
  executedAt: string | null;
  createdAt: string | null;
  portfolioType: "LONGTERM" | "CATALYST";
};

const normalizeTradeTime = (trade: {
  executedAt: string | null;
  createdAt: string | null;
}) => trade.executedAt || trade.createdAt || null;

const compareTradeTimeDesc = (a: CatalystTrade, b: CatalystTrade) => {
  const aTime = new Date(a.executedAt || a.createdAt || 0).getTime();
  const bTime = new Date(b.executedAt || b.createdAt || 0).getTime();
  return bTime - aTime;
};

const mapBrokerRow = (row: BrokerRow): CatalystTrade | null => {
  if (row.type === "OPENING_BALANCE") return null;
  const pricePerShare = row.quantity > 0 ? row.value / row.quantity : 0;
  return {
    id: `broker-${row.id}`,
    symbol: row.symbol,
    stockName: row.stockName,
    type: row.type,
    quantity: row.quantity,
    pricePerShare,
    executedAt: normalizeTradeTime(row),
    createdAt: row.createdAt,
    portfolioType: row.portfolioType,
    source: "BROKER",
  };
};

const mapIntradayRow = (row: IntradayRow): CatalystTrade => ({
  id: `intraday-${row.id}`,
  symbol: row.symbol,
  stockName: row.stockName,
  type: row.type,
  quantity: row.quantity,
  pricePerShare: row.pricePerShare,
  executedAt: normalizeTradeTime(row),
  createdAt: row.createdAt,
  portfolioType: row.portfolioType,
  source: "INTRADAY",
});

export async function getCatalystTrades(): Promise<CatalystTrade[]> {
  const brokerDirect = await db
    .select({
      id: schema.transactions.id,
      symbol: schema.transactions.symbol,
      stockName: schema.transactions.stockName,
      type: schema.transactions.type,
      quantity: schema.transactions.quantity,
      value: schema.transactions.value,
      executedAt: schema.transactions.executedAt,
      createdAt: schema.transactions.createdAt,
      portfolioType: schema.transactions.portfolioType,
    })
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.portfolioType, "CATALYST"),
        eq(schema.transactions.status, "Executed")
      )
    )
    .orderBy(desc(schema.transactions.executedAt));

  const brokerLinked = await db
    .select({
      id: schema.transactions.id,
      symbol: schema.transactions.symbol,
      stockName: schema.transactions.stockName,
      type: schema.transactions.type,
      quantity: schema.transactions.quantity,
      value: schema.transactions.value,
      executedAt: schema.transactions.executedAt,
      createdAt: schema.transactions.createdAt,
      portfolioType: schema.transactions.portfolioType,
    })
    .from(schema.suggestionTransactions)
    .innerJoin(
      schema.transactions,
      eq(schema.suggestionTransactions.transactionId, schema.transactions.id)
    )
    .innerJoin(
      schema.suggestions,
      eq(schema.suggestionTransactions.suggestionId, schema.suggestions.id)
    )
    .where(
      and(
        eq(schema.suggestions.portfolioType, "CATALYST"),
        eq(schema.transactions.status, "Executed")
      )
    );

  const intradayDirect = await db
    .select({
      id: schema.intradayTransactions.id,
      symbol: schema.intradayTransactions.symbol,
      stockName: schema.intradayTransactions.stockName,
      type: schema.intradayTransactions.type,
      quantity: schema.intradayTransactions.quantity,
      pricePerShare: schema.intradayTransactions.pricePerShare,
      executedAt: schema.intradayTransactions.executedAt,
      createdAt: schema.intradayTransactions.createdAt,
      portfolioType: schema.intradayTransactions.portfolioType,
    })
    .from(schema.intradayTransactions)
    .where(eq(schema.intradayTransactions.portfolioType, "CATALYST"))
    .orderBy(desc(schema.intradayTransactions.createdAt));

  const intradayLinked = await db
    .select({
      id: schema.intradayTransactions.id,
      symbol: schema.intradayTransactions.symbol,
      stockName: schema.intradayTransactions.stockName,
      type: schema.intradayTransactions.type,
      quantity: schema.intradayTransactions.quantity,
      pricePerShare: schema.intradayTransactions.pricePerShare,
      executedAt: schema.intradayTransactions.executedAt,
      createdAt: schema.intradayTransactions.createdAt,
      portfolioType: schema.intradayTransactions.portfolioType,
    })
    .from(schema.intradaySuggestionLinks)
    .innerJoin(
      schema.intradayTransactions,
      eq(
        schema.intradaySuggestionLinks.intradayTransactionId,
        schema.intradayTransactions.id
      )
    )
    .innerJoin(
      schema.suggestions,
      eq(schema.intradaySuggestionLinks.suggestionId, schema.suggestions.id)
    )
    .where(eq(schema.suggestions.portfolioType, "CATALYST"));

  const brokerMerged = new Map<string, BrokerRow>();
  for (const tx of brokerDirect) brokerMerged.set(tx.id, tx);
  for (const tx of brokerLinked) brokerMerged.set(tx.id, tx);

  const intradayMerged = new Map<string, IntradayRow>();
  for (const tx of intradayDirect) intradayMerged.set(tx.id, tx);
  for (const tx of intradayLinked) intradayMerged.set(tx.id, tx);

  const brokerTrades = Array.from(brokerMerged.values())
    .map(mapBrokerRow)
    .filter((trade): trade is CatalystTrade => trade !== null);
  const intradayTrades = Array.from(intradayMerged.values()).map(mapIntradayRow);

  return [...brokerTrades, ...intradayTrades].sort(compareTradeTimeDesc);
}
