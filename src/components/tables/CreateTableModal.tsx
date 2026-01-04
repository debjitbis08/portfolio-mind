import { createSignal, For, Show } from "solid-js";

interface ColumnDefinition {
  id: string;
  name: string;
  type: "text" | "number" | "percent" | "date" | "checkbox" | "select" | "url";
  options?: string[];
}

interface CreateTableModalProps {
  symbol: string;
  onSave: () => void;
  onClose: () => void;
}

const COLUMN_TYPES = [
  { value: "text", label: "Text", icon: "📝" },
  { value: "number", label: "Number", icon: "🔢" },
  { value: "percent", label: "Percent", icon: "%" },
  { value: "date", label: "Date", icon: "📅" },
  { value: "checkbox", label: "Checkbox", icon: "☑️" },
  { value: "select", label: "Select", icon: "📋" },
  { value: "url", label: "URL", icon: "🔗" },
];

export default function CreateTableModal(props: CreateTableModalProps) {
  const [name, setName] = createSignal("");
  const [columns, setColumns] = createSignal<ColumnDefinition[]>([
    { id: "col_1", name: "", type: "text" },
  ]);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal("");

  let nextColId = 2;

  const addColumn = () => {
    setColumns([
      ...columns(),
      { id: `col_${nextColId++}`, name: "", type: "text" },
    ]);
  };

  const removeColumn = (id: string) => {
    if (columns().length <= 1) return;
    setColumns(columns().filter((col) => col.id !== id));
  };

  const updateColumn = (
    id: string,
    field: keyof ColumnDefinition,
    value: string | string[]
  ) => {
    setColumns(
      columns().map((col) => (col.id === id ? { ...col, [field]: value } : col))
    );
  };

  const addOption = (colId: string) => {
    setColumns(
      columns().map((col) =>
        col.id === colId
          ? { ...col, options: [...(col.options || []), ""] }
          : col
      )
    );
  };

  const updateOption = (colId: string, optionIndex: number, value: string) => {
    setColumns(
      columns().map((col) =>
        col.id === colId
          ? {
              ...col,
              options: col.options?.map((opt, i) =>
                i === optionIndex ? value : opt
              ),
            }
          : col
      )
    );
  };

  const removeOption = (colId: string, optionIndex: number) => {
    setColumns(
      columns().map((col) =>
        col.id === colId
          ? {
              ...col,
              options: col.options?.filter((_, i) => i !== optionIndex),
            }
          : col
      )
    );
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();

    // Validate
    if (!name().trim()) {
      setError("Table name is required");
      return;
    }

    const validColumns = columns().filter((col) => col.name.trim());
    if (validColumns.length === 0) {
      setError("At least one column with a name is required");
      return;
    }

    // Check select columns have options
    for (const col of validColumns) {
      if (
        col.type === "select" &&
        (!col.options || col.options.filter((o) => o.trim()).length === 0)
      ) {
        setError(`Select column "${col.name}" must have at least one option`);
        return;
      }
    }

    setSaving(true);
    setError("");

    try {
      // Clean up columns for submission
      const cleanedColumns = validColumns.map((col) => ({
        id: col.id,
        name: col.name.trim(),
        type: col.type,
        ...(col.type === "select" && {
          options: col.options?.filter((o) => o.trim()),
        }),
      }));

      const response = await fetch("/api/tables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: props.symbol,
          name: name().trim(),
          columns: cleanedColumns,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create table");
      }

      props.onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create table");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      class="fixed inset-0 z-[60] flex items-center justify-center bg-crust/80 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div class="bg-base border border-surface1 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div class="flex items-center justify-between p-4 border-b border-surface1">
          <h3 class="text-lg font-medium text-text">Create New Table</h3>
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

        {/* Form */}
        <form onSubmit={handleSubmit} class="flex-1 overflow-y-auto p-4">
          <Show when={error()}>
            <div class="mb-4 p-3 bg-red/10 border border-red/30 rounded-lg text-sm text-red">
              {error()}
            </div>
          </Show>

          {/* Table Name */}
          <div class="mb-6">
            <label class="block text-sm font-medium text-text mb-2">
              Table Name
            </label>
            <input
              type="text"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              placeholder="e.g., Quarterly Tracker"
              class="w-full px-3 py-2 bg-surface0 border border-surface1 rounded-lg text-text placeholder:text-subtext1 focus:outline-none focus:border-blue"
              autofocus
            />
          </div>

          {/* Columns */}
          <div class="mb-6">
            <div class="flex items-center justify-between mb-3">
              <label class="text-sm font-medium text-text">Columns</label>
              <button
                type="button"
                onClick={addColumn}
                class="text-xs text-blue hover:text-blue/80 transition-colors"
              >
                + Add Column
              </button>
            </div>

            <div class="space-y-3">
              <For each={columns()}>
                {(column, index) => (
                  <div class="p-3 bg-surface0 border border-surface1 rounded-lg">
                    <div class="flex items-start gap-3">
                      <div class="flex-1 space-y-2">
                        <div class="flex gap-2">
                          <input
                            type="text"
                            value={column.name}
                            onInput={(e) =>
                              updateColumn(
                                column.id,
                                "name",
                                e.currentTarget.value
                              )
                            }
                            placeholder={`Column ${index() + 1} name`}
                            class="flex-1 px-3 py-1.5 bg-base border border-surface1 rounded text-sm text-text placeholder:text-subtext1 focus:outline-none focus:border-blue"
                          />
                          <select
                            value={column.type}
                            onChange={(e) =>
                              updateColumn(
                                column.id,
                                "type",
                                e.currentTarget
                                  .value as ColumnDefinition["type"]
                              )
                            }
                            class="px-2 py-1.5 bg-base border border-surface1 rounded text-sm text-text focus:outline-none focus:border-blue"
                          >
                            <For each={COLUMN_TYPES}>
                              {(type) => (
                                <option value={type.value}>
                                  {type.icon} {type.label}
                                </option>
                              )}
                            </For>
                          </select>
                        </div>

                        {/* Select Options */}
                        <Show when={column.type === "select"}>
                          <div class="pl-2 border-l-2 border-surface1">
                            <div class="text-xs text-subtext0 mb-2">
                              Options:
                            </div>
                            <div class="space-y-1">
                              <For each={column.options || []}>
                                {(option, optIndex) => (
                                  <div class="flex gap-2">
                                    <input
                                      type="text"
                                      value={option}
                                      onInput={(e) =>
                                        updateOption(
                                          column.id,
                                          optIndex(),
                                          e.currentTarget.value
                                        )
                                      }
                                      placeholder={`Option ${optIndex() + 1}`}
                                      class="flex-1 px-2 py-1 bg-base border border-surface1 rounded text-xs text-text placeholder:text-subtext1 focus:outline-none focus:border-blue"
                                    />
                                    <button
                                      type="button"
                                      onClick={() =>
                                        removeOption(column.id, optIndex())
                                      }
                                      class="p-1 text-subtext0 hover:text-red transition-colors"
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
                                  </div>
                                )}
                              </For>
                              <button
                                type="button"
                                onClick={() => addOption(column.id)}
                                class="text-xs text-blue hover:text-blue/80 transition-colors"
                              >
                                + Add Option
                              </button>
                            </div>
                          </div>
                        </Show>
                      </div>

                      <button
                        type="button"
                        onClick={() => removeColumn(column.id)}
                        class="p-1.5 text-subtext0 hover:text-red hover:bg-surface1 rounded transition-all"
                        title="Remove column"
                        disabled={columns().length <= 1}
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
                )}
              </For>
            </div>
          </div>

          {/* Actions */}
          <div class="flex justify-end gap-3">
            <button
              type="button"
              onClick={props.onClose}
              class="px-4 py-2 text-sm text-subtext0 hover:text-text transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving()}
              class="px-4 py-2 text-sm bg-blue hover:bg-blue/80 disabled:bg-blue/50 text-base rounded-lg transition-colors"
            >
              {saving() ? "Creating..." : "Create Table"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
