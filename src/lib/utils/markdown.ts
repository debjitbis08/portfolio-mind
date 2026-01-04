/**
 * Simple markdown to HTML converter for research documents
 * Uses basic regex replacements for common markdown syntax
 */

export function markdownToHtml(markdown: string): string {
  let html = markdown;

  // Escape HTML special characters first
  html = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Headers (must come before bold/italic)
  html = html.replace(/^######\s+(.+)$/gm, "<h6>$1</h6>");
  html = html.replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>");
  html = html.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");

  // Italic
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/_(.+?)_/g, "<em>$1</em>");

  // Code blocks
  html = html.replace(/```(.+?)```/gs, "<pre><code>$1</code></pre>");
  html = html.replace(/`(.+?)`/g, "<code>$1</code>");

  // Links
  html = html.replace(
    /\[(.+?)\]\((.+?)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue hover:underline">$1</a>'
  );

  // Unordered lists
  html = html.replace(/^\s*[-*+]\s+(.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

  // Ordered lists
  html = html.replace(/^\s*\d+\.\s+(.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => {
    if (!match.includes("<ul>")) {
      return `<ol>${match}</ol>`;
    }
    return match;
  });

  // Paragraphs (split by double newlines)
  html = html
    .split(/\n\n+/)
    .map((para) => {
      para = para.trim();
      // Don't wrap if already wrapped in a tag
      if (
        para.startsWith("<h") ||
        para.startsWith("<ul") ||
        para.startsWith("<ol") ||
        para.startsWith("<pre")
      ) {
        return para;
      }
      return para ? `<p>${para}</p>` : "";
    })
    .join("\n");

  // Line breaks (single newlines within paragraphs)
  html = html.replace(/\n/g, "<br>");

  return html;
}
