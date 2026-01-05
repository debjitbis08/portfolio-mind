/**
 * Earnings Panel Component
 *
 * Displays structured financial data (quarterly/annual) and concall highlights.
 */

import { createSignal, createEffect, For, Show, onMount } from "solid-js";
import { isServer } from "solid-js/web";
import { FaSolidArrowsRotate } from "solid-icons/fa";

interface FinancialPeriod {
  id: string;
  periodType: "annual" | "quarterly";
  reportDate: string;
  sales: number | null;
  operatingProfit: number | null;
  netProfit: number | null;
  opmPercent: number | null;
  equity: number | null;
  reserves: number | null;
  borrowings: number | null;
  receivables: number | null;
  inventory: number | null;
  operatingCashFlow: number | null;
  investingCashFlow: number | null;
  financingCashFlow: number | null;
  price: number | null;
}

interface ConcallHighlight {
  quarter: string;
  callDate: string;
  sourceUrl: string;
  managementGuidance: string;
  keyNumbers: Record<string, string>;
  positives: string[];
  risksDiscussed: string[];
  analystConcerns: string[];
}

interface Props {
  symbol: string;
}

export default function EarningsPanel(props: Props) {
  const [financials, setFinancials] = createSignal<FinancialPeriod[]>([]);
  const [concalls, setConcalls] = createSignal<ConcallHighlight[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [periodType, setPeriodType] = createSignal<"quarterly" | "annual">(
    "quarterly"
  );
  const [expandedConcall, setExpandedConcall] = createSignal<string | null>(
    null
  );

  // Sync state
  const [hasCredentials, setHasCredentials] = createSignal(false);
  const [syncingConcalls, setSyncingConcalls] = createSignal(false);
  const [syncingFinancials, setSyncingFinancials] = createSignal(false);
  const [syncStatus, setSyncStatus] = createSignal<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);
  const [loadError, setLoadError] = createSignal<string | null>(null);

  // Format number with Indian locale
  const formatNum = (val: number | null) => {
    if (val === null) return "—";
    return new Intl.NumberFormat("en-IN", {
      maximumFractionDigits: 2,
    }).format(val);
  };

  // Format percentage
  const formatPct = (val: number | null) => {
    if (val === null) return "—";
    return `${val.toFixed(1)}%`;
  };

  // Format date
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      month: "short",
      year: "numeric",
    });
  };

  // Check for screener credentials
  onMount(async () => {
    if (isServer) return;
    try {
      const res = await fetch("/api/settings");
      const { settings } = await res.json();
      setHasCredentials(
        !!settings?.screener_email && !!settings?.has_screener_password
      );
    } catch (err) {
      console.error("Failed to check credentials:", err);
    }
  });

  // Fetch data
  createEffect(async () => {
    if (isServer) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [financialsRes, concallsRes] = await Promise.all([
        fetch(`/api/earnings?symbol=${props.symbol}`),
        fetch(`/api/concalls?symbol=${props.symbol}`),
      ]);

      if (!financialsRes.ok || !concallsRes.ok) {
        throw new Error("Failed to fetch data");
      }

      const financialsData = await financialsRes.json();
      const concallsData = await concallsRes.json();

      setFinancials(financialsData.financials || []);
      setConcalls(concallsData.highlights || []);
    } catch (err) {
      console.error("Failed to load earnings:", err);
      setLoadError("Failed to load earnings data. Please try again.");
    } finally {
      setLoading(false);
    }
  });

  // Filter financials by period type
  const filteredFinancials = () =>
    financials().filter((f) => f.periodType === periodType());

  // Sync concalls from Screener
  const syncConcalls = async () => {
    setSyncingConcalls(true);
    setSyncStatus({
      type: "info",
      message: "Fetching transcripts from Screener...",
    });

    try {
      const res = await fetch("/api/concalls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: props.symbol,
          screenerUrl: `https://www.screener.in/company/${props.symbol}/`,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setSyncStatus({
          type: "success",
          message: `Processed ${data.processedCount || 0} transcripts`,
        });

        // Refresh concalls data
        const concallsRes = await fetch(`/api/concalls?symbol=${props.symbol}`);
        const concallsData = await concallsRes.json();
        setConcalls(concallsData.highlights || []);
      } else {
        setSyncStatus({
          type: "error",
          message: data.error || "Failed to sync concalls",
        });
      }
    } catch (err) {
      setSyncStatus({
        type: "error",
        message: "Network error - please try again",
      });
    } finally {
      setSyncingConcalls(false);
      // Clear status after delay
      setTimeout(() => setSyncStatus(null), 5000);
    }
  };

  // Sync financials from Screener
  const syncFinancials = async () => {
    setSyncingFinancials(true);
    setSyncStatus({
      type: "info",
      message: "Downloading financial data...",
    });

    try {
      const res = await fetch("/api/earnings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: props.symbol,
          screenerUrl: `https://www.screener.in/company/${props.symbol}/`,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setSyncStatus({
          type: "success",
          message: `Synced ${data.savedCount} financial records`,
        });
        // Refresh data
        const financialsRes = await fetch(
          `/api/earnings?symbol=${props.symbol}`
        );
        const financialsData = await financialsRes.json();
        setFinancials(financialsData.financials || []);
      } else {
        setSyncStatus({
          type: "error",
          message: data.error || "Failed to sync financials",
        });
      }
    } catch (err) {
      setSyncStatus({
        type: "error",
        message: "Network error",
      });
    } finally {
      setSyncingFinancials(false);
      setTimeout(() => setSyncStatus(null), 5000);
    }
  };

  return (
    <div class="space-y-6">
      {/* Header */}
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-text">Earnings Data</h2>
      </div>

      {/* Sync Status */}
      <Show when={syncStatus()}>
        <div
          class={`px-3 py-2 text-xs rounded-lg ${
            syncStatus()!.type === "success"
              ? "bg-green/10 text-green"
              : syncStatus()!.type === "error"
              ? "bg-red/10 text-red"
              : "bg-blue/10 text-blue"
          }`}
        >
          {syncStatus()!.message}
        </div>
      </Show>

      <Show when={loading()}>
        <div class="flex justify-center py-8">
          <div class="animate-spin w-6 h-6 border-2 border-mauve border-t-transparent rounded-full" />
        </div>
      </Show>

      <Show when={loadError()}>
        <div class="bg-red/10 border border-red/30 rounded-lg p-4 text-center">
          <p class="text-red text-sm">{loadError()}</p>
          <button
            class="mt-2 px-3 py-1 text-xs bg-surface1 hover:bg-surface2 rounded-lg text-text transition-colors"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </div>
      </Show>

      <Show when={!loading()}>
        {/* Financials Section */}
        <div class="bg-surface0 border border-surface1 rounded-xl p-4">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-2">
              <h3 class="text-sm font-medium text-subtext0">
                Financial Metrics
              </h3>
              <Show when={hasCredentials()}>
                <button
                  class={`px-3 py-1 text-xs rounded-lg transition-colors flex items-center gap-1 cursor-pointer ${
                    syncingFinancials()
                      ? "bg-surface1 text-subtext0"
                      : "bg-blue/20 text-blue hover:bg-blue/30"
                  }`}
                  onClick={syncFinancials}
                  disabled={syncingFinancials()}
                >
                  <FaSolidArrowsRotate
                    class={syncingFinancials() ? "animate-spin" : ""}
                  />
                  {syncingFinancials() ? "Syncing..." : "Sync Financials"}
                </button>
              </Show>
            </div>
            <div class="flex gap-1">
              <button
                class={`px-3 py-1 text-xs rounded-lg transition-colors ${
                  periodType() === "quarterly"
                    ? "bg-mauve text-base"
                    : "bg-surface1 text-subtext0 hover:bg-surface2"
                }`}
                onClick={() => setPeriodType("quarterly")}
              >
                Quarterly
              </button>
              <button
                class={`px-3 py-1 text-xs rounded-lg transition-colors ${
                  periodType() === "annual"
                    ? "bg-mauve text-base"
                    : "bg-surface1 text-subtext0 hover:bg-surface2"
                }`}
                onClick={() => setPeriodType("annual")}
              >
                Annual
              </button>
            </div>
          </div>

          <Show
            when={filteredFinancials().length > 0}
            fallback={
              <p class="text-subtext1 text-sm py-4 text-center">
                No {periodType()} data available. Sync earnings first.
              </p>
            }
          >
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-surface1">
                    <th class="text-left py-2 text-subtext0 font-medium">
                      Period
                    </th>
                    <th class="text-right py-2 text-subtext0 font-medium">
                      Sales (Cr)
                    </th>
                    <th class="text-right py-2 text-subtext0 font-medium">
                      Net Profit
                    </th>
                    <th class="text-right py-2 text-subtext0 font-medium">
                      OPM%
                    </th>
                    <Show when={periodType() === "annual"}>
                      <th class="text-right py-2 text-subtext0 font-medium">
                        Reserves
                      </th>
                      <th class="text-right py-2 text-subtext0 font-medium">
                        Borrowings
                      </th>
                      <th class="text-right py-2 text-subtext0 font-medium">
                        Op. CF
                      </th>
                    </Show>
                  </tr>
                </thead>
                <tbody>
                  <For each={filteredFinancials()}>
                    {(period) => (
                      <tr class="border-b border-surface1/50 hover:bg-surface1/30">
                        <td class="py-2 text-text">
                          {formatDate(period.reportDate)}
                        </td>
                        <td class="py-2 text-right text-text">
                          {formatNum(period.sales)}
                        </td>
                        <td
                          class={`py-2 text-right ${
                            (period.netProfit ?? 0) >= 0
                              ? "text-green"
                              : "text-red"
                          }`}
                        >
                          {formatNum(period.netProfit)}
                        </td>
                        <td class="py-2 text-right text-subtext0">
                          {formatPct(period.opmPercent)}
                        </td>
                        <Show when={periodType() === "annual"}>
                          <td class="py-2 text-right text-text">
                            {formatNum(period.reserves)}
                          </td>
                          <td class="py-2 text-right text-text">
                            {formatNum(period.borrowings)}
                          </td>
                          <td
                            class={`py-2 text-right ${
                              (period.operatingCashFlow ?? 0) >= 0
                                ? "text-green"
                                : "text-red"
                            }`}
                          >
                            {formatNum(period.operatingCashFlow)}
                          </td>
                        </Show>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
        </div>

        {/* Concall Highlights Section */}
        <div class="bg-surface0 border border-surface1 rounded-xl p-4">
          <div class="flex items-center justify-left gap-4 mb-4">
            <h3 class="text-sm font-medium text-subtext0">
              Concall Highlights
            </h3>
            <Show
              when={hasCredentials()}
              fallback={
                <a href="/settings" class="text-xs text-yellow hover:underline">
                  Configure Screener credentials →
                </a>
              }
            >
              <button
                class={`px-3 py-1 text-xs rounded-lg transition-colors flex items-center gap-1 cursor-pointer ${
                  syncingConcalls()
                    ? "bg-surface1 text-subtext0"
                    : "bg-blue/20 text-blue hover:bg-blue/30"
                }`}
                onClick={syncConcalls}
                disabled={syncingConcalls()}
              >
                <span class={syncingConcalls() ? "animate-spin" : ""}>
                  <FaSolidArrowsRotate />
                </span>
                {syncingConcalls() ? "Syncing..." : "Sync Concalls"}
              </button>
            </Show>
          </div>

          <Show
            when={concalls().length > 0}
            fallback={
              <p class="text-subtext1 text-sm py-4 text-center">
                No concall highlights available yet.
                {hasCredentials() &&
                  " Click 'Sync Concalls' to fetch from Screener."}
              </p>
            }
          >
            <div class="space-y-3">
              <For each={concalls()}>
                {(concall) => (
                  <div class="border border-surface1 rounded-lg">
                    <button
                      class="w-full flex items-center justify-between p-3 hover:bg-surface1/30 transition-colors"
                      onClick={() =>
                        setExpandedConcall(
                          expandedConcall() === concall.quarter
                            ? null
                            : concall.quarter
                        )
                      }
                    >
                      <div class="flex items-center gap-2">
                        <span class="text-mauve font-medium">
                          {concall.quarter}
                        </span>
                        <span class="text-xs text-subtext0">
                          {concall.callDate}
                        </span>
                      </div>
                      <span class="text-subtext0">
                        {expandedConcall() === concall.quarter ? "▲" : "▼"}
                      </span>
                    </button>

                    <Show when={expandedConcall() === concall.quarter}>
                      <div class="p-3 pt-0 space-y-3 border-t border-surface1">
                        <Show when={concall.managementGuidance}>
                          <div>
                            <h4 class="text-xs font-medium text-subtext0 mb-1">
                              Management Guidance
                            </h4>
                            <p class="text-sm text-text">
                              {concall.managementGuidance}
                            </p>
                          </div>
                        </Show>

                        <Show when={concall.positives?.length > 0}>
                          <div>
                            <h4 class="text-xs font-medium text-green mb-1">
                              Positives
                            </h4>
                            <ul class="text-sm text-text list-disc list-inside">
                              <For each={concall.positives}>
                                {(item) => <li>{item}</li>}
                              </For>
                            </ul>
                          </div>
                        </Show>

                        <Show when={concall.risksDiscussed?.length > 0}>
                          <div>
                            <h4 class="text-xs font-medium text-red mb-1">
                              Risks
                            </h4>
                            <ul class="text-sm text-text list-disc list-inside">
                              <For each={concall.risksDiscussed}>
                                {(item) => <li>{item}</li>}
                              </For>
                            </ul>
                          </div>
                        </Show>

                        <Show when={concall.sourceUrl}>
                          <a
                            href={concall.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            class="text-xs text-mauve hover:underline"
                          >
                            View Source PDF →
                          </a>
                        </Show>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
