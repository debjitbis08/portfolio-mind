# Bugfix: Performance Metrics Include Intraday Trades

## Status: COMPLETE

**Date:** 2026-01-08
**Goal:** Include intraday transactions in `/performance` metrics and filter to long-term trades only.

## Scope
- Merge intraday suggestion links into the metrics pipeline.
- Treat intraday transactions like standard trades for P&L calculations.

## Progress
- Combined `suggestionTransactions` and `intradaySuggestionLinks`.
- Included intraday transactions for linked trade lookups and symbol-level matching.
- Normalized intraday trade values using `quantity * pricePerShare`.
- Filtered metrics queries to `portfolioType = "CATALYST"`.

## Notes
- Intraday executed timestamps fall back to `createdAt` when missing.
- `/performance` targets LONGTERM trades, not catalyst.

## References
- `src/pages/api/metrics.ts`
