import { createSignal, Show } from "solid-js";
import { markdownToHtml } from "../../lib/utils/markdown";
import MarkdownEditor from "./MarkdownEditor";
import TagInput from "../common/TagInput";

interface ResearchDocument {
  id: string;
  symbol: string;
  title: string;
  content: string;
  tags?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ResearchEditorProps {
  symbol: string;
  document?: ResearchDocument; // If provided, edit mode; otherwise, create mode
  onSave: () => void;
  onClose: () => void;
}

async function saveResearch(
  symbol: string,
  title: string,
  content: string,
  tags: string[]
): Promise<ResearchDocument> {
  const response = await fetch("/api/research", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol, title, content, tags }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to create research");
  }
  const data = await response.json();
  return data.document;
}

async function updateResearch(
  id: string,
  title: string,
  content: string,
  tags: string[]
): Promise<ResearchDocument> {
  const response = await fetch(`/api/research/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, content, tags }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to update research");
  }
  const data = await response.json();
  return data.document;
}

export default function ResearchEditor(props: ResearchEditorProps) {
  // Parse existing tags from JSON string
  const parseTags = (): string[] => {
    if (!props.document?.tags) return [];
    try {
      return JSON.parse(props.document.tags);
    } catch {
      return [];
    }
  };

  const [title, setTitle] = createSignal(props.document?.title || "");
  const [content, setContent] = createSignal(props.document?.content || "");
  const [tags, setTags] = createSignal<string[]>(parseTags());
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [error, setError] = createSignal("");
  const [showPreview, setShowPreview] = createSignal(false);

  const isEditMode = () => !!props.document;

  const handleSubmit = async (e: Event) => {
    e.preventDefault();

    const titleValue = title().trim();
    const contentValue = content().trim();

    if (!titleValue) {
      setError("Title is required");
      return;
    }

    if (!contentValue) {
      setError("Content is required");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      if (isEditMode()) {
        await updateResearch(
          props.document!.id,
          titleValue,
          contentValue,
          tags()
        );
      } else {
        await saveResearch(props.symbol, titleValue, contentValue, tags());
      }
      props.onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save research");
    } finally {
      setIsSubmitting(false);
    }
  };

  const previewHtml = () => markdownToHtml(content());

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
      <div class="bg-base border border-surface1 rounded-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div class="flex items-center justify-between p-4 border-b border-surface1">
          <h3 class="text-lg font-medium text-text">
            {isEditMode() ? "✏️ Edit Research" : "📄 New Research Document"}
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
        <form
          onSubmit={handleSubmit}
          class="flex-1 overflow-hidden flex flex-col"
        >
          <div class="flex-1 overflow-y-auto space-y-4">
            <div class="p-4 space-y-4">
              {/* Title Input */}
              <div>
                <label class="block text-sm font-medium text-subtext1 mb-1">
                  Title
                </label>
                <input
                  type="text"
                  value={title()}
                  onInput={(e) => setTitle(e.currentTarget.value)}
                  placeholder="e.g., Investment Thesis"
                  class="w-full px-3 py-2 bg-surface0 border border-surface2 rounded-lg text-text focus:outline-none focus:border-mauve"
                  disabled={isSubmitting()}
                />
              </div>

              {/* Tags Input */}
              <div>
                <label class="block text-sm font-medium text-subtext1 mb-1">
                  Tags
                </label>
                <TagInput
                  tags={tags()}
                  onChange={setTags}
                  placeholder="Add tags (press Enter or comma)..."
                />
              </div>

              {/* Preview Toggle */}
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowPreview(!showPreview())}
                  class="px-3 py-1 text-sm bg-surface0 hover:bg-surface1 text-text rounded-lg transition-colors border border-surface2"
                >
                  {showPreview() ? "📝 Edit" : "👁️ Preview"}
                </button>
                <span class="text-xs text-subtext0">
                  Rich markdown editor with live formatting: **bold**, *italic*,
                  # headers, - lists, [links](url), tables, and more
                </span>
              </div>
            </div>
            {/* Content Editor/Preview */}
            <div class="flex-1">
              <Show when={!showPreview()}>
                <MarkdownEditor
                  value={content()}
                  onChange={setContent}
                  placeholder="Write your research in markdown...

# Key Points

- Strong moat in the demat business
- Consistent revenue growth
- Low debt

## Valuation

Current PE: 45
Target PE: 50"
                  disabled={isSubmitting()}
                />
              </Show>

              <Show when={showPreview()}>
                <div
                  class="w-full min-h-[300px] p-6 border-t border-surface2 prose prose-invert prose-sm max-w-none overflow-auto"
                  // biome-ignore lint: Using innerHTML for markdown rendering
                  innerHTML={previewHtml()}
                />
              </Show>
            </div>

            <Show when={error()}>
              <div class="p-2 bg-red/10 border border-red/30 rounded text-xs text-red">
                {error()}
              </div>
            </Show>
          </div>

          {/* Footer */}
          <div class="flex items-center justify-end gap-2 p-4 border-t border-surface1">
            <button
              type="button"
              onClick={props.onClose}
              class="px-4 py-2 text-sm bg-surface0 hover:bg-surface1 text-text rounded-lg transition-colors"
              disabled={isSubmitting()}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting() || !title().trim() || !content().trim()}
              class="px-4 py-2 text-sm bg-blue hover:bg-blue/80 text-base rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting() ? "Saving..." : "Save Research"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
