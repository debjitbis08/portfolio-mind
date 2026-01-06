import { createSignal, Show, For, onMount } from "solid-js";

interface Transaction {
  id: string;
  symbol: string;
  stock_name: string;
  type: "BUY" | "SELL" | "OPENING_BALANCE";
  quantity: number;
  value: number;
  price_per_share: number;
  executed_at: string;
}

interface MatchProposal {
  suggestion_id: string;
  transaction_id: string;
  match_type: string;
  confidence: number;
  reason: string;
  suggestion: {
    symbol: string;
    action: string;
    target_price: number | null;
    approved_at: string | null;
  };
}

interface Suggestion {
  id: string;
  symbol: string;
  stock_name: string | null;
  action: string;
  rationale: string;
  quantity: number | null;
  allocation_amount: number | null;
  status: string;
  superseded_by: string | null;
  superseded_reason: string | null;
  created_at: string | null;
  reviewed_at: string | null;
}

interface UnlinkedData {
  transactions: Transaction[];
  proposals: MatchProposal[];
  summary: {
    total_unlinked: number;
    total_proposals: number;
    lookback_days: number;
  };
}

export default function TransactionLinker() {
  const [data, setData] = createSignal<UnlinkedData | null>(null);
  const [suggestions, setSuggestions] = createSignal<Suggestion[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [linking, setLinking] = createSignal<string | null>(null);
  const [manualLink, setManualLink] = createSignal<string | null>(null);
  const [selectedSuggestion, setSelectedSuggestion] = createSignal<string>("");
  const [notes, setNotes] = createSignal("");

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [txRes, sugRes] = await Promise.all([
        fetch("/api/unlinked-transactions?days=7"),
        fetch("/api/suggestions?status=history"),
      ]);
      if (!txRes.ok) throw new Error("Failed to fetch transactions");
      if (!sugRes.ok) throw new Error("Failed to fetch suggestions");

      const txData = await txRes.json();
      const sugData = await sugRes.json();

      setData(txData);
      setSuggestions(sugData.suggestions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    fetchData();
  });

  const getProposalsForTx = (txId: string) => {
    return data()?.proposals.filter((p) => p.transaction_id === txId) || [];
  };

  const handleAcceptProposal = async (proposal: MatchProposal) => {
    setLinking(proposal.transaction_id);
    setError(null);
    try {
      const res = await fetch("/api/suggestion-transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suggestionId: proposal.suggestion_id,
          transactionId: proposal.transaction_id,
          matchType: proposal.match_type,
          confidence: proposal.confidence,
          notes: `Auto-matched: ${proposal.reason}`,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create link");
      }
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLinking(null);
    }
  };

  const handleManualLink = async (txId: string) => {
    if (!selectedSuggestion()) return;
    setLinking(txId);
    setError(null);
    try {
      const res = await fetch("/api/suggestion-transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suggestionId: selectedSuggestion(),
          transactionId: txId,
          matchType: "manual",
          confidence: 100,
          notes: notes() || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create link");
      }
      setManualLink(null);
      setSelectedSuggestion("");
      setNotes("");
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLinking(null);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
    });
  };

  const formatDateTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatSuggestionOption = (s: Suggestion) => {
    const parts: string[] = [];
    // Prefix with status indicator
    if (s.status === "approved") parts.push("✓");
    else if (s.status === "rejected") parts.push("✗");
    else if (s.status === "superseded") parts.push("⚠️");
    else if (s.status === "expired") parts.push("⏱️");

    parts.push(`${s.action} ${s.symbol}`);
    if (s.quantity) parts.push(`Qty: ${s.quantity}`);
    if (s.allocation_amount) parts.push(formatCurrency(s.allocation_amount));
    if (s.reviewed_at) parts.push(formatDateTime(s.reviewed_at));
    return parts.join(" ");
  };

  // Sort suggestions with approved first
  const sortedSuggestions = (list: Suggestion[]) => {
    return [...list].sort((a, b) => {
      if (a.status === "approved" && b.status !== "approved") return -1;
      if (a.status !== "approved" && b.status === "approved") return 1;
      // Then by date, newest first
      const dateA = a.reviewed_at || a.created_at || "";
      const dateB = b.reviewed_at || b.created_at || "";
      return dateB.localeCompare(dateA);
    });
  };

  return (
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-text">
          Transaction-Suggestion Links
        </h2>
        <button
          onClick={() => fetchData()}
          class="px-3 py-1 text-sm bg-surface1 hover:bg-surface2 text-subtext0 rounded transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      <Show when={error()}>
        <div class="p-3 bg-red/20 border border-red/30 rounded text-red text-sm">
          {error()}
        </div>
      </Show>

      <Show when={loading()}>
        <div class="text-center py-8 text-subtext0">
          <div class="animate-spin inline-block w-6 h-6 border-2 border-mauve border-t-transparent rounded-full" />
          <p class="mt-2">Loading transactions...</p>
        </div>
      </Show>

      <Show when={!loading() && data() && data()!.transactions.length === 0}>
        <div class="p-6 bg-surface0 border border-surface1 rounded-lg text-center">
          <p class="text-green">
            ✓ All transactions from last 7 days are linked!
          </p>
        </div>
      </Show>

      <Show when={!loading() && data() && data()!.transactions.length > 0}>
        <div class="text-sm text-subtext0 mb-2">
          {data()!.summary.total_unlinked} unlinked transaction
          {data()!.summary.total_unlinked !== 1 ? "s" : ""} from last{" "}
          {data()!.summary.lookback_days} days
          {data()!.summary.total_proposals > 0 &&
            ` • ${data()!.summary.total_proposals} auto-match proposal${
              data()!.summary.total_proposals !== 1 ? "s" : ""
            }`}
        </div>

        <div class="space-y-3">
          <For each={data()!.transactions}>
            {(tx) => {
              const proposals = getProposalsForTx(tx.id);
              const isLinking = () => linking() === tx.id;
              const isManualLinking = () => manualLink() === tx.id;

              return (
                <div class="bg-surface0 border border-surface1 rounded-lg p-4">
                  {/* Transaction info */}
                  <div class="flex items-center justify-between mb-2">
                    <div class="flex items-center gap-2">
                      <span
                        class={`px-2 py-0.5 text-xs font-bold rounded ${
                          tx.type === "BUY"
                            ? "bg-green/20 text-green"
                            : tx.type === "SELL"
                            ? "bg-red/20 text-red"
                            : "bg-surface2 text-subtext0"
                        }`}
                      >
                        {tx.type}
                      </span>
                      <span class="font-medium text-text">
                        {tx.quantity} {tx.stock_name || tx.symbol}
                      </span>
                      <span class="text-subtext0">
                        @ {formatCurrency(tx.price_per_share)}
                      </span>
                    </div>
                    <span class="text-xs text-subtext0">
                      {formatDate(tx.executed_at)}
                    </span>
                  </div>

                  {/* Auto-match proposals */}
                  <Show when={proposals.length > 0}>
                    <div class="mt-3 space-y-2">
                      <For each={proposals}>
                        {(proposal) => (
                          <div class="flex items-center justify-between bg-mauve/10 border border-mauve/20 rounded p-2">
                            <div class="flex-1">
                              <div class="flex items-center gap-2">
                                <span class="text-sm text-mauve font-medium">
                                  🔗 Suggested Match ({proposal.confidence}%)
                                </span>
                              </div>
                              <p class="text-xs text-subtext0 mt-1">
                                {proposal.reason}
                              </p>
                            </div>
                            <div class="flex gap-2 ml-4">
                              <button
                                onClick={() => handleAcceptProposal(proposal)}
                                disabled={isLinking()}
                                class="px-3 py-1 text-sm bg-green/20 hover:bg-green/30 text-green rounded transition-colors disabled:opacity-50"
                              >
                                {isLinking() ? "..." : "✓ Accept"}
                              </button>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>

                  {/* Manual link section */}
                  <Show when={!isManualLinking() && proposals.length === 0}>
                    <button
                      onClick={() => setManualLink(tx.id)}
                      class="mt-2 text-sm text-mauve hover:text-lavender transition-colors"
                    >
                      🔍 Link to Suggestion...
                    </button>
                  </Show>

                  <Show when={proposals.length > 0 && !isManualLinking()}>
                    <button
                      onClick={() => setManualLink(tx.id)}
                      class="mt-2 text-xs text-subtext0 hover:text-subtext1 transition-colors"
                    >
                      or link to different suggestion...
                    </button>
                  </Show>

                  {/* Manual linking form */}
                  <Show when={isManualLinking()}>
                    <div class="mt-3 p-3 bg-surface1 rounded space-y-3">
                      <div>
                        <label class="block text-xs text-subtext0 mb-1">
                          Select Suggestion
                        </label>
                        <select
                          value={selectedSuggestion()}
                          onChange={(e) =>
                            setSelectedSuggestion(e.currentTarget.value)
                          }
                          class="w-full px-3 py-2 bg-crust border border-surface2 rounded text-text text-sm"
                        >
                          <option value="">Choose a suggestion...</option>
                          <For
                            each={sortedSuggestions(
                              suggestions().filter(
                                (s) =>
                                  s.symbol === tx.symbol && s.action === tx.type
                              )
                            )}
                          >
                            {(s) => (
                              <option value={s.id}>
                                {formatSuggestionOption(s)}
                              </option>
                            )}
                          </For>
                          <optgroup label="Other suggestions">
                            <For
                              each={sortedSuggestions(
                                suggestions().filter(
                                  (s) =>
                                    s.symbol !== tx.symbol ||
                                    s.action !== tx.type
                                )
                              )}
                            >
                              {(s) => (
                                <option value={s.id}>
                                  {formatSuggestionOption(s)}
                                </option>
                              )}
                            </For>
                          </optgroup>
                        </select>
                      </div>
                      <div>
                        <label class="block text-xs text-subtext0 mb-1">
                          Notes (optional)
                        </label>
                        <input
                          type="text"
                          value={notes()}
                          onInput={(e) => setNotes(e.currentTarget.value)}
                          placeholder="Why this link?"
                          class="w-full px-3 py-2 bg-crust border border-surface2 rounded text-text text-sm"
                        />
                      </div>
                      <div class="flex gap-2">
                        <button
                          onClick={() => handleManualLink(tx.id)}
                          disabled={!selectedSuggestion() || isLinking()}
                          class="px-3 py-1 text-sm bg-mauve/20 hover:bg-mauve/30 text-mauve rounded transition-colors disabled:opacity-50"
                        >
                          {isLinking() ? "Linking..." : "Link"}
                        </button>
                        <button
                          onClick={() => {
                            setManualLink(null);
                            setSelectedSuggestion("");
                            setNotes("");
                          }}
                          class="px-3 py-1 text-sm bg-surface2 hover:bg-surface1 text-subtext0 rounded transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}
