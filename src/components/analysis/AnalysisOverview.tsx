/**
 * Analysis Overview Component
 * Shows stocks eligible for Tier 3 analysis with statistics and action buttons
 */

import { FaSolidArrowsRotate } from "solid-icons/fa";
import { createSignal, createResource, For, Show, onMount } from "solid-js";

interface AnalysisData {
  opportunityScore: number | null;
  timingSignal: "accumulate" | "wait" | "avoid" | null;
  thesisSummary: string | null;
  risksSummary: string | null;
  newsAlert: boolean;
  newsAlertReason: string | null;
  analyzedAt: string | null;
  expiresAt: string | null;
}

interface StockEntry {
  symbol: string;
  name: string;
  isHolding: boolean;
  isInteresting: boolean;
  analysis: AnalysisData | null;
}

interface OverviewData {
  holdings: StockEntry[];
  watchlist: StockEntry[];
  statistics: {
    totalEligible: number;
    holdingsCount: number;
    watchlistCount: number;
    analyzed: number;
    pending: number;
    withAlerts: number;
    avgScore: number | null;
    accumulate: number;
    wait: number;
    avoid: number;
  };
}

export default function AnalysisOverview() {
  const [isRefreshing, setIsRefreshing] = createSignal(false);
  const [isRunningDiscovery, setIsRunningDiscovery] = createSignal(false);
  const [refreshingSymbol, setRefreshingSymbol] = createSignal<string | null>(
    null
  );
  const [jobId, setJobId] = createSignal<string | null>(null);
  const [jobProgress, setJobProgress] = createSignal<{
    completed: number;
    total: number;
    current: string | null;
  } | null>(null);

  // Create a signal that only becomes true after component mounts (client-side only)
  const [shouldFetch, setShouldFetch] = createSignal(false);

  onMount(() => {
    setShouldFetch(true);
  });

  const [data, { refetch }] = createResource(
    shouldFetch,
    async () => {
      const res = await fetch("/api/analysis/overview");
      if (!res.ok) {
        console.error("Failed to fetch analysis overview:", res.status);
        throw new Error(`Failed to fetch: ${res.status}`);
      }
      return await res.json();
    }
  );

  const refreshAnalysis = async () => {
    setIsRefreshing(true);
    setJobProgress(null);
    try {
      const res = await fetch("/api/analysis/deep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (res.ok) {
        const result = await res.json();
        setJobId(result.jobId);

        // Poll for job completion
        const pollInterval = setInterval(async () => {
          try {
            const statusRes = await fetch(`/api/analysis/deep/${result.jobId}`);
            const status = await statusRes.json();
            setJobProgress({
              completed: status.completed || 0,
              total: status.total || 0,
              current: status.current || null,
            });

            if (status.status === "completed" || status.status === "failed") {
              clearInterval(pollInterval);
              setIsRefreshing(false);
              setJobId(null);
              setJobProgress(null);
              refetch();
            }
          } catch {
            clearInterval(pollInterval);
            setIsRefreshing(false);
          }
        }, 2000);
      } else {
        alert("Failed to start analysis");
        setIsRefreshing(false);
      }
    } catch (e) {
      console.error("Failed to start analysis:", e);
      alert("Failed to start analysis");
      setIsRefreshing(false);
    }
  };

  const runDiscovery = async () => {
    setIsRunningDiscovery(true);
    try {
      const res = await fetch("/api/cycle/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (res.ok) {
        // Redirect to dashboard to see suggestions
        window.location.href = "/dashboard";
      } else {
        alert("Failed to run AI Discovery");
        setIsRunningDiscovery(false);
      }
    } catch (e) {
      console.error("Failed to run discovery:", e);
      alert("Failed to run AI Discovery");
      setIsRunningDiscovery(false);
    }
  };

  const refreshSingleStock = async (symbol: string) => {
    setRefreshingSymbol(symbol);
    try {
      const res = await fetch("/api/analysis/deep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: [symbol] }),
      });

      if (res.ok) {
        const result = await res.json();
        // Poll for completion
        const pollInterval = setInterval(async () => {
          try {
            const statusRes = await fetch(`/api/analysis/deep/${result.jobId}`);
            const status = await statusRes.json();
            if (status.status === "completed" || status.status === "failed") {
              clearInterval(pollInterval);
              setRefreshingSymbol(null);
              refetch();
            }
          } catch {
            clearInterval(pollInterval);
            setRefreshingSymbol(null);
          }
        }, 2000);
      } else {
        alert(`Failed to start analysis for ${symbol}`);
        setRefreshingSymbol(null);
      }
    } catch (e) {
      console.error(`Failed to start analysis for ${symbol}:`, e);
      setRefreshingSymbol(null);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    const date = new Date(dateStr);
    const now = new Date();
    const diffHours = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60)
    );
    if (diffHours < 1) return "Just now";
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const signalBadge = (signal: string | null) => {
    switch (signal) {
      case "accumulate":
        return (
          <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-green/10 text-green border border-green/20">
            🟢 Accumulate
          </span>
        );
      case "wait":
        return (
          <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-yellow/10 text-yellow border border-yellow/20">
            🟡 Wait
          </span>
        );
      case "avoid":
        return (
          <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-red/10 text-red border border-red/20">
            🔴 Avoid
          </span>
        );
      default:
        return (
          <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-surface1 text-subtext1 border border-surface2">
            Pending
          </span>
        );
    }
  };

  const scoreColor = (score: number | null) => {
    if (score === null) return "text-subtext1";
    if (score >= 70) return "text-green";
    if (score >= 50) return "text-yellow";
    return "text-red";
  };

  return (
    <div class="max-w-7xl mx-auto p-4 md:p-8">
      {/* Header */}
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold text-text">Analysis Overview</h1>
          <p class="text-sm text-subtext0">
            Stocks eligible for Tier 3 AI Discovery
          </p>
        </div>
        <div class="flex gap-3">
          <button
            onClick={refreshAnalysis}
            disabled={isRefreshing()}
            class={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
              isRefreshing()
                ? "bg-surface1 text-subtext1 cursor-not-allowed"
                : "bg-blue text-crust hover:bg-blue/80"
            }`}
          >
            {isRefreshing() ? (
              <span>
                Analyzing...{" "}
                {jobProgress()
                  ? `(${jobProgress()!.completed}/${jobProgress()!.total})`
                  : ""}
              </span>
            ) : (
              "🔄 Refresh Analysis"
            )}
          </button>
          <button
            onClick={runDiscovery}
            disabled={isRunningDiscovery() || isRefreshing()}
            class={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
              isRunningDiscovery() || isRefreshing()
                ? "bg-surface1 text-subtext1 cursor-not-allowed"
                : "bg-mauve text-crust hover:bg-mauve/80"
            }`}
          >
            {isRunningDiscovery() ? "Running..." : "🤖 Run AI Discovery"}
          </button>
        </div>
      </div>

      {/* Job Progress */}
      <Show when={isRefreshing() && jobProgress()}>
        <div class="mb-6 p-4 bg-surface0 border border-surface1 rounded-xl">
          <div class="flex items-center gap-3">
            <div class="animate-spin w-5 h-5 border-2 border-mauve border-t-transparent rounded-full" />
            <div>
              <p class="text-sm text-text font-medium">
                Analyzing: {jobProgress()?.current || "Starting..."}
              </p>
              <p class="text-xs text-subtext1">
                {jobProgress()?.completed} of {jobProgress()?.total} stocks
                completed
              </p>
            </div>
          </div>
          <div class="mt-3 h-2 bg-surface1 rounded-full overflow-hidden">
            <div
              class="h-full bg-mauve transition-all duration-300"
              style={{
                width: `${
                  jobProgress()?.total
                    ? (jobProgress()!.completed / jobProgress()!.total) * 100
                    : 0
                }%`,
              }}
            />
          </div>
        </div>
      </Show>

      {/* Statistics Cards */}
      <Show when={!data.loading && data()}>
        <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <div class="bg-surface0 border border-surface1 rounded-xl p-4">
            <p class="text-2xl font-bold text-text">
              {data()!.statistics.totalEligible}
            </p>
            <p class="text-xs text-subtext0">Total Eligible</p>
          </div>
          <div class="bg-surface0 border border-surface1 rounded-xl p-4">
            <p class="text-2xl font-bold text-text">
              {data()!.statistics.analyzed}
            </p>
            <p class="text-xs text-subtext0">Analyzed</p>
          </div>
          <div class="bg-surface0 border border-surface1 rounded-xl p-4">
            <p class="text-2xl font-bold text-green">
              {data()!.statistics.accumulate}
            </p>
            <p class="text-xs text-subtext0">🟢 Accumulate</p>
          </div>
          <div class="bg-surface0 border border-surface1 rounded-xl p-4">
            <p class="text-2xl font-bold text-yellow">
              {data()!.statistics.wait}
            </p>
            <p class="text-xs text-subtext0">🟡 Wait</p>
          </div>
          <div class="bg-surface0 border border-surface1 rounded-xl p-4">
            <p class="text-2xl font-bold text-peach">
              {data()!.statistics.withAlerts}
            </p>
            <p class="text-xs text-subtext0">⚠️ Alerts</p>
          </div>
        </div>

        {/* Holdings Section */}
        <Show when={data()!.holdings.length > 0}>
          <div class="mb-6">
            <h2 class="text-lg font-semibold text-text mb-3">
              📈 Holdings ({data()!.holdings.length})
            </h2>
            <div class="bg-surface0 border border-surface1 rounded-xl overflow-hidden">
              <table class="w-full text-sm">
                <thead class="bg-surface1">
                  <tr>
                    <th class="text-left px-4 py-2 text-subtext0 font-medium">
                      Symbol
                    </th>
                    <th class="text-left px-4 py-2 text-subtext0 font-medium">
                      Score
                    </th>
                    <th class="text-left px-4 py-2 text-subtext0 font-medium">
                      Signal
                    </th>
                    <th class="text-left px-4 py-2 text-subtext0 font-medium hidden md:table-cell">
                      Thesis
                    </th>
                    <th class="text-left px-4 py-2 text-subtext0 font-medium">
                      Analyzed
                    </th>
                    <th class="text-left px-4 py-2 text-subtext0 font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <For each={data()!.holdings}>
                    {(stock) => (
                      <tr class="border-t border-surface1 hover:bg-surface1/50">
                        <td class="px-4 py-3">
                          <a
                            href={`/company/${stock.symbol}`}
                            class="font-medium text-text hover:text-mauve transition-colors"
                          >
                            {stock.symbol}
                          </a>
                          <Show when={stock.analysis?.newsAlert}>
                            <span class="ml-2 text-peach">⚠️</span>
                          </Show>
                          <p class="text-xs text-subtext1 truncate max-w-[150px]">
                            {stock.name}
                          </p>
                        </td>
                        <td class="px-4 py-3">
                          <span
                            class={`font-bold ${scoreColor(
                              stock.analysis?.opportunityScore ?? null
                            )}`}
                          >
                            {stock.analysis?.opportunityScore ?? "-"}
                          </span>
                        </td>
                        <td class="px-4 py-3">
                          {signalBadge(stock.analysis?.timingSignal ?? null)}
                        </td>
                        <td class="px-4 py-3 hidden md:table-cell">
                          <p class="text-xs text-subtext1 truncate max-w-[300px]">
                            {stock.analysis?.thesisSummary || "-"}
                          </p>
                        </td>
                        <td class="px-4 py-3 text-xs text-subtext1">
                          {formatDate(stock.analysis?.analyzedAt ?? null)}
                        </td>
                        <td class="px-4 py-3">
                          <button
                            onClick={() => refreshSingleStock(stock.symbol)}
                            disabled={
                              refreshingSymbol() === stock.symbol ||
                              isRefreshing()
                            }
                            class={`px-2 py-1 text-xs rounded transition-colors ${
                              refreshingSymbol() === stock.symbol
                                ? "bg-surface1 text-subtext1 cursor-not-allowed"
                                : "bg-surface1 hover:bg-surface2 text-subtext0 hover:text-text"
                            }`}
                            title={`Refresh analysis for ${stock.symbol}`}
                          >
                            {refreshingSymbol() === stock.symbol ? "..." : "🔄"}
                          </button>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </div>
        </Show>

        {/* Watchlist Section */}
        <Show when={data()!.watchlist.length > 0}>
          <div class="mb-6">
            <h2 class="text-lg font-semibold text-text mb-3">
              ⭐ Interesting Watchlist ({data()!.watchlist.length})
            </h2>
            <div class="bg-surface0 border border-surface1 rounded-xl overflow-hidden">
              <table class="w-full text-sm">
                <thead class="bg-surface1">
                  <tr>
                    <th class="text-left px-4 py-2 text-subtext0 font-medium">
                      Symbol
                    </th>
                    <th class="text-left px-4 py-2 text-subtext0 font-medium">
                      Score
                    </th>
                    <th class="text-left px-4 py-2 text-subtext0 font-medium">
                      Signal
                    </th>
                    <th class="text-left px-4 py-2 text-subtext0 font-medium hidden md:table-cell">
                      Thesis
                    </th>
                    <th class="text-left px-4 py-2 text-subtext0 font-medium">
                      Analyzed
                    </th>
                    <th class="text-left px-4 py-2 text-subtext0 font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <For each={data()!.watchlist}>
                    {(stock) => (
                      <tr class="border-t border-surface1 hover:bg-surface1/50">
                        <td class="px-4 py-3">
                          <a
                            href={`/company/${stock.symbol}`}
                            class="font-medium text-text hover:text-mauve transition-colors"
                          >
                            {stock.name}
                          </a>
                          <Show when={stock.analysis?.newsAlert}>
                            <span
                              class="ml-2 text-peach"
                              title={`News Alert: ${stock.analysis?.newsAlertReason}`}
                            >
                              ⚠️
                            </span>
                          </Show>
                          <p class="text-xs text-subtext1 truncate max-w-[150px]">
                            {stock.symbol}
                          </p>
                        </td>
                        <td class="px-4 py-3">
                          <span
                            class={`font-bold ${scoreColor(
                              stock.analysis?.opportunityScore ?? null
                            )}`}
                          >
                            {stock.analysis?.opportunityScore ?? "-"}
                          </span>
                        </td>
                        <td class="px-4 py-3">
                          {signalBadge(stock.analysis?.timingSignal ?? null)}
                        </td>
                        <td class="px-4 py-3 hidden md:table-cell">
                          <p class="text-xs text-subtext1 truncate max-w-[300px]">
                            {stock.analysis?.thesisSummary || "-"}
                          </p>
                        </td>
                        <td class="px-4 py-3 text-xs text-subtext1">
                          {formatDate(stock.analysis?.analyzedAt ?? null)}
                        </td>
                        <td class="px-4 py-3">
                          <button
                            onClick={() => refreshSingleStock(stock.symbol)}
                            disabled={
                              refreshingSymbol() === stock.symbol ||
                              isRefreshing()
                            }
                            class={`cursor-pointer px-2 py-1 text-xs rounded transition-colors ${
                              refreshingSymbol() === stock.symbol
                                ? "bg-surface1 text-subtext1 cursor-not-allowed"
                                : "bg-surface1 hover:bg-surface2 text-subtext0 hover:text-text"
                            }`}
                            title={`Refresh analysis for ${stock.symbol}`}
                          >
                            {refreshingSymbol() === stock.symbol ? (
                              "..."
                            ) : (
                              <FaSolidArrowsRotate />
                            )}
                          </button>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </div>
        </Show>

        {/* Empty State */}
        <Show
          when={data()!.holdings.length === 0 && data()!.watchlist.length === 0}
        >
          <div class="text-center py-12 bg-surface0 border border-surface1 rounded-xl">
            <p class="text-subtext0 mb-2">No stocks eligible for analysis</p>
            <p class="text-sm text-subtext1">
              Add holdings or mark watchlist stocks as "interesting" to get
              started.
            </p>
          </div>
        </Show>
      </Show>

      {/* Loading State */}
      <Show when={data.loading}>
        <div class="text-center py-12">
          <div class="animate-spin w-8 h-8 border-2 border-mauve border-t-transparent rounded-full mx-auto mb-4" />
          <p class="text-subtext0">Loading analysis data...</p>
        </div>
      </Show>
    </div>
  );
}
