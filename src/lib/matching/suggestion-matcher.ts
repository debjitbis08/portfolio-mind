/**
 * Suggestion-Transaction Auto-Matching
 *
 * Automatically proposes links between suggestions and transactions
 * based on symbol, action, date proximity, and price similarity.
 */

import { db, schema } from "../db";
import { eq, and, gte, lte } from "drizzle-orm";

export interface MatchProposal {
  suggestionId: string;
  transactionId: string;
  suggestion: {
    symbol: string;
    action: string;
    targetPrice: number | null;
    approvedAt: string | null;
  };
  transaction: {
    symbol: string;
    type: string;
    executedAt: string;
    pricePerShare: number;
  };
  matchType: "auto_symbol_date" | "auto_price";
  confidence: number;
  reason: string;
}

/**
 * Find matching suggestions for a set of transactions
 */
export async function findMatchesForTransactions(
  transactionIds: string[]
): Promise<MatchProposal[]> {
  if (transactionIds.length === 0) return [];

  const proposals: MatchProposal[] = [];

  // Fetch transactions
  const transactions = await db
    .select()
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.status, "Executed")
        // You'd normally use IN operator, but let's fetch all and filter
      )
    );

  const relevantTransactions = transactions.filter((t) =>
    transactionIds.includes(t.id)
  );

  // Fetch approved suggestions from last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const suggestions = await db
    .select()
    .from(schema.suggestions)
    .where(
      and(
        eq(schema.suggestions.status, "approved"),
        gte(schema.suggestions.reviewedAt || "", thirtyDaysAgo.toISOString())
      )
    );

  // Match each transaction to suggestions
  for (const tx of relevantTransactions) {
    const txDate = new Date(tx.executedAt);
    const pricePerShare = tx.quantity > 0 ? tx.value / tx.quantity : 0;

    for (const suggestion of suggestions) {
      // Must match symbol
      if (suggestion.symbol !== tx.symbol) continue;

      // Must match action type
      if (suggestion.action !== tx.type) continue;

      // Check if already linked
      const existingLink = await db
        .select()
        .from(schema.suggestionTransactions)
        .where(
          and(
            eq(schema.suggestionTransactions.suggestionId, suggestion.id),
            eq(schema.suggestionTransactions.transactionId, tx.id)
          )
        )
        .limit(1);

      if (existingLink.length > 0) continue;

      // Calculate date proximity (transaction should be after approval)
      if (!suggestion.reviewedAt) continue;

      const approvalDate = new Date(suggestion.reviewedAt);
      const daysDiff = Math.floor(
        (txDate.getTime() - approvalDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Transaction must be within 7 days after approval
      if (daysDiff < 0 || daysDiff > 7) continue;

      // Calculate confidence based on date proximity and price match
      let confidence = 70; // Base confidence for symbol + action + date match

      // Boost confidence based on date proximity
      if (daysDiff <= 1) confidence += 20;
      else if (daysDiff <= 3) confidence += 10;
      else if (daysDiff <= 5) confidence += 5;

      // Check price match if target price is available
      let matchType: "auto_symbol_date" | "auto_price" = "auto_symbol_date";
      if (suggestion.targetPrice && pricePerShare > 0) {
        const priceDiff = Math.abs(pricePerShare - suggestion.targetPrice);
        const priceDiffPercent = (priceDiff / suggestion.targetPrice) * 100;

        if (priceDiffPercent <= 5) {
          confidence += 10;
          matchType = "auto_price";
        } else if (priceDiffPercent <= 10) {
          confidence += 5;
          matchType = "auto_price";
        }
      }

      // Only propose if confidence is > 50%
      if (confidence > 50) {
        proposals.push({
          suggestionId: suggestion.id,
          transactionId: tx.id,
          suggestion: {
            symbol: suggestion.symbol,
            action: suggestion.action,
            targetPrice: suggestion.targetPrice,
            approvedAt: suggestion.reviewedAt,
          },
          transaction: {
            symbol: tx.symbol,
            type: tx.type,
            executedAt: tx.executedAt,
            pricePerShare,
          },
          matchType,
          confidence,
          reason: `${suggestion.action} ${
            suggestion.symbol
          } executed ${daysDiff} days after approval${
            matchType === "auto_price"
              ? ` at matching price (${confidence}% confidence)`
              : ""
          }`,
        });
      }
    }
  }

  // Sort by confidence descending
  return proposals.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Auto-create links for high-confidence matches
 */
export async function autoLinkHighConfidenceMatches(
  proposals: MatchProposal[],
  minConfidence = 80
): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;

  for (const proposal of proposals) {
    if (proposal.confidence < minConfidence) {
      skipped++;
      continue;
    }

    try {
      await db.insert(schema.suggestionTransactions).values({
        suggestionId: proposal.suggestionId,
        transactionId: proposal.transactionId,
        matchType: proposal.matchType,
        confidence: proposal.confidence,
        notes: `Auto-matched: ${proposal.reason}`,
      });
      created++;
    } catch (error) {
      // Likely duplicate, skip
      skipped++;
    }
  }

  return { created, skipped };
}
