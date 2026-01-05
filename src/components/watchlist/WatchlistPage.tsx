/**
 * Watchlist Page Component
 * View, add, and manage watchlist stocks
 */

import { createSignal, createEffect, For, Show } from "solid-js";

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
  has_thesis: boolean;
  has_financials: boolean;
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
  const [adding, setAdding] = createSignal(false);

  // Sync state
  const [syncing, setSyncing] = createSignal(false);
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
      await fetch(`/api/watchlist?symbol=${symbol}`, { method: "DELETE" });
      setStocks((prev) => prev.filter((s) => s.symbol !== symbol));
    } catch (err) {
      console.error("Failed to delete:", err);
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
        body: JSON.stringify({ symbol: newSymbol().trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add");
      setNewSymbol("");
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

  // Format date
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "2-digit",
    });
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
              syncing()
                ? "bg-surface1 text-subtext0 cursor-not-allowed"
                : "bg-blue/20 text-blue hover:bg-blue/30"
            }`}
            onClick={syncAllFinancials}
            disabled={syncing()}
          >
            <span class={syncing() ? "animate-spin" : ""}>
              {syncing() ? "⏳" : "📊"}
            </span>
            {syncing() ? "Syncing..." : "Sync All Financials"}
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
                <th class="text-right py-3 px-4 text-subtext0 font-medium">
                  Price
                </th>
                <th class="text-right py-3 px-4 text-subtext0 font-medium">
                  RSI
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
                      <a
                        href={`/company/${stock.symbol}`}
                        class="text-mauve hover:underline font-medium"
                      >
                        {stock.name}
                      </a>
                      <Show when={stock.name !== stock.symbol}>
                        <span class="text-xs text-subtext0 ml-1">
                          ({stock.symbol})
                        </span>
                      </Show>
                      <Show when={stock.sector}>
                        <span class="text-xs text-subtext0 ml-2">
                          {stock.sector}
                        </span>
                      </Show>
                    </td>
                    <td class="py-3 px-4">
                      <span
                        class={`text-xs px-2 py-0.5 rounded ${
                          stock.source === "screener"
                            ? "bg-blue/10 text-blue"
                            : "bg-surface2 text-subtext0"
                        }`}
                      >
                        {stock.source}
                      </span>
                    </td>
                    <td class="py-3 px-4 text-right text-text">
                      {stock.current_price
                        ? `₹${stock.current_price.toLocaleString("en-IN")}`
                        : "—"}
                    </td>
                    <td
                      class={`py-3 px-4 text-right ${
                        stock.rsi_14
                          ? stock.rsi_14 < 40
                            ? "text-green"
                            : stock.rsi_14 > 70
                            ? "text-red"
                            : "text-text"
                          : "text-subtext0"
                      }`}
                    >
                      {stock.rsi_14 ?? "—"}
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
                  Stock Symbol
                </label>
                <input
                  type="text"
                  class="w-full px-3 py-2 bg-surface0 border border-surface1 rounded-lg text-text placeholder-subtext0"
                  placeholder="e.g., INFY, TCS, RELIANCE"
                  value={newSymbol()}
                  onInput={(e) =>
                    setNewSymbol(e.currentTarget.value.toUpperCase())
                  }
                  onKeyPress={(e) => e.key === "Enter" && addStock()}
                />
                <p class="text-xs text-subtext0 mt-1">
                  Enter the NSE/BSE symbol without exchange suffix
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
