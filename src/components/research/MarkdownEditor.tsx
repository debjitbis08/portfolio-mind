import { onMount, onCleanup } from "solid-js";
import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
// Frame.css removed - using custom dark theme in global.css

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export default function MarkdownEditor(props: MarkdownEditorProps) {
  let editorRef: HTMLDivElement | undefined;
  let crepe: Crepe | undefined;

  onMount(async () => {
    if (!editorRef) return;

    try {
      crepe = new Crepe({
        root: editorRef,
        defaultValue: props.value || "",
      });

      // Listen for changes
      crepe.on((listener) => {
        listener.markdownUpdated((_ctx, markdown) => {
          props.onChange(markdown);
        });
      });

      await crepe.create();
    } catch (err) {
      console.error("Failed to initialize Crepe editor:", err);
    }
  });

  onCleanup(() => {
    crepe?.destroy();
  });

  return (
    <div
      ref={editorRef}
      class={`crepe-editor-container ${props.disabled ? "opacity-50 pointer-events-none" : ""}`}
      style={{
        "min-height": "400px",
        "border": "1px solid var(--ctp-surface1)",
        "border-radius": "0.75rem",
        "background": "var(--ctp-surface0)",
        "box-shadow": "0 2px 8px rgba(0, 0, 0, 0.3)",
        "transition": "border-color 0.15s ease-out, box-shadow 0.15s ease-out",
      }}
    />
  );
}
