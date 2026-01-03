/**
 * Suggestions Tools
 *
 * Tools for the AI agent to review and manage its own suggestions.
 * Enables suggestion refinement across sessions.
 */

import { registerToolExecutor, type ToolResponse } from "./registry";
import { db, schema } from "../db";
import { eq, and, inArray, desc } from "drizzle-orm";

interface GetPreviousSuggestionsArgs {
  symbols?: string[];
  status?: "pending" | "approved" | "rejected" | "expired" | "superseded";
}

/**
 * Get previous suggestions for symbols being analyzed.
 * Returns active/pending suggestions so agent can review and update them.
 */
async function getPreviousSuggestions(
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const { symbols, status } = args as unknown as GetPreviousSuggestionsArgs;

  try {
    console.log(
      `[Suggestions Tool] Fetching previous suggestions for: ${
        symbols?.join(", ") || "all"
      }`
    );

    // Build query conditions
    const conditions = [];

    // Filter by status (default to pending)
    const targetStatus = status || "pending";
    conditions.push(eq(schema.suggestions.status, targetStatus));

    // Filter by symbols if provided
    if (symbols && symbols.length > 0) {
      const cleanSymbols = symbols.map((s) => s.trim().toUpperCase());
      conditions.push(inArray(schema.suggestions.symbol, cleanSymbols));
    }

    const results = await db
      .select({
        id: schema.suggestions.id,
        symbol: schema.suggestions.symbol,
        stockName: schema.suggestions.stockName,
        action: schema.suggestions.action,
        rationale: schema.suggestions.rationale,
        confidence: schema.suggestions.confidence,
        currentPrice: schema.suggestions.currentPrice,
        targetPrice: schema.suggestions.targetPrice,
        status: schema.suggestions.status,
        createdAt: schema.suggestions.createdAt,
        expiresAt: schema.suggestions.expiresAt,
      })
      .from(schema.suggestions)
      .where(and(...conditions))
      .orderBy(desc(schema.suggestions.createdAt))
      .limit(20);

    if (results.length === 0) {
      return {
        success: true,
        data: {
          suggestions: [],
          message: `No ${targetStatus} suggestions found${
            symbols ? ` for symbols: ${symbols.join(", ")}` : ""
          }`,
        },
        meta: {
          source: "internal",
        },
      };
    }

    // Format for agent consumption
    const formatted = results.map((s) => ({
      id: s.id,
      symbol: s.symbol,
      stock_name: s.stockName,
      action: s.action,
      rationale: s.rationale,
      confidence: s.confidence,
      current_price_at_suggestion: s.currentPrice,
      target_price: s.targetPrice,
      status: s.status,
      created_at: s.createdAt,
      expires_at: s.expiresAt,
      days_old: s.createdAt
        ? Math.floor(
            (Date.now() - new Date(s.createdAt).getTime()) /
              (1000 * 60 * 60 * 24)
          )
        : null,
    }));

    return {
      success: true,
      data: {
        suggestions: formatted,
        count: formatted.length,
        guidance:
          "Review these previous suggestions. For each, decide: (1) STILL VALID - no action needed, (2) UPDATE - create new suggestion with different action/rationale, or (3) INVALIDATE - mark as rejected if no longer valid.",
      },
      meta: {
        source: "internal",
      },
    };
  } catch (error) {
    console.error("[Suggestions Tool] Error:", error);
    return {
      success: false,
      error: {
        code: "UNKNOWN",
        message: error instanceof Error ? error.message : "Unknown error",
        retryable: true,
      },
    };
  }
}

/**
 * Supersede an existing suggestion with a new one.
 * Called internally when agent creates a new suggestion for a symbol that already has one.
 */
export async function supersedeSuggestion(
  oldSuggestionId: string,
  newSuggestionId: string,
  reason: string
): Promise<boolean> {
  try {
    console.log(
      `[Suggestions] Superseding ${oldSuggestionId} with ${newSuggestionId}: ${reason}`
    );

    await db
      .update(schema.suggestions)
      .set({
        status: "superseded",
        supersededBy: newSuggestionId,
        supersededReason: reason,
        reviewedAt: new Date().toISOString(),
      })
      .where(eq(schema.suggestions.id, oldSuggestionId));

    return true;
  } catch (error) {
    console.error("[Suggestions] Supersede error:", error);
    return false;
  }
}

/**
 * Get pending suggestions for specific symbols (for context injection)
 */
export async function getPendingSuggestionsForSymbols(
  symbols: string[]
): Promise<
  Array<{
    id: string;
    symbol: string;
    action: string;
    rationale: string;
    confidence: number | null;
    createdAt: string | null;
  }>
> {
  if (symbols.length === 0) return [];

  const cleanSymbols = symbols.map((s) => s.trim().toUpperCase());

  const results = await db
    .select({
      id: schema.suggestions.id,
      symbol: schema.suggestions.symbol,
      action: schema.suggestions.action,
      rationale: schema.suggestions.rationale,
      confidence: schema.suggestions.confidence,
      createdAt: schema.suggestions.createdAt,
    })
    .from(schema.suggestions)
    .where(
      and(
        eq(schema.suggestions.status, "pending"),
        inArray(schema.suggestions.symbol, cleanSymbols)
      )
    )
    .orderBy(desc(schema.suggestions.createdAt));

  return results;
}

// Register the executor
registerToolExecutor("get_previous_suggestions", getPreviousSuggestions);

export { getPreviousSuggestions };
