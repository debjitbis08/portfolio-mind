import { createSignal, createResource, For, Show } from "solid-js";

interface Note {
  id: string;
  symbol: string;
  content: string;
  createdAt: string;
}

interface CompanyNotesProps {
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
  return `${Math.floor(seconds / 604800)}w ago`;
}

async function fetchNotes(symbol: string): Promise<Note[]> {
  const response = await fetch(
    `/api/notes/company?symbol=${encodeURIComponent(symbol)}`
  );
  if (!response.ok) throw new Error("Failed to fetch notes");
  const data = await response.json();
  return data.notes || [];
}

async function createNote(symbol: string, content: string): Promise<Note> {
  const response = await fetch("/api/notes/company", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol, content }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to create note");
  }
  const data = await response.json();
  return data.note;
}

async function deleteNote(id: string): Promise<void> {
  const response = await fetch("/api/notes/company", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!response.ok) throw new Error("Failed to delete note");
}

export default function CompanyNotes(props: CompanyNotesProps) {
  const [notes, { refetch }] = createResource(() => props.symbol, fetchNotes);
  const [newNote, setNewNote] = createSignal("");
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [error, setError] = createSignal("");
  const [displayInfo, setDisplayInfo] = createSignal<{
    name: string;
    isEtf: boolean;
  }>({ name: props.symbol, isEtf: false });

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

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    const content = newNote().trim();

    if (!content) return;

    if (content.length > 500) {
      setError("Note cannot exceed 500 characters");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      await createNote(props.symbol, content);
      setNewNote("");
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create note");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this note?")) return;

    try {
      await deleteNote(id);
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete note");
    }
  };

  const charCount = () => newNote().length;
  const charLimitClass = () => {
    const count = charCount();
    if (count > 500) return "text-red";
    if (count > 450) return "text-yellow";
    return "text-subtext0";
  };

  // Close on Escape key
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      props.onClose();
    }
  };

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-crust/80 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <div class="bg-base border border-surface1 rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div class="flex items-center justify-between p-4 border-b border-surface1">
          <h3 class="text-lg font-medium text-text">
            📝 Notes for {displayInfo().name}
          </h3>
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

        {/* Content */}
        <div class="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Add Note Form */}
          <form onSubmit={handleSubmit} class="space-y-2">
            <div class="relative">
              <textarea
                value={newNote()}
                onInput={(e) => setNewNote(e.currentTarget.value)}
                placeholder="Add a note about this stock..."
                rows={3}
                class="w-full px-3 py-2 bg-surface0 border border-surface2 rounded-lg text-sm text-text resize-none focus:outline-none focus:border-mauve"
                disabled={isSubmitting()}
              />
              <div
                class={`absolute bottom-2 right-2 text-xs ${charLimitClass()}`}
              >
                {charCount()}/500
              </div>
            </div>

            <Show when={error()}>
              <div class="p-2 bg-red/10 border border-red/30 rounded text-xs text-red">
                {error()}
              </div>
            </Show>

            <button
              type="submit"
              disabled={
                isSubmitting() || !newNote().trim() || charCount() > 500
              }
              class="w-full px-4 py-2 text-sm bg-blue hover:bg-blue/80 text-base rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting() ? "Saving..." : "Add Note"}
            </button>
          </form>

          {/* Notes List */}
          <Show when={notes.loading}>
            <div class="text-center py-8 text-subtext0">Loading notes...</div>
          </Show>

          <Show when={notes() && notes()!.length === 0}>
            <div class="text-center py-8 text-subtext0 italic">
              No notes yet. Add one above!
            </div>
          </Show>

          <Show when={notes() && notes()!.length > 0}>
            <div class="space-y-2">
              <h4 class="text-sm font-medium text-subtext1">
                All Notes ({notes()!.length})
              </h4>
              <ul class="space-y-2">
                <For each={notes()}>
                  {(note) => (
                    <li class="p-3 bg-surface0 border border-surface1 rounded-lg group">
                      <div class="flex items-start justify-between gap-3">
                        <div class="flex-1 min-w-0">
                          <p class="text-sm text-text break-words whitespace-pre-wrap">
                            {note.content}
                          </p>
                          <p class="text-xs text-subtext0 mt-1">
                            {formatTimeAgo(note.createdAt)}
                          </p>
                        </div>
                        <button
                          onClick={() => handleDelete(note.id)}
                          class="opacity-0 group-hover:opacity-100 flex-shrink-0 text-red hover:text-red/80 text-sm transition-opacity p-1"
                          title="Delete note"
                        >
                          ✕
                        </button>
                      </div>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
