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

interface CompanyDetailsProps {
  symbol: string;
}

export default function CompanyDetails(props: CompanyDetailsProps) {
  const [activeTab, setActiveTab] = createSignal("overview");
  const [isRefreshingTech, setIsRefreshingTech] = createSignal(false);

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
              <h1 class="text-2xl font-bold text-text uppercase tracking-tight">
                {props.symbol}
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
            <p class="text-sm text-subtext0">
              {holdings()?.stock_name || "Company Details"}
            </p>
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
                          <span class={getRsiClass(technical()?.rsi_14 || 50)}>
                            <Show
                              when={technical()?.rsi_14 !== undefined}
                              fallback="..."
                            >
                              {technical()?.rsi_14?.toFixed(1)} (
                              {getRsiLabel(technical()?.rsi_14)})
                            </Show>
                          </span>
                        </div>
                        <div class="flex justify-between items-center text-sm">
                          <span class="text-subtext1">SMA 50</span>
                          <div class="text-right">
                            <div class="text-text">
                              {formatCurrencyDecimal(technical()?.sma_50 || 0)}
                            </div>
                            <div
                              class={`text-[10px] ${
                                technical()?.price_vs_sma50 >= 0
                                  ? "text-red"
                                  : "text-green"
                              }`}
                            >
                              {technical()?.price_vs_sma50 >= 0 ? "+" : ""}
                              {technical()?.price_vs_sma50?.toFixed(1)}%
                            </div>
                          </div>
                        </div>
                        <div class="flex justify-between items-center text-sm pt-1">
                          <span class="text-subtext1">SMA 200</span>
                          <div class="text-right">
                            <div class="text-text">
                              {formatCurrencyDecimal(technical()?.sma_200 || 0)}
                            </div>
                            <div
                              class={`text-[10px] ${
                                technical()?.price_vs_sma200 >= 0
                                  ? "text-red"
                                  : "text-green"
                              }`}
                            >
                              {technical()?.price_vs_sma200 >= 0 ? "+" : ""}
                              {technical()?.price_vs_sma200?.toFixed(1)}%
                            </div>
                          </div>
                        </div>

                        {/* Wait Zone Status */}
                        <div class="mt-4 pt-4 border-t border-surface1">
                          <div class="flex items-center justify-between mb-2">
                            <span class="text-xs text-subtext1">Decision</span>
                            <span
                              class={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                technical()?.rsi_14 > 40 ||
                                technical()?.price_vs_sma50 > 15 ||
                                technical()?.price_vs_sma200 > 15 ||
                                (technical()?.sma_200 &&
                                  technical()?.current_price <
                                    technical()?.sma_200)
                                  ? "bg-red/10 text-red border border-red/20"
                                  : "bg-green/10 text-green border border-green/20"
                              }`}
                            >
                              {technical()?.rsi_14 > 40 ||
                              technical()?.price_vs_sma50 > 15 ||
                              technical()?.price_vs_sma200 > 15 ||
                              (technical()?.sma_200 &&
                                technical()?.current_price <
                                  technical()?.sma_200)
                                ? "Wait"
                                : "Value territory"}
                            </span>
                          </div>
                          <div class="flex flex-wrap gap-1">
                            <Show when={technical()?.rsi_14 > 40}>
                              <span class="px-1.5 py-0.5 bg-surface1 text-subtext1 text-[10px] rounded">
                                RSI &gt; 40
                              </span>
                            </Show>
                            <Show when={technical()?.price_vs_sma50 > 15}>
                              <span class="px-1.5 py-0.5 bg-surface1 text-subtext1 text-[10px] rounded">
                                +{technical()?.price_vs_sma50?.toFixed(0)}%
                                SMA50
                              </span>
                            </Show>
                            <Show when={technical()?.price_vs_sma200 > 15}>
                              <span class="px-1.5 py-0.5 bg-surface1 text-subtext1 text-[10px] rounded">
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
                              <span class="px-1.5 py-0.5 bg-surface1 text-subtext1 text-[10px] rounded">
                                Below SMA200
                              </span>
                            </Show>
                          </div>
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
                          class="text-[10px] text-red hover:text-red/80 px-2 py-0.5 rounded border border-red/20 hover:bg-red/5"
                          title="Remove incorrect data"
                        >
                          Remove
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
                        <p class="text-subtext1">
                          No ValuePickr thesis available. Run "Sync Data" on the
                          watchlist to fetch.
                        </p>
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
