# Bugfix: Catalyst Holdings Intraday Netting

## Status: COMPLETE

**Date:** 2026-01-09
**Goal:** Prevent intraday BUY/SELL ordering from leaving stale catalyst holdings.

## Context
- Intraday transactions were merged in insertion order.
- If a SELL row arrived before a BUY row, the SELL was ignored, leaving an open holding.

## Changes
- Aggregate intraday transactions by normalized symbol before merging with holdings.
- Apply net quantity/invested value deltas to existing holdings or create new ones when net long.
- Normalize `.NS/.BO` symbols so intraday exits match broker-linked catalyst holdings.

## References
- `src/lib/db/index.ts`
