import { createSignal, Show } from "solid-js";

interface CompanyLink {
  id: string;
  symbol: string;
  url: string;
  title: string;
  description: string | null;
  fetchedContent: string | null;
  fetchedAt: string | null;
  createdAt: string;
}

interface LinkViewerProps {
  link: CompanyLink;
  onRefetch: () => void;
  onClose: () => void;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function LinkViewer(props: LinkViewerProps) {
  const [refetching, setRefetching] = createSignal(false);
  const [error, setError] = createSignal("");
  const [fetchStatus, setFetchStatus] = createSignal<{
    success: boolean;
    error?: string;
  } | null>(null);

  const handleRefetch = async () => {
    setRefetching(true);
    setError("");
    setFetchStatus(null);

    try {
      const response = await fetch(`/api/links/${props.link.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refetch: true }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to re-fetch content");
      }

      const data = await response.json();
      if (data.fetchStatus) {
        setFetchStatus(data.fetchStatus);
      }

      props.onRefetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to re-fetch");
    } finally {
      setRefetching(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      props.onClose();
    }
  };

  return (
    <div
      class="fixed inset-0 z-[60] flex items-center justify-center bg-crust/80 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <div class="bg-base border border-surface1 rounded-2xl max-w-4xl w-full max-h-[85vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div class="flex items-center justify-between p-4 border-b border-surface1">
          <div class="flex-1 min-w-0 mr-4">
            <h3 class="text-lg font-medium text-text truncate">
              {props.link.title}
            </h3>
            <a
              href={props.link.url}
              target="_blank"
              rel="noopener noreferrer"
              class="text-sm text-blue hover:underline truncate block"
            >
              {props.link.url}
            </a>
          </div>
          <div class="flex items-center gap-2">
            <button
              onClick={handleRefetch}
              class="px-3 py-1.5 text-sm bg-surface1 hover:bg-surface2 text-text rounded-lg transition-colors disabled:opacity-50"
              disabled={refetching()}
              title="Re-fetch content from URL"
            >
              {refetching() ? "Fetching..." : "↻ Re-fetch"}
            </button>
            <a
              href={props.link.url}
              target="_blank"
              rel="noopener noreferrer"
              class="px-3 py-1.5 text-sm bg-blue hover:bg-blue/80 text-base rounded-lg transition-colors"
            >
              Open URL
            </a>
            <button
              onClick={props.onClose}
              class="text-subtext0 hover:text-text transition-colors p-1"
              title="Close"
            >
              <svg
                class="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Metadata */}
        <div class="px-4 py-2 bg-surface0 border-b border-surface1 flex items-center gap-4 text-xs text-subtext1">
          <span>Added {formatDate(props.link.createdAt)}</span>
          <Show when={props.link.fetchedAt}>
            <span>•</span>
            <span class="text-green">
              Content fetched {formatDate(props.link.fetchedAt!)}
            </span>
          </Show>
          <Show when={!props.link.fetchedAt}>
            <span>•</span>
            <span class="text-yellow">No content fetched yet</span>
          </Show>
        </div>

        {/* Error/Status messages */}
        <Show when={error()}>
          <div class="mx-4 mt-4 p-3 bg-red/10 border border-red/30 rounded-lg text-sm text-red">
            {error()}
          </div>
        </Show>

        <Show when={fetchStatus()}>
          <div
            class={`mx-4 mt-4 p-3 rounded-lg text-sm ${
              fetchStatus()!.success
                ? "bg-green/10 border border-green/30 text-green"
                : "bg-yellow/10 border border-yellow/30 text-yellow"
            }`}
          >
            {fetchStatus()!.success
              ? "Content successfully re-fetched!"
              : `Fetch issue: ${fetchStatus()!.error}`}
          </div>
        </Show>

        {/* Content */}
        <div class="flex-1 overflow-y-auto p-4">
          <Show when={props.link.description}>
            <div class="mb-4 p-3 bg-surface0 border border-surface1 rounded-lg">
              <div class="text-xs text-subtext1 mb-1 font-medium">
                Your Notes
              </div>
              <p class="text-sm text-text">{props.link.description}</p>
            </div>
          </Show>

          <Show when={props.link.fetchedContent}>
            <div>
              <div class="text-xs text-subtext1 mb-2 font-medium">
                Fetched Content (
                {props.link.fetchedContent!.length.toLocaleString()} characters)
              </div>
              <div class="p-4 bg-surface0 border border-surface1 rounded-lg max-h-[50vh] overflow-y-auto">
                <pre class="text-sm text-text whitespace-pre-wrap font-sans leading-relaxed">
                  {props.link.fetchedContent}
                </pre>
              </div>
            </div>
          </Show>

          <Show when={!props.link.fetchedContent}>
            <div class="text-center py-12">
              <div class="text-4xl mb-3">📄</div>
              <p class="text-subtext0 mb-4">
                No content has been fetched for this link yet.
              </p>
              <button
                onClick={handleRefetch}
                class="px-4 py-2 text-sm bg-blue hover:bg-blue/80 text-base rounded-lg transition-colors disabled:opacity-50"
                disabled={refetching()}
              >
                {refetching() ? "Fetching..." : "Fetch Content Now"}
              </button>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
