import MarkdownIt from "markdown-it";

/**
 * Markdown to HTML converter using markdown-it
 * Configured for safe rendering with proper link handling
 */

// Initialize markdown-it with safe defaults
const md = new MarkdownIt({
  html: true, // Allow HTML tags in markdown (for <br/> support)
  breaks: true, // Convert \n to <br>
  linkify: true, // Auto-convert URLs to links
  typographer: true, // Enable smartquotes and other typographic replacements
});

// Customize link rendering to open in new tab
const defaultRender = md.renderer.rules.link_open || function(tokens, idx, options, _env, self) {
  return self.renderToken(tokens, idx, options);
};

md.renderer.rules.link_open = function (tokens, idx, options, _env, self) {
  // Add target="_blank" and rel="noopener noreferrer" to links
  const aIndex = tokens[idx].attrIndex('target');

  if (aIndex < 0) {
    tokens[idx].attrPush(['target', '_blank']);
  } else {
    tokens[idx].attrs![aIndex][1] = '_blank';
  }

  const relIndex = tokens[idx].attrIndex('rel');
  if (relIndex < 0) {
    tokens[idx].attrPush(['rel', 'noopener noreferrer']);
  } else {
    tokens[idx].attrs![relIndex][1] = 'noopener noreferrer';
  }

  return defaultRender(tokens, idx, options, _env, self);
};

export function markdownToHtml(markdown: string): string {
  return md.render(markdown);
}
