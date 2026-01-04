import { createSignal, createResource, For, Show } from "solid-js";

interface Note {
  id: string;
  content: string;
  createdAt: string;
}

interface ActionNotesProps {
  suggestionId: string;
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

async function fetchNotes(suggestionId: string): Promise<Note[]> {
  const response = await fetch(
    `/api/notes/action?suggestionId=${encodeURIComponent(suggestionId)}`
  );
  if (!response.ok) throw new Error("Failed to fetch notes");
  const data = await response.json();
  return data.notes || [];
}

async function createNote(
  suggestionId: string,
  content: string
): Promise<Note> {
  const response = await fetch("/api/notes/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ suggestionId, content }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to create note");
  }
  const data = await response.json();
  return data.note;
}

async function deleteNote(id: string): Promise<void> {
  const response = await fetch("/api/notes/action", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!response.ok) throw new Error("Failed to delete note");
}

export default function ActionNotes(props: ActionNotesProps) {
  const [notes, { refetch }] = createResource(
    () => props.suggestionId,
    fetchNotes
  );
  const [newNote, setNewNote] = createSignal("");
  const [showForm, setShowForm] = createSignal(false);
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [error, setError] = createSignal("");

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
      await createNote(props.suggestionId, content);
      setNewNote("");
      setShowForm(false);
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

  return (
    <div class="border-t border-surface1 px-4 py-3">
      <div class="flex items-center justify-between mb-2">
        <h4 class="text-sm text-subtext1">Your Notes:</h4>
        <Show when={!showForm()}>
          <button
            onClick={() => setShowForm(true)}
            class="text-xs px-2 py-1 bg-surface1 hover:bg-surface2 text-subtext1 rounded transition-colors"
          >
            + Add Note
          </button>
        </Show>
      </div>

      <Show when={error()}>
        <div class="mb-2 p-2 bg-red/10 border border-red/30 rounded text-xs text-red">
          {error()}
        </div>
      </Show>

      <Show when={showForm()}>
        <form onSubmit={handleSubmit} class="mb-3 space-y-2">
          <div class="relative">
            <textarea
              value={newNote()}
              onInput={(e) => setNewNote(e.currentTarget.value)}
              placeholder="Add a note about this suggestion..."
              rows={2}
              class="w-full px-3 py-2 bg-surface0 border border-surface2 rounded-lg text-sm text-text resize-none focus:outline-none focus:border-mauve"
              disabled={isSubmitting()}
            />
            <div
              class={`absolute bottom-1 right-2 text-xs ${charLimitClass()}`}
            >
              {charCount()}/500
            </div>
          </div>
          <div class="flex gap-2">
            <button
              type="submit"
              disabled={
                isSubmitting() || !newNote().trim() || charCount() > 500
              }
              class="px-3 py-1 text-sm bg-blue hover:bg-blue/80 text-base rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting() ? "Saving..." : "Save Note"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setNewNote("");
                setError("");
              }}
              disabled={isSubmitting()}
              class="px-3 py-1 text-sm bg-surface1 hover:bg-surface2 text-subtext1 rounded transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </Show>

      <Show when={notes.loading}>
        <div class="text-xs text-subtext0">Loading notes...</div>
      </Show>

      <Show when={notes() && notes()!.length === 0 && !showForm()}>
        <div class="text-xs text-subtext0 italic">No notes yet</div>
      </Show>

      <ul class="space-y-1.5">
        <For each={notes()}>
          {(note) => (
            <li class="flex items-start gap-2 text-sm group">
              <span class="text-mauve">•</span>
              <div class="flex-1 min-w-0">
                <p class="text-text break-words">{note.content}</p>
                <p class="text-xs text-subtext0 mt-0.5">
                  {formatTimeAgo(note.createdAt)}
                </p>
              </div>
              <button
                onClick={() => handleDelete(note.id)}
                class="opacity-0 group-hover:opacity-100 text-red hover:text-red/80 text-xs transition-opacity p-1"
                title="Delete note"
              >
                ✕
              </button>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}
