import { createSignal, createResource, For, Show, Switch, Match } from "solid-js";

type Signal = {
  id: string;
  keyword: string;
  ticker: string;
  action: "BUY_WATCH" | "SELL_WATCH";
  newsTitle: string;
  newsUrl: string;
  newsSource: string | null;
  newsPubDate: string | null;
  impactType: "SUPPLY_SHOCK" | "DEMAND_SHOCK" | "REGULATORY";
  sentiment: "BULLISH" | "BEARISH";
  confidence: number;
  reasoning: string;
  validationTicker: string | null;
  currentPrice: number | null;
  priceChangePercent: number | null;
  volumeRatio: number | null;
  volumeSpike: boolean | null;
  status: "active" | "pending_market_open" | "acted" | "expired" | "dismissed";
  actedAt: string | null;
  notes: string | null;
  createdAt: string;
  expiresAt: string | null;
};

type MetricsStats = {
  overall: {
    total: number;
    goodCalls: number;
    badCalls: number;
    neutral: number;
    pending: number;
    accuracy: string;
  };
  byKeyword: Array<{
    keyword: string;
    total: number;
    goodCalls: number;
    badCalls: number;
    avgConfidence: number;
  }>;
  byCheckpoint: {
    after1hr: {
      total: number;
      goodCalls: number;
      badCalls: number;
      neutral: number;
      accuracy: string;
    };
    nextSession: {
      total: number;
      goodCalls: number;
      badCalls: number;
      neutral: number;
      accuracy: string;
    };
    after24hr: {
      total: number;
      goodCalls: number;
      badCalls: number;
      neutral: number;
      accuracy: string;
    };
  };
};

type WatchlistItem = {
  id: string;
  keyword: string;
  ticker: string | null;
  assetType: "COMMODITY" | "EQUITY" | "ETF" | "CURRENCY" | "GLOBAL";
  globalValidationTicker: string | null;
  relatedTickers: string | null;
  enabled: boolean;
  notes: string | null;
  createdAt: string;
};

