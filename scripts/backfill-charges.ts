import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import {
  calculateChargesForSplit,
  calculateTransactionCharges,
  type TradeSide,
} from "../src/lib/charges";

type TransactionRow = {
  id: string;
  symbol: string;
  type: "BUY" | "SELL" | "OPENING_BALANCE";
  quantity: number;
  value: number;
  exchange: string | null;
  executedAt: string;
  totalCharges: number | null;
};

type IntradayRow = {
  id: string;
  type: "BUY" | "SELL";
  quantity: number;
  pricePerShare: number;
  totalCharges: number | null;
};

const DB_PATH = process.env.DATABASE_PATH || "./data/investor.db";
const args = new Set(process.argv.slice(2));
const force = args.has("--force");
const dryRun = args.has("--dry-run");

const pad = (value: number) => String(value).padStart(2, "0");
const getLocalDateKey = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "invalid-date";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}`;
};

const db = drizzle(new Database(DB_PATH), { schema });

async function backfillTransactions() {
  const rows: TransactionRow[] = await db
    .select({
      id: schema.transactions.id,
      symbol: schema.transactions.symbol,
      type: schema.transactions.type,
      quantity: schema.transactions.quantity,
      value: schema.transactions.value,
      exchange: schema.transactions.exchange,
      executedAt: schema.transactions.executedAt,
      totalCharges: schema.transactions.totalCharges,
    })
    .from(schema.transactions)
    .where(eq(schema.transactions.status, "Executed"));

  const grouped = new Map<string, TransactionRow[]>();
  for (const row of rows) {
    if (row.type === "OPENING_BALANCE") continue;
    const dateKey = getLocalDateKey(row.executedAt);
    const key = `${row.symbol}::${dateKey}`;
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      grouped.set(key, [row]);
    }
  }

  const intradayQtyByTx = new Map<string, number>();
  for (const groupRows of grouped.values()) {
    const sorted = [...groupRows].sort((a, b) => {
      const timeA = new Date(a.executedAt).getTime();
      const timeB = new Date(b.executedAt).getTime();
      return timeA - timeB;
    });

    const buyLots: Array<{ id: string; remaining: number }> = [];
    for (const tx of sorted) {
      if (tx.type === "BUY") {
        buyLots.push({ id: tx.id, remaining: tx.quantity });
        continue;
      }
      if (tx.type !== "SELL") continue;

      let remaining = tx.quantity;
      while (remaining > 0 && buyLots.length > 0) {
        const lot = buyLots[0];
        const matched = Math.min(remaining, lot.remaining);
        intradayQtyByTx.set(
          lot.id,
          (intradayQtyByTx.get(lot.id) || 0) + matched
        );
        intradayQtyByTx.set(
          tx.id,
          (intradayQtyByTx.get(tx.id) || 0) + matched
        );
        lot.remaining -= matched;
        remaining -= matched;
        if (lot.remaining <= 0) buyLots.shift();
      }
    }
  }

  let updated = 0;
  const updateRows = rows.filter((row) =>
    force ? true : (row.totalCharges || 0) === 0
  );

  if (dryRun) {
    console.log(
      `[Backfill] Transactions eligible: ${updateRows.length} (of ${rows.length})`
    );
    return;
  }

  await db.transaction(async (tx) => {
    for (const row of updateRows) {
      if (row.type === "OPENING_BALANCE") continue;

      const intradayQty = intradayQtyByTx.get(row.id) || 0;
      const ratio =
        row.quantity > 0
          ? Math.max(0, Math.min(1, intradayQty / row.quantity))
          : 0;

      const charges = calculateChargesForSplit({
        tradeValue: row.value,
        side: row.type as TradeSide,
        intradayRatio: ratio,
        exchange: row.exchange,
      });

      await tx
        .update(schema.transactions)
        .set({
          brokerage: charges.brokerage,
          stt: charges.stt,
          stampDuty: charges.stampDuty,
          exchangeCharges: charges.exchangeCharges,
          sebiCharges: charges.sebiCharges,
          ipftCharges: charges.ipftCharges,
          dpCharges: charges.dpCharges,
          gst: charges.gst,
          totalCharges: charges.totalCharges,
        })
        .where(eq(schema.transactions.id, row.id));
      updated += 1;
    }
  });

  console.log(`[Backfill] Transactions updated: ${updated}`);
}

async function backfillIntraday() {
  const rows: IntradayRow[] = await db
    .select({
      id: schema.intradayTransactions.id,
      type: schema.intradayTransactions.type,
      quantity: schema.intradayTransactions.quantity,
      pricePerShare: schema.intradayTransactions.pricePerShare,
      totalCharges: schema.intradayTransactions.totalCharges,
    })
    .from(schema.intradayTransactions);

  const updateRows = rows.filter((row) =>
    force ? true : (row.totalCharges || 0) === 0
  );

  if (dryRun) {
    console.log(
      `[Backfill] Intraday transactions eligible: ${updateRows.length} (of ${rows.length})`
    );
    return;
  }

  let updated = 0;
  await db.transaction(async (tx) => {
    for (const row of updateRows) {
      const tradeValue = row.quantity * row.pricePerShare;
      const charges = calculateTransactionCharges({
        tradeValue,
        side: row.type as TradeSide,
        productType: "INTRADAY",
      });

      await tx
        .update(schema.intradayTransactions)
        .set({
          brokerage: charges.brokerage,
          stt: charges.stt,
          stampDuty: charges.stampDuty,
          exchangeCharges: charges.exchangeCharges,
          sebiCharges: charges.sebiCharges,
          ipftCharges: charges.ipftCharges,
          dpCharges: charges.dpCharges,
          gst: charges.gst,
          totalCharges: charges.totalCharges,
        })
        .where(eq(schema.intradayTransactions.id, row.id));
      updated += 1;
    }
  });

  console.log(`[Backfill] Intraday transactions updated: ${updated}`);
}

async function run() {
  console.log(`[Backfill] Using database: ${DB_PATH}`);
  await backfillTransactions();
  await backfillIntraday();
}

run().catch((error) => {
  console.error("[Backfill] Failed:", error);
  process.exit(1);
});
