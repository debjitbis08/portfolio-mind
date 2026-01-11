/**
 * Portfolio Freshness Card
 *
 * Displays data freshness status on Dashboard with proactive warnings.
 * Helps users identify stale data before running AI analysis.
 */

import { createSignal, createEffect, Show, For } from "solid-js";

interface FreshnessData {
  overall_status: "fresh" | "aging" | "stale" | "missing";
  summary: {
    total_stocks: number;
    fresh: number;
    aging: number;
    stale: number;
    missing_analysis: number;
  };
  can_run_tier3: boolean;
  warnings: string[];
  recommendation: string;
  stocks_needing_refresh: Array<{
    symbol: string;
    status: string;
    reason: string;
  }>;
  last_checked: string;
}

const STATUS_CONFIG = {
  fresh: {
    icon: "🟢",
    bg: "bg-green/10",
    text: "text-green",
    border: "border-green/30",
    title: "All Data Fresh",
  },
  aging: {
    icon: "🟡",
    bg: "bg-yellow/10",
    text: "text-yellow",
    border: "border-yellow/30",
    title: "Some Data Aging",
  },
  stale: {
    icon: "🔴",
    bg: "bg-red/10",
    text: "text-red",
    border: "border-red/30",
    title: "Stale Data Detected",
  },
  missing: {
    icon: "⚪",
    bg: "bg-surface1",
    text: "text-subtext0",
    border: "border-surface2",
    title: "Missing Analysis",
  },
};

