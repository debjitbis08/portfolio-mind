import { createSignal, Show, For, onMount } from "solid-js";

interface MetricsResponse {
  summary: {
    total_approved: number;
    total_linked: number;
    hit_rate: number;
    avg_response_days: number | null;
    avg_gain_percent: number | null;
    total_realized_gain: number;
  };
  by_action: {
    action: string;
    count: number;
    linked: number;
    avg_gain_percent: number | null;
  }[];
  recent_links: {
    suggestion_id: string;
    symbol: string;
    action: string;
    transaction_value: number;
    gain_percent: number | null;
    days_to_act: number;
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
      const res = await fetch("/api/metrics?days=90");
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
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-text">📊 Performance Metrics</h2>
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
        {/* Summary Cards */}
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div class="bg-surface1 rounded-lg p-4">
            <p class="text-xs text-subtext0 uppercase tracking-wide">
              Hit Rate
            </p>
            <p class="text-2xl font-bold text-text mt-1">
              {data()!.summary.hit_rate}%
            </p>
            <p class="text-xs text-subtext0 mt-1">
              {data()!.summary.total_linked} / {data()!.summary.total_approved}{" "}
              approved
            </p>
          </div>

          <div class="bg-surface1 rounded-lg p-4">
            <p class="text-xs text-subtext0 uppercase tracking-wide">
              Avg Gain
            </p>
            <p
              class={`text-2xl font-bold mt-1 ${
                data()!.summary.avg_gain_percent !== null &&
                data()!.summary.avg_gain_percent! >= 0
                  ? "text-green"
                  : "text-red"
              }`}
            >
              {formatPercent(data()!.summary.avg_gain_percent)}
            </p>
            <p class="text-xs text-subtext0 mt-1">On linked BUY suggestions</p>
          </div>

          <div class="bg-surface1 rounded-lg p-4">
            <p class="text-xs text-subtext0 uppercase tracking-wide">
              Response Time
            </p>
            <p class="text-2xl font-bold text-text mt-1">
              {data()!.summary.avg_response_days !== null
                ? `${data()!.summary.avg_response_days} days`
                : "—"}
            </p>
            <p class="text-xs text-subtext0 mt-1">Avg days to act</p>
          </div>

          <div class="bg-surface1 rounded-lg p-4">
            <p class="text-xs text-subtext0 uppercase tracking-wide">
              Total Gain
            </p>
            <p
              class={`text-2xl font-bold mt-1 ${
                data()!.summary.total_realized_gain >= 0
                  ? "text-green"
                  : "text-red"
              }`}
            >
              {formatCurrency(data()!.summary.total_realized_gain)}
            </p>
            <p class="text-xs text-subtext0 mt-1">Realized on linked trades</p>
          </div>
        </div>

        {/* By Action Breakdown */}
        <Show when={data()!.by_action.length > 0}>
          <div class="bg-surface1 rounded-lg p-4">
            <h3 class="text-sm font-medium text-subtext1 mb-3">
              By Action Type
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
                    <div class="mt-2 flex items-baseline gap-2">
                      <span class="text-lg font-bold text-text">
                        {action.linked}/{action.count}
                      </span>
                      <span class="text-xs text-subtext0">linked</span>
                    </div>
                    <Show when={action.avg_gain_percent !== null}>
                      <p
                        class={`text-sm mt-1 ${
                          action.avg_gain_percent! >= 0
                            ? "text-green"
                            : "text-red"
                        }`}
                      >
                        {formatPercent(action.avg_gain_percent)} avg
                      </p>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* Recent Links */}
        <Show when={data()!.recent_links.length > 0}>
          <div class="bg-surface1 rounded-lg p-4">
            <h3 class="text-sm font-medium text-subtext1 mb-3">Recent Links</h3>
            <div class="space-y-2">
              <For each={data()!.recent_links}>
                {(link) => (
                  <div class="flex items-center justify-between bg-surface0 rounded p-3">
                    <div class="flex items-center gap-2">
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
                      <span class="font-medium text-text">{link.symbol}</span>
                      <span class="text-xs text-subtext0">
                        {formatCurrency(link.transaction_value)}
                      </span>
                    </div>
                    <div class="flex items-center gap-4">
                      <Show when={link.gain_percent !== null}>
                        <span
                          class={`text-sm font-medium ${
                            link.gain_percent! >= 0 ? "text-green" : "text-red"
                          }`}
                        >
                          {formatPercent(link.gain_percent)}
                        </span>
                      </Show>
                      <span class="text-xs text-subtext0">
                        {link.days_to_act}d to act
                      </span>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* Empty State */}
        <Show when={data()!.summary.total_linked === 0}>
          <div class="p-6 bg-surface1 rounded-lg text-center">
            <p class="text-subtext0">
              No linked suggestions yet. Link some transactions below to see
              performance metrics.
            </p>
          </div>
        </Show>
      </Show>
    </div>
  );
}
