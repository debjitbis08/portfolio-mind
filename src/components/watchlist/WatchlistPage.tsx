/**
 * Watchlist Page Component
 * View, add, and manage watchlist stocks
 */

import { createSignal, createEffect, For, Show } from "solid-js";
import { getSourceBadges } from "../../lib/utils/source-utils";
import { FaSolidPencil } from "solid-icons/fa";

interface WatchlistStock {
  symbol: string;
  source: string;
  notes: string | null;
  interesting: boolean;
  added_at: string;
  name: string;
  sector: string | null;
  current_price: number | null;
  rsi_14: number | null;
  sma_50: number | null;
  sma_200: number | null;
  price_vs_sma50: number | null;
  price_vs_sma200: number | null;
  zone_status: "BUY" | "WAIT_TOO_HOT" | "WAIT_TOO_COLD" | null;
  is_wait_zone: boolean;
  wait_reasons: string[] | null;
  portfolio_role:
    | "VALUE"
    | "MOMENTUM"
    | "CORE"
    | "SPECULATIVE"
    | "INCOME"
    | null;
  technical_updated_at: string | null;
  has_thesis: boolean;
  has_financials: boolean;
  vrs_research: {
    recPrice: number | null;
    recDate: string | null;
    exitPrice: number | null;
    exitDate: string | null;
    status: "Buy" | "Exited" | null;
    rationale: string | null;
    risks: string | null;
    analystNote: string | null;
  } | null;
}

