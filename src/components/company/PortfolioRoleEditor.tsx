/**
 * Portfolio Role Editor Component
 *
 * Allows manual assignment/editing of portfolio role for a stock.
 * Shows current role and provides dropdown to change it.
 */

import { createSignal, Show } from "solid-js";

interface PortfolioRoleEditorProps {
  symbol: string;
  currentRole?: string | null;
}

const PORTFOLIO_ROLES = [
  {
    value: "VALUE",
    emoji: "💎",
    label: "Value",
    description: "Deep value play with margin of safety",
  },
  {
    value: "MOMENTUM",
    emoji: "🚀",
    label: "Momentum",
    description: "Trend-following, riding strength",
  },
  {
    value: "CORE",
    emoji: "🏛️",
    label: "Core",
    description: "Long-term compounder, buy-and-hold",
  },
  {
    value: "SPECULATIVE",
    emoji: "🎲",
    label: "Speculative",
    description: "High-risk/reward bet",
  },
  {
    value: "INCOME",
    emoji: "💰",
    label: "Income",
    description: "Dividend/distribution focused",
  },
];

export default function PortfolioRoleEditor(props: PortfolioRoleEditorProps) {
  const [isEditing, setIsEditing] = createSignal(false);
  const [selectedRole, setSelectedRole] = createSignal(props.currentRole || null);
  const [isSaving, setIsSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const getCurrentRoleConfig = () => {
    return PORTFOLIO_ROLES.find((r) => r.value === selectedRole());
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/portfolio-roles/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: props.symbol,
          portfolioRole: selectedRole(),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to update portfolio role");
      }

      setIsEditing(false);
      // Reload the page to update the display
      window.location.reload();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setSelectedRole(props.currentRole || null);
    setIsEditing(false);
    setError(null);
  };

  return (
    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <span class="text-xs font-medium text-subtext1">Portfolio Role</span>
        <Show when={!isEditing()}>
          <button
            onClick={() => setIsEditing(true)}
            class="text-xs text-blue hover:text-blue/80 transition-colors"
          >
            {props.currentRole ? "Edit" : "Set Role"}
          </button>
        </Show>
      </div>

      <Show when={!isEditing()}>
        <Show
          when={props.currentRole}
          fallback={
            <p class="text-xs text-subtext0 italic">No portfolio role assigned</p>
          }
        >
          <div class="flex items-center gap-2">
            <span class="px-2 py-1 rounded text-xs bg-surface1 text-text">
              {getCurrentRoleConfig()?.emoji} {getCurrentRoleConfig()?.label}
            </span>
            <span class="text-[10px] text-subtext0">
              {getCurrentRoleConfig()?.description}
            </span>
          </div>
        </Show>
      </Show>

      <Show when={isEditing()}>
        <div class="space-y-2">
          <select
            class="w-full px-3 py-2 bg-surface0 border border-surface1 rounded-lg text-sm text-text focus:outline-none focus:ring-2 focus:ring-blue/50"
            value={selectedRole() || ""}
            onChange={(e) => setSelectedRole(e.target.value || null)}
          >
            <option value="">-- Select Role --</option>
            {PORTFOLIO_ROLES.map((role) => (
              <option value={role.value}>
                {role.emoji} {role.label} - {role.description}
              </option>
            ))}
          </select>

          <Show when={error()}>
            <p class="text-xs text-red">{error()}</p>
          </Show>

          <div class="flex gap-2">
            <button
              onClick={handleSave}
              disabled={isSaving() || !selectedRole()}
              class="px-3 py-1.5 bg-blue hover:bg-blue/80 text-base0 text-xs rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving() ? "Saving..." : "Save"}
            </button>
            <button
              onClick={handleCancel}
              disabled={isSaving()}
              class="px-3 py-1.5 bg-surface1 hover:bg-surface2 text-text text-xs rounded-lg transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}
