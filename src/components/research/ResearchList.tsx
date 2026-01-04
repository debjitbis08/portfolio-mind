import { createSignal, createResource, For, Show } from "solid-js";
import ResearchEditor from "./ResearchEditor";
import ResearchViewer from "./ResearchViewer.tsx";

interface ResearchDocument {
  id: string;
  symbol: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface ResearchListProps {
  symbol: string;
  onClose: () => void;
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

async function fetchResearch(symbol: string): Promise<ResearchDocument[]> {
  const response = await fetch(
    `/api/research?symbol=${encodeURIComponent(symbol)}`
  );
  if (!response.ok) throw new Error("Failed to fetch research");
  const data = await response.json();
  return data.documents || [];
}

async function deleteResearch(id: string): Promise<void> {
  const response = await fetch(`/api/research/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) throw new Error("Failed to delete research");
}

export default function ResearchList(props: ResearchListProps) {
  const [documents, { refetch }] = createResource(
    () => props.symbol,
    fetchResearch
  );
  const [showEditor, setShowEditor] = createSignal(false);
  const [showViewer, setShowViewer] = createSignal(false);
  const [selectedDocument, setSelectedDocument] = createSignal<
    ResearchDocument | undefined
  >(undefined);
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
      // Fallback to original symbol
      setDisplayInfo({ name: props.symbol, isEtf: false });
    }
  });

  const handleCreate = () => {
    setSelectedDocument(undefined);
    setShowEditor(true);
  };

  const handleEdit = (doc: ResearchDocument) => {
    setSelectedDocument(doc);
    setShowEditor(true);
  };

  const handleView = (doc: ResearchDocument) => {
    setSelectedDocument(doc);
    setShowViewer(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this research document? This cannot be undone."))
      return;

    try {
      await deleteResearch(id);
      refetch();
      setError("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete research"
      );
    }
  };

  const handleSave = () => {
    setShowEditor(false);
    setSelectedDocument(undefined);
    refetch();
  };

  const handleCloseEditor = () => {
    setShowEditor(false);
    setSelectedDocument(undefined);
  };

  const handleCloseViewer = () => {
    setShowViewer(false);
    setSelectedDocument(undefined);
  };

  const truncateContent = (content: string, maxLength: number = 200) => {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + "...";
  };

  // Close on Escape key
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !showEditor() && !showViewer()) {
      props.onClose();
    }
  };

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
              📚 Research: {displayInfo().name}
            </h3>
            <div class="flex items-center gap-2">
              <button
                onClick={handleCreate}
                class="px-3 py-1.5 text-sm bg-blue hover:bg-blue/80 text-base rounded-lg transition-colors"
              >
                + New Document
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
          <div class="flex-1 overflow-y-auto p-4">
            <Show when={documents.loading}>
              <div class="text-center py-12 text-subtext0">
                Loading research documents...
              </div>
            </Show>

            <Show when={error()}>
              <div class="mb-4 p-3 bg-red/10 border border-red/30 rounded-lg text-sm text-red">
                {error()}
              </div>
            </Show>

            <Show when={documents() && documents()!.length === 0}>
              <div class="text-center py-12">
                <div class="text-4xl mb-3">📄</div>
                <p class="text-subtext0 mb-4">
                  No research documents yet for {displayInfo().name}
                </p>
                <button
                  onClick={handleCreate}
                  class="px-4 py-2 text-sm bg-blue hover:bg-blue/80 text-base rounded-lg transition-colors"
                >
                  Create First Document
                </button>
              </div>
            </Show>

            <Show when={documents() && documents()!.length > 0}>
              <div class="space-y-3">
                <For each={documents()}>
                  {(doc) => (
                    <div class="p-4 bg-surface0 border border-surface1 rounded-lg hover:border-surface2 transition-colors group">
                      <div class="flex items-start justify-between gap-3">
                        <div
                          class="flex-1 min-w-0 cursor-pointer"
                          onClick={() => handleView(doc)}
                        >
                          <h4 class="text-base font-medium text-text mb-1 group-hover:text-blue transition-colors">
                            {doc.title}
                          </h4>
                          <p class="text-sm text-subtext0 mb-2 line-clamp-2">
                            {truncateContent(doc.content)}
                          </p>
                          <div class="flex items-center gap-3 text-xs text-subtext1">
                            <span>Updated {formatTimeAgo(doc.updatedAt)}</span>
                            <span>•</span>
                            <span>{doc.content.length} characters</span>
                          </div>
                        </div>
                        <div class="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => handleEdit(doc)}
                            class="p-2 text-subtext0 hover:text-blue hover:bg-surface1 rounded transition-all"
                            title="Edit"
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
                                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                              />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDelete(doc.id)}
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
          </div>
        </div>
      </div>

      {/* Editor Modal */}
      <Show when={showEditor()}>
        <ResearchEditor
          symbol={props.symbol}
          document={selectedDocument()}
          onSave={handleSave}
          onClose={handleCloseEditor}
        />
      </Show>

      {/* Viewer Modal */}
      <Show when={showViewer() && selectedDocument()}>
        <ResearchViewer
          document={selectedDocument()!}
          onEdit={() => {
            setShowViewer(false);
            setShowEditor(true);
          }}
          onClose={handleCloseViewer}
        />
      </Show>
    </>
  );
}
