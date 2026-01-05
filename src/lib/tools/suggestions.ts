/**
 * Suggestions Tools
 *
 * Tools for the AI agent to review and manage its own suggestions.
 * Enables suggestion refinement across sessions.
 */

import { registerToolExecutor, type ToolResponse } from "./registry";
import { db, schema } from "../db";
import { eq, and, inArray, desc, gt } from "drizzle-orm";

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
/**
 * Get suggestions context for AI (Pending + Recent History)
 */
export async function getSuggestionsContext(symbols?: string[]): Promise<
  Array<{
    id: string;
    symbol: string;
    action: string;
    rationale: string;
    confidence: number | null;
    status: string; // 'pending' | 'approved' | 'rejected'
    createdAt: string | null;
    notes: string[];
  }>
> {
  const cleanSymbols = symbols?.map((s) => s.trim().toUpperCase()) || [];

  // 1. Fetch ALL pending suggestions (or filter by symbol if provided)
  const pendingConditions = [eq(schema.suggestions.status, "pending")];
  if (cleanSymbols.length > 0) {
    pendingConditions.push(inArray(schema.suggestions.symbol, cleanSymbols));
  }

  // 2. Fetch RECENT resolved suggestions (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const historyConditions = [
    inArray(schema.suggestions.status, ["approved", "rejected"]),
    gt(schema.suggestions.createdAt, thirtyDaysAgo.toISOString()),
  ];
  if (cleanSymbols.length > 0) {
    historyConditions.push(inArray(schema.suggestions.symbol, cleanSymbols));
  }

  // Execute queries
  const [pendingRows, historyRows] = await Promise.all([
    db
      .select({
        id: schema.suggestions.id,
        symbol: schema.suggestions.symbol,
        action: schema.suggestions.action,
        rationale: schema.suggestions.rationale,
        confidence: schema.suggestions.confidence,
        status: schema.suggestions.status,
        createdAt: schema.suggestions.createdAt,
        noteContent: schema.actionNotes.content,
      })
      .from(schema.suggestions)
      .leftJoin(
        schema.actionNotes,
        eq(schema.suggestions.id, schema.actionNotes.suggestionId)
      )
      .where(and(...pendingConditions))
      .orderBy(desc(schema.suggestions.createdAt))
      .limit(50), // Cap pending to 50

    db
      .select({
        id: schema.suggestions.id,
        symbol: schema.suggestions.symbol,
        action: schema.suggestions.action,
        rationale: schema.suggestions.rationale,
        confidence: schema.suggestions.confidence,
        status: schema.suggestions.status,
        createdAt: schema.suggestions.createdAt,
        noteContent: schema.actionNotes.content,
      })
      .from(schema.suggestions)
      .leftJoin(
        schema.actionNotes,
        eq(schema.suggestions.id, schema.actionNotes.suggestionId)
      )
      .where(and(...historyConditions))
      .orderBy(desc(schema.suggestions.createdAt))
      .limit(20), // Cap history to 20
  ]);

  // Merge and group by ID
  const allRows = [...pendingRows, ...historyRows];

  const map = new Map<
    string,
    {
      id: string;
      symbol: string;
      action: string;
      rationale: string;
      confidence: number | null;
      status: string;
      createdAt: string | null;
      notes: string[];
    }
  >();

  for (const row of allRows) {
    if (!map.has(row.id)) {
      map.set(row.id, {
        id: row.id,
        symbol: row.symbol,
        action: row.action,
        rationale: row.rationale,
        confidence: row.confidence,
        status: row.status || "pending",
        createdAt: row.createdAt,
        notes: [],
      });
    }

    if (row.noteContent) {
      map.get(row.id)!.notes.push(row.noteContent);
    }
  }

  // Sort by created date desc
  return Array.from(map.values()).sort((a, b) => {
    return (
      new Date(b.createdAt || 0).getTime() -
      new Date(a.createdAt || 0).getTime()
    );
  });
}

// Register the executor
registerToolExecutor("get_previous_suggestions", getPreviousSuggestions);

export { getPreviousSuggestions };
