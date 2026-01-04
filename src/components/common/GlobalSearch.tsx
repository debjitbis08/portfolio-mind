/**
 * GlobalSearch Component
 *
 * Search bar with:
 * - Debounced input
 * - Results grouped by type (research, notes, links)
 * - Click to navigate
 * - Keyboard shortcut (Cmd/Ctrl+K)
 */

import { createSignal, For, Show, onMount, onCleanup } from "solid-js";

interface SearchResult {
  type: "research" | "note" | "link";
  id: string;
  symbol: string;
  title?: string;
  snippet: string;
  tags?: string[];
  rank: number;
}

interface GlobalSearchProps {
  onClose?: () => void;
}

export default function GlobalSearch(props: GlobalSearchProps) {
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<SearchResult[]>([]);
  const [isLoading, setIsLoading] = createSignal(false);
  const [isOpen, setIsOpen] = createSignal(false);
  const [selectedIndex, setSelectedIndex] = createSignal(-1);

  let inputRef: HTMLInputElement | undefined;
  let debounceTimer: number | undefined;

  // Debounced search
  const performSearch = async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(searchQuery)}&limit=15`,
        { credentials: "include" }
      );

      if (response.ok) {
        const data = await response.json();
        setResults(data.results || []);
        setSelectedIndex(-1);
      }
    } catch (error) {
      console.error("Search error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleInput = (e: Event) => {
    const value = (e.target as HTMLInputElement).value;
    setQuery(value);

    // Debounce search
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      performSearch(value);
    }, 250);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const currentResults = results();

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, currentResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && selectedIndex() >= 0) {
      e.preventDefault();
      navigateToResult(currentResults[selectedIndex()]);
    } else if (e.key === "Escape") {
      setIsOpen(false);
      props.onClose?.();
    }
  };

  const navigateToResult = (result: SearchResult) => {
    // Navigate to the appropriate page based on result type
    let url = `/company/${encodeURIComponent(result.symbol)}`;

    // Add tab parameter based on type
    if (result.type === "research") {
      url += "?tab=research";
    } else if (result.type === "note") {
      url += "?tab=notes";
    } else if (result.type === "link") {
      url += "?tab=links";
    }

    window.location.href = url;
  };

  const getTypeIcon = (type: SearchResult["type"]) => {
    switch (type) {
      case "research":
        return (
          <svg
            class="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        );
      case "note":
        return (
          <svg
            class="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
            />
          </svg>
        );
      case "link":
        return (
          <svg
            class="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
            />
          </svg>
        );
    }
  };

  const getTypeLabel = (type: SearchResult["type"]) => {
    switch (type) {
      case "research":
        return "Research";
      case "note":
        return "Note";
      case "link":
        return "Link";
    }
  };

  // Global keyboard shortcut
  const handleGlobalKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      setIsOpen(true);
      setTimeout(() => inputRef?.focus(), 0);
    }
  };

  onMount(() => {
    if (typeof document !== "undefined") {
      document.addEventListener("keydown", handleGlobalKeyDown);
    }
  });

  onCleanup(() => {
    if (typeof document !== "undefined") {
      document.removeEventListener("keydown", handleGlobalKeyDown);
    }
    if (debounceTimer) clearTimeout(debounceTimer);
  });

  return (
    <>
      {/* Search trigger button */}
      <button
        type="button"
        onClick={() => {
          setIsOpen(true);
          setTimeout(() => inputRef?.focus(), 0);
        }}
        class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface0 border border-surface1 hover:border-surface2 text-subtext0 hover:text-text transition-colors text-sm"
      >
        <svg
          class="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <span class="hidden sm:inline">Search...</span>
        <kbd class="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs rounded bg-surface1 text-subtext1">
          <span>⌘</span>K
        </kbd>
      </button>

      {/* Search modal */}
      <Show when={isOpen()}>
        <div
          class="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-base/80 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsOpen(false);
              props.onClose?.();
            }
          }}
        >
          <div class="w-full max-w-2xl mx-4 bg-surface0 rounded-xl border border-surface1 shadow-2xl overflow-hidden">
            {/* Search input */}
            <div class="flex items-center gap-3 px-4 py-3 border-b border-surface1">
              <svg
                class="w-5 h-5 text-subtext0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={query()}
                onInput={handleInput}
                onKeyDown={handleKeyDown}
                placeholder="Search research, notes, and links..."
                class="flex-1 bg-transparent border-none outline-none text-text placeholder:text-subtext0"
              />
              <Show when={isLoading()}>
                <div class="w-5 h-5 border-2 border-blue border-t-transparent rounded-full animate-spin" />
              </Show>
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  props.onClose?.();
                }}
                class="text-subtext0 hover:text-text"
              >
                <kbd class="px-1.5 py-0.5 text-xs rounded bg-surface1">ESC</kbd>
              </button>
            </div>

            {/* Results */}
            <div class="max-h-[60vh] overflow-y-auto">
              <Show when={results().length > 0}>
                <div class="py-2">
                  <For each={results()}>
                    {(result, index) => (
                      <button
                        type="button"
                        onClick={() => navigateToResult(result)}
                        class={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors ${
                          selectedIndex() === index()
                            ? "bg-blue/10"
                            : "hover:bg-surface1"
                        }`}
                      >
                        <div class="mt-0.5 p-1.5 rounded bg-surface1 text-subtext0">
                          {getTypeIcon(result.type)}
                        </div>
                        <div class="flex-1 min-w-0">
                          <div class="flex items-center gap-2">
                            <span class="text-sm font-medium text-text truncate">
                              {result.title || result.snippet.slice(0, 50)}
                            </span>
                            <span class="text-xs px-1.5 py-0.5 rounded bg-surface1 text-subtext0">
                              {getTypeLabel(result.type)}
                            </span>
                          </div>
                          <div class="flex items-center gap-2 mt-1">
                            <span class="text-xs text-subtext0">
                              {result.symbol}
                            </span>
                            <Show when={result.tags && result.tags.length > 0}>
                              <div class="flex gap-1">
                                <For each={result.tags?.slice(0, 3)}>
                                  {(tag) => (
                                    <span class="text-xs px-1.5 rounded bg-blue/20 text-blue-300">
                                      {tag}
                                    </span>
                                  )}
                                </For>
                              </div>
                            </Show>
                          </div>
                          <p
                            class="mt-1 text-sm text-subtext0 line-clamp-2"
                            innerHTML={result.snippet}
                          />
                        </div>
                      </button>
                    )}
                  </For>
                </div>
              </Show>

              <Show
                when={
                  query().length > 0 && results().length === 0 && !isLoading()
                }
              >
                <div class="py-8 text-center text-subtext0">
                  <svg
                    class="w-12 h-12 mx-auto mb-3 opacity-50"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="1.5"
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                  <p>No results found for "{query()}"</p>
                </div>
              </Show>

              <Show when={query().length === 0}>
                <div class="py-8 text-center text-subtext0">
                  <p class="text-sm">
                    Start typing to search across all your research, notes, and
                    links
                  </p>
                </div>
              </Show>
            </div>

            {/* Footer */}
            <Show when={results().length > 0}>
              <div class="flex items-center justify-between px-4 py-2 border-t border-surface1 text-xs text-subtext0">
                <div class="flex items-center gap-3">
                  <span class="flex items-center gap-1">
                    <kbd class="px-1 rounded bg-surface1">↑</kbd>
                    <kbd class="px-1 rounded bg-surface1">↓</kbd>
                    to navigate
                  </span>
                  <span class="flex items-center gap-1">
                    <kbd class="px-1 rounded bg-surface1">↵</kbd>
                    to select
                  </span>
                </div>
                <span>
                  {results().length} result{results().length !== 1 ? "s" : ""}
                </span>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </>
  );
}
