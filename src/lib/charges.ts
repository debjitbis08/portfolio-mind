export type TradeSide = "BUY" | "SELL";
export type TradeProduct = "DELIVERY" | "INTRADAY";

export interface ChargeBreakdown {
  brokerage: number;
  stt: number;
  stampDuty: number;
  exchangeCharges: number;
  sebiCharges: number;
  ipftCharges: number;
  dpCharges: number;
  gst: number;
  totalCharges: number;
}

type Exchange = "NSE" | "BSE" | "UNKNOWN";

const GST_RATE = 0.18;

const EXCHANGE_CHARGE_RATE: Record<Exclude<Exchange, "UNKNOWN">, number> = {
  NSE: 0.0000297,
  BSE: 0.0000375,
};

const DELIVERY_RATES = {
  sttBuy: 0.001,
  sttSell: 0.001,
  stampDutyBuy: 0.00015,
};

const INTRADAY_RATES = {
  sttBuy: 0,
  sttSell: 0.00025,
  stampDutyBuy: 0.00003,
};

const SEBI_RATE = 0.000001;
const IPFT_RATE = 0.000001;

const BROKERAGE_RATE = 0.001;
const BROKERAGE_MAX = 20;
const BROKERAGE_MIN = 5;

const DP_CHARGE_FLAT = 20;
const DP_CHARGE_MIN_DEBIT = 100;

const round2 = (value: number) => Math.round(value * 100) / 100;

const resolveExchange = (exchange?: string | null): Exchange => {
  if (!exchange) return "UNKNOWN";
  const upper = exchange.toUpperCase();
  if (upper.includes("NSE")) return "NSE";
  if (upper.includes("BSE")) return "BSE";
  return "UNKNOWN";
};

const normalizeTradeValue = (value: number) => (Number.isFinite(value) ? value : 0);

export function calculateTransactionCharges(params: {
  tradeValue: number;
  side: TradeSide;
  productType: TradeProduct;
  exchange?: string | null;
}): ChargeBreakdown {
  const tradeValue = normalizeTradeValue(params.tradeValue);
  if (tradeValue <= 0) {
    return {
      brokerage: 0,
      stt: 0,
      stampDuty: 0,
      exchangeCharges: 0,
      sebiCharges: 0,
      ipftCharges: 0,
      dpCharges: 0,
      gst: 0,
      totalCharges: 0,
    };
  }
  const exchange = resolveExchange(params.exchange);
  const exchangeRate =
    exchange === "UNKNOWN" ? EXCHANGE_CHARGE_RATE.NSE : EXCHANGE_CHARGE_RATE[exchange];
  const rates = params.productType === "INTRADAY" ? INTRADAY_RATES : DELIVERY_RATES;

  const brokerageBase = tradeValue * BROKERAGE_RATE;
  const brokerage = round2(
    Math.max(Math.min(brokerageBase, BROKERAGE_MAX), BROKERAGE_MIN)
  );

  const sttRate = params.side === "BUY" ? rates.sttBuy : rates.sttSell;
  const stt = round2(tradeValue * sttRate);
  const stampDuty =
    params.side === "BUY" ? round2(tradeValue * rates.stampDutyBuy) : 0;
  const exchangeCharges = round2(tradeValue * exchangeRate);
  const sebiCharges = round2(tradeValue * SEBI_RATE);
  const ipftCharges = round2(tradeValue * IPFT_RATE);

  const dpCharges =
    params.productType === "DELIVERY" &&
    params.side === "SELL" &&
    tradeValue >= DP_CHARGE_MIN_DEBIT
      ? DP_CHARGE_FLAT
      : 0;

  const gstBase =
    brokerage + dpCharges + exchangeCharges + sebiCharges + ipftCharges;
  const gst = round2(gstBase * GST_RATE);

  const totalCharges = round2(
    brokerage +
      stt +
      stampDuty +
      exchangeCharges +
      sebiCharges +
      ipftCharges +
      dpCharges +
      gst
  );

  return {
    brokerage,
    stt,
    stampDuty,
    exchangeCharges,
    sebiCharges,
    ipftCharges,
    dpCharges,
    gst,
    totalCharges,
  };
}

export function calculateChargesForSplit(params: {
  tradeValue: number;
  side: TradeSide;
  intradayRatio: number;
  exchange?: string | null;
}): ChargeBreakdown {
  const tradeValue = normalizeTradeValue(params.tradeValue);
  if (tradeValue <= 0) {
    return {
      brokerage: 0,
      stt: 0,
      stampDuty: 0,
      exchangeCharges: 0,
      sebiCharges: 0,
      ipftCharges: 0,
      dpCharges: 0,
      gst: 0,
      totalCharges: 0,
    };
  }

  const intradayRatio = Math.max(0, Math.min(1, params.intradayRatio));
  const deliveryRatio = 1 - intradayRatio;
  const intradayValue = tradeValue * intradayRatio;
  const deliveryValue = tradeValue * deliveryRatio;

  const exchange = resolveExchange(params.exchange);
  const exchangeRate =
    exchange === "UNKNOWN" ? EXCHANGE_CHARGE_RATE.NSE : EXCHANGE_CHARGE_RATE[exchange];

  const brokerageBase = tradeValue * BROKERAGE_RATE;
  const brokerage = round2(
    Math.max(Math.min(brokerageBase, BROKERAGE_MAX), BROKERAGE_MIN)
  );

  const sttRateIntraday =
    params.side === "BUY" ? INTRADAY_RATES.sttBuy : INTRADAY_RATES.sttSell;
  const sttRateDelivery =
    params.side === "BUY" ? DELIVERY_RATES.sttBuy : DELIVERY_RATES.sttSell;
  const stt = round2(
    intradayValue * sttRateIntraday + deliveryValue * sttRateDelivery
  );

  const stampDuty =
    params.side === "BUY"
      ? round2(
          intradayValue * INTRADAY_RATES.stampDutyBuy +
            deliveryValue * DELIVERY_RATES.stampDutyBuy
        )
      : 0;

  const exchangeCharges = round2(tradeValue * exchangeRate);
  const sebiCharges = round2(tradeValue * SEBI_RATE);
  const ipftCharges = round2(tradeValue * IPFT_RATE);

  const dpCharges =
    params.side === "SELL" && deliveryValue >= DP_CHARGE_MIN_DEBIT
      ? DP_CHARGE_FLAT
      : 0;

  const gstBase =
    brokerage + dpCharges + exchangeCharges + sebiCharges + ipftCharges;
  const gst = round2(gstBase * GST_RATE);

  const totalCharges = round2(
    brokerage +
      stt +
      stampDuty +
      exchangeCharges +
      sebiCharges +
      ipftCharges +
      dpCharges +
      gst
  );

  return {
    brokerage,
    stt,
    stampDuty,
    exchangeCharges,
    sebiCharges,
    ipftCharges,
    dpCharges,
    gst,
    totalCharges,
  };
}
