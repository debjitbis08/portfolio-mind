# Bugfix: Catalyst Performance Mixed-Source Realized P&L

## Status: COMPLETE

**Date:** 2026-01-08
**Goal:** Ensure realized P&L is computed when buys come from broker transactions and sells come from intraday trades.

## Scope
- Merge broker and intraday trades linked to catalyst suggestions even when portfolio type mismatches.
- Normalize symbols for lot matching to avoid suffix mismatches (e.g., `.NS`).

## Progress
- Added linked broker and intraday transactions to catalyst performance metrics.
- Normalized symbols for lot matching across broker and intraday sources.

## References
- `src/lib/catalyst/performance-metrics.ts`
