/**
 * Source Management Utilities
 * Helpers for managing multi-source tracking (screener, vrs, manual)
 */

/**
 * Parse sources from DB string to array
 * @example parseSources("screener,vrs") => ["screener", "vrs"]
 */
export function parseSources(source: string | null): string[] {
  if (!source) return [];
  return source
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Check if stock has a specific source
 * @example hasSource("screener,vrs", "vrs") => true
 */
export function hasSource(source: string | null, check: string): boolean {
  const sources = parseSources(source);
  return sources.includes(check);
}

/**
 * Add source to existing sources (prevents duplicates)
 * @example addSource("screener", "vrs") => "screener,vrs"
 */
export function addSource(existing: string | null, newSource: string): string {
  const sources = parseSources(existing);
  if (!sources.includes(newSource)) {
    sources.push(newSource);
  }
  return sources.join(",");
}

/**
 * Remove source from existing sources
 * @example removeSource("screener,vrs", "vrs") => "screener"
 */
export function removeSource(
  existing: string | null,
  toRemove: string
): string {
  const sources = parseSources(existing).filter((s) => s !== toRemove);
  return sources.join(",") || "manual"; // Default to manual if no sources left
}

/**
 * Get display badges for sources with colors and icons
 */
export function getSourceBadges(
  source: string | null
): Array<{ label: string; color: string; icon: string }> {
  const sources = parseSources(source);
  const badges: Array<{ label: string; color: string; icon: string }> = [];

  for (const src of sources) {
    switch (src) {
      case "screener":
        badges.push({
          label: "Screener",
          color: "bg-blue/10 text-blue border-blue/30",
          icon: "📊",
        });
        break;
      case "vrs":
        badges.push({
          label: "VRS",
          color: "bg-yellow/10 text-yellow border-yellow/30",
          icon: "⭐",
        });
        break;
      case "manual":
        badges.push({
          label: "Manual",
          color: "bg-surface2 text-subtext0 border-surface2",
          icon: "✏️",
        });
        break;
      case "ai_discovery":
        badges.push({
          label: "AI",
          color: "bg-mauve/10 text-mauve border-mauve/30",
          icon: "🤖",
        });
        break;
      default:
        badges.push({
          label: src,
          color: "bg-surface2 text-subtext0 border-surface2",
          icon: "•",
        });
    }
  }

  return badges;
}
