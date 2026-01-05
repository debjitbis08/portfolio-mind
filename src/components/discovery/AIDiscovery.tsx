import { createSignal, For, Show, onMount, onCleanup } from "solid-js";
import SuggestionCard from "./SuggestionCard";

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
  citations?: any[];
  created_at?: string;
}

interface AIDiscoveryProps {
  embedded?: boolean;
}

type FilterStatus = "pending" | "history";

async function fetchSuggestions(status: FilterStatus): Promise<Suggestion[]> {
  const response = await fetch(`/api/suggestions?status=${status}`);
  if (!response.ok) throw new Error("Failed to fetch suggestions");
  const data = await response.json();
  return data.suggestions || [];
}

async function updateSuggestionStatus(
  id: string,
  status: string
): Promise<void> {
  await fetch("/api/suggestions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, status }),
  });
}

async function checkAIEnabled(): Promise<boolean> {
  try {
    const res = await fetch("/api/settings");
    const { settings } = await res.json();
    return settings?.ai_enabled !== false;
  } catch {
    return true; // Default to enabled on error
  }
}

export default function AIDiscovery(props: AIDiscoveryProps) {
  const [filterStatus, setFilterStatus] = createSignal<FilterStatus>("pending");
  const [aiEnabled, setAiEnabled] = createSignal(true);
  const [isRunning, setIsRunning] = createSignal(false);
  const [progress, setProgress] = createSignal(0);
  const [progressMessage, setProgressMessage] = createSignal("Starting...");
  const [statusMessage, setStatusMessage] = createSignal("");
  const [suggestions, setSuggestions] = createSignal<Suggestion[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);

  let eventSourceRef: EventSource | null = null;

  // Fetch suggestions - client-side only
  const loadSuggestions = async (status: FilterStatus) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/suggestions?status=${status}`);
      if (!response.ok) throw new Error("Failed to fetch suggestions");
      const data = await response.json();
      setSuggestions(data.suggestions || []);
    } catch (err) {
      console.error("Failed to load suggestions:", err);
      setSuggestions([]);
    } finally {
      setIsLoading(false);
    }
  };

  const refetch = () => loadSuggestions(filterStatus());

  // Check AI availability and load suggestions on mount (client-side only)
  onMount(async () => {
    const enabled = await checkAIEnabled();
    setAiEnabled(enabled);
    if (enabled) {
      loadSuggestions(filterStatus());
    } else {
      setIsLoading(false);
    }
  });

  // Cleanup event source on unmount
  onCleanup(() => {
    if (eventSourceRef) {
      eventSourceRef.close();
    }
  });

  const handleApprove = async (id: string) => {
    await updateSuggestionStatus(id, "approved");
    refetch();
  };

  const handleReject = async (id: string) => {
    await updateSuggestionStatus(id, "rejected");
    refetch();
  };

  const handleFilterChange = (status: FilterStatus) => {
    setFilterStatus(status);
    loadSuggestions(status);
  };

  const runDiscoveryCycle = async () => {
    setIsRunning(true);
    setProgress(0);
    setProgressMessage("Starting...");
    setStatusMessage("");

    try {
      // Step 1: Create the job
      const createRes = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "discovery_cycle" }),
      });
      const { job } = await createRes.json();

      if (!job?.id) {
        throw new Error("Failed to create job");
      }

      // Step 2: Connect to SSE for progress updates
      eventSourceRef = new EventSource(`/api/jobs/${job.id}/status`);

      eventSourceRef.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.progress !== undefined) {
          setProgress(data.progress);
        }
        if (data.message) {
          setProgressMessage(data.message);
        }

        if (data.status === "completed") {
          eventSourceRef?.close();
          eventSourceRef = null;
          setIsRunning(false);
          setStatusMessage(
            `✓ ${data.result?.actionable || 0} actionable suggestions`
          );
          setTimeout(() => setStatusMessage(""), 5000);
          // Switch to pending filter and refetch
          setFilterStatus("pending");
          refetch();
        } else if (data.status === "failed") {
          eventSourceRef?.close();
          eventSourceRef = null;
          setIsRunning(false);
          setStatusMessage(`Error: ${data.error}`);
        }
      };

      eventSourceRef.onerror = () => {
        eventSourceRef?.close();
        eventSourceRef = null;
        setIsRunning(false);
        setStatusMessage("Connection lost");
      };
    } catch (err) {
      setIsRunning(false);
      setStatusMessage("Discovery failed");
    }
  };

  const filterButtonClass = (status: FilterStatus) => {
    if (filterStatus() === status) {
      return "px-2 py-1 text-xs bg-mauve/20 text-mauve rounded transition-colors";
    }
    return "px-2 py-1 text-xs bg-surface2 text-subtext0 hover:bg-surface1 rounded transition-colors";
  };

  return (
    <section class="bg-surface0 border border-surface1 rounded-2xl overflow-hidden">
      {/* Header */}
      <div class="p-4 border-b border-surface1 flex items-center justify-between flex-wrap gap-2">
        <div class="flex items-center gap-3">
          <h2 class="text-lg text-subtext0">🤖 AI Discovery</h2>
          <Show when={aiEnabled()}>
            <button
              onClick={runDiscoveryCycle}
              disabled={isRunning()}
              class="px-4 py-1.5 bg-mauve hover:bg-mauve/90 text-crust font-medium text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRunning() ? "Running..." : "Run Discovery Cycle"}
            </button>
          </Show>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-xs text-subtext0">Show:</span>
          <button
            onClick={() => handleFilterChange("pending")}
            class={filterButtonClass("pending")}
          >
            Pending
          </button>
          <button
            onClick={() => handleFilterChange("history")}
            class={filterButtonClass("history")}
          >
            History
          </button>
          <Show when={statusMessage()}>
            <span class="text-sm text-subtext0 ml-2">{statusMessage()}</span>
          </Show>
        </div>
      </div>

      {/* Progress bar */}
      <Show when={isRunning()}>
        <div class="px-4 py-3 border-b border-surface1">
          <div class="flex justify-between text-xs text-subtext0 mb-1">
            <span>{progressMessage()}</span>
            <span>{progress()}%</span>
          </div>
          <div class="h-2 bg-surface2 rounded-full overflow-hidden">
            <div
              class="h-full bg-mauve transition-all duration-300"
              style={{ width: `${progress()}%` }}
            />
          </div>
        </div>
      </Show>

      {/* Content */}
      <div class="divide-y divide-surface1 p-6">
        {/* AI Disabled Message */}
        <Show when={!aiEnabled()}>
          <div class="p-8 text-center">
            <div class="text-4xl mb-3">🤖💤</div>
            <h3 class="text-lg font-medium text-text mb-1">
              AI Assistant is Disabled
            </h3>
            <p class="text-subtext0 text-sm max-w-sm mx-auto">
              You've disabled AI features in settings. Enable the AI Assistant
              to get automated investment suggestions and portfolio analysis.
            </p>
            <a
              href="/settings"
              class="inline-block mt-4 text-mauve hover:underline text-sm font-medium"
            >
              Go to Settings →
            </a>
          </div>
        </Show>

        {/* Loading State */}
        <Show when={aiEnabled() && isLoading() && !isRunning()}>
          <div class="p-6 text-center text-subtext0">
            Loading suggestions...
          </div>
        </Show>

        {/* Empty State */}
        <Show
          when={
            aiEnabled() &&
            !isLoading() &&
            !isRunning() &&
            suggestions() &&
            suggestions()!.length === 0
          }
        >
          <div class="p-6 text-center text-subtext0">
            {filterStatus() === "pending"
              ? "No pending suggestions. Run a discovery cycle!"
              : "No suggestion history yet."}
          </div>
        </Show>

        {/* Suggestions List */}
        <Show
          when={
            aiEnabled() &&
            !isLoading() &&
            !isRunning() &&
            suggestions() &&
            suggestions()!.length > 0
          }
        >
          <div class="space-y-2">
            <For each={suggestions()}>
              {(suggestion) => (
                <SuggestionCard
                  suggestion={suggestion}
                  showActions={filterStatus() === "pending"}
                  onApprove={handleApprove}
                  onReject={handleReject}
                />
              )}
            </For>
          </div>
        </Show>
      </div>
    </section>
  );
}
