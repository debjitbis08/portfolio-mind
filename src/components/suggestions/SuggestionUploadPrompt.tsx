/**
 * Suggestion Upload Prompt
 *
 * Displays a friendly reminder to upload transactions when the user
 * has approved suggestions that aren't linked to any transactions.
 *
 * Uses sessionStorage to avoid nagging within the same session.
 */

import { createSignal, createEffect, Show, For } from "solid-js";

interface UnlinkedSuggestion {
  id: string;
  symbol: string;
  stock_name: string | null;
  action: string;
  reviewed_at: string | null;
  allocation_amount: number | null;
  quantity: number | null;
  current_price: number | null;
  days_since_approval: number;
}

interface UploadPromptData {
  shouldPrompt: boolean;
  unlinkedSuggestions: UnlinkedSuggestion[];
  count: number;
  urgency: "low" | "medium" | "high";
  message: string;
}

const URGENCY_CONFIG = {
  high: {
    icon: "🔴",
    bg: "bg-red/10",
    text: "text-red",
    border: "border-red/30",
    title: "Action Required",
  },
  medium: {
    icon: "🟡",
    bg: "bg-yellow/10",
    text: "text-yellow",
    border: "border-yellow/30",
    title: "Reminder",
  },
  low: {
    icon: "🟢",
    bg: "bg-blue/10",
    text: "text-blue",
    border: "border-blue/30",
    title: "Gentle Reminder",
  },
};

export default function SuggestionUploadPrompt() {
  const [data, setData] = createSignal<UploadPromptData | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [dismissed, setDismissed] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);

  // Check sessionStorage for dismissal
  const isDismissedInSession = () => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem("suggestion_upload_prompt_dismissed") === "true";
  };

  // Fetch upload prompt data
  const fetchPromptData = async () => {
    setLoading(true);

    try {
      const response = await fetch("/api/suggestions/upload-prompt");

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.statusText}`);
      }

      const promptData = await response.json();
      setData(promptData);

      // Auto-dismiss if no prompt needed
      if (!promptData.shouldPrompt) {
        setDismissed(true);
      }

      // Check session storage
      if (isDismissedInSession()) {
        setDismissed(true);
      }
    } catch (err) {
      console.error("[SuggestionUploadPrompt] Error:", err);
      // Fail silently - this is a nice-to-have feature
      setDismissed(true);
    } finally {
      setLoading(false);
    }
  };

  // Fetch on mount
  createEffect(() => {
    fetchPromptData();
  });

  // Handle dismiss
  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem("suggestion_upload_prompt_dismissed", "true");
  };

  // Scroll to import section
  const scrollToImport = () => {
    // Find the import section by searching for the summary text
    const allDetails = document.querySelectorAll('details');
    let importSection: HTMLDetailsElement | null = null;

    allDetails.forEach((details) => {
      const summary = details.querySelector('summary');
      if (summary && summary.textContent?.includes('Import Transactions')) {
        importSection = details;
      }
    });

    if (importSection) {
      importSection.scrollIntoView({ behavior: "smooth", block: "start" });
      // Open the details element
      importSection.open = true;
    }
  };

  const currentData = () => data();
  const urgencyConfig = () =>
    currentData()
      ? URGENCY_CONFIG[currentData()!.urgency]
      : URGENCY_CONFIG.low;

  // Don't render if dismissed or no data
  if (loading() || dismissed() || !currentData() || !currentData()!.shouldPrompt) {
    return null;
  }

  return (
    <section
      class={`border rounded-2xl p-4 mb-6 transition-all ${
        urgencyConfig().border
      } ${urgencyConfig().bg}`}
    >
      {/* Header */}
      <div class="flex items-start justify-between gap-4">
        <div class="flex items-start gap-3 flex-1">
          <span class="text-2xl">{urgencyConfig().icon}</span>
          <div class="flex-1">
            <h3 class={`font-semibold text-base mb-1 ${urgencyConfig().text}`}>
              {urgencyConfig().title}: Upload Latest Transactions
            </h3>
            <p class="text-sm text-subtext1 mb-3">
              {currentData()!.message}. Have you uploaded your latest transactions?
            </p>

            {/* Quick Stats */}
            <div class="flex items-center gap-4 text-xs text-subtext0 mb-3">
              <span>
                📝 {currentData()!.count} approved{" "}
                {currentData()!.count === 1 ? "suggestion" : "suggestions"} yesterday
              </span>
            </div>

            {/* Actions */}
            <div class="flex items-center gap-2 flex-wrap">
              <button
                onClick={scrollToImport}
                class="px-4 py-2 bg-mauve hover:bg-mauve/80 text-base rounded-lg transition-colors font-medium text-sm"
              >
                📤 Upload Transactions
              </button>
              <button
                onClick={() => setExpanded(!expanded())}
                class="px-3 py-2 bg-surface1 hover:bg-surface2 text-subtext1 rounded-lg transition-colors text-sm"
              >
                {expanded() ? "▲ Hide" : "▼ View"} Details
              </button>
              <button
                onClick={handleDismiss}
                class="px-3 py-2 bg-surface1 hover:bg-surface2 text-subtext1 rounded-lg transition-colors text-sm"
              >
                Dismiss for Now
              </button>
            </div>
          </div>
        </div>

        {/* Close button */}
        <button
          onClick={handleDismiss}
          class="text-subtext0 hover:text-text transition-colors p-1"
          title="Dismiss"
        >
          ✕
        </button>
      </div>

      {/* Expanded Details */}
      <Show when={expanded()}>
        <div class="mt-4 pt-4 border-t border-surface1 space-y-2">
          <p class="text-sm font-medium text-subtext0 mb-2">
            Yesterday's approved suggestions waiting for transactions:
          </p>
          <For each={currentData()!.unlinkedSuggestions}>
            {(suggestion) => (
              <div class="flex items-center justify-between p-3 bg-surface0 rounded-lg">
                <div class="flex-1">
                  <div class="flex items-center gap-2">
                    <span
                      class={`font-medium ${
                        suggestion.action === "BUY"
                          ? "text-green"
                          : "text-red"
                      }`}
                    >
                      {suggestion.action}
                    </span>
                    <span class="font-medium text-text">
                      {suggestion.symbol}
                    </span>
                    {suggestion.stock_name && (
                      <span class="text-xs text-subtext0">
                        ({suggestion.stock_name})
                      </span>
                    )}
                  </div>
                  <div class="text-xs text-subtext1 mt-1">
                    {suggestion.quantity && (
                      <span class="mr-3">Qty: {suggestion.quantity}</span>
                    )}
                    {suggestion.allocation_amount && (
                      <span class="mr-3">
                        Amount: ₹{suggestion.allocation_amount.toLocaleString()}
                      </span>
                    )}
                    <span>Approved yesterday</span>
                  </div>
                </div>
              </div>
            )}
          </For>

          <div class="mt-3 p-3 bg-surface1 rounded-lg text-xs text-subtext1">
            <p class="font-medium mb-1">💡 Why this matters:</p>
            <p>
              Linking transactions to suggestions helps track your investment
              decisions and provides better portfolio insights. Upload your
              broker's order history to automatically match these approved
              suggestions.
            </p>
          </div>
        </div>
      </Show>
    </section>
  );
}
