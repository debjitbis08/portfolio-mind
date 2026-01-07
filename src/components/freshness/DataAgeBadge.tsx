/**
 * Data Age Badge
 *
 * Shows freshness status for a specific data source with visual indicators.
 * Used in CompanyDetails page to show age of VRS, Financials, etc.
 */

import { createSignal, createEffect, Show } from "solid-js";

interface DataAgeBadgeProps {
  symbol: string;
  source: string; // "VRS", "Financials", "Cached Analysis (Tier 2)", etc.
}

interface CheckData {
  source: string;
  status: "fresh" | "aging" | "stale" | "missing";
  age_hours: number | null;
  ttl_hours: number;
  last_updated: string | null;
  warning?: string;
}

const STATUS_CONFIG = {
  fresh: {
    icon: "🟢",
    text: "text-green",
    bg: "bg-green/10",
    border: "border-green/30",
  },
  aging: {
    icon: "🟡",
    text: "text-yellow",
    bg: "bg-yellow/10",
    border: "border-yellow/30",
  },
  stale: {
    icon: "🔴",
    text: "text-red",
    bg: "bg-red/10",
    border: "border-red/30",
  },
  missing: {
    icon: "⚪",
    text: "text-subtext0",
    bg: "bg-surface1",
    border: "border-surface2",
  },
};

function formatAge(hours: number | null): string {
  if (hours === null) return "Never";
  if (hours < 1) return `${Math.round(hours * 60)}m ago`;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatDate(isoString: string | null): string {
  if (!isoString) return "Never";
  return new Date(isoString).toLocaleString();
}

export default function DataAgeBadge(props: DataAgeBadgeProps) {
  const [checkData, setCheckData] = createSignal<CheckData | null>(null);
  const [loading, setLoading] = createSignal(true);

  createEffect(async () => {
    if (!props.symbol || !props.source) return;

    setLoading(true);

    try {
      const response = await fetch(`/api/analysis/freshness/${props.symbol}`);

      if (!response.ok) {
        console.error(`Failed to fetch freshness for ${props.symbol}`);
        setLoading(false);
        return;
      }

      const data = await response.json();

      // Find the check matching our source
      const check = data.checks.find((c: CheckData) => c.source === props.source);

      if (check) {
        setCheckData(check);
      }
    } catch (err) {
      console.error(`Error fetching freshness for ${props.symbol}:`, err);
    } finally {
      setLoading(false);
    }
  });

  const statusConfig = () =>
    checkData() ? STATUS_CONFIG[checkData()!.status] : STATUS_CONFIG.missing;

  return (
    <Show when={!loading() && checkData()} fallback={
      <span class="text-xs text-subtext0">Loading...</span>
    }>
      <div
        class={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium border transition-colors ${
          statusConfig().bg
        } ${statusConfig().border} ${statusConfig().text}`}
        title={
          checkData()!.warning ||
          `Last updated: ${formatDate(checkData()!.last_updated)}\nTTL: ${checkData()!.ttl_hours / 24} days`
        }
      >
        <span>{statusConfig().icon}</span>
        <span>{formatAge(checkData()!.age_hours)}</span>
        <Show when={checkData()!.status === "aging" || checkData()!.status === "stale"}>
          <span class="opacity-70">
            (TTL: {Math.round(checkData()!.ttl_hours / 24)}d)
          </span>
        </Show>
      </div>
    </Show>
  );
}
