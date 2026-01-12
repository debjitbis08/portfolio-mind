/**
 * Intraday Transactions API
 *
 * CRUD operations for temporary trades entered manually before broker import.
 * These transactions are merged into holdings calculations at read-time.
 *
 * GET  - List all or filter by suggestionId
 * POST - Create new intraday transaction linked to a suggestion
 * DELETE - Delete single (id) or clear all (clearAll=true)
 */

import type { APIRoute } from "astro";
import { requireAuth } from "../../lib/middleware/requireAuth";
import { db, schema } from "../../lib/db";
import { and, eq } from "drizzle-orm";

export const GET: APIRoute = async ({ request }) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  const url = new URL(request.url);
  const suggestionId = url.searchParams.get("suggestionId");
  const portfolioTypeParam = url.searchParams.get("portfolioType");
  const portfolioType =
    portfolioTypeParam === "LONGTERM" || portfolioTypeParam === "CATALYST"
      ? portfolioTypeParam
      : null;

  try {
    if (suggestionId) {
      const whereClause = portfolioType
        ? and(
            eq(schema.intradaySuggestionLinks.suggestionId, suggestionId),
            eq(schema.intradayTransactions.portfolioType, portfolioType)
          )
        : eq(schema.intradaySuggestionLinks.suggestionId, suggestionId);

      // Get intraday transactions for a specific suggestion
      const links = await db
        .select({
          id: schema.intradayTransactions.id,
          symbol: schema.intradayTransactions.symbol,
          stockName: schema.intradayTransactions.stockName,
          type: schema.intradayTransactions.type,
          quantity: schema.intradayTransactions.quantity,
          pricePerShare: schema.intradayTransactions.pricePerShare,
          executedAt: schema.intradayTransactions.executedAt,
          createdAt: schema.intradayTransactions.createdAt,
          portfolioType: schema.intradayTransactions.portfolioType,
          suggestionId: schema.intradaySuggestionLinks.suggestionId,
        })
        .from(schema.intradaySuggestionLinks)
        .innerJoin(
          schema.intradayTransactions,
          eq(
            schema.intradaySuggestionLinks.intradayTransactionId,
            schema.intradayTransactions.id
          )
        )
        .where(whereClause);

      return new Response(JSON.stringify({ transactions: links }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get all intraday transactions
    let transactions = portfolioType
      ? await db
          .select()
          .from(schema.intradayTransactions)
          .where(eq(schema.intradayTransactions.portfolioType, portfolioType))
          .orderBy(schema.intradayTransactions.createdAt)
      : await db
          .select()
          .from(schema.intradayTransactions)
          .orderBy(schema.intradayTransactions.createdAt);

    if (portfolioType) {
      const linkedTransactions = await db
        .select({
          id: schema.intradayTransactions.id,
          symbol: schema.intradayTransactions.symbol,
          stockName: schema.intradayTransactions.stockName,
          type: schema.intradayTransactions.type,
          quantity: schema.intradayTransactions.quantity,
          pricePerShare: schema.intradayTransactions.pricePerShare,
          executedAt: schema.intradayTransactions.executedAt,
          createdAt: schema.intradayTransactions.createdAt,
          portfolioType: schema.intradayTransactions.portfolioType,
        })
        .from(schema.intradaySuggestionLinks)
        .innerJoin(
          schema.intradayTransactions,
          eq(
            schema.intradaySuggestionLinks.intradayTransactionId,
            schema.intradayTransactions.id
          )
        )
        .innerJoin(
          schema.suggestions,
          eq(schema.intradaySuggestionLinks.suggestionId, schema.suggestions.id)
        )
        .where(eq(schema.suggestions.portfolioType, portfolioType));

      if (linkedTransactions.length > 0) {
        const merged = new Map<string, (typeof linkedTransactions)[0]>();
        for (const tx of transactions) merged.set(tx.id, tx);
        for (const tx of linkedTransactions) merged.set(tx.id, tx);
        transactions = Array.from(merged.values()).sort((a, b) => {
          const aTime = new Date(a.createdAt || 0).getTime();
          const bTime = new Date(b.createdAt || 0).getTime();
          return aTime - bTime;
        });
      }
    }

    return new Response(JSON.stringify({ transactions }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[Intraday API] GET error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const POST: APIRoute = async ({ request }) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { suggestionId, symbol, stockName, type, quantity, pricePerShare } =
      body;

    // Validate required fields
    if (!suggestionId || !symbol || !type || !quantity || !pricePerShare) {
      return new Response(
        JSON.stringify({
          error:
            "Missing required fields: suggestionId, symbol, type, quantity, pricePerShare",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!["BUY", "SELL"].includes(type)) {
      return new Response(
        JSON.stringify({ error: "Type must be BUY or SELL" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Verify suggestion exists
    const suggestion = await db
      .select()
      .from(schema.suggestions)
      .where(eq(schema.suggestions.id, suggestionId))
      .limit(1);

    if (suggestion.length === 0) {
      return new Response(JSON.stringify({ error: "Suggestion not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Create intraday transaction with same portfolio type as the suggestion
    const txResult = await db
      .insert(schema.intradayTransactions)
      .values({
        symbol: symbol.toUpperCase(),
        stockName: stockName || symbol,
        type: type as "BUY" | "SELL",
        quantity: Number(quantity),
        pricePerShare: Number(pricePerShare),
        portfolioType: suggestion[0].portfolioType || "LONGTERM",
      })
      .returning();

    const newTx = txResult[0];

    // Create link to suggestion
    await db.insert(schema.intradaySuggestionLinks).values({
      intradayTransactionId: newTx.id,
      suggestionId,
    });

    console.log(
      `[Intraday API] Created ${type} ${quantity} ${symbol} @ ${pricePerShare} for suggestion ${suggestionId}`
    );

    return new Response(
      JSON.stringify({
        success: true,
        transaction: newTx,
      }),
      { status: 201, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[Intraday API] POST error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  const authError = await requireAuth(request);
  if (authError) return authError;

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const clearAll = url.searchParams.get("clearAll") === "true";

  try {
    if (clearAll) {
      // Clear all intraday data
      await db.delete(schema.intradaySuggestionLinks);
      await db.delete(schema.intradayTransactions);
      console.log("[Intraday API] Cleared all intraday transactions");

      return new Response(
        JSON.stringify({ success: true, message: "All intraday data cleared" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    if (id) {
      // Delete specific transaction (links will cascade)
      await db
        .delete(schema.intradayTransactions)
        .where(eq(schema.intradayTransactions.id, id));

      console.log(`[Intraday API] Deleted transaction ${id}`);

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ error: "Must provide id or clearAll=true" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[Intraday API] DELETE error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