export default function WatchlistPage() {
  const [stocks, setStocks] = createSignal<WatchlistStock[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  // Filters
  const [filterSource, setFilterSource] = createSignal<string>("");
  const [filterInteresting, setFilterInteresting] = createSignal(false);

  // Add modal
  const [showAddModal, setShowAddModal] = createSignal(false);
  const [newSymbol, setNewSymbol] = createSignal("");
  const [newName, setNewName] = createSignal("");
  const [adding, setAdding] = createSignal(false);

  // Inline name editing
  const [editingSymbol, setEditingSymbol] = createSignal<string | null>(null);
  const [editedName, setEditedName] = createSignal("");

  // Sync state
  const [syncing, setSyncing] = createSignal(false);
  const [techSyncing, setTechSyncing] = createSignal(false);
  // VRS redirect handler
  const redirectToVrsEntry = (stock: WatchlistStock) => {
    window.location.href = `/company/${stock.symbol}?openVrs=true`;
  };

  const [syncStatus, setSyncStatus] = createSignal<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);

  // Fetch watchlist
  const fetchWatchlist = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterSource()) params.set("source", filterSource());
      if (filterInteresting()) params.set("interesting", "true");

      const res = await fetch(`/api/watchlist?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setStocks(data.stocks || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load watchlist");
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    // Re-fetch when filters change
    filterSource();
    filterInteresting();
    fetchWatchlist();
  });

  // Toggle interesting
  const toggleInteresting = async (symbol: string, current: boolean) => {
    try {
      await fetch("/api/watchlist", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, interesting: !current }),
      });
      // Update local state
      setStocks((prev) =>
        prev.map((s) =>
          s.symbol === symbol ? { ...s, interesting: !current } : s
        )
      );
    } catch (err) {
      console.error("Failed to toggle interesting:", err);
    }
  };

  // Delete stock
  const deleteStock = async (symbol: string) => {
    if (!confirm(`Remove ${symbol} from watchlist?`)) return;
    try {
      const res = await fetch(
        `/api/watchlist?symbol=${encodeURIComponent(symbol)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed to delete stock from server");

      setStocks((prev) => prev.filter((s) => s.symbol !== symbol));
    } catch (err) {
      console.error("Failed to delete:", err);
      alert(err instanceof Error ? err.message : "Failed to delete stock");
    }
  };

  // Add stock
  const addStock = async () => {
    if (!newSymbol().trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: newSymbol().trim(),
          name: newName().trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add");
      setNewSymbol("");
      setNewName("");
      setShowAddModal(false);
      fetchWatchlist();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to add stock");
    } finally {
      setAdding(false);
    }
  };

  // Batch sync financials
  const syncAllFinancials = async () => {
    setSyncing(true);
    setSyncStatus({ type: "info", message: "Starting batch sync..." });
    try {
      const res = await fetch("/api/watchlist/sync-financials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      setSyncStatus({
        type: "success",
        message: `Synced ${data.synced}/${data.total} stocks. ${data.failed} failed.`,
      });
      fetchWatchlist();
    } catch (err) {
      setSyncStatus({
        type: "error",
        message: err instanceof Error ? err.message : "Sync failed",
      });
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncStatus(null), 10000);
    }
  };

  // Batch sync technicals
  const syncAllTechnicals = async () => {
    setTechSyncing(true);
    setSyncStatus({ type: "info", message: "Updating technical snapshots..." });
    try {
      const res = await fetch("/api/watchlist/sync-technicals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      setSyncStatus({
        type: "success",
        message: `Updated technicals for ${data.synced}/${data.total} stocks. ${data.failed} failed.`,
      });
      fetchWatchlist();
    } catch (err) {
      setSyncStatus({
        type: "error",
        message: err instanceof Error ? err.message : "Sync failed",
      });
    } finally {
      setTechSyncing(false);
      setTimeout(() => setSyncStatus(null), 10000);
    }
  };

  // Format date
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "2-digit",
    });
  };

  // Start editing stock name
  const startEditingName = (stock: WatchlistStock) => {
    setEditingSymbol(stock.symbol);
    setEditedName(stock.name || stock.symbol);
  };

  // Save edited name
  const saveEditedName = async (symbol: string) => {
    try {
      const res = await fetch("/api/watchlist", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, name: editedName().trim() }),
      });
      if (res.ok) {
        // Update local state
        setStocks((prev) =>
          prev.map((s) =>
            s.symbol === symbol ? { ...s, name: editedName().trim() } : s
          )
        );
      }
    } catch (err) {
      console.error("Failed to save name:", err);
    } finally {
      setEditingSymbol(null);
    }
  };

  // Cancel editing
  const cancelEditingName = () => {
    setEditingSymbol(null);
    setEditedName("");
  };

  // Copy table as markdown
  const copyTableAsMarkdown = async () => {
    const formatTechnical = (stock: WatchlistStock) => {
      const badges = [];
      if (stock.rsi_14 !== null) badges.push(`RSI ${stock.rsi_14}`);
      if (stock.price_vs_sma50 !== null)
        badges.push(
          `${
            stock.price_vs_sma50 >= 0 ? "+" : ""
          }${stock.price_vs_sma50.toFixed(0)}% 50D`
        );
      if (stock.price_vs_sma200 !== null)
        badges.push(
          `${
            stock.price_vs_sma200 >= 0 ? "+" : ""
          }${stock.price_vs_sma200.toFixed(0)}% 200D`
        );
      if (stock.zone_status === "WAIT_TOO_HOT") badges.push("Too Hot");
      else if (stock.zone_status === "WAIT_TOO_COLD") badges.push("Downtrend");
      else if (stock.zone_status === "BUY") badges.push("Buy Zone");
      if (stock.portfolio_role) badges.push(stock.portfolio_role);
      return badges.length > 0 ? badges.join(", ") : "-";
    };

    const headers = [
      "⭐",
      "Name",
      "Symbol",
      "Sector",
      "Source",
      "Technical",
      "Price",
    ];
    const separator = headers.map(() => "---");

    const rows = stocks().map((stock) => [
      stock.interesting ? "★" : "☆",
      stock.name,
      stock.symbol,
      stock.sector || "-",
      stock.source,
      formatTechnical(stock),
      stock.current_price
        ? `₹${stock.current_price.toLocaleString("en-IN")}`
        : "-",
    ]);

    const markdown = [
      `| ${headers.join(" | ")} |`,
      `| ${separator.join(" | ")} |`,
      ...rows.map((row) => `| ${row.join(" | ")} |`),
    ].join("\n");

    try {
      await navigator.clipboard.writeText(markdown);
      alert("Table copied as markdown!");
    } catch (err) {
      console.error("Failed to copy:", err);
      alert("Failed to copy to clipboard");
    }
  };

  return (
    <div class="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold text-text">Watchlist</h1>
          <p class="text-sm text-subtext0">
            {stocks().length} stocks from screener screens and manual additions
          </p>
        </div>
        <div class="flex items-center gap-3">
          <button
            class={`px-4 py-2 text-sm rounded-lg flex items-center gap-2 transition-colors ${
              techSyncing()
                ? "bg-surface1 text-subtext0 cursor-not-allowed"
                : "bg-yellow/20 text-yellow hover:bg-yellow/30"
            }`}
            onClick={syncAllTechnicals}
            disabled={techSyncing() || syncing()}
          >
            <span class={techSyncing() ? "animate-spin" : ""}>
              {techSyncing() ? "⏳" : "⚡"}
            </span>
            {techSyncing() ? "Updating..." : "Refresh Technicals"}
          </button>
          <button
            class={`px-4 py-2 text-sm rounded-lg flex items-center gap-2 transition-colors ${
              syncing()
                ? "bg-surface1 text-subtext0 cursor-not-allowed"
                : "bg-blue/20 text-blue hover:bg-blue/30"
            }`}
            onClick={syncAllFinancials}
            disabled={syncing() || techSyncing()}
          >
            <span class={syncing() ? "animate-spin" : ""}>
              {syncing() ? "⏳" : "📊"}
            </span>
            {syncing() ? "Syncing..." : "Sync All Financials"}
          </button>
          <button
            class="px-4 py-2 text-sm bg-green/20 text-green rounded-lg hover:bg-green/30 transition-colors"
            onClick={copyTableAsMarkdown}
            title="Copy table as markdown"
          >
            📋 Copy MD
          </button>
          <button
            class="px-4 py-2 text-sm bg-mauve text-base rounded-lg hover:bg-mauve/80 transition-colors"
            onClick={() => setShowAddModal(true)}
          >
            + Add Stock
          </button>
        </div>
      </div>

      {/* Sync Status */}
      <Show when={syncStatus()}>
        <div
          class={`mb-4 px-4 py-3 rounded-lg text-sm ${
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

      {/* Filters */}
      <div class="flex items-center gap-4 mb-4">
        <select
          class="px-3 py-2 bg-surface0 border border-surface1 rounded-lg text-sm text-text"
          value={filterSource()}
          onChange={(e) => setFilterSource(e.currentTarget.value)}
        >
          <option value="">All Sources</option>
          <option value="screener">Screener</option>
          <option value="manual">Manual</option>
          <option value="vrs">Value Research</option>
        </select>
        <label class="flex items-center gap-2 text-sm text-subtext0">
          <input
            type="checkbox"
            checked={filterInteresting()}
            onChange={(e) => setFilterInteresting(e.currentTarget.checked)}
            class="rounded"
          />
          Interesting only
        </label>
        <button
          class="text-sm text-mauve hover:underline"
          onClick={fetchWatchlist}
        >
          Refresh
        </button>
      </div>

      {/* Error */}
      <Show when={error()}>
        <div class="bg-red/10 border border-red/30 rounded-lg p-4 mb-4 text-red text-sm">
          {error()}
        </div>
      </Show>

      {/* Loading */}
      <Show when={loading()}>
        <div class="flex justify-center py-12">
          <div class="animate-spin w-8 h-8 border-2 border-mauve border-t-transparent rounded-full" />
        </div>
      </Show>

      {/* Table */}
      <Show when={!loading() && stocks().length > 0}>
        <div class="bg-surface0 border border-surface1 rounded-xl overflow-hidden">
          <table class="w-full text-sm">
            <thead>
              <tr class="bg-surface1/50 border-b border-surface1">
                <th class="text-left py-3 px-4 text-subtext0 font-medium">★</th>
                <th class="text-left py-3 px-4 text-subtext0 font-medium">
                  Symbol
                </th>
                <th class="text-left py-3 px-4 text-subtext0 font-medium">
                  Source
                </th>
                <th class="text-center py-3 px-4 text-subtext0 font-medium">
                  Technical
                </th>
                <th class="text-right py-3 px-4 text-subtext0 font-medium">
                  Price
                </th>
                <th class="text-center py-3 px-4 text-subtext0 font-medium">
                  Thesis
                </th>
                <th class="text-center py-3 px-4 text-subtext0 font-medium">
                  Financials
                </th>
                <th class="text-left py-3 px-4 text-subtext0 font-medium">
                  Added
                </th>
                <th class="text-right py-3 px-4 text-subtext0 font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              <For each={stocks()}>
                {(stock) => (
                  <tr class="border-b border-surface1/50 hover:bg-surface1/20 transition-colors">
                    <td class="py-3 px-4">
                      <button
                        class={`text-lg ${
                          stock.interesting
                            ? "text-yellow"
                            : "text-surface2 hover:text-yellow"
                        }`}
                        onClick={() =>
                          toggleInteresting(stock.symbol, stock.interesting)
                        }
                        title={
                          stock.interesting
                            ? "Remove from interesting"
                            : "Mark as interesting"
                        }
                      >
                        {stock.interesting ? "★" : "☆"}
                      </button>
                    </td>
                    <td class="py-3 px-4">
                      <Show
                        when={editingSymbol() === stock.symbol}
                        fallback={
                          <div>
                            <div class="flex items-center gap-2 group">
                              <a
                                href={`/company/${stock.symbol}`}
                                class="text-mauve hover:underline font-medium"
                              >
                                {stock.name}
                              </a>
                              <button
                                onClick={() => startEditingName(stock)}
                                class="opacity-0 group-hover:opacity-100 text-subtext0 hover:text-text transition-all p-1 rounded hover:bg-surface1"
                                title="Edit name"
                              >
                                <FaSolidPencil />
                              </button>
                            </div>
                            <div class="flex items-center gap-2 group text-xs text-subtext0 mt-1">
                              <Show when={stock.name !== stock.symbol}>
                                <span>{stock.symbol}</span>
                              </Show>
                              <Show
                                when={
                                  stock.name !== stock.symbol && stock.sector
                                }
                              >
                                |
                              </Show>
                              <Show when={stock.sector}>
                                <span>{stock.sector}</span>
                              </Show>
                            </div>
                          </div>
                        }
                      >
                        <div class="flex items-center gap-2">
                          <input
                            type="text"
                            class="px-2 py-1 bg-surface0 border border-surface1 rounded text-sm text-text"
                            value={editedName()}
                            onInput={(e) =>
                              setEditedName(e.currentTarget.value)
                            }
                            onKeyPress={(e) => {
                              if (e.key === "Enter")
                                saveEditedName(stock.symbol);
                              if (e.key === "Escape") cancelEditingName();
                            }}
                            autofocus
                          />
                          <button
                            onClick={() => saveEditedName(stock.symbol)}
                            class="px-2 py-0.5 bg-green/20 text-green rounded text-xs hover:bg-green/30"
                          >
                            ✓
                          </button>
                          <button
                            onClick={cancelEditingName}
                            class="px-2 py-0.5 bg-surface1 text-subtext0 rounded text-xs hover:bg-surface2"
                          >
                            ✕
                          </button>
                        </div>
                      </Show>
                    </td>
                    <td class="py-3 px-4">
                      <div class="flex flex-wrap gap-1">
                        <For each={getSourceBadges(stock.source)}>
                          {(badge) => (
                            <span
                              class={`text-xs px-2 py-0.5 rounded border ${badge.color}`}
                              title={badge.label}
                            >
                              {badge.icon} {badge.label}
                            </span>
                          )}
                        </For>
                      </div>
                    </td>
                    <td class="py-3 px-4 text-center">
                      <div class="flex flex-wrap gap-1 justify-center">
                        <Show
                          when={
                            stock.rsi_14 ||
                            stock.price_vs_sma50 ||
                            stock.zone_status ||
                            stock.portfolio_role
                          }
                          fallback={
                            <span class="text-xs text-subtext0">—</span>
                          }
                        >
                          {/* RSI badge */}
                          <Show when={stock.rsi_14 !== null}>
                            <span
                              class={`px-2 py-0.5 text-xs rounded ${
                                stock.rsi_14! > 70
                                  ? "bg-red/20 text-red"
                                  : stock.rsi_14! < 30
                                  ? "bg-green/20 text-green"
                                  : "bg-surface2 text-subtext0"
                              }`}
                            >
                              RSI {stock.rsi_14}
                            </span>
                          </Show>

                          {/* SMA50 badge */}
                          <Show when={stock.price_vs_sma50 !== null}>
                            <span
                              class={`px-2 py-0.5 text-xs rounded bg-surface2 ${
                                stock.price_vs_sma50! > 20
                                  ? "text-red"
                                  : stock.price_vs_sma50! < -10
                                  ? "text-yellow"
                                  : stock.price_vs_sma50! >= 0
                                  ? "text-green"
                                  : "text-subtext0"
                              }`}
                            >
                              {stock.price_vs_sma50! >= 0 ? "+" : ""}
                              {stock.price_vs_sma50!.toFixed(0)}% 50D
                            </span>
                          </Show>

                          {/* SMA200 badge */}
                          <Show when={stock.price_vs_sma200 !== null}>
                            <span
                              class={`px-2 py-0.5 text-xs rounded bg-surface2 ${
                                stock.price_vs_sma200! > 40
                                  ? "text-red"
                                  : stock.price_vs_sma200! < 0
                                  ? "text-yellow"
                                  : "text-green"
                              }`}
                            >
                              {stock.price_vs_sma200! >= 0 ? "+" : ""}
                              {stock.price_vs_sma200!.toFixed(0)}% 200D
                            </span>
                          </Show>

                          {/* Zone status badge */}
                          <Show when={stock.zone_status}>
                            <Show when={stock.zone_status === "WAIT_TOO_HOT"}>
                              <span class="px-2 py-0.5 text-xs rounded bg-red/20 text-red">
                                🔥 Too Hot
                              </span>
                            </Show>
                            <Show when={stock.zone_status === "WAIT_TOO_COLD"}>
                              <span class="px-2 py-0.5 text-xs rounded bg-blue/20 text-blue">
                                🧊 Downtrend
                              </span>
                            </Show>
                            <Show when={stock.zone_status === "BUY"}>
                              <span class="px-2 py-0.5 text-xs rounded bg-green/20 text-green">
                                ✅ Buy Zone
                              </span>
                            </Show>
                          </Show>

                          {/* Portfolio Role badge */}
                          <Show when={stock.portfolio_role}>
                            <Show when={stock.portfolio_role === "VALUE"}>
                              <span class="px-2 py-0.5 text-xs rounded bg-blue/20 text-blue">
                                💎 Value
                              </span>
                            </Show>
                            <Show when={stock.portfolio_role === "MOMENTUM"}>
                              <span class="px-2 py-0.5 text-xs rounded bg-purple/20 text-purple">
                                🚀 Momentum
                              </span>
                            </Show>
                            <Show when={stock.portfolio_role === "CORE"}>
                              <span class="px-2 py-0.5 text-xs rounded bg-mauve/20 text-mauve">
                                🏛️ Core
                              </span>
                            </Show>
                            <Show when={stock.portfolio_role === "SPECULATIVE"}>
                              <span class="px-2 py-0.5 text-xs rounded bg-peach/20 text-peach">
                                🎲 Speculative
                              </span>
                            </Show>
                            <Show when={stock.portfolio_role === "INCOME"}>
                              <span class="px-2 py-0.5 text-xs rounded bg-green/20 text-green">
                                💰 Income
                              </span>
                            </Show>
                          </Show>
                        </Show>
                      </div>
                      <Show
                        when={
                          stock.wait_reasons && stock.wait_reasons.length > 0
                        }
                      >
                        <div class="text-xs text-subtext0 mt-1">
                          {stock.wait_reasons!.join(", ")}
                        </div>
                      </Show>
                    </td>
                    <td class="py-3 px-4 text-right text-text">
                      {stock.current_price
                        ? `₹${stock.current_price.toLocaleString("en-IN")}`
                        : "—"}
                    </td>
                    <td class="py-3 px-4 text-center">
                      {stock.has_thesis ? (
                        <span class="text-green" title="Has ValuePickr thesis">
                          ✓
                        </span>
                      ) : (
                        <span class="text-surface2">—</span>
                      )}
                    </td>
                    <td class="py-3 px-4 text-center">
                      {stock.has_financials ? (
                        <span class="text-green" title="Financials synced">
                          ✓
                        </span>
                      ) : (
                        <span class="text-surface2">—</span>
                      )}
                    </td>
                    <td class="py-3 px-4 text-subtext0">
                      {formatDate(stock.added_at)}
                    </td>
                    <td class="py-3 px-4 text-right">
                      <button
                        class="text-red/70 hover:text-red text-xs"
                        onClick={() => deleteStock(stock.symbol)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>

      {/* Empty state */}
      <Show when={!loading() && stocks().length === 0}>
        <div class="bg-surface0 border border-surface1 rounded-xl p-8 text-center">
          <p class="text-subtext0 mb-4">No stocks in watchlist</p>
          <button
            class="px-4 py-2 bg-mauve text-base rounded-lg hover:bg-mauve/80"
            onClick={() => setShowAddModal(true)}
          >
            Add your first stock
          </button>
        </div>
      </Show>

      {/* Add Modal */}
      <Show when={showAddModal()}>
        <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div class="bg-base border border-surface1 rounded-xl p-6 w-full max-w-md">
            <h2 class="text-lg font-semibold text-text mb-4">
              Add Stock to Watchlist
            </h2>
            <div class="space-y-4">
              <div>
                <label class="block text-sm text-subtext0 mb-1">
                  Stock Symbol *
                </label>
                <input
                  type="text"
                  class="w-full px-3 py-2 bg-surface0 border border-surface1 rounded-lg text-text placeholder-subtext0"
                  placeholder="e.g., INFY, TCS, 544467"
                  value={newSymbol()}
                  onInput={(e) =>
                    setNewSymbol(e.currentTarget.value.toUpperCase())
                  }
                  onKeyPress={(e) => e.key === "Enter" && addStock()}
                />
                <p class="text-xs text-subtext0 mt-1">
                  Enter NSE/BSE symbol or BSE code (e.g., 544467)
                </p>
              </div>
              <div>
                <label class="block text-sm text-subtext0 mb-1">
                  Company Name <span class="text-subtext1">(optional)</span>
                </label>
                <input
                  type="text"
                  class="w-full px-3 py-2 bg-surface0 border border-surface1 rounded-lg text-text placeholder-subtext0"
                  placeholder="e.g., Infosys Limited"
                  value={newName()}
                  onInput={(e) => setNewName(e.currentTarget.value)}
                />
                <p class="text-xs text-subtext0 mt-1">
                  Provide for obscure BSE stocks not in Yahoo Finance
                </p>
              </div>
              <div class="flex justify-end gap-3">
                <button
                  class="px-4 py-2 text-sm text-subtext0 hover:text-text"
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </button>
                <button
                  class={`px-4 py-2 text-sm rounded-lg ${
                    adding()
                      ? "bg-surface1 text-subtext0"
                      : "bg-mauve text-base hover:bg-mauve/80"
                  }`}
                  onClick={addStock}
                  disabled={adding()}
                >
                  {adding() ? "Adding..." : "Add Stock"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
