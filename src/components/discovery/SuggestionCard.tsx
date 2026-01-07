import { Show, For } from "solid-js";
import ActionNotes from "../notes/ActionNotes";
import IntradayTransactionForm from "./IntradayTransactionForm";

interface Citation {
  type: string;
  id?: string;
  title?: string;
  source?: string;
}

interface Suggestion {
  id: string;
  symbol: string;
  stock_name?: string;
  action: "BUY" | "SELL" | "MOVE" | "RAISE_CASH" | "HOLD";
  rationale: string;
  confidence?: number;
  technical_score?: number;
  quantity?: number;
  allocation_amount?: number;
  sell_quantity?: number;
  sell_symbol?: string;
  cash_deployment_notes?: string;
  status: string;
  superseded_reason?: string;
  superseded_by?: string;
  citations?: Citation[];
  created_at?: string;
}

interface SuggestionCardProps {
  suggestion: Suggestion;
  showActions: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}

const citationIcons: Record<string, string> = {
  research: "📄",
  link: "🔗",
  note: "📝",
  table: "📊",
  valuepickr: "💬",
  news: "📰",
  reddit: "🗣️",
  technicals: "📈",
};

function getActionStyles(action: string) {
  switch (action) {
    case "BUY":
      return { color: "text-green", bg: "bg-green/20", icon: "BUY" };
    case "SELL":
      return { color: "text-red", bg: "bg-red/20", icon: "SELL" };
    case "MOVE":
      return { color: "text-mauve", bg: "bg-mauve/20", icon: "MOVE" };
    case "RAISE_CASH":
      return { color: "text-peach", bg: "bg-peach/20", icon: "💵 CASH" };
    default:
      return { color: "text-subtext0", bg: "bg-surface2", icon: "•" };
  }
}

function formatDate(dateString?: string): string {
  if (!dateString) return "";
  return new Date(dateString).toLocaleDateString();
}

export default function SuggestionCard(props: SuggestionCardProps) {
  const s = () => props.suggestion;
  const actionStyles = () => getActionStyles(s().action);

  const details = () => {
    const suggestion = s();
    switch (suggestion.action) {
      case "BUY":
        return suggestion.quantity
          ? `Qty: ${
              suggestion.quantity
            } (₹${suggestion.allocation_amount?.toLocaleString()})`
          : "";
      case "SELL":
        return suggestion.quantity ? `Qty: ${suggestion.quantity}` : "";
      case "MOVE":
        return `Sell ${suggestion.sell_quantity} ${suggestion.sell_symbol} → Buy ${suggestion.quantity} ${suggestion.symbol}`;
      case "RAISE_CASH":
        let text = suggestion.quantity
          ? `Sell ${suggestion.quantity} shares to cash`
          : "Raise cash from position";
        if (suggestion.cash_deployment_notes) {
          text += ` 📝 ${suggestion.cash_deployment_notes}`;
        }
        return text;
      default:
        return "";
    }
  };

  const confidenceBadge = () => {
    const suggestion = s();
    if (suggestion.confidence) {
      const color =
        suggestion.confidence >= 7
          ? "bg-green/20 text-green"
          : suggestion.confidence >= 4
          ? "bg-yellow/20 text-yellow"
          : "bg-red/20 text-red";
      return { show: true, color, text: `${suggestion.confidence}/10` };
    }
    if (suggestion.technical_score) {
      return {
        show: true,
        color: "text-subtext0",
        text: `Score: ${suggestion.technical_score}`,
        isText: true,
      };
    }
    return { show: false };
  };

  return (
    <div
      class={`bg-surface0 border border-surface1 rounded-lg overflow-hidden mb-2 hover:bg-surface1/50 transition-colors ${
        s().status === "superseded" ? "opacity-70" : ""
      }`}
      data-id={s().id}
      data-suggestion-id={s().id}
    >
      <div class="p-4 flex items-center justify-between">
        <div class="flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-medium text-text">
              {s().stock_name || s().symbol}
            </span>
            <span
              class={`px-2 py-0.5 text-xs font-bold rounded ${
                actionStyles().bg
              } ${actionStyles().color}`}
            >
              {actionStyles().icon}
            </span>
            <Show when={confidenceBadge().show}>
              <Show
                when={!confidenceBadge().isText}
                fallback={
                  <span class="text-xs text-subtext0">
                    {confidenceBadge().text}
                  </span>
                }
              >
                <span
                  class={`px-1.5 py-0.5 text-xs rounded ${
                    confidenceBadge().color
                  }`}
                >
                  {confidenceBadge().text}
                </span>
              </Show>
            </Show>
            <Show when={details()}>
              <span class="text-xs text-subtext1 ml-2">{details()}</span>
            </Show>
          </div>
          <p class="text-sm text-subtext0 mt-1">{s().rationale}</p>

          {/* Citations */}
          <Show when={s().citations && s().citations!.length > 0}>
            <div class="mt-2 pt-2 border-t border-surface2/50">
              <div class="flex items-center gap-1 text-xs text-subtext0 flex-wrap">
                <span class="font-medium text-subtext1">📚 Sources:</span>
                <For each={s().citations}>
                  {(citation, index) => (
                    <>
                      <Show when={index() > 0}>
                        <span class="text-surface2 mx-1">•</span>
                      </Show>
                      <Show
                        when={
                          citation.id &&
                          ["research", "link", "note", "table"].includes(
                            citation.type
                          )
                        }
                        fallback={
                          <span>
                            {citationIcons[citation.type] || "📌"}{" "}
                            {citation.title || citation.source || citation.type}
                          </span>
                        }
                      >
                        <a
                          href={`/company/${encodeURIComponent(
                            s().symbol
                          )}?tab=${citation.type}`}
                          class="hover:text-mauve transition-colors"
                        >
                          {citationIcons[citation.type] || "📌"}{" "}
                          {citation.title || citation.source || citation.type}
                        </a>
                      </Show>
                    </>
                  )}
                </For>
              </div>
            </div>
          </Show>

          {/* Superseded info */}
          <Show when={s().status === "superseded" && s().superseded_reason}>
            <div class="text-xs text-yellow mt-1">
              ⚠️ {s().superseded_reason}
              <Show when={s().superseded_by}>
                {" "}
                → Suggestion #{s().superseded_by}
              </Show>
            </div>
          </Show>
        </div>

        {/* Action buttons or date */}
        <Show
          when={props.showActions}
          fallback={
            <span class="text-xs text-subtext0 ml-4">
              {formatDate(s().created_at)}
            </span>
          }
        >
          <div class="flex gap-2 ml-4">
            <button
              onClick={() => props.onApprove(s().id)}
              class="px-3 py-1 text-sm bg-green/20 hover:bg-green/30 text-green rounded transition-colors"
            >
              ✓
            </button>
            <button
              onClick={() => props.onReject(s().id)}
              class="px-3 py-1 text-sm bg-red/20 hover:bg-red/30 text-red rounded transition-colors"
            >
              ✗
            </button>
          </div>
        </Show>
      </div>

      {/* Action Notes */}
      <ActionNotes suggestionId={s().id} />

      {/* Intraday Transaction Form - for active suggestions with BUY/SELL action */}
      <Show
        when={
          (s().status === "pending" || s().status === "approved") &&
          (s().action === "BUY" || s().action === "SELL")
        }
      >
        <IntradayTransactionForm
          suggestionId={s().id}
          symbol={s().symbol}
          stockName={s().stock_name}
          suggestedAction={s().action as "BUY" | "SELL"}
        />
      </Show>
    </div>
  );
}
