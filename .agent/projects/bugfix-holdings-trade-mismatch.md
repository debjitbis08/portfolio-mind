# Bugfix: Holdings/Trade Mismatch (Tradebook sells)

## Status: IN PROGRESS

**Date:** 2026-01-09
**Goal:** Ensure tradebook SELLs that lack ISIN correctly offset existing holdings so closed positions disappear.

## Context
- ICICI tradebook CSVs can omit ISIN values.
- Holdings are computed by grouping transactions using ISIN + symbol, so SELL rows with empty ISIN do not offset BUY rows with populated ISIN.

## Progress
- Updated holdings aggregation to group by symbol and pick a non-empty ISIN when available.

## Next Steps
- Verify holdings for PENIND after recalculation.
- Consider adding import-time ISIN backfill from existing transactions for extra safety.

## References
- `src/lib/db/index.ts`
- `src/pages/api/import-transactions.ts`
- `src/lib/xlsx-importer.ts`
