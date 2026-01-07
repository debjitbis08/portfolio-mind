import {
  createSignal,
  createResource,
  Show,
  For,
  Switch,
  Match,
  onMount,
} from "solid-js";
import { isServer } from "solid-js/web";
import ResearchList from "../research/ResearchList";
import CompanyNotes from "../notes/CompanyNotes";
import LinksList from "../links/LinksList";
import TablesList from "../tables/TablesList";
import PriceChart from "../charts/PriceChart";
import EarningsPanel from "../earnings/EarningsPanel";
import VRSSection from "./VRSSection";
import DataAgeBadge from "../freshness/DataAgeBadge";
import PortfolioRoleEditor from "./PortfolioRoleEditor";
import { FaSolidArrowsRotate, FaSolidTrashCan } from "solid-icons/fa";

interface CompanyDetailsProps {
  symbol: string;
}

export default function CompanyDetails(props: CompanyDetailsProps) {
  const [activeTab, setActiveTab] = createSignal("overview");
  const [isRefreshingTech, setIsRefreshingTech] = createSignal(false);
  const [isRefreshingVP, setIsRefreshingVP] = createSignal(false);

  // Format currency
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatCurrencyDecimal = (value: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  // Resources
  const [holdings, { refetch: refetchHoldings }] = createResource(
    () => props.symbol,
    async (symbol) => {
      if (isServer) return null;
      const res = await fetch(
        `/api/holdings?symbol=${encodeURIComponent(symbol)}`
      );
      const data = await res.json();
      return data.holdings?.find((h: any) => h.symbol === symbol);
    }
  );

  const [suggestion] = createResource(
    () => props.symbol,
    async (symbol) => {
      if (isServer) return null;
      const res = await fetch(
        `/api/suggestions?symbol=${encodeURIComponent(symbol)}&limit=1`
      );
      const data = await res.json();
      return data.suggestions?.[0];
    }
  );

  const [knowledgeCounts] = createResource(
    () => props.symbol,
    async (symbol) => {
      if (isServer) return null;
      const [researchRes, notesRes, linksRes, tablesRes] = await Promise.all([
        fetch(`/api/research?symbol=${encodeURIComponent(symbol)}`),
        fetch(`/api/notes/company?symbol=${encodeURIComponent(symbol)}`),
        fetch(`/api/links?symbol=${encodeURIComponent(symbol)}`),
        fetch(`/api/tables?symbol=${encodeURIComponent(symbol)}`),
      ]);

      const [research, notes, links, tables] = await Promise.all([
        researchRes.json(),
        notesRes.json(),
        linksRes.json(),
        tablesRes.json(),
      ]);

      return {
        research: research.documents?.length || 0,
        notes: notes.notes?.length || 0,
        links: links.links?.length || 0,
        tables: tables.tables?.length || 0,
      };
    }
  );

  // Fetch watchlist data for name (for non-holdings)
  const [watchlistStock] = createResource(
    () => props.symbol,
    async (symbol) => {
      if (isServer) return null;
      try {
        const res = await fetch(
          `/api/watchlist?symbol=${encodeURIComponent(symbol)}`
        );
        const data = await res.json();
        return data.stocks?.find((s: any) => s.symbol === symbol);
      } catch (e) {
        return null;
      }
    }
  );

  const [intel] = createResource(
    () => props.symbol,
    async (symbol) => {
      if (isServer) return null;
      try {
        const res = await fetch(`/api/intel/${encodeURIComponent(symbol)}`);
        const data = await res.json();
        return data.valuepickr;
      } catch (e) {
        return null;
      }
    }
  );

  const [technical, { refetch: refetchTechnical }] = createResource(
    () => props.symbol,
    async (symbol) => {
      if (isServer) return null;
      try {
        const res = await fetch(
          `/api/technical?symbol=${encodeURIComponent(symbol)}`
        );
        const data = await res.json();
        return data.data?.[0];
      } catch (e) {
        return null;
      }
    }
  );

  // Tier 2 Deep Analysis cache
  const [tier2Analysis, { refetch: refetchTier2 }] = createResource(
    () => props.symbol,
    async (symbol) => {
      if (isServer) return null;
      try {
        const res = await fetch(
          `/api/analysis/cache?symbol=${encodeURIComponent(symbol)}`
        );
        return await res.json();
      } catch (e) {
        return { found: false, analysis: null };
      }
    }
  );

  const getRsiLabel = (rsi: number) => {
    if (rsi > 70) return "Overbought";
    if (rsi < 30) return "Oversold";
    return "Neutral";
  };

  const getRsiClass = (rsi: number) => {
    if (rsi > 70) return "text-red";
    if (rsi < 30) return "text-green";
    return "text-text";
  };

  const refreshTechnicals = async () => {
    setIsRefreshingTech(true);
    try {
      await fetch("/api/technical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: props.symbol }),
      });
      // Refresh both resources
      refetchHoldings();
      refetchTechnical();
    } catch (error) {
      console.error("Failed to refresh technicals:", error);
    } finally {
      setIsRefreshingTech(false);
    }
  };

  const tabs = () => [
    { id: "overview", label: "Overview" },
    {
      id: "research",
      label: "Research",
      count: knowledgeCounts()?.research,
    },
    { id: "notes", label: "Notes", count: knowledgeCounts()?.notes },
    { id: "links", label: "Links", count: knowledgeCounts()?.links },
    { id: "tables", label: "Tables", count: knowledgeCounts()?.tables },
    { id: "earnings", label: "Earnings" },
  ];

  const actionColors: Record<string, string> = {
    BUY: "text-green bg-green/20",
    SELL: "text-red bg-red/20",
    HOLD: "text-yellow bg-yellow/20",
    WATCH: "text-blue bg-blue/20",
    RAISE_CASH: "text-peach bg-peach/20",
  };

  return (
    <div class="min-h-screen p-4 md:p-8">
      {/* Header */}
      <header class="max-w-6xl mx-auto flex items-center justify-between mb-6">
        <div class="flex items-center gap-4">
          <a
            href={holdings() ? "/dashboard" : "/watchlist"}
            class="text-subtext1 hover:text-text transition-colors p-2 -ml-2 rounded-lg hover:bg-surface1"
            title="Back to Dashboard"
          >
            ← Back
          </a>
          <div>
            <div class="flex items-center gap-2 mb-0.5">
              <h1 class="text-2xl font-bold text-text tracking-tight">
                {holdings()?.stock_name ||
                  watchlistStock()?.name ||
                  props.symbol}
              </h1>
              <Show when={holdings()}>
                <span class="px-2 py-0.5 bg-mauve/10 text-mauve text-[10px] rounded uppercase font-bold border border-mauve/20">
                  Holding
                </span>
              </Show>
              <Show when={!holdings() && !holdings.loading}>
                <span class="px-2 py-0.5 bg-surface1 text-subtext1 text-[10px] rounded uppercase font-bold border border-surface2">
                  Watchlist
                </span>
              </Show>
            </div>
            <p class="text-sm text-subtext0">{props.symbol}</p>
          </div>
        </div>
        <div class="text-right">
          <div class="text-2xl font-bold text-text">
            {formatCurrencyDecimal(
              holdings()?.current_price || technical()?.current_price || 0
            )}
          </div>
          <Show when={holdings()}>
            <div
              class={`text-sm font-medium ${
                holdings()?.returns >= 0 ? "text-green" : "text-red"
              }`}
            >
              {holdings()?.returns >= 0 ? "+" : ""}
              {formatCurrency(holdings()?.returns)} (
              {holdings()?.returns_percent.toFixed(2)}%)
            </div>
          </Show>
        </div>
      </header>

      <main class="max-w-6xl mx-auto">
        {/* Tab Navigation */}
        <nav class="border-b border-surface1 mb-6">
          <div class="flex gap-1 overflow-x-auto no-scrollbar">
            <For each={tabs()}>
              {(tab) => (
                <button
                  onClick={() => setActiveTab(tab.id)}
                  class={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-2 ${
                    activeTab() === tab.id
                      ? "border-mauve text-mauve"
                      : "border-transparent text-subtext0 hover:text-text"
                  }`}
                >
                  {tab.label}
                  <Show when={tab.count !== undefined}>
                    <span
                      class={`px-1.5 py-0.5 text-[10px] rounded-full ${
                        activeTab() === tab.id
                          ? "bg-mauve/20 text-mauve"
                          : "bg-surface1 text-subtext1"
                      }`}
                    >
                      {tab.count ?? 0}
                    </span>
                  </Show>
                </button>
              )}
            </For>
          </div>
        </nav>

        {/* Tab Content */}
        <div id="tab-content">
          <Switch>
            <Match when={activeTab() === "overview"}>
              <section id="tab-overview" class="tab-panel">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                  {/* Holdings Summary (Only for Holdings) */}
                  <Show when={holdings()}>
                    <div class="bg-surface0 border border-surface1 rounded-xl p-4">
                      <h3 class="text-sm font-medium text-subtext0 mb-3">
                        Holdings Summary
                      </h3>
                      <div class="space-y-2">
                        <div class="flex justify-between">
                          <span class="text-subtext1">Quantity</span>
                          <span class="text-text font-medium">
                            {holdings()?.quantity} shares
                          </span>
                        </div>
                        <div class="flex justify-between">
                          <span class="text-subtext1">Avg Cost</span>
                          <span class="text-text">
                            {formatCurrencyDecimal(holdings()?.avg_buy_price)}
                          </span>
                        </div>
                        <div class="flex justify-between">
                          <span class="text-subtext1">Current Price</span>
                          <span class="text-text">
                            {formatCurrencyDecimal(holdings()?.current_price)}
                          </span>
                        </div>
                        <div class="flex justify-between">
                          <span class="text-subtext1">Value</span>
                          <span class="text-text font-medium">
                            {formatCurrency(holdings()?.current_value)}
                          </span>
                        </div>
                        <div class="flex justify-between pt-2 border-t border-surface1">
                          <span class="text-subtext1">P&L</span>
                          <span
                            class={`font-medium ${
                              holdings()?.returns >= 0
                                ? "text-green"
                                : "text-red"
                            }`}
                          >
                            {holdings()?.returns >= 0 ? "+" : ""}
                            {formatCurrency(holdings()?.returns)} (
                            {holdings()?.returns_percent.toFixed(2)}%)
                          </span>
                        </div>
                      </div>
                    </div>
                  </Show>

                  {/* Technical Snapshot */}
                  <div class="bg-surface0 border border-surface1 rounded-xl p-4">
                    <div class="flex items-center justify-between mb-3">
                      <h3 class="text-sm font-medium text-subtext0">
                        Technical Snapshot
                      </h3>
                      <button
                        onClick={refreshTechnicals}
                        disabled={isRefreshingTech()}
                        class={`text-[10px] px-2 py-1 rounded border border-surface1 transition-colors ${
                          isRefreshingTech()
                            ? "bg-surface1 text-subtext1 cursor-not-allowed"
                            : "bg-surface1/50 text-subtext0 hover:bg-surface1 hover:text-text"
                        }`}
                      >
                        {isRefreshingTech() ? "Calculating..." : "Recalculate"}
                      </button>
                    </div>
                    <div class="space-y-3">
                      <Show
                        when={technical() || technical.loading}
                        fallback={
                          <p class="text-subtext1 text-sm py-2 italic">
                            No technical data available
                          </p>
                        }
                      >
                        <div class="flex justify-between items-center">
                          <span class="text-subtext1">RSI(14)</span>
                          <Show
                            when={technical()?.rsi_14 != null}
                            fallback={<span class="text-subtext1">N/A</span>}
                          >
                            <span class={getRsiClass(technical()?.rsi_14!)}>
                              {technical()?.rsi_14?.toFixed(1)} (
                              {getRsiLabel(technical()?.rsi_14!)})
                            </span>
                          </Show>
                        </div>
                        <div class="flex justify-between items-center text-sm">
                          <span class="text-subtext1">SMA 50</span>
                          <Show
                            when={technical()?.sma_50 != null}
                            fallback={<span class="text-subtext1">N/A</span>}
                          >
                            <div class="text-right">
                              <div class="text-text">
                                {formatCurrencyDecimal(technical()?.sma_50!)}
                              </div>
                              <div
                                class={`text-[10px] ${
                                  technical()?.price_vs_sma50! >= 0
                                    ? "text-red"
                                    : "text-green"
                                }`}
                              >
                                {technical()?.price_vs_sma50! >= 0 ? "+" : ""}
                                {technical()?.price_vs_sma50?.toFixed(1)}%
                              </div>
                            </div>
                          </Show>
                        </div>
                        <div class="flex justify-between items-center text-sm pt-1">
                          <span class="text-subtext1">SMA 200</span>
                          <Show
                            when={technical()?.sma_200 != null}
                            fallback={<span class="text-subtext1">N/A</span>}
                          >
                            <div class="text-right">
                              <div class="text-text">
                                {formatCurrencyDecimal(technical()?.sma_200!)}
                              </div>
                              <div
                                class={`text-[10px] ${
                                  technical()?.price_vs_sma200! >= 0
                                    ? "text-red"
                                    : "text-green"
                                }`}
                              >
                                {technical()?.price_vs_sma200! >= 0 ? "+" : ""}
                                {technical()?.price_vs_sma200?.toFixed(1)}%
                              </div>
                            </div>
                          </Show>
                        </div>

                        {/* Zone Status (replaces old Wait Zone logic) */}
                        <div class="mt-4 pt-4 border-t border-surface1">
                          <div class="flex items-center justify-between mb-2">
                            <span class="text-xs text-subtext1">
                              Zone Status
                            </span>
                            {(() => {
                              // Get zone status from holdings (which now includes it) or compute from technical
                              const zoneStatus = holdings()?.zone_status;
                              const isDowntrend =
                                technical()?.sma_200 &&
                                technical()?.current_price <
                                  technical()?.sma_200;
                              const isOverheated =
                                (technical()?.rsi_14 &&
                                  technical()?.rsi_14 > 75) ||
                                (technical()?.price_vs_sma50 &&
                                  technical()?.price_vs_sma50 > 20) ||
                                (technical()?.price_vs_sma200 &&
                                  technical()?.price_vs_sma200 > 40);

                              // Determine status - priority: zone_status from API, else compute
                              const computedStatus = isDowntrend
                                ? "WAIT_TOO_COLD"
                                : isOverheated
                                ? "WAIT_TOO_HOT"
                                : "BUY";
                              const finalStatus = zoneStatus || computedStatus;

                              if (finalStatus === "WAIT_TOO_COLD") {
                                return (
                                  <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-blue/10 text-blue border border-blue/20">
                                    🧊 Downtrend
                                  </span>
                                );
                              } else if (finalStatus === "WAIT_TOO_HOT") {
                                return (
                                  <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-red/10 text-red border border-red/20">
                                    🔥 Too Hot
                                  </span>
                                );
                              } else {
                                return (
                                  <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-green/10 text-green border border-green/20">
                                    ✅ Buy Zone
                                  </span>
                                );
                              }
                            })()}
                          </div>
                          <div class="flex flex-wrap gap-1">
                            <Show
                              when={
                                technical()?.rsi_14 && technical()?.rsi_14 > 75
                              }
                            >
                              <span class="px-1.5 py-0.5 bg-red/10 text-red text-[10px] rounded">
                                RSI {technical()?.rsi_14?.toFixed(0)} &gt; 75
                              </span>
                            </Show>
                            <Show
                              when={
                                technical()?.rsi_14 && technical()?.rsi_14 < 30
                              }
                            >
                              <span class="px-1.5 py-0.5 bg-green/10 text-green text-[10px] rounded">
                                RSI {technical()?.rsi_14?.toFixed(0)} &lt; 30
                                (Oversold)
                              </span>
                            </Show>
                            <Show
                              when={
                                technical()?.price_vs_sma50 &&
                                technical()?.price_vs_sma50 > 20
                              }
                            >
                              <span class="px-1.5 py-0.5 bg-red/10 text-red text-[10px] rounded">
                                +{technical()?.price_vs_sma50?.toFixed(0)}%
                                SMA50
                              </span>
                            </Show>
                            <Show
                              when={
                                technical()?.price_vs_sma200 &&
                                technical()?.price_vs_sma200 > 40
                              }
                            >
                              <span class="px-1.5 py-0.5 bg-red/10 text-red text-[10px] rounded">
                                +{technical()?.price_vs_sma200?.toFixed(0)}%
                                SMA200
                              </span>
                            </Show>
                            <Show
                              when={
                                technical()?.sma_200 &&
                                technical()?.current_price <
                                  technical()?.sma_200
                              }
                            >
                              <span class="px-1.5 py-0.5 bg-blue/10 text-blue text-[10px] rounded">
                                Below SMA200
                              </span>
                            </Show>
                          </div>
                        </div>

                        {/* Portfolio Role */}
                        <Show when={holdings()?.portfolio_role}>
                          <div class="mt-4 pt-4 border-t border-surface1">
                            <div class="flex items-center justify-between">
                              <span class="text-xs text-subtext1">
                                Portfolio Role
                              </span>
                              {(() => {
                                const role = holdings()?.portfolio_role;
                                const roleConfig: Record<
                                  string,
                                  { emoji: string; label: string; color: string; description: string }
                                > = {
                                  VALUE: {
                                    emoji: "💎",
                                    label: "Value",
                                    color: "bg-blue/10 text-blue border-blue/20",
                                    description: "Deep value play with margin of safety"
                                  },
                                  MOMENTUM: {
                                    emoji: "🚀",
                                    label: "Momentum",
                                    color: "bg-purple/10 text-purple border-purple/20",
                                    description: "Trend-following, riding strength"
                                  },
                                  CORE: {
                                    emoji: "🏛️",
                                    label: "Core",
                                    color: "bg-mauve/10 text-mauve border-mauve/20",
                                    description: "Long-term compounder, buy-and-hold"
                                  },
                                  SPECULATIVE: {
                                    emoji: "🎲",
                                    label: "Speculative",
                                    color: "bg-peach/10 text-peach border-peach/20",
                                    description: "High-risk/reward bet"
                                  },
                                  INCOME: {
                                    emoji: "💰",
                                    label: "Income",
                                    color: "bg-green/10 text-green border-green/20",
                                    description: "Dividend/distribution focused"
                                  }
                                };
                                const config = role ? roleConfig[role] : null;
                                if (!config) return null;

                                return (
                                  <div class="flex flex-col items-end gap-1">
                                    <span class={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${config.color}`}>
                                      {config.emoji} {config.label}
                                    </span>
                                    <span class="text-[9px] text-subtext0 text-right">
                                      {config.description}
                                    </span>
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                        </Show>

                        {/* Portfolio Role Editor */}
                        <div class="mt-4 pt-4 border-t border-surface1">
                          <PortfolioRoleEditor
                            symbol={props.symbol}
                            currentRole={holdings()?.portfolio_role}
                          />
                        </div>
                      </Show>
                    </div>
                  </div>
                </div>

                {/* Latest AI Suggestion */}
                <div class="bg-surface0 border border-surface1 rounded-xl p-4 mb-6">
                  <h3 class="text-sm font-medium text-subtext0 mb-3">
                    Latest AI Suggestion
                  </h3>
                  <Show
                    when={!suggestion.loading}
                    fallback={<div class="text-subtext1">Loading...</div>}
                  >
                    <Show
                      when={suggestion()}
                      fallback={
                        <p class="text-subtext1">No AI suggestions yet</p>
                      }
                    >
                      {(s) => (
                        <div class="flex items-start gap-3">
                          <span
                            class={`px-2 py-1 text-xs font-bold rounded ${
                              actionColors[s().action] ||
                              "text-subtext0 bg-surface1"
                            }`}
                          >
                            {s().action}
                          </span>
                          <div class="flex-1">
                            <p class="text-sm text-text">{s().rationale}</p>
                            <p class="text-xs text-subtext1 mt-1">
                              {s().confidence
                                ? `Confidence: ${s().confidence}/10 • `
                                : ""}
                              {new Date(s().created_at).toLocaleDateString()}
                            </p>

                          </div>
                        </div>
                      )}
                    </Show>
                  </Show>
                </div>

                {/* Tier 2 Deep Analysis */}
                <div class="bg-surface0 border border-surface1 rounded-xl p-4 mb-6">
                  <div class="flex items-center justify-between mb-3">
                    <div class="flex items-center gap-2">
                      <h3 class="text-sm font-medium text-subtext0">
                        🧠 Deep Analysis (Tier 2)
                      </h3>
                      <DataAgeBadge
                        symbol={props.symbol}
                        source="Cached Analysis (Tier 2)"
                      />
                    </div>
                    <button
                      onClick={async () => {
                        const btn = document.getElementById(
                          "run-tier2-btn"
                        ) as HTMLButtonElement;
                        if (btn) {
                          btn.disabled = true;
                          btn.innerText = "Analyzing...";
                        }
                        try {
                          const res = await fetch("/api/analysis/deep", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ symbols: [props.symbol] }),
                          });
                          if (res.ok) {
                            const data = await res.json();
                            // Poll for completion
                            const pollInterval = setInterval(async () => {
                              try {
                                const statusRes = await fetch(
                                  `/api/analysis/deep/${data.jobId}`
                                );
                                const status = await statusRes.json();
                                if (
                                  status.status === "completed" ||
                                  status.status === "failed"
                                ) {
                                  clearInterval(pollInterval);
                                  window.location.reload();
                                }
                              } catch {
                                clearInterval(pollInterval);
                              }
                            }, 2000);
                          } else {
                            alert("Failed to start analysis");
                            if (btn) {
                              btn.disabled = false;
                              btn.innerText = "Run Analysis";
                            }
                          }
                        } catch (e) {
                          console.error("Failed to run analysis", e);
                          alert("Failed to start analysis");
                          if (btn) {
                            btn.disabled = false;
                            btn.innerText = "Run Analysis";
                          }
                        }
                      }}
                      id="run-tier2-btn"
                      class="text-[10px] px-2 py-1 rounded border border-surface1 bg-surface1/50 text-subtext0 hover:bg-surface1 hover:text-text transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Run Analysis
                    </button>
                  </div>
                  <Show
                    when={!tier2Analysis.loading}
                    fallback={<div class="text-subtext1">Loading...</div>}
                  >
                    <Show
                      when={tier2Analysis()?.found}
                      fallback={
                        <p class="text-subtext1 text-sm">
                          No deep analysis yet. Click "Run Analysis" to analyze
                          this stock.
                        </p>
                      }
                    >
                      {(a) => (
                        <div class="space-y-3">
                          {/* Score and Signal Row */}
                          <div class="flex items-center gap-3">
                            <div
                              class={`text-2xl font-bold ${
                                (tier2Analysis()?.analysis?.opportunityScore ??
                                  0) >= 70
                                  ? "text-green"
                                  : (tier2Analysis()?.analysis
                                      ?.opportunityScore ?? 0) >= 50
                                  ? "text-yellow"
                                  : "text-red"
                              }`}
                            >
                              {tier2Analysis()?.analysis?.opportunityScore ??
                                "?"}
                              <span class="text-sm text-subtext1">/100</span>
                            </div>
                            <span
                              class={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                tier2Analysis()?.analysis?.timingSignal ===
                                "accumulate"
                                  ? "bg-green/10 text-green border border-green/20"
                                  : tier2Analysis()?.analysis?.timingSignal ===
                                    "wait"
                                  ? "bg-yellow/10 text-yellow border border-yellow/20"
                                  : "bg-red/10 text-red border border-red/20"
                              }`}
                            >
                              {tier2Analysis()?.analysis?.timingSignal ===
                              "accumulate"
                                ? "🟢 Accumulate"
                                : tier2Analysis()?.analysis?.timingSignal ===
                                  "wait"
                                ? "🟡 Wait"
                                : "🔴 Avoid"}
                            </span>
                            <Show when={tier2Analysis()?.analysis?.newsAlert}>
                              <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-peach/10 text-peach border border-peach/20">
                                ⚠️ News Alert
                              </span>
                            </Show>
                          </div>

                          {/* Thesis Summary */}
                          <div>
                            <p class="text-sm text-text">
                              {tier2Analysis()?.analysis?.thesisSummary}
                            </p>
                          </div>

                          {/* Risks */}
                          <Show when={tier2Analysis()?.analysis?.risksSummary}>
                            <div class="text-sm">
                              <span class="text-subtext0 font-medium">
                                Risks:{" "}
                              </span>
                              <span class="text-subtext1">
                                {tier2Analysis()?.analysis?.risksSummary}
                              </span>
                            </div>
                          </Show>

                          {/* News Alert Reason */}
                          <Show
                            when={tier2Analysis()?.analysis?.newsAlertReason}
                          >
                            <div class="p-2 bg-peach/5 border border-peach/20 rounded text-sm">
                              <span class="text-peach font-medium">
                                ⚠️ News:{" "}
                              </span>
                              <span class="text-text">
                                {tier2Analysis()?.analysis?.newsAlertReason}
                              </span>
                            </div>
                          </Show>

                          {/* Analyzed At + Data Freshness */}
                          <div class="text-xs text-subtext1 pt-2 border-t border-surface1 space-y-1">
                            <div>
                              Analyzed:{" "}
                              {tier2Analysis()?.analysis?.analyzedAt
                                ? new Date(
                                    tier2Analysis()?.analysis?.analyzedAt
                                  ).toLocaleString()
                                : "Unknown"}
                            </div>
                            <Show when={tier2Analysis()?.analysis?.newsAt}>
                              <div>
                                News as of:{" "}
                                {new Date(
                                  tier2Analysis()?.analysis?.newsAt
                                ).toLocaleString()}
                              </div>
                            </Show>
                          </div>
                        </div>
                      )}
                    </Show>
                  </Show>
                </div>

                {/* ValuePickr Summary */}
                <div class="bg-surface0 border border-surface1 rounded-xl p-4 mb-6">
                  <div class="flex items-center justify-between mb-3">
                    <h3 class="text-sm font-medium text-subtext0">
                      💬 ValuePickr Thesis
                    </h3>
                    <div class="flex items-center gap-2">
                      <Show when={intel()?.thesis_summary}>
                        <button
                          onClick={async () => {
                            setIsRefreshingVP(true);
                            try {
                              const res = await fetch(
                                `/api/intel/${encodeURIComponent(
                                  props.symbol
                                )}/valuepickr`,
                                { method: "POST" }
                              );
                              if (res.ok) {
                                window.location.reload();
                              } else {
                                alert("Failed to refresh data");
                              }
                            } catch (e) {
                              console.error(
                                "Failed to refresh ValuePickr data",
                                e
                              );
                              alert("Failed to refresh data");
                            } finally {
                              setIsRefreshingVP(false);
                            }
                          }}
                          disabled={isRefreshingVP()}
                          class={`text-xs flex items-center gap-1 px-2 py-1 rounded border border-surface1 transition-colors ${
                            isRefreshingVP()
                              ? "bg-surface1 text-subtext1 cursor-not-allowed"
                              : "bg-surface1/50 text-subtext0 hover:bg-surface1 hover:text-text"
                          }`}
                          title="Refresh Data"
                        >
                          <FaSolidArrowsRotate
                            class={isRefreshingVP() ? "animate-spin" : ""}
                          />
                          {isRefreshingVP() ? "Refreshing..." : ""}
                        </button>

                        <button
                          onClick={async () => {
                            if (
                              !confirm(
                                "Are you sure you want to remove this ValuePickr data? It may be incorrect."
                              )
                            )
                              return;
                            try {
                              const res = await fetch(
                                `/api/intel/${encodeURIComponent(
                                  props.symbol
                                )}/valuepickr`,
                                {
                                  method: "DELETE",
                                }
                              );
                              if (res.ok) {
                                // Refresh the page or just the resource
                                window.location.reload();
                              }
                            } catch (e) {
                              console.error(
                                "Failed to delete ValuePickr data",
                                e
                              );
                              alert("Failed to delete data");
                            }
                          }}
                          class="text-xs material-symbols-outlined text-red/60 hover:text-red cursor-pointer"
                          title="Remove incorrect data"
                        >
                          <FaSolidTrashCan />
                        </button>
                      </Show>
                      <Show when={intel()?.topic_url}>
                        <a
                          href={intel()?.topic_url}
                          target="_blank"
                          rel="noopener"
                          class="text-xs text-blue hover:text-sapphire"
                        >
                          View on Forum →
                        </a>
                      </Show>
                    </div>
                  </div>
                  <Show
                    when={!intel.loading}
                    fallback={<div class="text-subtext1">Loading...</div>}
                  >
                    <Show
                      when={intel()?.thesis_summary}
                      fallback={
                        <div class="text-subtext1">
                          <p class="mb-2">No ValuePickr thesis available.</p>
                          <div class="flex gap-2 items-center">
                            <button
                              onClick={() => {
                                const el =
                                  document.getElementById("vp-manual-add");
                                if (el) el.classList.remove("hidden");
                              }}
                              class="text-xs text-blue hover:text-sapphire hover:underline"
                            >
                              Add Manually
                            </button>
                            <span class="text-xs text-subtext1">|</span>
                            <span class="text-xs text-subtext1">
                              Run "Sync Data" on watchlist to auto-fetch
                            </span>
                          </div>

                          <div
                            id="vp-manual-add"
                            class="hidden mt-3 p-3 bg-surface1/30 rounded-lg"
                          >
                            <p class="text-xs text-subtext0 mb-2">
                              Paste ValuePickr thread URL:
                            </p>
                            <div class="flex gap-2">
                              <input
                                type="text"
                                id="vp-url-input"
                                placeholder="https://forum.valuepickr.com/t/..."
                                class="flex-1 bg-surface0 border border-surface2 rounded px-2 py-1 text-xs text-text focus:border-mauve focus:outline-none"
                              />
                              <button
                                onClick={async () => {
                                  const input = document.getElementById(
                                    "vp-url-input"
                                  ) as HTMLInputElement;
                                  const url = input.value.trim();
                                  if (!url) return;

                                  const btn = document.getElementById(
                                    "vp-save-btn"
                                  ) as HTMLButtonElement;
                                  if (btn) {
                                    btn.disabled = true;
                                    btn.innerText = "Saving...";
                                  }

                                  try {
                                    const res = await fetch(
                                      `/api/intel/${encodeURIComponent(
                                        props.symbol
                                      )}/valuepickr`,
                                      {
                                        method: "POST",
                                        headers: {
                                          "Content-Type": "application/json",
                                        },
                                        body: JSON.stringify({ url }),
                                      }
                                    );

                                    if (res.ok) {
                                      window.location.reload();
                                    } else {
                                      alert(
                                        "Failed to fetch data from URL. Please check if it's a valid ValuePickr thread."
                                      );
                                    }
                                  } catch (e) {
                                    console.error(e);
                                    alert("Error saving URL");
                                  } finally {
                                    if (btn) {
                                      btn.disabled = false;
                                      btn.innerText = "Save";
                                    }
                                  }
                                }}
                                id="vp-save-btn"
                                class="px-3 py-1 bg-mauve text-base text-xs font-medium rounded hover:bg-mauve/90 disabled:opacity-50"
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        </div>
                      }
                    >
                      <div class="text-subtext1">
                        <p class="text-sm text-text mb-2">
                          {intel()?.thesis_summary}
                        </p>
                        <Show when={intel()?.recent_sentiment_summary}>
                          <p class="text-sm text-subtext1">
                            <strong class="text-subtext0">
                              Recent sentiment:
                            </strong>{" "}
                            {intel()?.recent_sentiment_summary}
                          </p>
                        </Show>
                        <Show when={intel()?.last_activity}>
                          <p class="text-xs text-subtext1 mt-2">
                            Last activity:{" "}
                            {(() => {
                              const lastActivity = new Date(
                                intel()?.last_activity
                              );
                              const now = new Date();
                              const daysAgo = Math.floor(
                                (now.getTime() - lastActivity.getTime()) /
                                  (1000 * 60 * 60 * 24)
                              );
                              return daysAgo === 0
                                ? "Today"
                                : daysAgo === 1
                                ? "Yesterday"
                                : `${daysAgo} days ago`;
                            })()}
                          </p>
                        </Show>
                      </div>
                    </Show>
                  </Show>
                </div>

                {/* VRS Research Section */}
                <VRSSection symbol={props.symbol} />

                {/* Price Chart */}
                <div id="price-chart-container" class="mb-6">
                  <PriceChart symbol={props.symbol} />
                </div>
              </section>
            </Match>

            <Match when={activeTab() === "research"}>
              <section id="tab-research">
                <ResearchList
                  symbol={props.symbol}
                  onClose={() => {}}
                  embedded={true}
                />
              </section>
            </Match>

            <Match when={activeTab() === "notes"}>
              <section id="tab-notes">
                <CompanyNotes
                  symbol={props.symbol}
                  onClose={() => {}}
                  embedded={true}
                />
              </section>
            </Match>

            <Match when={activeTab() === "links"}>
              <section id="tab-links">
                <LinksList
                  symbol={props.symbol}
                  onClose={() => {}}
                  embedded={true}
                />
              </section>
            </Match>

            <Match when={activeTab() === "tables"}>
              <section id="tab-tables">
                <TablesList
                  symbol={props.symbol}
                  onClose={() => {}}
                  embedded={true}
                />
              </section>
            </Match>

            <Match when={activeTab() === "earnings"}>
              <section id="tab-earnings">
                <EarningsPanel symbol={props.symbol} />
              </section>
            </Match>
          </Switch>
        </div>
      </main>
    </div>
  );
}
