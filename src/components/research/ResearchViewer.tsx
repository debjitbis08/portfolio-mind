import { Show } from "solid-js";
import { markdownToHtml } from "../../lib/utils/markdown";

interface ResearchDocument {
  id: string;
  symbol: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface ResearchViewerProps {
  document: ResearchDocument;
  onEdit: () => void;
  onClose: () => void;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ResearchViewer(props: ResearchViewerProps) {
  const contentHtml = () => markdownToHtml(props.document.content);

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
      <div class="bg-base border border-surface1 rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div class="flex items-center justify-between p-4 border-b border-surface1">
          <div class="flex-1 min-w-0">
            <h2 class="text-xl font-semibold text-text truncate">
              {props.document.title}
            </h2>
            <p class="text-xs text-subtext0 mt-1">
              Last updated: {formatDate(props.document.updatedAt)}
            </p>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={props.onEdit}
              class="px-3 py-1.5 text-sm bg-surface0 hover:bg-surface1 text-text rounded-lg transition-colors border border-surface2"
            >
              ✏️ Edit
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
        <div class="flex-1 overflow-y-auto p-6">
          <article
            class="prose prose-invert max-w-none
              prose-headings:text-text prose-headings:font-semibold
              prose-h1:text-2xl prose-h1:mb-4 prose-h1:mt-6
              prose-h2:text-xl prose-h2:mb-3 prose-h2:mt-5
              prose-h3:text-lg prose-h3:mb-2 prose-h3:mt-4
              prose-p:text-text prose-p:leading-relaxed prose-p:mb-4
              prose-a:text-blue prose-a:no-underline hover:prose-a:underline
              prose-strong:text-text prose-strong:font-semibold
              prose-em:text-text prose-em:italic
              prose-code:text-pink prose-code:bg-surface0 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-sm
              prose-pre:bg-surface0 prose-pre:border prose-pre:border-surface2 prose-pre:p-4 prose-pre:rounded-lg
              prose-ul:list-disc prose-ul:pl-6 prose-ul:mb-4
              prose-ol:list-decimal prose-ol:pl-6 prose-ol:mb-4
              prose-li:text-text prose-li:mb-1"
            innerHTML={contentHtml()}
          />
        </div>
      </div>
    </div>
  );
}