export default function CatalystPage() {
  const [activeTab, setActiveTab] = createSignal<"signals" | "metrics" | "watchlist">("signals");
  const [statusFilter, setStatusFilter] = createSignal<string>("active");

  // Get the base URL for API calls (works in both browser and SSR)
  const getBaseUrl = () => {
    if (typeof window !== "undefined") {
      return window.location.origin;
    }
    return ""; // Return empty string during SSR, resources won't fetch
  };

  // Fetch signals
  const [signals, { refetch: refetchSignals }] = createResource(
    () => ({ filter: statusFilter(), enabled: typeof window !== "undefined" }),
    async ({ filter, enabled }) => {
      if (!enabled) return [];
      const url = filter
        ? `${getBaseUrl()}/api/catalyst/signals?status=${filter}`
        : `${getBaseUrl()}/api/catalyst/signals`;
      const res = await fetch(url);
      const data = await res.json();
      return data.signals as Signal[];
    }
  );

  // Fetch metrics
  const [metrics] = createResource(
    () => ({ enabled: typeof window !== "undefined" }),
    async ({ enabled }) => {
      if (!enabled) return null;
      const res = await fetch(`${getBaseUrl()}/api/catalyst/metrics`);
      const data = await res.json();
      return data as MetricsStats;
    }
  );

  // Fetch watchlist
  const [watchlist, { refetch: refetchWatchlist }] = createResource(
    () => ({ enabled: typeof window !== "undefined" }),
    async ({ enabled }) => {
      if (!enabled) return [];
      const res = await fetch(`${getBaseUrl()}/api/catalyst/watchlist`);
      const data = await res.json();
      return data.watchlist as WatchlistItem[];
    }
  );

  const updateSignalStatus = async (id: string, status: string) => {
    await fetch(`${getBaseUrl()}/api/catalyst/signals`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    refetchSignals();
  };

  const toggleWatchlistItem = async (id: string, enabled: boolean) => {
    await fetch(`${getBaseUrl()}/api/catalyst/watchlist`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, enabled }),
    });
    refetchWatchlist();
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));

    if (hours < 1) {
      const minutes = Math.floor(diff / (1000 * 60));
      return `${minutes}m ago`;
    } else if (hours < 24) {
      return `${hours}h ago`;
    } else {
      const days = Math.floor(hours / 24);
      return `${days}d ago`;
    }
  };

  const getImpactColor = (impactType: string) => {
    switch (impactType) {
      case "SUPPLY_SHOCK": return "text-red";
      case "DEMAND_SHOCK": return "text-blue";
      case "REGULATORY": return "text-yellow";
      default: return "text-text";
    }
  };

  const getSentimentColor = (sentiment: string) => {
    return sentiment === "BULLISH" ? "text-green" : "text-red";
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      active: "bg-green/20 text-green",
      pending_market_open: "bg-yellow/20 text-yellow",
      acted: "bg-blue/20 text-blue",
      expired: "bg-overlay0/50 text-subtext0",
      dismissed: "bg-overlay0/50 text-subtext0",
    };
    return styles[status as keyof typeof styles] || styles.expired;
  };

  return (
    <div class="max-w-7xl mx-auto px-4 py-6">
      {/* Page Header */}
      <div class="mb-6">
        <h1 class="text-3xl font-bold text-text mb-2">Catalyst Catcher</h1>
        <p class="text-subtext0">
          AI-powered swing trading signals based on market-moving news events
        </p>
      </div>

      {/* Tabs */}
      <div class="flex gap-2 mb-6 border-b border-surface1">
        <button
          onClick={() => setActiveTab("signals")}
          class={`px-4 py-2 font-medium transition-colors ${
            activeTab() === "signals"
              ? "text-mauve border-b-2 border-mauve"
              : "text-subtext0 hover:text-text"
          }`}
        >
          Signals
        </button>
        <button
          onClick={() => setActiveTab("metrics")}
          class={`px-4 py-2 font-medium transition-colors ${
            activeTab() === "metrics"
              ? "text-mauve border-b-2 border-mauve"
              : "text-subtext0 hover:text-text"
          }`}
        >
          Metrics
        </button>
        <button
          onClick={() => setActiveTab("watchlist")}
          class={`px-4 py-2 font-medium transition-colors ${
            activeTab() === "watchlist"
              ? "text-mauve border-b-2 border-mauve"
              : "text-subtext0 hover:text-text"
          }`}
        >
          Watchlist
        </button>
      </div>

      {/* Tab Content */}
      <Switch>
        <Match when={activeTab() === "signals"}>
          <div class="space-y-4">
            {/* Filter */}
            <div class="flex gap-2">
              <button
                onClick={() => setStatusFilter("active")}
                class={`px-3 py-1 rounded-lg text-sm transition-colors ${
                  statusFilter() === "active"
                    ? "bg-green/20 text-green"
                    : "bg-surface1 text-subtext0 hover:bg-surface2"
                }`}
              >
                Active
              </button>
              <button
                onClick={() => setStatusFilter("pending_market_open")}
                class={`px-3 py-1 rounded-lg text-sm transition-colors ${
                  statusFilter() === "pending_market_open"
                    ? "bg-yellow/20 text-yellow"
                    : "bg-surface1 text-subtext0 hover:bg-surface2"
                }`}
              >
                Pending Market Open
              </button>
              <button
                onClick={() => setStatusFilter("")}
                class={`px-3 py-1 rounded-lg text-sm transition-colors ${
                  !statusFilter()
                    ? "bg-mauve/20 text-mauve"
                    : "bg-surface1 text-subtext0 hover:bg-surface2"
                }`}
              >
                All
              </button>
            </div>

            {/* Signals List */}
            <Show when={!signals.loading} fallback={<div class="text-subtext0">Loading signals...</div>}>
              <Show when={signals()?.length ?? 0 > 0} fallback={<div class="text-subtext0">No signals found</div>}>
                <div class="space-y-4">
                  <For each={signals()}>
                    {(signal) => (
                      <div class="bg-surface0 rounded-lg p-4 border border-surface1">
                        <div class="flex items-start justify-between mb-3">
                          <div class="flex-1">
                            <div class="flex items-center gap-2 mb-1">
                              <span class="font-semibold text-text">{signal.keyword}</span>
                              <span class="text-subtext0 text-sm">({signal.ticker})</span>
                              <span class={`text-sm font-medium ${getSentimentColor(signal.sentiment)}`}>
                                {signal.action}
                              </span>
                              <span class={`px-2 py-0.5 rounded text-xs ${getStatusBadge(signal.status)}`}>
                                {signal.status.replace(/_/g, " ")}
                              </span>
                            </div>
                            <div class="flex items-center gap-3 text-sm text-subtext0 mb-2">
                              <span class={getImpactColor(signal.impactType)}>{signal.impactType}</span>
                              <span>Confidence: {signal.confidence}/10</span>
                              <span>{formatDate(signal.createdAt)}</span>
                            </div>
                          </div>
                        </div>

                        <a
                          href={signal.newsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="text-mauve hover:text-mauve/80 font-medium mb-2 block"
                        >
                          {signal.newsTitle}
                        </a>

                        <p class="text-sm text-subtext1 mb-3">{signal.reasoning}</p>

                        <Show when={signal.currentPrice}>
                          <div class="flex items-center gap-4 text-sm text-subtext0 mb-3">
                            <span>Price: ₹{signal.currentPrice?.toFixed(2)}</span>
                            <span class={signal.priceChangePercent && signal.priceChangePercent > 0 ? "text-green" : "text-red"}>
                              {signal.priceChangePercent?.toFixed(2)}%
                            </span>
                            <Show when={signal.volumeSpike}>
                              <span class="text-yellow">Volume Spike!</span>
                            </Show>
                          </div>
                        </Show>

                        <div class="flex gap-2">
                          <Show when={signal.status === "active" || signal.status === "pending_market_open"}>
                            <button
                              onClick={() => updateSignalStatus(signal.id, "acted")}
                              class="px-3 py-1 bg-green/20 text-green rounded-lg text-sm hover:bg-green/30 transition-colors"
                            >
                              Mark Acted
                            </button>
                            <button
                              onClick={() => updateSignalStatus(signal.id, "dismissed")}
                              class="px-3 py-1 bg-red/20 text-red rounded-lg text-sm hover:bg-red/30 transition-colors"
                            >
                              Dismiss
                            </button>
                          </Show>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </div>
        </Match>

        <Match when={activeTab() === "metrics"}>
          <Show when={!metrics.loading} fallback={<div class="text-subtext0">Loading metrics...</div>}>
            <Show when={metrics()}>
              <div class="space-y-6">
                {/* Overall Stats */}
                <div class="bg-surface0 rounded-lg p-6 border border-surface1">
                  <h2 class="text-xl font-bold text-text mb-4">Overall Accuracy</h2>
                  <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <div>
                      <div class="text-3xl font-bold text-mauve">{metrics()!.overall.accuracy}%</div>
                      <div class="text-sm text-subtext0">Accuracy</div>
                    </div>
                    <div>
                      <div class="text-3xl font-bold text-text">{metrics()!.overall.total}</div>
                      <div class="text-sm text-subtext0">Total</div>
                    </div>
                    <div>
                      <div class="text-3xl font-bold text-green">{metrics()!.overall.goodCalls}</div>
                      <div class="text-sm text-subtext0">Good Calls</div>
                    </div>
                    <div>
                      <div class="text-3xl font-bold text-red">{metrics()!.overall.badCalls}</div>
                      <div class="text-sm text-subtext0">Bad Calls</div>
                    </div>
                    <div>
                      <div class="text-3xl font-bold text-yellow">{metrics()!.overall.pending}</div>
                      <div class="text-sm text-subtext0">Pending</div>
                    </div>
                  </div>
                </div>

                {/* By Checkpoint */}
                <div class="bg-surface0 rounded-lg p-6 border border-surface1">
                  <h2 class="text-xl font-bold text-text mb-4">Accuracy by Timeframe</h2>
                  <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <div class="text-2xl font-bold text-mauve">{metrics()!.byCheckpoint.after1hr.accuracy}%</div>
                      <div class="text-sm text-subtext0 mb-2">After 1 Hour</div>
                      <div class="text-xs text-subtext1">
                        {metrics()!.byCheckpoint.after1hr.goodCalls} / {metrics()!.byCheckpoint.after1hr.total}
                      </div>
                    </div>
                    <div>
                      <div class="text-2xl font-bold text-mauve">{metrics()!.byCheckpoint.nextSession.accuracy}%</div>
                      <div class="text-sm text-subtext0 mb-2">Next Session</div>
                      <div class="text-xs text-subtext1">
                        {metrics()!.byCheckpoint.nextSession.goodCalls} / {metrics()!.byCheckpoint.nextSession.total}
                      </div>
                    </div>
                    <div>
                      <div class="text-2xl font-bold text-mauve">{metrics()!.byCheckpoint.after24hr.accuracy}%</div>
                      <div class="text-sm text-subtext0 mb-2">After 24 Hours</div>
                      <div class="text-xs text-subtext1">
                        {metrics()!.byCheckpoint.after24hr.goodCalls} / {metrics()!.byCheckpoint.after24hr.total}
                      </div>
                    </div>
                  </div>
                </div>

                {/* By Keyword */}
                <div class="bg-surface0 rounded-lg p-6 border border-surface1">
                  <h2 class="text-xl font-bold text-text mb-4">Accuracy by Keyword</h2>
                  <Show when={metrics()!.byKeyword.length > 0} fallback={<div class="text-subtext0">No data available</div>}>
                    <div class="space-y-2">
                      <For each={metrics()!.byKeyword}>
                        {(item) => (
                          <div class="flex items-center justify-between p-3 bg-surface1 rounded-lg">
                            <div class="flex-1">
                              <div class="font-medium text-text">{item.keyword}</div>
                              <div class="text-xs text-subtext0">
                                Avg Confidence: {item.avgConfidence.toFixed(1)}/10
                              </div>
                            </div>
                            <div class="text-right">
                              <div class="text-lg font-bold text-mauve">
                                {item.total > 0 ? ((item.goodCalls / item.total) * 100).toFixed(1) : "0.0"}%
                              </div>
                              <div class="text-xs text-subtext0">
                                {item.goodCalls} / {item.total}
                              </div>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </div>
            </Show>
          </Show>
        </Match>

        <Match when={activeTab() === "watchlist"}>
          <Show when={!watchlist.loading} fallback={<div class="text-subtext0">Loading watchlist...</div>}>
            <Show when={watchlist()?.length ?? 0 > 0} fallback={<div class="text-subtext0">No watchlist items</div>}>
              <div class="space-y-3">
                <For each={watchlist()}>
                  {(item) => (
                    <div class="bg-surface0 rounded-lg p-4 border border-surface1 flex items-center justify-between">
                      <div class="flex-1">
                        <div class="flex items-center gap-3 mb-1">
                          <span class="font-semibold text-text">{item.keyword}</span>
                          <span class="px-2 py-0.5 bg-surface2 text-subtext0 rounded text-xs">{item.assetType}</span>
                          <Show when={item.ticker}>
                            <span class="text-sm text-subtext1">{item.ticker}</span>
                          </Show>
                        </div>
                        <Show when={item.globalValidationTicker}>
                          <div class="text-sm text-subtext0">
                            Global Ticker: {item.globalValidationTicker}
                          </div>
                        </Show>
                        <Show when={item.notes}>
                          <div class="text-sm text-subtext1 mt-1">{item.notes}</div>
                        </Show>
                      </div>
                      <button
                        onClick={() => toggleWatchlistItem(item.id, !item.enabled)}
                        class={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                          item.enabled
                            ? "bg-green/20 text-green hover:bg-green/30"
                            : "bg-surface1 text-subtext0 hover:bg-surface2"
                        }`}
                      >
                        {item.enabled ? "Enabled" : "Disabled"}
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </Match>
      </Switch>
    </div>
  );
}
