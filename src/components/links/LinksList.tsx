import { createSignal, createResource, For, Show } from "solid-js";
import AddLinkModal from "./AddLinkModal";
import LinkViewer from "./LinkViewer";

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

interface LinksListProps {
  symbol: string;
  onClose: () => void;
  embedded?: boolean;
}

function formatTimeAgo(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  if (seconds < 2592000) return `${Math.floor(seconds / 604800)}w ago`;
  return `${Math.floor(seconds / 2592000)}mo ago`;
}

function truncateUrl(url: string, maxLength: number = 50): string {
  try {
    const parsed = new URL(url);
    const display = parsed.hostname + parsed.pathname;
    if (display.length <= maxLength) return display;
    return display.substring(0, maxLength) + "...";
  } catch {
    return url.length <= maxLength ? url : url.substring(0, maxLength) + "...";
  }
}

async function fetchLinks(symbol: string): Promise<CompanyLink[]> {
  const response = await fetch(
    `/api/links?symbol=${encodeURIComponent(symbol)}`
  );
  if (!response.ok) throw new Error("Failed to fetch links");
  const data = await response.json();
  return data.links || [];
}

async function deleteLink(id: string): Promise<void> {
  const response = await fetch(`/api/links/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) throw new Error("Failed to delete link");
}

export default function LinksList(props: LinksListProps) {
  const [links, { refetch }] = createResource(() => props.symbol, fetchLinks);
  const [showAddModal, setShowAddModal] = createSignal(false);
  const [showViewer, setShowViewer] = createSignal(false);
  const [selectedLink, setSelectedLink] = createSignal<CompanyLink | undefined>(
    undefined
  );
  const [displayInfo, setDisplayInfo] = createSignal<{
    name: string;
    isEtf: boolean;
  }>({ name: props.symbol, isEtf: false });
  const [error, setError] = createSignal("");

  // Fetch display name on mount
  createResource(async () => {
    try {
      const response = await fetch(
        `/api/commodity/resolve?symbol=${encodeURIComponent(props.symbol)}`
      );
      if (response.ok) {
        const data = await response.json();
        setDisplayInfo({
          name: data.displayName || props.symbol,
          isEtf: data.isEtf || false,
        });
      }
    } catch {
      setDisplayInfo({ name: props.symbol, isEtf: false });
    }
  });

  const handleAdd = () => {
    setShowAddModal(true);
  };

  const handleView = (link: CompanyLink) => {
    setSelectedLink(link);
    setShowViewer(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this link? This cannot be undone.")) return;

    try {
      await deleteLink(id);
      refetch();
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete link");
    }
  };

  const handleSave = () => {
    setShowAddModal(false);
    refetch();
  };

  const handleCloseAddModal = () => {
    setShowAddModal(false);
  };

  const handleCloseViewer = () => {
    setShowViewer(false);
    setSelectedLink(undefined);
  };

  const handleRefetch = () => {
    refetch();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !showAddModal() && !showViewer()) {
      props.onClose();
    }
  };

  // Content that is shared between modal and embedded modes
  const linksContent = () => (
    <>
      <Show when={links.loading}>
        <div class="text-center py-12 text-subtext0">
          Loading saved links...
        </div>
      </Show>

      <Show when={error()}>
        <div class="mb-4 p-3 bg-red/10 border border-red/30 rounded-lg text-sm text-red">
          {error()}
        </div>
      </Show>

      <Show when={links() && links()!.length === 0}>
        <div class="text-center py-12">
          <div class="text-4xl mb-3">🔗</div>
          <p class="text-subtext0 mb-4">
            No saved links yet for {displayInfo().name}
          </p>
          <button
            onClick={handleAdd}
            class="px-4 py-2 text-sm bg-blue hover:bg-blue/80 text-base rounded-lg transition-colors"
          >
            Add First Link
          </button>
        </div>
      </Show>

      <Show when={links() && links()!.length > 0}>
        <div class="space-y-3">
          <For each={links()}>
            {(link) => (
              <div class="p-4 bg-surface0 border border-surface1 rounded-lg hover:border-surface2 transition-colors group">
                <div class="flex items-start justify-between gap-3">
                  <div
                    class="flex-1 min-w-0 cursor-pointer"
                    onClick={() => handleView(link)}
                  >
                    <h4 class="text-base font-medium text-text mb-1 group-hover:text-blue transition-colors">
                      {link.title}
                    </h4>
                    <p class="text-sm text-subtext0 mb-2 truncate">
                      {truncateUrl(link.url)}
                    </p>
                    <Show when={link.description}>
                      <p class="text-sm text-subtext1 mb-2 line-clamp-1">
                        {link.description}
                      </p>
                    </Show>
                    <div class="flex items-center gap-3 text-xs text-subtext1">
                      <span>Added {formatTimeAgo(link.createdAt)}</span>
                      <Show when={link.fetchedAt}>
                        <span>•</span>
                        <span class="text-green">✓ Content fetched</span>
                      </Show>
                      <Show when={!link.fetchedAt && !link.fetchedContent}>
                        <span>•</span>
                        <span class="text-yellow">⚠ No content</span>
                      </Show>
                    </div>
                  </div>
                  <div class="flex items-center gap-1 flex-shrink-0">
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="p-2 text-subtext0 hover:text-blue hover:bg-surface1 rounded transition-all"
                      title="Open in new tab"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <svg
                        class="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width={2}
                          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                        />
                      </svg>
                    </a>
                    <button
                      onClick={() => handleDelete(link.id)}
                      class="p-2 text-subtext0 hover:text-red hover:bg-surface1 rounded transition-all"
                      title="Delete"
                    >
                      <svg
                        class="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </>
  );

  // Embedded mode: render inline without modal wrapper
  if (props.embedded) {
    return (
      <>
        {/* Header for embedded mode */}
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-medium text-text">🔗 Links</h3>
          <button
            onClick={handleAdd}
            class="px-3 py-1.5 text-sm bg-blue hover:bg-blue/80 text-base rounded-lg transition-colors"
          >
            + Add Link
          </button>
        </div>

        {/* Content */}
        <div class="flex-1">{linksContent()}</div>

        {/* Add Modal */}
        <Show when={showAddModal()}>
          <AddLinkModal
            symbol={props.symbol}
            onSave={handleSave}
            onClose={handleCloseAddModal}
          />
        </Show>

        {/* Viewer Modal */}
        <Show when={showViewer() && selectedLink()}>
          <LinkViewer
            link={selectedLink()!}
            onRefetch={handleRefetch}
            onClose={handleCloseViewer}
          />
        </Show>
      </>
    );
  }

  // Modal mode: render with fixed overlay
  return (
    <>
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-crust/80 backdrop-blur-sm p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose();
        }}
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        <div class="bg-base border border-surface1 rounded-2xl max-w-4xl w-full max-h-[80vh] overflow-hidden flex flex-col shadow-2xl">
          {/* Header */}
          <div class="flex items-center justify-between p-4 border-b border-surface1">
            <h3 class="text-lg font-medium text-text">
              🔗 Links: {displayInfo().name}
            </h3>
            <div class="flex items-center gap-2">
              <button
                onClick={handleAdd}
                class="px-3 py-1.5 text-sm bg-blue hover:bg-blue/80 text-base rounded-lg transition-colors"
              >
                + Add Link
              </button>
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

          {/* Content */}
          <div class="flex-1 overflow-y-auto p-4">{linksContent()}</div>
        </div>
      </div>

      {/* Add Modal */}
      <Show when={showAddModal()}>
        <AddLinkModal
          symbol={props.symbol}
          onSave={handleSave}
          onClose={handleCloseAddModal}
        />
      </Show>

      {/* Viewer Modal */}
      <Show when={showViewer() && selectedLink()}>
        <LinkViewer
          link={selectedLink()!}
          onRefetch={handleRefetch}
          onClose={handleCloseViewer}
        />
      </Show>
    </>
  );
}
