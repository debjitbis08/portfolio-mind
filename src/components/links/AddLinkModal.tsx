import { createSignal } from "solid-js";

interface AddLinkModalProps {
  symbol: string;
  onSave: () => void;
  onClose: () => void;
}

export default function AddLinkModal(props: AddLinkModalProps) {
  const [url, setUrl] = createSignal("");
  const [title, setTitle] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError("");

    const urlValue = url().trim();
    if (!urlValue) {
      setError("URL is required");
      return;
    }

    // Basic URL validation
    try {
      new URL(urlValue);
    } catch {
      setError("Please enter a valid URL");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: props.symbol,
          url: urlValue,
          title: title().trim() || undefined,
          description: description().trim() || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to add link");
      }

      props.onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add link");
    } finally {
      setLoading(false);
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
      <div class="bg-base border border-surface1 rounded-2xl max-w-lg w-full shadow-2xl">
        {/* Header */}
        <div class="flex items-center justify-between p-4 border-b border-surface1">
          <h3 class="text-lg font-medium text-text">Add Link</h3>
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
        <form onSubmit={handleSubmit} class="p-4 space-y-4">
          {error() && (
            <div class="p-3 bg-red/10 border border-red/30 rounded-lg text-sm text-red">
              {error()}
            </div>
          )}

          <div>
            <label class="block text-sm font-medium text-text mb-1.5">
              URL <span class="text-red">*</span>
            </label>
            <input
              type="url"
              value={url()}
              onInput={(e) => setUrl(e.currentTarget.value)}
              placeholder="https://example.com/article"
              class="w-full px-3 py-2 bg-surface0 border border-surface1 rounded-lg text-text placeholder:text-subtext1 focus:outline-none focus:border-blue transition-colors"
              disabled={loading()}
              autofocus
            />
            <p class="text-xs text-subtext1 mt-1">
              We'll automatically fetch the page content for AI analysis
            </p>
          </div>

          <div>
            <label class="block text-sm font-medium text-text mb-1.5">
              Title <span class="text-subtext1">(optional)</span>
            </label>
            <input
              type="text"
              value={title()}
              onInput={(e) => setTitle(e.currentTarget.value)}
              placeholder="Leave blank to auto-detect from page"
              class="w-full px-3 py-2 bg-surface0 border border-surface1 rounded-lg text-text placeholder:text-subtext1 focus:outline-none focus:border-blue transition-colors"
              disabled={loading()}
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-text mb-1.5">
              Your Notes <span class="text-subtext1">(optional)</span>
            </label>
            <textarea
              value={description()}
              onInput={(e) => setDescription(e.currentTarget.value)}
              placeholder="Why is this link important?"
              rows={2}
              class="w-full px-3 py-2 bg-surface0 border border-surface1 rounded-lg text-text placeholder:text-subtext1 focus:outline-none focus:border-blue transition-colors resize-none"
              disabled={loading()}
            />
          </div>

          <div class="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={props.onClose}
              class="px-4 py-2 text-sm text-subtext0 hover:text-text transition-colors"
              disabled={loading()}
            >
              Cancel
            </button>
            <button
              type="submit"
              class="px-4 py-2 text-sm bg-blue hover:bg-blue/80 text-base rounded-lg transition-colors disabled:opacity-50"
              disabled={loading()}
            >
              {loading() ? "Adding..." : "Add Link"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
