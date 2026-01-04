import { createSignal, createResource, For, Show } from "solid-js";
import CreateTableModal from "./CreateTableModal";
import TableEditor from "./TableEditor";

interface ColumnDefinition {
  id: string;
  name: string;
  type: "text" | "number" | "percent" | "date" | "checkbox" | "select" | "url";
  options?: string[];
}

interface UserTable {
  id: string;
  symbol: string;
  name: string;
  columns: ColumnDefinition[];
  rowCount: number;
  createdAt: string;
  updatedAt: string;
}

interface TablesListProps {
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

async function fetchTables(symbol: string): Promise<UserTable[]> {
  const response = await fetch(
    `/api/tables?symbol=${encodeURIComponent(symbol)}`
  );
  if (!response.ok) throw new Error("Failed to fetch tables");
  const data = await response.json();
  return data.tables || [];
}

async function deleteTable(id: string): Promise<void> {
  const response = await fetch(`/api/tables/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) throw new Error("Failed to delete table");
}

export default function TablesList(props: TablesListProps) {
  const [tables, { refetch }] = createResource(() => props.symbol, fetchTables);
  const [showCreateModal, setShowCreateModal] = createSignal(false);
  const [showEditor, setShowEditor] = createSignal(false);
  const [selectedTable, setSelectedTable] = createSignal<UserTable | undefined>(
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

  const handleCreate = () => {
    setShowCreateModal(true);
  };

  const handleView = (table: UserTable) => {
    setSelectedTable(table);
    setShowEditor(true);
  };

  const handleDelete = async (id: string, e: Event) => {
    e.stopPropagation();
    if (!confirm("Delete this table and all its data? This cannot be undone."))
      return;

    try {
      await deleteTable(id);
      refetch();
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete table");
    }
  };

  const handleSave = () => {
    setShowCreateModal(false);
    refetch();
  };

  const handleCloseCreateModal = () => {
    setShowCreateModal(false);
  };

  const handleCloseEditor = () => {
    setShowEditor(false);
    setSelectedTable(undefined);
    refetch(); // Refresh to update row counts
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !showCreateModal() && !showEditor()) {
      props.onClose();
    }
  };

  // Content that is shared between modal and embedded modes
  const tablesContent = () => (
    <>
      <Show when={tables.loading}>
        <div class="text-center py-12 text-subtext0">Loading tables...</div>
      </Show>

      <Show when={error()}>
        <div class="mb-4 p-3 bg-red/10 border border-red/30 rounded-lg text-sm text-red">
          {error()}
        </div>
      </Show>

      <Show when={tables() && tables()!.length === 0}>
        <div class="text-center py-12">
          <div class="text-4xl mb-3">📊</div>
          <p class="text-subtext0 mb-4">
            No tables yet for {displayInfo().name}
          </p>
          <button
            onClick={handleCreate}
            class="px-4 py-2 text-sm bg-blue hover:bg-blue/80 text-base rounded-lg transition-colors"
          >
            Create First Table
          </button>
        </div>
      </Show>

      <Show when={tables() && tables()!.length > 0}>
        <div class="space-y-3">
          <For each={tables()}>
            {(table) => (
              <div
                class="p-4 bg-surface0 border border-surface1 rounded-lg hover:border-surface2 transition-colors group cursor-pointer"
                onClick={() => handleView(table)}
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="flex-1 min-w-0">
                    <h4 class="text-base font-medium text-text mb-1 group-hover:text-blue transition-colors">
                      {table.name}
                    </h4>
                    <div class="flex items-center gap-2 flex-wrap text-xs text-subtext1">
                      <span>
                        {table.columns.length} column
                        {table.columns.length !== 1 ? "s" : ""}
                      </span>
                      <span>•</span>
                      <span>
                        {table.rowCount} row{table.rowCount !== 1 ? "s" : ""}
                      </span>
                      <span>•</span>
                      <span>Updated {formatTimeAgo(table.updatedAt)}</span>
                    </div>
                    <div class="mt-2 flex gap-1 flex-wrap">
                      <For each={table.columns.slice(0, 5)}>
                        {(col) => (
                          <span class="px-2 py-0.5 text-xs bg-surface1 rounded text-subtext0">
                            {col.name}
                          </span>
                        )}
                      </For>
                      <Show when={table.columns.length > 5}>
                        <span class="px-2 py-0.5 text-xs bg-surface1 rounded text-subtext1">
                          +{table.columns.length - 5} more
                        </span>
                      </Show>
                    </div>
                  </div>
                  <div class="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={(e) => handleDelete(table.id, e)}
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
          <h3 class="text-lg font-medium text-text">📊 Tables</h3>
          <button
            onClick={handleCreate}
            class="px-3 py-1.5 text-sm bg-blue hover:bg-blue/80 text-base rounded-lg transition-colors"
          >
            + New Table
          </button>
        </div>

        {/* Content */}
        <div class="flex-1">{tablesContent()}</div>

        {/* Create Modal */}
        <Show when={showCreateModal()}>
          <CreateTableModal
            symbol={props.symbol}
            onSave={handleSave}
            onClose={handleCloseCreateModal}
          />
        </Show>

        {/* Editor Modal */}
        <Show when={showEditor() && selectedTable()}>
          <TableEditor table={selectedTable()!} onClose={handleCloseEditor} />
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
              📊 Tables: {displayInfo().name}
            </h3>
            <div class="flex items-center gap-2">
              <button
                onClick={handleCreate}
                class="px-3 py-1.5 text-sm bg-blue hover:bg-blue/80 text-base rounded-lg transition-colors"
              >
                + New Table
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
          <div class="flex-1 overflow-y-auto p-4">{tablesContent()}</div>
        </div>
      </div>

      {/* Create Modal */}
      <Show when={showCreateModal()}>
        <CreateTableModal
          symbol={props.symbol}
          onSave={handleSave}
          onClose={handleCloseCreateModal}
        />
      </Show>

      {/* Editor Modal */}
      <Show when={showEditor() && selectedTable()}>
        <TableEditor table={selectedTable()!} onClose={handleCloseEditor} />
      </Show>
    </>
  );
}
