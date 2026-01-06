/**
 * VRS Research Section Component
 * Displays and edits VRS (Value Research Stocks) research data
 * with modal-based editing similar to research documents
 */
import { createSignal, Show, onMount } from "solid-js";
import { FaSolidTrashCan, FaSolidPen, FaSolidExpand } from "solid-icons/fa";
import { markdownToHtml } from "../../lib/utils/markdown";
import MarkdownEditor from "../research/MarkdownEditor";

interface VRSSectionProps {
  symbol: string;
}

interface VRSData {
  recPrice?: number;
  recDate?: string;
  exitPrice?: number;
  exitDate?: string;
  status?: "Buy" | "Exited";
  rationale?: string;
  risks?: string;
  analystNote?: string;
  researchContent?: string;
  updatedAt?: string;
}

interface FormData {
  recPrice: string;
  recDate: string;
  exitPrice: string;
  exitDate: string;
  status: "Buy" | "Exited";
  rationale: string;
  risks: string;
  analystNote: string;
}

// Helper to truncate text for preview
const truncateText = (text: string, maxLength: number = 150): string => {
  if (!text || text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim() + "...";
};

// Check if there's any content worth showing
const hasContent = (data: VRSData): boolean => {
  return !!(data.rationale || data.risks || data.analystNote);
};

export default function VRSSection(props: VRSSectionProps) {
  const [vrsData, setVrsData] = createSignal<VRSData | null>(null);
  const [isLoading, setIsLoading] = createSignal(true);
  const [showEditModal, setShowEditModal] = createSignal(false);
  const [showViewModal, setShowViewModal] = createSignal(false);
  const [isSaving, setIsSaving] = createSignal(false);

  const [formData, setFormData] = createSignal<FormData>({
    recPrice: "",
    recDate: "",
    exitPrice: "",
    exitDate: "",
    status: "Buy",
    rationale: "",
    risks: "",
    analystNote: "",
  });

  // Check URL params for auto-opening editor
  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("openVrs") === "true") {
      setShowEditModal(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
    fetchVrsData();
  });

  const fetchVrsData = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(
        `/api/watchlist?symbol=${encodeURIComponent(props.symbol)}`
      );
      const data = await res.json();
      const stock = data.stocks?.find((s: any) => s.symbol === props.symbol);
      setVrsData(stock?.vrs_research || null);
    } catch (error) {
      console.error("Failed to fetch VRS data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const openEditor = () => {
    const data = vrsData();
    setFormData({
      recPrice: data?.recPrice?.toString() || "",
      recDate: data?.recDate || "",
      exitPrice: data?.exitPrice?.toString() || "",
      exitDate: data?.exitDate || "",
      status: data?.status || "Buy",
      rationale: data?.rationale || "",
      risks: data?.risks || "",
      analystNote: data?.analystNote || "",
    });
    setShowEditModal(true);
  };

  const saveData = async () => {
    setIsSaving(true);
    try {
      const form = formData();
      const res = await fetch("/api/watchlist/vrs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: props.symbol,
          recPrice: form.recPrice,
          recDate: form.recDate,
          exitPrice: form.exitPrice,
          exitDate: form.exitDate,
          status: form.status,
          rationale: form.rationale,
          risks: form.risks,
          analystNote: form.analystNote,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setShowEditModal(false);
      await fetchVrsData();
    } catch (error) {
      console.error("Failed to save VRS data:", error);
      alert("Failed to save VRS data");
    } finally {
      setIsSaving(false);
    }
  };

  const deleteData = async () => {
    if (!confirm("Are you sure you want to remove VRS research data?")) return;
    try {
      const res = await fetch(
        `/api/watchlist/vrs?symbol=${encodeURIComponent(props.symbol)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed to delete");
      await fetchVrsData();
    } catch (error) {
      console.error("Failed to delete VRS data:", error);
      alert("Failed to delete VRS data");
    }
  };

  // Close modals on Escape key
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setShowEditModal(false);
      setShowViewModal(false);
    }
  };

  return (
    <div class="bg-surface0 border border-surface1 rounded-xl p-4 mb-6">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-medium text-subtext0">⭐ VRS Research</h3>
        <div class="flex items-center gap-2">
          <Show when={vrsData() && hasContent(vrsData()!)}>
            <button
              onClick={() => setShowViewModal(true)}
              class="text-xs text-blue hover:text-sapphire cursor-pointer"
              title="View full research"
            >
              <FaSolidExpand />
            </button>
          </Show>
          <Show when={vrsData()}>
            <button
              onClick={openEditor}
              class="text-xs text-blue hover:text-sapphire cursor-pointer"
              title="Edit VRS data"
            >
              <FaSolidPen />
            </button>
            <button
              onClick={deleteData}
              class="text-xs text-red/60 hover:text-red cursor-pointer"
              title="Remove VRS data"
            >
              <FaSolidTrashCan />
            </button>
          </Show>
        </div>
      </div>

      <Show
        when={!isLoading()}
        fallback={<div class="text-subtext1">Loading...</div>}
      >
        <Show
          when={vrsData()}
          fallback={
            <div class="text-subtext1">
              <p class="mb-2">No VRS research data available.</p>
              <button
                onClick={openEditor}
                class="text-xs text-blue hover:text-sapphire hover:underline"
              >
                Add VRS Data
              </button>
            </div>
          }
        >
          {/* Compact Read Mode - Show preview only */}
          <div class="space-y-2">
            {/* Status Badge and Key Metrics in one row */}
            <div class="flex items-center gap-3 flex-wrap">
              <span
                class={`px-2 py-0.5 text-xs font-bold rounded ${
                  vrsData()!.status === "Buy"
                    ? "bg-green/10 text-green border border-green/30"
                    : "bg-yellow/10 text-yellow border border-yellow/30"
                }`}
              >
                {vrsData()!.status}
              </span>
              <Show when={vrsData()!.recPrice}>
                <span class="text-xs text-subtext1">
                  REC: ₹{vrsData()!.recPrice?.toLocaleString("en-IN")}
                </span>
              </Show>
              <Show when={vrsData()!.recDate}>
                <span class="text-xs text-subtext1">
                  {new Date(vrsData()!.recDate!).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              </Show>
              <Show
                when={vrsData()!.status === "Exited" && vrsData()!.exitPrice}
              >
                <span class="text-xs text-subtext1">
                  Exit: ₹{vrsData()!.exitPrice?.toLocaleString("en-IN")}
                </span>
              </Show>
            </div>

            {/* Preview of rationale - truncated */}
            <Show when={vrsData()!.rationale}>
              <div class="text-xs text-subtext1 line-clamp-2">
                {truncateText(vrsData()!.rationale!, 200)}
              </div>
            </Show>

            {/* Expand button if there's content */}
            <Show when={hasContent(vrsData()!)}>
              <button
                onClick={() => setShowViewModal(true)}
                class="text-xs text-blue hover:text-sapphire hover:underline"
              >
                View full research →
              </button>
            </Show>

            {/* Updated timestamp */}
            <Show when={vrsData()!.updatedAt}>
              <div class="text-xs text-subtext0">
                Updated: {new Date(vrsData()!.updatedAt!).toLocaleDateString()}
              </div>
            </Show>
          </div>
        </Show>
      </Show>

      {/* View Modal - Read Only */}
      <Show when={showViewModal()}>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-crust/80 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowViewModal(false);
          }}
          onKeyDown={handleKeyDown}
          tabIndex={0}
        >
          <div class="bg-base border border-surface1 rounded-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col shadow-2xl">
            {/* Header */}
            <div class="flex items-center justify-between p-4 border-b border-surface1">
              <div class="flex items-center gap-3">
                <h3 class="text-lg font-medium text-text">
                  ⭐ VRS Research - {props.symbol}
                </h3>
                <span
                  class={`px-2 py-0.5 text-xs font-bold rounded ${
                    vrsData()!.status === "Buy"
                      ? "bg-green/10 text-green border border-green/30"
                      : "bg-yellow/10 text-yellow border border-yellow/30"
                  }`}
                >
                  {vrsData()!.status}
                </span>
              </div>
              <div class="flex items-center gap-2">
                <button
                  onClick={() => {
                    setShowViewModal(false);
                    openEditor();
                  }}
                  class="text-xs text-blue hover:text-sapphire px-2 py-1"
                  title="Edit"
                >
                  <FaSolidPen />
                </button>
                <button
                  onClick={() => setShowViewModal(false)}
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
            <div class="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Price Information */}
              <div class="flex items-center gap-4 text-sm flex-wrap">
                <Show when={vrsData()!.recPrice}>
                  <div>
                    <span class="text-subtext1">REC Price: </span>
                    <span class="text-text font-medium">
                      ₹{vrsData()!.recPrice?.toLocaleString("en-IN")}
                    </span>
                  </div>
                </Show>
                <Show when={vrsData()!.recDate}>
                  <div>
                    <span class="text-subtext1">REC Date: </span>
                    <span class="text-text font-medium">
                      {new Date(vrsData()!.recDate!).toLocaleDateString(
                        "en-IN",
                        {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        }
                      )}
                    </span>
                  </div>
                </Show>
                <Show
                  when={vrsData()!.status === "Exited" && vrsData()!.exitPrice}
                >
                  <div>
                    <span class="text-subtext1">Exit Price: </span>
                    <span class="text-text font-medium">
                      ₹{vrsData()!.exitPrice?.toLocaleString("en-IN")}
                    </span>
                  </div>
                </Show>
                <Show
                  when={vrsData()!.status === "Exited" && vrsData()!.exitDate}
                >
                  <div>
                    <span class="text-subtext1">Exit Date: </span>
                    <span class="text-text font-medium">
                      {new Date(vrsData()!.exitDate!).toLocaleDateString(
                        "en-IN",
                        {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        }
                      )}
                    </span>
                  </div>
                </Show>
              </div>

              {/* Investment Rationale */}
              <Show when={vrsData()!.rationale}>
                <div class="border-t border-surface1 pt-3">
                  <div class="text-xs text-subtext0 mb-2 font-semibold uppercase tracking-wide">
                    Investment Rationale
                  </div>
                  <div
                    class="text-sm text-text prose prose-sm prose-invert max-w-none"
                    innerHTML={markdownToHtml(vrsData()!.rationale!)}
                  />
                </div>
              </Show>

              {/* Key Risks */}
              <Show when={vrsData()!.risks}>
                <div class="border-t border-surface1 pt-3">
                  <div class="text-xs text-subtext0 mb-2 font-semibold uppercase tracking-wide">
                    Key Risks
                  </div>
                  <div
                    class="text-sm text-text prose prose-sm prose-invert max-w-none"
                    innerHTML={markdownToHtml(vrsData()!.risks!)}
                  />
                </div>
              </Show>

              {/* Analyst Notes */}
              <Show when={vrsData()!.analystNote}>
                <div class="border-t border-surface1 pt-3">
                  <div class="text-xs text-subtext0 mb-2 font-semibold uppercase tracking-wide">
                    Analyst Notes
                  </div>
                  <div
                    class="text-sm text-subtext1 prose prose-sm prose-invert max-w-none"
                    innerHTML={markdownToHtml(vrsData()!.analystNote!)}
                  />
                </div>
              </Show>

              {/* Updated timestamp */}
              <Show when={vrsData()!.updatedAt}>
                <div class="text-xs text-subtext0 pt-2 border-t border-surface1">
                  Last updated:{" "}
                  {new Date(vrsData()!.updatedAt!).toLocaleDateString()}
                </div>
              </Show>
            </div>
          </div>
        </div>
      </Show>

      {/* Edit Modal */}
      <Show when={showEditModal()}>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-crust/80 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowEditModal(false);
          }}
          onKeyDown={handleKeyDown}
          tabIndex={0}
        >
          <div class="bg-base border border-surface1 rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
            {/* Header */}
            <div class="flex items-center justify-between p-4 border-b border-surface1">
              <h3 class="text-lg font-medium text-text">
                ✏️ Edit VRS Research - {props.symbol}
              </h3>
              <button
                onClick={() => setShowEditModal(false)}
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

            {/* Form Content */}
            <div class="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Status and Basic Fields */}
              <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label class="block text-xs text-subtext0 mb-1">Status</label>
                  <select
                    class="w-full px-3 py-2 bg-surface0 border border-surface1 rounded-lg text-text text-sm"
                    value={formData().status}
                    onChange={(e) =>
                      setFormData({
                        ...formData(),
                        status: e.currentTarget.value as "Buy" | "Exited",
                      })
                    }
                  >
                    <option value="Buy">Buy</option>
                    <option value="Exited">Exited</option>
                  </select>
                </div>
                <div>
                  <label class="block text-xs text-subtext0 mb-1">
                    REC Price (₹)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    class="w-full px-3 py-2 bg-surface0 border border-surface1 rounded-lg text-text text-sm"
                    value={formData().recPrice}
                    onInput={(e) =>
                      setFormData({
                        ...formData(),
                        recPrice: e.currentTarget.value,
                      })
                    }
                  />
                </div>
                <div>
                  <label class="block text-xs text-subtext0 mb-1">
                    REC Date
                  </label>
                  <input
                    type="date"
                    class="w-full px-3 py-2 bg-surface0 border border-surface1 rounded-lg text-text text-sm"
                    value={formData().recDate}
                    onInput={(e) =>
                      setFormData({
                        ...formData(),
                        recDate: e.currentTarget.value,
                      })
                    }
                  />
                </div>
              </div>

              {/* Exit Fields - Only shown for Exited status */}
              <Show when={formData().status === "Exited"}>
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <label class="block text-xs text-subtext0 mb-1">
                      Exit Price (₹)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      class="w-full px-3 py-2 bg-surface0 border border-surface1 rounded-lg text-text text-sm"
                      value={formData().exitPrice}
                      onInput={(e) =>
                        setFormData({
                          ...formData(),
                          exitPrice: e.currentTarget.value,
                        })
                      }
                    />
                  </div>
                  <div>
                    <label class="block text-xs text-subtext0 mb-1">
                      Exit Date
                    </label>
                    <input
                      type="date"
                      class="w-full px-3 py-2 bg-surface0 border border-surface1 rounded-lg text-text text-sm"
                      value={formData().exitDate}
                      onInput={(e) =>
                        setFormData({
                          ...formData(),
                          exitDate: e.currentTarget.value,
                        })
                      }
                    />
                  </div>
                </div>
              </Show>

              {/* Investment Rationale - Milkdown Editor */}
              <div>
                <label class="block text-xs text-subtext0 mb-1">
                  Investment Rationale{" "}
                  <span class="text-subtext1">(Markdown supported)</span>
                </label>
                <MarkdownEditor
                  value={formData().rationale}
                  onChange={(value) =>
                    setFormData({ ...formData(), rationale: value })
                  }
                  placeholder="Why is this stock recommended? Key thesis points..."
                />
              </div>

              {/* Risks - Milkdown Editor */}
              <div>
                <label class="block text-xs text-subtext0 mb-1">
                  Key Risks{" "}
                  <span class="text-subtext1">(Markdown supported)</span>
                </label>
                <MarkdownEditor
                  value={formData().risks}
                  onChange={(value) =>
                    setFormData({ ...formData(), risks: value })
                  }
                  placeholder="What are the key risks to this investment?"
                />
              </div>

              {/* Analyst Notes - Milkdown Editor */}
              <div>
                <label class="block text-xs text-subtext0 mb-1">
                  Analyst Notes{" "}
                  <span class="text-subtext1">(Markdown supported)</span>
                </label>
                <MarkdownEditor
                  value={formData().analystNote}
                  onChange={(value) =>
                    setFormData({ ...formData(), analystNote: value })
                  }
                  placeholder="Additional notes or observations..."
                />
              </div>
            </div>

            {/* Footer */}
            <div class="flex items-center justify-end gap-3 p-4 border-t border-surface1">
              <button
                class="px-4 py-2 text-sm text-subtext0 hover:text-text"
                onClick={() => setShowEditModal(false)}
              >
                Cancel
              </button>
              <button
                class={`px-6 py-2 text-sm rounded-lg font-medium ${
                  isSaving()
                    ? "bg-surface1 text-subtext0"
                    : "bg-blue text-base hover:bg-blue/80"
                }`}
                onClick={saveData}
                disabled={isSaving()}
              >
                {isSaving() ? "Saving..." : "Save VRS Data"}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
