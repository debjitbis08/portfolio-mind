import { db, schema } from "../db";
import { and, asc, eq, inArray } from "drizzle-orm";

export type CatalystPerformanceMetrics = {
  profitFactor: number | null;
  winRate: number | null;
  maxDrawdownPercent: number | null;
  expectancyR: number | null;
  grossExpectancyR: number | null;
  avgWinR: number | null;
  avgLossR: number | null;
  grossProfit: number;
  grossLoss: number;
  closedTrades: number;
  defaultRiskUsed: number;
  grossProfitBeforeCharges: number | null;
  grossLossBeforeCharges: number | null;
  netPnL: number | null;
  grossPnL: number | null;
  leakage: number | null;
  impactRatioPercent: number | null;
  breakevenRR: number | null;
  breakevenCapital: number | null;
  efficiencyPercent: number | null;
  efficiencyGrade: "A" | "B" | "C" | "D" | "E" | "F" | null;
  avgDpChargePerSell: number | null;
  avgSellCharges: number | null;
  charges: {
    brokerage: number;
    statutory: number;
    dpCharges: number;
    totalCharges: number;
    stt: number;
    gst: number;
    stampDuty: number;
    exchangeCharges: number;
    sebiCharges: number;
    ipftCharges: number;
  };
};

const DEFAULT_RISK_PERCENT = 0.02;

type Lot = {
  quantity: number;
  pricePerShareNet: number;
  pricePerShareGross: number;
  executedAt: string;
  stopLoss: number | null;
};

type PerformanceTransaction = {
  id: string;
  symbol: string;
  type: "BUY" | "SELL" | "OPENING_BALANCE";
  quantity: number;
  value: number;
  brokerage: number;
  stt: number;
  stampDuty: number;
  exchangeCharges: number;
  sebiCharges: number;
  ipftCharges: number;
  dpCharges: number;
  gst: number;
  totalCharges: number;
  executedAt: string | null;
};

const normalizeSymbol = (symbol: string) =>
  symbol.replace(/\.NS$|\.BO$/i, "").trim();

const getNetValue = (tx: PerformanceTransaction) =>
  tx.type === "SELL"
    ? tx.value - (tx.totalCharges || 0)
    : tx.value + (tx.totalCharges || 0);

const getGrossValue = (tx: PerformanceTransaction) => tx.value;

const calculateRiskPerShare = (
  entryPrice: number,
  stopLoss: number | null
) => {
  if (stopLoss !== null && stopLoss < entryPrice) {
    return { riskPerShare: entryPrice - stopLoss, usedDefault: false };
  }
  return {
    riskPerShare: entryPrice * DEFAULT_RISK_PERCENT,
    usedDefault: true,
  };
};

const getEfficiencyGrade = (efficiencyPercent: number | null) => {
  if (efficiencyPercent === null || !Number.isFinite(efficiencyPercent)) {
    return null;
  }
  if (efficiencyPercent >= 90) return "A";
  if (efficiencyPercent >= 75) return "B";
  if (efficiencyPercent >= 60) return "C";
  if (efficiencyPercent >= 40) return "D";
  if (efficiencyPercent >= 20) return "E";
  return "F";
};

