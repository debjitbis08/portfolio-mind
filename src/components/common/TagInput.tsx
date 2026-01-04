/**
 * TagInput Component
 *
 * A chip-style tag input with:
 * - Add tags with Enter or comma
 * - Remove tags with backspace or X click
 * - Autocomplete from existing tags (optional)
 */

import { createSignal, For, Show } from "solid-js";

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
  maxTags?: number;
}

export default function TagInput(props: TagInputProps) {
  const [inputValue, setInputValue] = createSignal("");
  const [showSuggestions, setShowSuggestions] = createSignal(false);

  const addTag = (tag: string) => {
    const trimmed = tag.trim().toLowerCase();
    if (trimmed && !props.tags.includes(trimmed)) {
      if (props.maxTags && props.tags.length >= props.maxTags) {
        return; // Don't add if at max
      }
      props.onChange([...props.tags, trimmed]);
    }
    setInputValue("");
    setShowSuggestions(false);
  };

  const removeTag = (tagToRemove: string) => {
    props.onChange(props.tags.filter((tag) => tag !== tagToRemove));
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const value = inputValue();

    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (value) addTag(value);
    } else if (e.key === "Backspace" && !value && props.tags.length > 0) {
      removeTag(props.tags[props.tags.length - 1]);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  const handleInput = (e: Event) => {
    const target = e.target as HTMLInputElement;
    let value = target.value;

    // Handle comma to add tag
    if (value.includes(",")) {
      const parts = value.split(",");
      parts.slice(0, -1).forEach((part) => addTag(part));
      value = parts[parts.length - 1];
    }

    setInputValue(value);
    setShowSuggestions(
      value.length > 0 && (props.suggestions?.length ?? 0) > 0
    );
  };

  const filteredSuggestions = () => {
    const value = inputValue().toLowerCase();
    if (!value || !props.suggestions) return [];
    return props.suggestions
      .filter(
        (s) =>
          s.toLowerCase().includes(value) &&
          !props.tags.includes(s.toLowerCase())
      )
      .slice(0, 5);
  };

  // Color palette for tag chips (Catppuccin-inspired)
  const tagColors = [
    "bg-blue-500/20 text-blue-300 border-blue-500/30",
    "bg-green-500/20 text-green-300 border-green-500/30",
    "bg-purple-500/20 text-purple-300 border-purple-500/30",
    "bg-pink-500/20 text-pink-300 border-pink-500/30",
    "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
    "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  ];

  const getTagColor = (index: number) => {
    return tagColors[index % tagColors.length];
  };

  return (
    <div class="relative">
      <div class="flex flex-wrap gap-2 p-2 rounded-lg border border-surface1 bg-surface0 focus-within:border-blue focus-within:ring-1 focus-within:ring-blue/50 min-h-[42px]">
        <For each={props.tags}>
          {(tag, index) => (
            <span
              class={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-sm font-medium border ${getTagColor(
                index()
              )}`}
            >
              <span>{tag}</span>
              <button
                type="button"
                onClick={() => removeTag(tag)}
                class="hover:text-red-400 transition-colors"
                aria-label={`Remove ${tag}`}
              >
                <svg
                  class="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </span>
          )}
        </For>
        <input
          type="text"
          value={inputValue()}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onFocus={() => inputValue() && setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          placeholder={
            props.tags.length === 0 ? props.placeholder || "Add tags..." : ""
          }
          class="flex-1 min-w-[100px] bg-transparent border-none outline-none text-text placeholder:text-subtext0 text-sm"
        />
      </div>

      {/* Suggestions dropdown */}
      <Show when={showSuggestions() && filteredSuggestions().length > 0}>
        <div class="absolute z-10 mt-1 w-full bg-surface0 rounded-lg border border-surface1 shadow-lg overflow-hidden">
          <For each={filteredSuggestions()}>
            {(suggestion) => (
              <button
                type="button"
                onClick={() => addTag(suggestion)}
                class="w-full px-3 py-2 text-left text-sm text-text hover:bg-surface1 transition-colors"
              >
                {suggestion}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
