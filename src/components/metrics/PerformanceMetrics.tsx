import { createSignal, Show, For, onMount } from "solid-js";

interface MetricsResponse {
  summary: {
    total_pnl: number;
    total_pnl_percent: number;
    unrealized_pnl: number;
    realized_pnl: number;
    total_invested: number;
    win_rate: number;
    total_trades: number;
    winning_trades: number;
  };
  best_performer: {
    symbol: string;
    gain_percent: number;
    gain_amount: number;
  } | null;
  worst_performer: {
    symbol: string;
    gain_percent: number;
    gain_amount: number;
  } | null;
  by_action: {
    action: string;
    count: number;
    linked: number;
    total_pnl: number;
    avg_gain_percent: number | null;
  }[];
  recent_links: {
    suggestion_id: string;
    symbol: string;
    action: string;
    transaction_value: number;
    current_value: number;
    gain_amount: number;
    gain_percent: number;
    days_held: number;
    status: "holding" | "closed";
    linked_at: string;
  }[];
}

export default function PerformanceMetrics() {
  const [data, setData] = createSignal<MetricsResponse | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  const fetchMetrics = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/metrics?days=365");
      if (!res.ok) throw new Error("Failed to fetch metrics");
      const result = await res.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    fetchMetrics();
  });

  const formatCurrency = (value: number) => {
    const absValue = Math.abs(value);
    if (absValue >= 100000) {
      return `₹${(value / 100000).toFixed(2)}L`;
    }
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatPercent = (value: number | null) => {
    if (value === null) return "—";
    const sign = value >= 0 ? "+" : "";
    return `${sign}${value.toFixed(1)}%`;
  };

  return (
    <div class="space-y-6">
      {/* Header */}
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-text">📊 Bot Performance</h2>
        <button
          onClick={() => fetchMetrics()}
          class="px-3 py-1 text-sm bg-surface1 hover:bg-surface2 text-subtext0 rounded transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      <Show when={loading()}>
        <div class="text-center py-8 text-subtext0">
          <div class="animate-spin inline-block w-6 h-6 border-2 border-mauve border-t-transparent rounded-full" />
          <p class="mt-2">Loading metrics...</p>
        </div>
      </Show>

      <Show when={error()}>
        <div class="p-4 bg-red/20 border border-red/30 rounded text-red">
          Failed to load: {error()}
        </div>
      </Show>

      <Show when={!loading() && data()}>
        {/* Hero P&L Section */}
        <div
          class={`relative overflow-hidden rounded-2xl p-6 ${
            data()!.summary.total_pnl >= 0
              ? "bg-gradient-to-br from-green/10 to-green/5 border border-green/20"
              : "bg-gradient-to-br from-red/10 to-red/5 border border-red/20"
          }`}
        >
          <div class="text-center">
            <p class="text-sm text-subtext0 uppercase tracking-wide mb-2">
              Total Bot P&L Impact
            </p>
            <p
              class={`text-4xl font-bold ${
                data()!.summary.total_pnl >= 0 ? "text-green" : "text-red"
              }`}
            >
              {formatCurrency(data()!.summary.total_pnl)}
            </p>
            <p
              class={`text-xl mt-1 ${
                data()!.summary.total_pnl_percent >= 0
                  ? "text-green/80"
                  : "text-red/80"
              }`}
            >
              {formatPercent(data()!.summary.total_pnl_percent)}
            </p>
            <p class="text-xs text-subtext0 mt-2">
              on {formatCurrency(data()!.summary.total_invested)} invested via{" "}
              {data()!.summary.total_trades} trades
            </p>
          </div>

          {/* Unrealized / Realized Breakdown */}
          <div class="flex justify-center gap-8 mt-4 pt-4 border-t border-surface2/50">
            <div class="text-center">
              <p class="text-xs text-subtext0 uppercase">Unrealized</p>
              <p
                class={`text-lg font-semibold ${
                  data()!.summary.unrealized_pnl >= 0
                    ? "text-green/80"
                    : "text-red/80"
                }`}
              >
                {formatCurrency(data()!.summary.unrealized_pnl)}
              </p>
              <p class="text-xs text-subtext0">paper gain</p>
            </div>
            <div class="text-center">
              <p class="text-xs text-subtext0 uppercase">Realized</p>
              <p
                class={`text-lg font-semibold ${
                  data()!.summary.realized_pnl >= 0
                    ? "text-green/80"
                    : "text-red/80"
                }`}
              >
                {formatCurrency(data()!.summary.realized_pnl)}
              </p>
              <p class="text-xs text-subtext0">locked in</p>
            </div>
          </div>
        </div>

        {/* Secondary Stats Grid */}
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Win Rate */}
          <div class="bg-surface1 rounded-lg p-4">
            <p class="text-xs text-subtext0 uppercase tracking-wide">
              Win Rate
            </p>
            <p class="text-2xl font-bold text-text mt-1">
              {data()!.summary.win_rate}%
            </p>
            <p class="text-xs text-subtext0 mt-1">
              {data()!.summary.winning_trades}/{data()!.summary.total_trades}{" "}
              profitable
            </p>
          </div>

          {/* Best Performer */}
          <Show when={data()!.best_performer}>
            <div class="bg-surface1 rounded-lg p-4">
              <p class="text-xs text-subtext0 uppercase tracking-wide">
                Best Trade
              </p>
              <p class="text-lg font-bold text-green mt-1">
                {data()!.best_performer!.symbol}
              </p>
              <p class="text-sm text-green">
                {formatPercent(data()!.best_performer!.gain_percent)}
              </p>
            </div>
          </Show>

          {/* Worst Performer */}
          <Show when={data()!.worst_performer}>
            <div class="bg-surface1 rounded-lg p-4">
              <p class="text-xs text-subtext0 uppercase tracking-wide">
                Worst Trade
              </p>
              <p class="text-lg font-bold text-red mt-1">
                {data()!.worst_performer!.symbol}
              </p>
              <p class="text-sm text-red">
                {formatPercent(data()!.worst_performer!.gain_percent)}
              </p>
            </div>
          </Show>

          {/* By Action Summary */}
          <Show when={data()!.by_action.length > 0}>
            <div class="bg-surface1 rounded-lg p-4">
              <p class="text-xs text-subtext0 uppercase tracking-wide">
                Follow Rate
              </p>
              <p class="text-2xl font-bold text-text mt-1">
                {data()!.by_action.reduce((sum, a) => sum + a.linked, 0)}/
                {data()!.by_action.reduce((sum, a) => sum + a.count, 0)}
              </p>
              <p class="text-xs text-subtext0 mt-1">suggestions acted on</p>
            </div>
          </Show>
        </div>

        {/* By Action Breakdown */}
        <Show when={data()!.by_action.length > 0}>
          <div class="bg-surface1 rounded-lg p-4">
            <h3 class="text-sm font-medium text-subtext1 mb-3">
              P&L by Action Type
            </h3>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
              <For each={data()!.by_action}>
                {(action) => (
                  <div class="bg-surface0 rounded p-3">
                    <span
                      class={`px-2 py-0.5 text-xs font-bold rounded ${
                        action.action === "BUY"
                          ? "bg-green/20 text-green"
                          : action.action === "SELL"
                          ? "bg-red/20 text-red"
                          : "bg-surface2 text-subtext0"
                      }`}
                    >
                      {action.action}
                    </span>
                    <div class="mt-2">
                      <span
                        class={`text-lg font-bold ${
                          action.total_pnl >= 0 ? "text-green" : "text-red"
                        }`}
                      >
                        {formatCurrency(action.total_pnl)}
                      </span>
                    </div>
                    <p class="text-xs text-subtext0 mt-1">
                      {action.linked}/{action.count} linked
                      {action.avg_gain_percent !== null && (
                        <span
                          class={
                            action.avg_gain_percent >= 0
                              ? "text-green"
                              : "text-red"
                          }
                        >
                          {" "}
                          • {formatPercent(action.avg_gain_percent)} avg
                        </span>
                      )}
                    </p>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* Recent Links */}
        <Show when={data()!.recent_links.length > 0}>
          <div class="bg-surface1 rounded-lg p-4">
            <h3 class="text-sm font-medium text-subtext1 mb-3">
              Recent Bot Trades
            </h3>
            <div class="space-y-2">
              <For each={data()!.recent_links}>
                {(link) => (
                  <a
                    href={`/company/${link.symbol}`}
                    class="flex items-center justify-between bg-surface0 hover:bg-surface2 rounded p-3 transition-colors cursor-pointer"
                  >
                    <div class="flex items-center gap-3">
                      <span
                        class={`px-2 py-0.5 text-xs font-bold rounded ${
                          link.action === "BUY"
                            ? "bg-green/20 text-green"
                            : link.action === "SELL"
                            ? "bg-red/20 text-red"
                            : "bg-surface2 text-subtext0"
                        }`}
                      >
                        {link.action}
                      </span>
                      <div>
                        <span class="font-medium text-text">{link.symbol}</span>
                        <span class="text-xs text-subtext0 ml-2">
                          {formatCurrency(link.transaction_value)}
                        </span>
                      </div>
                    </div>
                    <div class="flex items-center gap-4">
                      <div class="text-right">
                        <span
                          class={`text-sm font-medium ${
                            link.gain_percent >= 0 ? "text-green" : "text-red"
                          }`}
                        >
                          {formatPercent(link.gain_percent)}
                        </span>
                        <span
                          class={`text-xs ml-1 ${
                            link.gain_amount >= 0
                              ? "text-green/70"
                              : "text-red/70"
                          }`}
                        >
                          ({link.gain_amount >= 0 ? "+" : ""}
                          {formatCurrency(link.gain_amount)})
                        </span>
                      </div>
                      <div class="text-right">
                        <span
                          class={`text-xs px-2 py-0.5 rounded ${
                            link.status === "holding"
                              ? "bg-blue/20 text-blue"
                              : "bg-surface2 text-subtext0"
                          }`}
                        >
                          {link.status === "holding"
                            ? "📈 Holding"
                            : "✓ Closed"}
                        </span>
                        <p class="text-xs text-subtext0 mt-0.5">
                          {link.days_held}d held
                        </p>
                      </div>
                    </div>
                  </a>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* Empty State */}
        <Show when={data()!.summary.total_trades === 0}>
          <div class="p-6 bg-surface1 rounded-lg text-center">
            <p class="text-subtext0">
              No linked suggestions yet. Link transactions to suggestions in the
              section below to track bot performance.
            </p>
          </div>
        </Show>
      </Show>
    </div>
  );
}
