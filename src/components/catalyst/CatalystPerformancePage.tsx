import { createMemo, createSignal, For, onMount, Show } from "solid-js";

type CatalystHolding = {
  symbol: string;
  stock_name: string;
  quantity: number;
  avg_buy_price: number;
  invested_value: number;
  current_price: number;
  current_value: number;
  returns: number;
  returns_percent: number;
  rsi_14: number | null;
  sma_50: number | null;
  sma_200: number | null;
  price_vs_sma50: number | null;
  price_vs_sma200: number | null;
  zone_status: string | null;
  wait_reasons: string[] | null;
  technical_updated_at: string | null;
};

type HoldingsSummary = {
  current_value: number;
  invested_value: number;
  total_returns: number;
  total_returns_percent: number;
  holdings_count: number;
};

type CatalystTrade = {
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

type HoldingsResponse = {
  holdings: CatalystHolding[];
  summary: HoldingsSummary | null;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);

const formatPercent = (value: number) =>
  `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

const formatPercentPlain = (value: number) => `${value.toFixed(2)}%`;

const formatDateTime = (value: string | null) => {
  if (!value) return "Unknown";
  const date = new Date(value);
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const pnlClass = (value: number) =>
  value >= 0 ? "text-green" : "text-red";

const normalizeSymbol = (symbol: string) =>
  symbol.replace(/\.NS$|\.BO$/i, "").trim();

type Props = {
  initialHoldings?: HoldingsResponse | null;
  initialTrades?: CatalystTrade[];
  initialMetrics?: CatalystPerformanceMetrics | null;
};

type CatalystPerformanceMetrics = {
  profitFactor: number | null;
  winRate: number | null;
  maxDrawdownPercent: number | null;
  expectancyR: number | null;
  avgWinR: number | null;
  avgLossR: number | null;
  grossProfit: number;
  grossLoss: number;
  closedTrades: number;
  defaultRiskUsed: number;
};

export default function CatalystPerformancePage(props: Props) {
  const [holdings, setHoldings] = createSignal<HoldingsResponse | null>(
    props.initialHoldings ?? null
  );
  const [trades, setTrades] = createSignal<CatalystTrade[]>(
    props.initialTrades ?? []
  );
  const [metrics, setMetrics] =
    createSignal<CatalystPerformanceMetrics | null>(
      props.initialMetrics ?? null
    );
  const [loading, setLoading] = createSignal(
    typeof window !== "undefined" &&
      (!props.initialHoldings || !props.initialMetrics)
  );

  const getBaseUrl = () => {
    if (typeof window !== "undefined") {
      return window.location.origin;
    }
    return "";
  };

  onMount(async () => {
    try {
      setLoading(true);
      const [holdingsRes, tradesRes] = await Promise.all([
        fetch(`${getBaseUrl()}/api/catalyst/holdings`),
        fetch(`${getBaseUrl()}/api/catalyst/trades`),
      ]);
      const metricsRes = await fetch(
        `${getBaseUrl()}/api/catalyst/performance-metrics`
      );

      if (holdingsRes.ok) {
        setHoldings((await holdingsRes.json()) as HoldingsResponse);
      }

      if (tradesRes.ok) {
        const data = await tradesRes.json();
        setTrades((data.trades || []) as CatalystTrade[]);
      }

      if (metricsRes.ok) {
        setMetrics((await metricsRes.json()) as CatalystPerformanceMetrics);
      }
    } finally {
      setLoading(false);
    }
  });

  const priceMap = createMemo(() => {
    const map = new Map<string, number>();
    const data = holdings();
    if (data?.holdings) {
      for (const holding of data.holdings) {
        map.set(holding.symbol, holding.current_price);
        map.set(normalizeSymbol(holding.symbol), holding.current_price);
      }
    }
    return map;
  });

  const sortedTrades = createMemo(() => {
    const rows = [...(trades() || [])];
    rows.sort((a, b) => {
      const aTime = new Date(a.executedAt || a.createdAt || 0).getTime();
      const bTime = new Date(b.executedAt || b.createdAt || 0).getTime();
      return bTime - aTime;
    });
    return rows;
  });

  const tradeSummary = createMemo(() => {
    const rows = sortedTrades();
    let totalPnl = 0;
    let pricedCount = 0;
    for (const trade of rows) {
      const currentPrice =
        priceMap().get(trade.symbol) ||
        priceMap().get(normalizeSymbol(trade.symbol));
      if (!currentPrice) continue;
      const pnl =
        trade.type === "BUY"
          ? (currentPrice - trade.pricePerShare) * trade.quantity
          : (trade.pricePerShare - currentPrice) * trade.quantity;
      totalPnl += pnl;
      pricedCount += 1;
    }
    return { totalPnl, pricedCount };
  });

  const latestTrade = createMemo(() => sortedTrades()[0] || null);

  const latestTradePnl = createMemo(() => {
    const trade = latestTrade();
    if (!trade) return null;
    const currentPrice =
      priceMap().get(trade.symbol) ||
      priceMap().get(normalizeSymbol(trade.symbol));
    if (!currentPrice) return null;
    const pnl =
      trade.type === "BUY"
        ? (currentPrice - trade.pricePerShare) * trade.quantity
        : (trade.pricePerShare - currentPrice) * trade.quantity;
    return { pnl, currentPrice };
  });

  const summary = () => holdings()?.summary;
  const positions = () => holdings()?.holdings || [];
  const realizedPnL = createMemo(() => {
    const data = metrics();
    if (!data) return null;
    return data.grossProfit - data.grossLoss;
  });
  const unrealizedPnL = createMemo(() => {
    const data = summary();
    return data ? data.total_returns : null;
  });
  const totalPnL = createMemo(() => {
    const realized = realizedPnL();
    const unrealized = unrealizedPnL();
    if (realized === null && unrealized === null) return null;
    return (realized ?? 0) + (unrealized ?? 0);
  });

  return (
    <div class="max-w-7xl mx-auto px-4 py-6">
      <div class="mb-6">
        <h1 class="text-3xl font-bold text-text mb-2">
          Catalyst Performance
        </h1>
        <p class="text-subtext0">
          Live snapshot of swing positions and trades linked to catalyst ideas.
        </p>
      </div>

      <Show
        when={!loading()}
        fallback={<div class="text-subtext0">Loading performance...</div>}
      >
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div class="bg-surface0 border border-surface1 rounded-xl p-4">
            <div class="text-xs text-subtext0 mb-2">Profit Factor</div>
            <div class="text-2xl font-semibold text-text">
              {metrics()?.profitFactor !== null
                ? metrics()!.profitFactor.toFixed(2)
                : "—"}
            </div>
            <div class="text-xs text-subtext1">
              {metrics()?.closedTrades
                ? `${metrics()!.closedTrades} closed trades`
                : "No closed trades yet"}
            </div>
          </div>
          <div class="bg-surface0 border border-surface1 rounded-xl p-4">
            <div class="text-xs text-subtext0 mb-2">Win Rate</div>
            <div class="text-2xl font-semibold text-text">
              {metrics()?.winRate !== null
                ? formatPercentPlain(metrics()!.winRate)
                : "—"}
            </div>
            <div class="text-xs text-subtext1">
              {metrics()?.grossProfit
                ? `${formatCurrency(metrics()!.grossProfit)} gross profit`
                : "Awaiting broker trades"}
            </div>
          </div>
          <div class="bg-surface0 border border-surface1 rounded-xl p-4">
            <div class="text-xs text-subtext0 mb-2">Max Drawdown</div>
            <div class="text-2xl font-semibold text-text">
              {metrics()?.maxDrawdownPercent !== null
                ? `${metrics()!.maxDrawdownPercent.toFixed(2)}%`
                : "—"}
            </div>
            <div class="text-xs text-subtext1">
              {metrics()?.grossLoss
                ? `${formatCurrency(metrics()!.grossLoss)} gross loss`
                : "No drawdown data yet"}
            </div>
          </div>
          <div class="bg-surface0 border border-surface1 rounded-xl p-4">
            <div class="text-xs text-subtext0 mb-2">Expectancy (R)</div>
            <div class="text-2xl font-semibold text-text">
              {metrics()?.expectancyR !== null
                ? metrics()!.expectancyR.toFixed(2)
                : "—"}
            </div>
            <div class="text-xs text-subtext1">
              {metrics()?.defaultRiskUsed
                ? `${metrics()!.defaultRiskUsed} default risk uses`
                : "Based on stop-loss when available"}
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div class="bg-surface0 border border-surface1 rounded-xl p-4">
            <div class="text-xs text-subtext0 mb-2">Total P&amp;L</div>
            <div
              class={`text-2xl font-semibold ${
                totalPnL() !== null ? pnlClass(totalPnL()!) : "text-text"
              }`}
            >
              {totalPnL() !== null ? formatCurrency(totalPnL()!) : "—"}
            </div>
            <div class="text-xs text-subtext1">
              {totalPnL() !== null
                ? `Unrealized ${formatCurrency(
                    unrealizedPnL() ?? 0
                  )} • Realized ${formatCurrency(realizedPnL() ?? 0)}`
                : "No positions yet"}
            </div>
          </div>
          <div class="bg-surface0 border border-surface1 rounded-xl p-4">
            <div class="text-xs text-subtext0 mb-2">Trade P&amp;L</div>
            <div
              class={`text-2xl font-semibold ${pnlClass(
                tradeSummary().totalPnl
              )}`}
            >
              {sortedTrades().length > 0
                ? formatCurrency(tradeSummary().totalPnl)
                : "—"}
            </div>
            <div class="text-xs text-subtext1">
              {sortedTrades().length > 0
                ? `${tradeSummary().pricedCount} priced trade${
                    tradeSummary().pricedCount === 1 ? "" : "s"
                  }`
                : "No trades yet"}
            </div>
          </div>
          <div class="bg-surface0 border border-surface1 rounded-xl p-4">
            <div class="text-xs text-subtext0 mb-2">Latest Gain/Loss</div>
            <Show
              when={latestTrade() && latestTradePnl()}
              fallback={
                <div class="text-sm text-subtext1">
                  No priced trades yet
                </div>
              }
            >
              <div
                class={`text-2xl font-semibold ${pnlClass(
                  latestTradePnl()!.pnl
                )}`}
              >
                {formatCurrency(latestTradePnl()!.pnl)}
              </div>
              <div class="text-xs text-subtext1">
                {latestTrade()!.symbol} @{" "}
                {formatCurrency(latestTrade()!.pricePerShare)} •{" "}
                {formatDateTime(
                  latestTrade()!.executedAt || latestTrade()!.createdAt
                )}
              </div>
            </Show>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <div class="bg-surface0 border border-surface1 rounded-xl p-4">
            <div class="text-xs text-subtext0 mb-2">Unrealized P&amp;L</div>
            <div
              class={`text-2xl font-semibold ${
                unrealizedPnL() !== null ? pnlClass(unrealizedPnL()!) : "text-text"
              }`}
            >
              {unrealizedPnL() !== null
                ? formatCurrency(unrealizedPnL()!)
                : "—"}
            </div>
            <div class="text-xs text-subtext1">
              {summary()
                ? formatPercent(summary()!.total_returns_percent)
                : "No open positions yet"}
            </div>
          </div>
          <div class="bg-surface0 border border-surface1 rounded-xl p-4">
            <div class="text-xs text-subtext0 mb-2">Realized P&amp;L</div>
            <div
              class={`text-2xl font-semibold ${
                realizedPnL() !== null ? pnlClass(realizedPnL()!) : "text-text"
              }`}
            >
              {realizedPnL() !== null ? formatCurrency(realizedPnL()!) : "—"}
            </div>
            <div class="text-xs text-subtext1">
              {metrics()?.closedTrades
                ? `${metrics()!.closedTrades} closed trade${
                    metrics()!.closedTrades === 1 ? "" : "s"
                  }`
                : "No closed trades yet"}
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div class="lg:col-span-3 bg-surface0 border border-surface1 rounded-xl p-5">
            <div class="flex items-center justify-between mb-4">
              <div>
                <h2 class="text-lg font-semibold text-text">Positions</h2>
                <p class="text-xs text-subtext0">
                  {summary()
                    ? `${summary()!.holdings_count} active positions`
                    : "No active positions"}
                </p>
              </div>
              <Show when={summary()}>
                <div class="text-right text-xs text-subtext0">
                  <div>Total Value</div>
                  <div class="text-sm text-text font-medium">
                    {formatCurrency(summary()!.current_value)}
                  </div>
                </div>
              </Show>
            </div>

            <Show
              when={positions().length > 0}
              fallback={
                <div class="text-subtext0 text-sm">
                  No catalyst holdings yet.
                </div>
              }
            >
              <div class="space-y-3">
                <For each={positions()}>
                  {(position) => (
                    <div class="border border-surface2/70 rounded-lg p-3">
                      <div class="flex items-center justify-between mb-2">
                        <div>
                          <div class="text-sm font-semibold text-mauve">
                            {position.symbol}
                          </div>
                          <div class="text-xs text-subtext0">
                            {position.stock_name}
                          </div>
                        </div>
                        <div class="text-right">
                          <div
                            class={`text-sm font-semibold ${pnlClass(
                              position.returns
                            )}`}
                          >
                            {formatCurrency(position.returns)}
                          </div>
                          <div class="text-xs text-subtext0">
                            {formatPercent(position.returns_percent)}
                          </div>
                        </div>
                      </div>
                      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-subtext0">
                        <div>
                          <div>Qty</div>
                          <div class="text-text font-medium">
                            {position.quantity}
                          </div>
                        </div>
                        <div>
                          <div>Avg Buy</div>
                          <div class="text-text font-medium">
                            {formatCurrency(position.avg_buy_price)}
                          </div>
                        </div>
                        <div>
                          <div>Current</div>
                          <div class="text-text font-medium">
                            {formatCurrency(position.current_price)}
                          </div>
                        </div>
                        <div>
                          <div>Value</div>
                          <div class="text-text font-medium">
                            {formatCurrency(position.current_value)}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>

          <div class="lg:col-span-2 bg-surface0 border border-surface1 rounded-xl p-5">
            <div class="flex items-center justify-between mb-4">
              <div>
                <h2 class="text-lg font-semibold text-text">Trades</h2>
                <p class="text-xs text-subtext0">
                  Broker and intraday trades linked to catalyst
                </p>
              </div>
            </div>

            <Show
              when={sortedTrades().length > 0}
              fallback={
                <div class="text-subtext0 text-sm">
                  No trades logged.
                </div>
              }
            >
              <div class="space-y-3">
                <For each={sortedTrades()}>
                  {(trade) => {
                    const currentPrice = () =>
                      priceMap().get(trade.symbol) ||
                      priceMap().get(normalizeSymbol(trade.symbol)) ||
                      null;
                    const pnl = () => {
                      const latest = currentPrice();
                      if (!latest) return null;
                      return trade.type === "BUY"
                        ? (latest - trade.pricePerShare) * trade.quantity
                        : (trade.pricePerShare - latest) * trade.quantity;
                    };

                    return (
                      <div class="border border-surface2/70 rounded-lg p-3">
                        <div class="flex items-center justify-between mb-2">
                          <div>
                            <div class="text-sm font-semibold text-text">
                              {trade.symbol}
                            </div>
                            <div class="text-xs text-subtext0">
                              {formatDateTime(
                                trade.executedAt || trade.createdAt
                              )}
                            </div>
                          </div>
                          <div class="flex items-center gap-2">
                            <div
                              class={`text-xs font-medium px-2 py-0.5 rounded ${
                                trade.type === "BUY"
                                  ? "bg-green/20 text-green"
                                  : "bg-red/20 text-red"
                              }`}
                            >
                              {trade.type}
                            </div>
                            <div class="text-[10px] uppercase text-subtext0">
                              {trade.source}
                            </div>
                          </div>
                        </div>
                        <div class="grid grid-cols-2 gap-3 text-xs text-subtext0">
                          <div>
                            <div>Qty</div>
                            <div class="text-text font-medium">
                              {trade.quantity}
                            </div>
                          </div>
                          <div>
                            <div>Entry</div>
                            <div class="text-text font-medium">
                              {formatCurrency(trade.pricePerShare)}
                            </div>
                          </div>
                          <div>
                            <div>Last</div>
                            <div class="text-text font-medium">
                              {currentPrice()
                                ? formatCurrency(currentPrice()!)
                                : "—"}
                            </div>
                          </div>
                          <div>
                            <div>P&amp;L</div>
                            <div
                              class={`text-text font-semibold ${
                                pnl() !== null ? pnlClass(pnl()!) : ""
                              }`}
                            >
                              {pnl() !== null ? formatCurrency(pnl()!) : "—"}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