export async function calculateCatalystPerformanceMetrics(): Promise<CatalystPerformanceMetrics> {
  const brokerTransactions = await db
    .select({
      id: schema.transactions.id,
      symbol: schema.transactions.symbol,
      type: schema.transactions.type,
      quantity: schema.transactions.quantity,
      value: schema.transactions.value,
      brokerage: schema.transactions.brokerage,
      stt: schema.transactions.stt,
      stampDuty: schema.transactions.stampDuty,
      exchangeCharges: schema.transactions.exchangeCharges,
      sebiCharges: schema.transactions.sebiCharges,
      ipftCharges: schema.transactions.ipftCharges,
      dpCharges: schema.transactions.dpCharges,
      gst: schema.transactions.gst,
      totalCharges: schema.transactions.totalCharges,
      executedAt: schema.transactions.executedAt,
    })
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.status, "Executed"),
        eq(schema.transactions.portfolioType, "CATALYST")
      )
    )
    .orderBy(asc(schema.transactions.executedAt));

  const brokerLinked = await db
    .select({
      id: schema.transactions.id,
      symbol: schema.transactions.symbol,
      type: schema.transactions.type,
      quantity: schema.transactions.quantity,
      value: schema.transactions.value,
      brokerage: schema.transactions.brokerage,
      stt: schema.transactions.stt,
      stampDuty: schema.transactions.stampDuty,
      exchangeCharges: schema.transactions.exchangeCharges,
      sebiCharges: schema.transactions.sebiCharges,
      ipftCharges: schema.transactions.ipftCharges,
      dpCharges: schema.transactions.dpCharges,
      gst: schema.transactions.gst,
      totalCharges: schema.transactions.totalCharges,
      executedAt: schema.transactions.executedAt,
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

  const intradayTransactions = await db
    .select({
      id: schema.intradayTransactions.id,
      symbol: schema.intradayTransactions.symbol,
      type: schema.intradayTransactions.type,
      quantity: schema.intradayTransactions.quantity,
      pricePerShare: schema.intradayTransactions.pricePerShare,
      brokerage: schema.intradayTransactions.brokerage,
      stt: schema.intradayTransactions.stt,
      stampDuty: schema.intradayTransactions.stampDuty,
      exchangeCharges: schema.intradayTransactions.exchangeCharges,
      sebiCharges: schema.intradayTransactions.sebiCharges,
      ipftCharges: schema.intradayTransactions.ipftCharges,
      dpCharges: schema.intradayTransactions.dpCharges,
      gst: schema.intradayTransactions.gst,
      totalCharges: schema.intradayTransactions.totalCharges,
      executedAt: schema.intradayTransactions.executedAt,
      createdAt: schema.intradayTransactions.createdAt,
    })
    .from(schema.intradayTransactions)
    .where(eq(schema.intradayTransactions.portfolioType, "CATALYST"));

  const intradayLinked = await db
    .select({
      id: schema.intradayTransactions.id,
      symbol: schema.intradayTransactions.symbol,
      type: schema.intradayTransactions.type,
      quantity: schema.intradayTransactions.quantity,
      pricePerShare: schema.intradayTransactions.pricePerShare,
      brokerage: schema.intradayTransactions.brokerage,
      stt: schema.intradayTransactions.stt,
      stampDuty: schema.intradayTransactions.stampDuty,
      exchangeCharges: schema.intradayTransactions.exchangeCharges,
      sebiCharges: schema.intradayTransactions.sebiCharges,
      ipftCharges: schema.intradayTransactions.ipftCharges,
      dpCharges: schema.intradayTransactions.dpCharges,
      gst: schema.intradayTransactions.gst,
      totalCharges: schema.intradayTransactions.totalCharges,
      executedAt: schema.intradayTransactions.executedAt,
      createdAt: schema.intradayTransactions.createdAt,
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

  const brokerMerged = new Map<string, (typeof brokerTransactions)[0]>();
  for (const tx of brokerTransactions) brokerMerged.set(tx.id, tx);
  for (const tx of brokerLinked) brokerMerged.set(tx.id, tx);

  const intradayMerged = new Map<string, (typeof intradayTransactions)[0]>();
  for (const tx of intradayTransactions) intradayMerged.set(tx.id, tx);
  for (const tx of intradayLinked) {
      intradayMerged.set(tx.id, {
        id: tx.id,
        symbol: tx.symbol,
        type: tx.type,
        quantity: tx.quantity,
        pricePerShare: tx.pricePerShare,
        brokerage: tx.brokerage,
        stt: tx.stt,
        stampDuty: tx.stampDuty,
        exchangeCharges: tx.exchangeCharges,
        sebiCharges: tx.sebiCharges,
        ipftCharges: tx.ipftCharges,
        dpCharges: tx.dpCharges,
        gst: tx.gst,
        totalCharges: tx.totalCharges,
        executedAt: tx.executedAt,
        createdAt: tx.createdAt,
    });
  }

  const brokerRows = Array.from(brokerMerged.values());
  const intradayRows = Array.from(intradayMerged.values());

  const transactions: PerformanceTransaction[] = [
    ...brokerRows,
    ...intradayRows.map((tx) => ({
      id: tx.id,
      symbol: tx.symbol,
      type: tx.type,
      quantity: tx.quantity,
      value: tx.quantity * tx.pricePerShare,
      brokerage: tx.brokerage,
      stt: tx.stt,
      stampDuty: tx.stampDuty,
      exchangeCharges: tx.exchangeCharges,
      sebiCharges: tx.sebiCharges,
      ipftCharges: tx.ipftCharges,
      dpCharges: tx.dpCharges,
      gst: tx.gst,
      totalCharges: tx.totalCharges || 0,
      executedAt: tx.executedAt || tx.createdAt,
    })),
  ].sort((a, b) => {
    const aTime = new Date(a.executedAt || 0).getTime();
    const bTime = new Date(b.executedAt || 0).getTime();
    return aTime - bTime;
  });

  if (transactions.length === 0) {
    return {
      profitFactor: null,
      winRate: null,
      maxDrawdownPercent: null,
      expectancyR: null,
      avgWinR: null,
      avgLossR: null,
      grossProfit: 0,
      grossLoss: 0,
      closedTrades: 0,
      defaultRiskUsed: 0,
      grossProfitBeforeCharges: null,
      grossLossBeforeCharges: null,
      netPnL: null,
      grossPnL: null,
      leakage: null,
      impactRatioPercent: null,
      breakevenRR: null,
      breakevenCapital: null,
      efficiencyPercent: null,
      efficiencyGrade: null,
      avgDpChargePerSell: null,
      grossExpectancyR: null,
      charges: {
        brokerage: 0,
        statutory: 0,
        dpCharges: 0,
        totalCharges: 0,
        stt: 0,
        gst: 0,
        stampDuty: 0,
        exchangeCharges: 0,
        sebiCharges: 0,
        ipftCharges: 0,
      },
    };
  }

  const brokerTransactionIds = brokerRows.map((t) => t.id);
  const intradayTransactionIds = intradayRows.map((t) => t.id);
  const brokerSuggestionLinks =
    brokerTransactionIds.length > 0
      ? await db
          .select({
            transactionId: schema.suggestionTransactions.transactionId,
            suggestionId: schema.suggestionTransactions.suggestionId,
          })
          .from(schema.suggestionTransactions)
          .where(
            inArray(schema.suggestionTransactions.transactionId, brokerTransactionIds)
          )
      : [];

  const intradaySuggestionLinks =
    intradayTransactionIds.length > 0
      ? await db
          .select({
            transactionId: schema.intradaySuggestionLinks.intradayTransactionId,
            suggestionId: schema.intradaySuggestionLinks.suggestionId,
          })
          .from(schema.intradaySuggestionLinks)
          .where(
            inArray(
              schema.intradaySuggestionLinks.intradayTransactionId,
              intradayTransactionIds
            )
          )
      : [];

  const suggestionLinks = [
    ...brokerSuggestionLinks,
    ...intradaySuggestionLinks,
  ];

  const linkedSuggestionIds = [
    ...new Set(suggestionLinks.map((l) => l.suggestionId)),
  ];

  const suggestions =
    linkedSuggestionIds.length > 0
      ? await db
          .select()
          .from(schema.suggestions)
          .where(
            and(
              inArray(schema.suggestions.id, linkedSuggestionIds),
              eq(schema.suggestions.portfolioType, "CATALYST")
            )
          )
      : [];

  const suggestionById = new Map(suggestions.map((s) => [s.id, s]));
  const stopLossByTransactionId = new Map<string, number | null>();

  for (const link of suggestionLinks) {
    const suggestion = suggestionById.get(link.suggestionId);
    if (!suggestion) continue;
    stopLossByTransactionId.set(link.transactionId, suggestion.stopLoss);
  }

  const lotsBySymbol = new Map<string, Lot[]>();
  const tradePnLNet: number[] = [];
  const tradePnLGross: number[] = [];
  const tradeRNet: number[] = [];
  const tradeRGross: number[] = [];
  let totalEntryNotionalGross = 0;
  let defaultRiskUsed = 0;
  let sellTransactionCount = 0;
  let sellChargesTotal = 0;

  for (const tx of transactions) {
    if (tx.type === "OPENING_BALANCE") continue;

    const netValue = getNetValue(tx);
    const grossValue = getGrossValue(tx);
    const netPricePerShare = tx.quantity > 0 ? netValue / tx.quantity : 0;
    const grossPricePerShare = tx.quantity > 0 ? grossValue / tx.quantity : 0;
    const symbolKey = normalizeSymbol(tx.symbol);

    if (tx.type === "BUY") {
      const lots = lotsBySymbol.get(symbolKey) || [];
      lots.push({
        quantity: tx.quantity,
        pricePerShareNet: netPricePerShare,
        pricePerShareGross: grossPricePerShare,
        executedAt: tx.executedAt,
        stopLoss: stopLossByTransactionId.get(tx.id) ?? null,
      });
      lotsBySymbol.set(symbolKey, lots);
      continue;
    }

    if (tx.type !== "SELL") continue;
    sellTransactionCount += 1;
    sellChargesTotal += tx.totalCharges || 0;

    let remaining = tx.quantity;
    const lots = lotsBySymbol.get(symbolKey) || [];
    while (remaining > 0 && lots.length > 0) {
      const lot = lots[0];
      const matchedQty = Math.min(remaining, lot.quantity);
      const pnlNet =
        (netPricePerShare - lot.pricePerShareNet) * matchedQty;
      const pnlGross =
        (grossPricePerShare - lot.pricePerShareGross) * matchedQty;
      tradePnLNet.push(pnlNet);
      tradePnLGross.push(pnlGross);
      totalEntryNotionalGross += lot.pricePerShareGross * matchedQty;

      const stopLoss = lot.stopLoss;
      const netRisk = calculateRiskPerShare(
        lot.pricePerShareNet,
        stopLoss
      );
      if (netRisk.usedDefault) {
        defaultRiskUsed += 1;
      }

      const grossRisk = calculateRiskPerShare(
        lot.pricePerShareGross,
        stopLoss
      );

      const netRiskValue = netRisk.riskPerShare * matchedQty;
      const grossRiskValue = grossRisk.riskPerShare * matchedQty;
      tradeRNet.push(netRiskValue > 0 ? pnlNet / netRiskValue : 0);
      tradeRGross.push(grossRiskValue > 0 ? pnlGross / grossRiskValue : 0);

      lot.quantity -= matchedQty;
      remaining -= matchedQty;

      if (lot.quantity <= 0) {
        lots.shift();
      }
    }
    lotsBySymbol.set(symbolKey, lots);
  }

  if (tradePnLNet.length === 0) {
    const charges = {
      brokerage: 0,
      statutory: 0,
      dpCharges: 0,
      totalCharges: 0,
      stt: 0,
      gst: 0,
      stampDuty: 0,
      exchangeCharges: 0,
      sebiCharges: 0,
      ipftCharges: 0,
    };
    for (const tx of transactions) {
      if (tx.type === "OPENING_BALANCE") continue;
      charges.brokerage += tx.brokerage || 0;
      charges.stt += tx.stt || 0;
      charges.gst += tx.gst || 0;
      charges.stampDuty += tx.stampDuty || 0;
      charges.exchangeCharges += tx.exchangeCharges || 0;
      charges.sebiCharges += tx.sebiCharges || 0;
      charges.ipftCharges += tx.ipftCharges || 0;
      charges.dpCharges += tx.dpCharges || 0;
      charges.totalCharges += tx.totalCharges || 0;
    }
    charges.statutory =
      charges.stt +
      charges.gst +
      charges.stampDuty +
      charges.exchangeCharges +
      charges.sebiCharges +
      charges.ipftCharges;
    return {
      profitFactor: null,
      winRate: null,
      maxDrawdownPercent: null,
      expectancyR: null,
      grossExpectancyR: null,
      avgWinR: null,
      avgLossR: null,
      grossProfit: 0,
      grossLoss: 0,
      closedTrades: 0,
      defaultRiskUsed,
      grossProfitBeforeCharges: null,
      grossLossBeforeCharges: null,
      netPnL: null,
      grossPnL: null,
      leakage: null,
      impactRatioPercent: null,
      breakevenRR: null,
      breakevenCapital: null,
      efficiencyPercent: null,
      efficiencyGrade: null,
      avgDpChargePerSell: null,
      avgSellCharges: null,
      charges,
    };
  }

  const grossProfit = tradePnLNet
    .filter((p) => p > 0)
    .reduce((a, b) => a + b, 0);
  const grossLoss = tradePnLNet
    .filter((p) => p < 0)
    .reduce((a, b) => a + b, 0);
  const profitFactor =
    grossLoss !== 0 ? Math.abs(grossProfit / grossLoss) : null;

  const winningTrades = tradePnLNet.filter((p) => p > 0).length;
  const winRate = (winningTrades / tradePnLNet.length) * 100;

  let equity = 0;
  let peak = 0;
  let maxDrawdownPercent = 0;
  for (const pnl of tradePnLNet) {
    equity += pnl;
    if (equity > peak) peak = equity;
    if (peak > 0) {
      const drawdown = ((peak - equity) / peak) * 100;
      if (drawdown > maxDrawdownPercent) {
        maxDrawdownPercent = drawdown;
      }
    }
  }

  const avgWinR =
    tradeRNet.filter((r) => r > 0).reduce((a, b) => a + b, 0) /
    Math.max(1, tradeRNet.filter((r) => r > 0).length);
  const avgLossR =
    tradeRNet.filter((r) => r < 0).reduce((a, b) => a + b, 0) /
    Math.max(1, tradeRNet.filter((r) => r < 0).length);
  const expectancyR =
    tradeRNet.reduce((a, b) => a + b, 0) / tradeRNet.length;
  const grossExpectancyR =
    tradeRGross.reduce((a, b) => a + b, 0) / tradeRGross.length;

  const grossProfitBeforeCharges = tradePnLGross
    .filter((p) => p > 0)
    .reduce((a, b) => a + b, 0);
  const grossLossBeforeCharges = tradePnLGross
    .filter((p) => p < 0)
    .reduce((a, b) => a + b, 0);
  const grossPnL = grossProfitBeforeCharges + grossLossBeforeCharges;
  const netPnL = grossProfit + grossLoss;

  const charges = {
    brokerage: 0,
    statutory: 0,
    dpCharges: 0,
    totalCharges: 0,
    stt: 0,
    gst: 0,
    stampDuty: 0,
    exchangeCharges: 0,
    sebiCharges: 0,
    ipftCharges: 0,
  };
  for (const tx of transactions) {
    if (tx.type === "OPENING_BALANCE") continue;
    charges.brokerage += tx.brokerage || 0;
    charges.stt += tx.stt || 0;
    charges.gst += tx.gst || 0;
    charges.stampDuty += tx.stampDuty || 0;
    charges.exchangeCharges += tx.exchangeCharges || 0;
    charges.sebiCharges += tx.sebiCharges || 0;
    charges.ipftCharges += tx.ipftCharges || 0;
    charges.dpCharges += tx.dpCharges || 0;
    charges.totalCharges += tx.totalCharges || 0;
  }
  charges.statutory =
    charges.stt +
    charges.gst +
    charges.stampDuty +
    charges.exchangeCharges +
    charges.sebiCharges +
    charges.ipftCharges;

  const impactRatioPercent =
    grossProfitBeforeCharges > 0
      ? (charges.totalCharges / grossProfitBeforeCharges) * 100
      : null;

  const leakage = grossPnL - netPnL;
  const breakevenRR =
    winRate > 0 && avgLossR < 0
      ? Math.abs(avgLossR) * ((100 - winRate) / winRate)
      : null;
  const efficiencyPercent =
    grossProfitBeforeCharges !== 0
      ? (netPnL / grossProfitBeforeCharges) * 100
      : null;
  const efficiencyGrade = getEfficiencyGrade(efficiencyPercent);
  const avgDpChargePerSell =
    sellTransactionCount > 0
      ? charges.dpCharges / sellTransactionCount
      : null;
  const avgSellCharges =
    sellTransactionCount > 0 ? sellChargesTotal / sellTransactionCount : null;
  const grossReturnRate =
    totalEntryNotionalGross > 0
      ? grossProfitBeforeCharges / totalEntryNotionalGross
      : null;
  const avgChargesPerTrade =
    tradePnLNet.length > 0
      ? charges.totalCharges / tradePnLNet.length
      : null;
  const breakevenCapital =
    grossReturnRate && grossReturnRate > 0 && avgChargesPerTrade
      ? avgChargesPerTrade / (0.1 * grossReturnRate)
      : null;

  return {
    profitFactor,
    winRate,
    maxDrawdownPercent,
    expectancyR,
    grossExpectancyR: Number.isFinite(grossExpectancyR)
      ? grossExpectancyR
      : null,
    avgWinR: Number.isFinite(avgWinR) ? avgWinR : null,
    avgLossR: Number.isFinite(avgLossR) ? avgLossR : null,
    grossProfit,
    grossLoss: Math.abs(grossLoss),
    closedTrades: tradePnLNet.length,
    defaultRiskUsed,
    grossProfitBeforeCharges: Number.isFinite(grossProfitBeforeCharges)
      ? grossProfitBeforeCharges
      : null,
    grossLossBeforeCharges: Number.isFinite(grossLossBeforeCharges)
      ? Math.abs(grossLossBeforeCharges)
      : null,
    netPnL: Number.isFinite(netPnL) ? netPnL : null,
    grossPnL: Number.isFinite(grossPnL) ? grossPnL : null,
    leakage: Number.isFinite(leakage) ? leakage : null,
    impactRatioPercent,
    breakevenRR,
    breakevenCapital: Number.isFinite(breakevenCapital)
      ? breakevenCapital
      : null,
    efficiencyPercent: Number.isFinite(efficiencyPercent)
      ? efficiencyPercent
      : null,
    efficiencyGrade,
    avgDpChargePerSell: Number.isFinite(avgDpChargePerSell)
      ? avgDpChargePerSell
      : null,
    avgSellCharges: Number.isFinite(avgSellCharges) ? avgSellCharges : null,
    charges,
  };
}
