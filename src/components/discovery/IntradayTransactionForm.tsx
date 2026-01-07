/**
 * Intraday Transaction Form
 *
 * Inline form shown on active suggestions to record manual trades
 * before the next broker import. These are temporary and get cleared
 * when transactions are imported from CSV/XLSX.
 */

import { createSignal, createResource, Show, For } from "solid-js";

interface Props {
  suggestionId: string;
  symbol: string;
  stockName?: string;
  suggestedAction?: "BUY" | "SELL";
}

interface IntradayTransaction {
  id: string;
  symbol: string;
  stockName: string | null;
  type: "BUY" | "SELL";
  quantity: number;
  pricePerShare: number;
  executedAt: string | null;
  createdAt: string | null;
}

/**
 * Fetch intraday transactions for a specific suggestion
 */
async function fetchIntradayTxs(
  suggestionId: string
): Promise<IntradayTransaction[]> {
  const res = await fetch(
    `/api/intraday-transactions?suggestionId=${suggestionId}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.transactions || [];
}

export default function IntradayTransactionForm(props: Props) {
  const [type, setType] = createSignal<"BUY" | "SELL">(
    props.suggestedAction || "BUY"
  );
  const [quantity, setQuantity] = createSignal<string>("");
  const [price, setPrice] = createSignal<string>("");
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [expanded, setExpanded] = createSignal(false);

  // Fetch existing intraday transactions for this suggestion
  const [transactions, { refetch }] = createResource(
    () => props.suggestionId,
    fetchIntradayTxs
  );

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError(null);

    const qty = parseInt(quantity(), 10);
    const prc = parseFloat(price());

    if (!qty || qty <= 0) {
      setError("Quantity must be positive");
      return;
    }
    if (!prc || prc <= 0) {
      setError("Price must be positive");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/intraday-transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suggestionId: props.suggestionId,
          symbol: props.symbol,
          stockName: props.stockName,
          type: type(),
          quantity: qty,
          pricePerShare: prc,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }

      // Clear form and refresh list
      setQuantity("");
      setPrice("");
      setExpanded(false);
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/intraday-transactions?id=${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        refetch();
      }
    } catch (err) {
      console.error("Failed to delete:", err);
    }
  };

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    }).format(val);

  const existingTxs = () => transactions() || [];

  return (
    <div class="border-t border-surface2/30 bg-surface0/50">
      {/* Existing intraday transactions */}
      <Show when={existingTxs().length > 0}>
        <div class="px-4 py-2 space-y-1">
          <div class="text-xs text-subtext0 font-medium mb-1">
            📝 Intraday Trades (pending import):
          </div>
          <For each={existingTxs()}>
            {(tx) => (
              <div class="flex items-center justify-between text-xs bg-surface1/50 rounded px-2 py-1">
                <span>
                  <span
                    class={
                      tx.type === "BUY"
                        ? "text-green font-medium"
                        : "text-red font-medium"
                    }
                  >
                    {tx.type}
                  </span>{" "}
                  <span class="text-text">{tx.quantity}</span>
                  <span class="text-subtext0"> @ </span>
                  <span class="text-text">
                    {formatCurrency(tx.pricePerShare)}
                  </span>
                  <span class="text-subtext0 ml-2">
                    = {formatCurrency(tx.quantity * tx.pricePerShare)}
                  </span>
                </span>
                <button
                  onClick={() => handleDelete(tx.id)}
                  class="text-red/70 hover:text-red px-1"
                  title="Delete"
                >
                  ×
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* Add transaction toggle/form */}
      <div class="px-4 py-2">
        <Show
          when={expanded()}
          fallback={
            <button
              onClick={() => setExpanded(true)}
              class="text-xs text-mauve hover:text-mauve/80 flex items-center gap-1"
            >
              <span>+</span> Record Intraday Trade
            </button>
          }
        >
          <form onSubmit={handleSubmit} class="space-y-2">
            <div class="flex items-center gap-2 text-xs">
              <span class="text-subtext0">Record:</span>
              <select
                value={type()}
                onChange={(e) =>
                  setType(e.currentTarget.value as "BUY" | "SELL")
                }
                class="bg-surface1 border border-surface2 rounded px-2 py-1 text-xs text-text"
              >
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
              </select>
              <input
                type="number"
                placeholder="Qty"
                value={quantity()}
                onInput={(e) => setQuantity(e.currentTarget.value)}
                class="bg-surface1 border border-surface2 rounded px-2 py-1 text-xs w-16 text-text"
                min="1"
                required
              />
              <span class="text-subtext0">{props.symbol} @</span>
              <input
                type="number"
                placeholder="Price"
                value={price()}
                onInput={(e) => setPrice(e.currentTarget.value)}
                class="bg-surface1 border border-surface2 rounded px-2 py-1 text-xs w-20 text-text"
                step="0.01"
                min="0.01"
                required
              />
            </div>

            <Show when={error()}>
              <div class="text-xs text-red">{error()}</div>
            </Show>

            <div class="flex gap-2">
              <button
                type="submit"
                disabled={saving()}
                class="text-xs px-3 py-1 bg-mauve/20 hover:bg-mauve/30 text-mauve rounded transition-colors disabled:opacity-50"
              >
                {saving() ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setExpanded(false);
                  setError(null);
                }}
                class="text-xs px-2 py-1 text-subtext0 hover:text-text"
              >
                Cancel
              </button>
            </div>
          </form>
        </Show>
      </div>
    </div>
  );
}