export default function PortfolioFreshnessCard() {
  const [data, setData] = createSignal<FreshnessData | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [expanded, setExpanded] = createSignal(false);
  const [refreshing, setRefreshing] = createSignal(false);

  // Fetch freshness data
  const fetchFreshness = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/analysis/freshness");

      if (!response.ok) {
        throw new Error(`Failed to fetch freshness: ${response.statusText}`);
      }

      const freshnessData = await response.json();
      setData(freshnessData);
    } catch (err) {
      console.error("[PortfolioFreshnessCard] Error:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  // Fetch on mount
  createEffect(() => {
    fetchFreshness();
  });

  // Trigger Tier 2 refresh for stale stocks
  const refreshStaleStocks = async () => {
    const currentData = data();
    if (!currentData || refreshing()) return;

    const symbols = currentData.stocks_needing_refresh.map((s) => s.symbol);

    if (symbols.length === 0) {
      alert("No stocks need refresh");
      return;
    }

    setRefreshing(true);

    try {
      const buildWarningMessage = (issues: any[]) => {
        return issues
          .map((issue) => {
            const parts: string[] = [];
            if (issue.missing?.length) {
              parts.push(`Missing: ${issue.missing.join(", ")}`);
            }
            if (issue.stale?.length) {
              parts.push(`Stale: ${issue.stale.join(", ")}`);
            }
            return `${issue.symbol}: ${parts.join(" | ")}`;
          })
          .join("\n");
      };
      const requestAnalysis = async (confirmMissingData: boolean) => {
        return fetch("/api/analysis/deep", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbols, confirmMissingData }),
        });
      };

      let response = await requestAnalysis(false);
      if (response.status === 409) {
        const data = await response.json();
        const warningMessage = buildWarningMessage(data.issues || []);
        const proceed = window.confirm(
          `Tier 2 analysis has missing/stale data:\n\n${warningMessage}\n\nProceed anyway?`
        );
        if (!proceed) {
          setRefreshing(false);
          return;
        }
        response = await requestAnalysis(true);
      }

      if (!response.ok) {
        throw new Error(`Failed to start refresh: ${response.statusText}`);
      }

      const { jobId, stocksQueued, estimatedMinutes } = await response.json();

      alert(
        `Tier 2 analysis started for ${stocksQueued} stock(s).\nEstimated time: ${estimatedMinutes} minutes.\n\nJob ID: ${jobId}\n\nCheck status at /analysis page.`
      );

      // Refresh freshness data after a delay
      setTimeout(() => {
        fetchFreshness();
        setRefreshing(false);
      }, 5000);
    } catch (err) {
      console.error("[PortfolioFreshnessCard] Refresh error:", err);
      alert(`Failed to start refresh: ${err instanceof Error ? err.message : "Unknown error"}`);
      setRefreshing(false);
    }
  };

  const currentData = () => data();
  const statusConfig = () =>
    currentData() ? STATUS_CONFIG[currentData()!.overall_status] : STATUS_CONFIG.fresh;

  return (
    <section
      class={`border rounded-2xl p-6 transition-colors ${
        statusConfig().border
      } ${statusConfig().bg}`}
    >
      {/* Header */}
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <span class="text-2xl">{statusConfig().icon}</span>
          <h2 class="text-lg font-semibold text-text">
            Data Freshness Status
          </h2>
        </div>
        <button
          onClick={fetchFreshness}
          disabled={loading()}
          class="px-3 py-1 text-sm bg-surface1 hover:bg-surface2 text-subtext1 rounded-lg transition-colors disabled:opacity-50"
        >
          {loading() ? "⟳ Checking..." : "↻ Refresh"}
        </button>
      </div>

      <Show when={error()}>
        <div class="p-4 bg-red/10 border border-red/30 rounded-lg text-red text-sm">
          ⚠️ Error: {error()}
        </div>
      </Show>

      <Show when={!loading() && !error() && currentData()}>
        {/* Summary Stats */}
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div>
            <p class="text-xs text-subtext0 uppercase tracking-wide">Fresh</p>
            <p class="text-2xl font-bold text-green">
              {currentData()!.summary.fresh}
            </p>
          </div>
          <div>
            <p class="text-xs text-subtext0 uppercase tracking-wide">Aging</p>
            <p class="text-2xl font-bold text-yellow">
              {currentData()!.summary.aging}
            </p>
          </div>
          <div>
            <p class="text-xs text-subtext0 uppercase tracking-wide">Stale</p>
            <p class="text-2xl font-bold text-red">
              {currentData()!.summary.stale}
            </p>
          </div>
          <div>
            <p class="text-xs text-subtext0 uppercase tracking-wide">Missing</p>
            <p class="text-2xl font-bold text-subtext0">
              {currentData()!.summary.missing_analysis}
            </p>
          </div>
        </div>

        {/* Recommendation */}
        <Show when={currentData()!.overall_status !== "fresh"}>
          <div
            class={`p-4 rounded-lg border mb-4 ${statusConfig().bg} ${
              statusConfig().border
            }`}
          >
            <p class={`text-sm font-medium ${statusConfig().text} mb-2`}>
              {statusConfig().icon} {statusConfig().title}
            </p>
            <p class="text-sm text-subtext1">
              {currentData()!.recommendation}
            </p>
          </div>
        </Show>

        <Show when={currentData()!.overall_status === "fresh"}>
          <div class="p-4 rounded-lg border mb-4 bg-green/10 border-green/30">
            <p class="text-sm font-medium text-green mb-1">
              ✅ All data is up-to-date
            </p>
            <p class="text-sm text-subtext1">
              Ready to run portfolio analysis (Tier 3)
            </p>
          </div>
        </Show>

        {/* Action Buttons */}
        <div class="flex items-center gap-2 mb-4">
          <Show when={currentData()!.stocks_needing_refresh.length > 0}>
            <button
              onClick={refreshStaleStocks}
              disabled={refreshing()}
              class="px-4 py-2 bg-mauve hover:bg-mauve/80 text-base rounded-lg transition-colors font-medium disabled:opacity-50"
            >
              {refreshing()
                ? "⟳ Starting Refresh..."
                : `🔄 Refresh ${currentData()!.stocks_needing_refresh.length} Stock(s)`}
            </button>
          </Show>

          <Show when={currentData()!.stocks_needing_refresh.length > 0}>
            <button
              onClick={() => setExpanded(!expanded())}
              class="px-4 py-2 bg-surface1 hover:bg-surface2 text-subtext1 rounded-lg transition-colors"
            >
              {expanded() ? "▲ Hide Details" : "▼ View Details"}
            </button>
          </Show>
        </div>

        {/* Expanded Details */}
        <Show when={expanded() && currentData()!.stocks_needing_refresh.length > 0}>
          <div class="border-t border-surface1 pt-4 space-y-2">
            <p class="text-sm font-medium text-subtext0 mb-2">
              Stocks needing refresh:
            </p>
            <For each={currentData()!.stocks_needing_refresh}>
              {(stock) => (
                <div class="flex items-start gap-2 p-3 bg-surface0 rounded-lg">
                  <span class="text-lg">
                    {stock.status === "stale"
                      ? "🔴"
                      : stock.status === "aging"
                        ? "🟡"
                        : "⚪"}
                  </span>
                  <div class="flex-1">
                    <p class="font-medium text-text">{stock.symbol}</p>
                    <p class="text-xs text-subtext1">{stock.reason}</p>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* Warnings (if any) - Filter out Technical Data warnings since they auto-refresh */}
        <Show when={(() => {
          const relevantWarnings = currentData()!.warnings.filter(
            (w) => !w.includes("Technical Data")
          );
          return relevantWarnings.length > 0 && !expanded();
        })()}>
          <div class="mt-4 text-xs text-subtext0">
            <p class="font-medium mb-1">Recent warnings:</p>
            <ul class="list-disc list-inside space-y-1">
              <For each={currentData()!.warnings.filter(
                (w) => !w.includes("Technical Data")
              ).slice(0, 3)}>
                {(warning) => <li class="text-subtext1">{warning}</li>}
              </For>
            </ul>
            <Show when={currentData()!.warnings.filter(
              (w) => !w.includes("Technical Data")
            ).length > 3}>
              <button
                onClick={() => setExpanded(true)}
                class="text-mauve hover:underline mt-1"
              >
                +{currentData()!.warnings.filter(
                  (w) => !w.includes("Technical Data")
                ).length - 3} more warnings
              </button>
            </Show>
          </div>
        </Show>

        {/* Footer */}
        <div class="mt-4 pt-4 border-t border-surface1 flex items-center justify-between text-xs text-subtext0">
          <span>
            Last checked:{" "}
            {new Date(currentData()!.last_checked).toLocaleString()}
          </span>
          <Show when={!currentData()!.can_run_tier3}>
            <span class="px-2 py-1 bg-red/10 text-red rounded font-medium">
              ⚠️ Cannot run Tier 3
            </span>
          </Show>
          <Show when={currentData()!.can_run_tier3}>
            <span class="px-2 py-1 bg-green/10 text-green rounded font-medium">
              ✓ Ready for Tier 3
            </span>
          </Show>
        </div>
      </Show>

      <Show when={loading()}>
        <div class="flex items-center justify-center py-8">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-mauve"></div>
        </div>
      </Show>
    </section>
  );
}
