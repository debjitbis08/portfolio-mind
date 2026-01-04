import { createSignal, createResource, For, Show, onMount } from "solid-js";
import EditSchemaModal from "./EditSchemaModal";

interface ColumnDefinition {
  id: string;
  name: string;
  type: "text" | "number" | "percent" | "date" | "checkbox" | "select" | "url";
  options?: string[];
}

interface TableRow {
  id: string;
  tableId: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface UserTable {
  id: string;
  symbol: string;
  name: string;
  columns: ColumnDefinition[];
  createdAt: string;
  updatedAt: string;
}

interface TableEditorProps {
  table: UserTable;
  onClose: () => void;
}

async function fetchTableData(
  tableId: string
): Promise<{ table: UserTable; rows: TableRow[] }> {
  const response = await fetch(`/api/tables/${tableId}`);
  if (!response.ok) throw new Error("Failed to fetch table");
  return response.json();
}

export default function TableEditor(props: TableEditorProps) {
  const [tableData, { refetch }] = createResource(
    () => props.table.id,
    fetchTableData
  );
  const [showEditSchema, setShowEditSchema] = createSignal(false);
  const [error, setError] = createSignal("");
  const [savingCell, setSavingCell] = createSignal<string | null>(null);

  const table = () => tableData()?.table || props.table;
  const rows = () => tableData()?.rows || [];

  const addRow = async () => {
    try {
      // Create empty row with default values
      const defaultData: Record<string, unknown> = {};
      for (const col of table().columns) {
        switch (col.type) {
          case "checkbox":
            defaultData[col.id] = false;
            break;
          case "number":
          case "percent":
            defaultData[col.id] = null;
            break;
          default:
            defaultData[col.id] = "";
        }
      }

      const response = await fetch(`/api/tables/${props.table.id}/rows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: defaultData }),
      });

      if (!response.ok) throw new Error("Failed to add row");
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add row");
    }
  };

  const updateCell = async (
    rowId: string,
    colId: string,
    value: unknown,
    currentData: Record<string, unknown>
  ) => {
    const cellKey = `${rowId}-${colId}`;
    setSavingCell(cellKey);

    try {
      const newData = { ...currentData, [colId]: value };

      const response = await fetch(
        `/api/tables/${props.table.id}/rows/${rowId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: newData }),
        }
      );

      if (!response.ok) throw new Error("Failed to update cell");
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update cell");
    } finally {
      setSavingCell(null);
    }
  };

  const deleteRow = async (rowId: string) => {
    if (!confirm("Delete this row?")) return;

    try {
      const response = await fetch(
        `/api/tables/${props.table.id}/rows/${rowId}`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) throw new Error("Failed to delete row");
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete row");
    }
  };

  const handleSchemaUpdate = () => {
    setShowEditSchema(false);
    refetch();
  };

  const formatCellValue = (
    value: unknown,
    type: ColumnDefinition["type"]
  ): string => {
    if (value === null || value === undefined || value === "") return "";

    switch (type) {
      case "percent":
        return `${Number(value).toFixed(2)}%`;
      case "number":
        return Number(value).toLocaleString();
      case "checkbox":
        return value ? "✓" : "";
      case "date":
        return value ? new Date(String(value)).toLocaleDateString() : "";
      default:
        return String(value);
    }
  };

  const renderCell = (
    row: TableRow,
    col: ColumnDefinition,
    isSaving: boolean
  ) => {
    const value = row.data[col.id];
    const cellKey = `${row.id}-${col.id}`;

    const baseClasses =
      "w-full px-2 py-1.5 bg-transparent border-0 text-sm text-text focus:outline-none focus:ring-1 focus:ring-blue rounded";

    switch (col.type) {
      case "checkbox":
        return (
          <div class="flex justify-center">
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) =>
                updateCell(row.id, col.id, e.currentTarget.checked, row.data)
              }
              class="w-4 h-4 accent-blue"
              disabled={isSaving}
            />
          </div>
        );

      case "select":
        return (
          <select
            value={String(value || "")}
            onChange={(e) =>
              updateCell(row.id, col.id, e.currentTarget.value, row.data)
            }
            class={`${baseClasses} cursor-pointer`}
            disabled={isSaving}
          >
            <option value="">—</option>
            <For each={col.options || []}>
              {(option) => <option value={option}>{option}</option>}
            </For>
          </select>
        );

      case "number":
        return (
          <input
            type="number"
            value={value !== null && value !== undefined ? String(value) : ""}
            onBlur={(e) => {
              const newValue = e.currentTarget.value
                ? parseFloat(e.currentTarget.value)
                : null;
              if (newValue !== value) {
                updateCell(row.id, col.id, newValue, row.data);
              }
            }}
            class={`${baseClasses} text-right`}
            placeholder="—"
            disabled={isSaving}
          />
        );

      case "percent":
        return (
          <input
            type="number"
            step="0.01"
            value={value !== null && value !== undefined ? String(value) : ""}
            onBlur={(e) => {
              const newValue = e.currentTarget.value
                ? parseFloat(e.currentTarget.value)
                : null;
              if (newValue !== value) {
                updateCell(row.id, col.id, newValue, row.data);
              }
            }}
            class={`${baseClasses} text-right`}
            placeholder="—"
            disabled={isSaving}
          />
        );

      case "date":
        return (
          <input
            type="date"
            value={String(value || "")}
            onChange={(e) =>
              updateCell(row.id, col.id, e.currentTarget.value, row.data)
            }
            class={baseClasses}
            disabled={isSaving}
          />
        );

      case "url":
        return (
          <div class="flex items-center gap-1">
            <input
              type="url"
              value={String(value || "")}
              onBlur={(e) => {
                if (e.currentTarget.value !== value) {
                  updateCell(row.id, col.id, e.currentTarget.value, row.data);
                }
              }}
              class={`${baseClasses} flex-1`}
              placeholder="https://..."
              disabled={isSaving}
            />
            <Show when={value}>
              <a
                href={String(value)}
                target="_blank"
                rel="noopener noreferrer"
                class="p-1 text-blue hover:text-blue/80 transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <svg
                  class="w-3 h-3"
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
            </Show>
          </div>
        );

      default:
        // text
        return (
          <input
            type="text"
            value={String(value || "")}
            onBlur={(e) => {
              if (e.currentTarget.value !== value) {
                updateCell(row.id, col.id, e.currentTarget.value, row.data);
              }
            }}
            class={baseClasses}
            placeholder="—"
            disabled={isSaving}
          />
        );
    }
  };

  const getColumnTypeIcon = (type: ColumnDefinition["type"]): string => {
    switch (type) {
      case "text":
        return "📝";
      case "number":
        return "🔢";
      case "percent":
        return "%";
      case "date":
        return "📅";
      case "checkbox":
        return "☑️";
      case "select":
        return "📋";
      case "url":
        return "🔗";
      default:
        return "";
    }
  };

  return (
    <>
      <div
        class="fixed inset-0 z-[60] flex items-center justify-center bg-crust/80 backdrop-blur-sm p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose();
        }}
      >
        <div class="bg-base border border-surface1 rounded-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
          {/* Header */}
          <div class="flex items-center justify-between p-4 border-b border-surface1">
            <div>
              <h3 class="text-lg font-medium text-text">{table().name}</h3>
              <p class="text-xs text-subtext1 mt-0.5">
                {table().columns.length} columns • {rows().length} rows
              </p>
            </div>
            <div class="flex items-center gap-2">
              <button
                onClick={() => setShowEditSchema(true)}
                class="px-3 py-1.5 text-sm text-subtext0 hover:text-text border border-surface1 hover:border-surface2 rounded-lg transition-colors"
              >
                Edit Columns
              </button>
              <button
                onClick={addRow}
                class="px-3 py-1.5 text-sm bg-blue hover:bg-blue/80 text-base rounded-lg transition-colors"
              >
                + Add Row
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

          {/* Error */}
          <Show when={error()}>
            <div class="mx-4 mt-4 p-3 bg-red/10 border border-red/30 rounded-lg text-sm text-red">
              {error()}
            </div>
          </Show>

          {/* Table */}
          <div class="flex-1 overflow-auto p-4">
            <Show when={tableData.loading}>
              <div class="text-center py-12 text-subtext0">
                Loading table data...
              </div>
            </Show>

            <Show when={!tableData.loading && table().columns.length > 0}>
              <div class="overflow-x-auto">
                <table class="w-full border-collapse">
                  <thead>
                    <tr class="bg-surface0">
                      <For each={table().columns}>
                        {(col) => (
                          <th class="px-3 py-2 text-left text-xs font-medium text-subtext0 border border-surface1 whitespace-nowrap">
                            <span class="mr-1">
                              {getColumnTypeIcon(col.type)}
                            </span>
                            {col.name}
                          </th>
                        )}
                      </For>
                      <th class="w-10 px-2 py-2 border border-surface1"></th>
                    </tr>
                  </thead>
                  <tbody>
                    <Show when={rows().length === 0}>
                      <tr>
                        <td
                          colSpan={table().columns.length + 1}
                          class="px-4 py-8 text-center text-subtext1 border border-surface1"
                        >
                          No rows yet. Click "+ Add Row" to get started.
                        </td>
                      </tr>
                    </Show>
                    <For each={rows()}>
                      {(row) => (
                        <tr class="hover:bg-surface0/50 transition-colors">
                          <For each={table().columns}>
                            {(col) => (
                              <td class="border border-surface1 min-w-[120px] max-w-[300px]">
                                {renderCell(
                                  row,
                                  col,
                                  savingCell() === `${row.id}-${col.id}`
                                )}
                              </td>
                            )}
                          </For>
                          <td class="border border-surface1 w-10">
                            <button
                              onClick={() => deleteRow(row.id)}
                              class="p-1.5 text-subtext0 hover:text-red hover:bg-surface1 rounded transition-all mx-auto block"
                              title="Delete row"
                            >
                              <svg
                                class="w-3 h-3"
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
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
          </div>
        </div>
      </div>

      {/* Edit Schema Modal */}
      <Show when={showEditSchema()}>
        <EditSchemaModal
          table={table()}
          onSave={handleSchemaUpdate}
          onClose={() => setShowEditSchema(false)}
        />
      </Show>
    </>
  );
}
