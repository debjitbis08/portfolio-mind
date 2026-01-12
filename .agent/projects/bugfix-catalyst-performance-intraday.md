# Bugfix: Catalyst Performance Intraday Metrics

## Status: COMPLETE

**Date:** 2026-01-08
**Goal:** Ensure catalyst performance metrics include intraday transactions.

## Scope
- Include intraday transactions in performance metric calculations.
- Preserve existing stop-loss linkage logic for suggestion-backed trades.

## Progress
- Merged intraday trades into `calculateCatalystPerformanceMetrics` inputs.
- Added intraday suggestion link lookup for stop-loss mapping.
- Sorted combined trades by execution time for consistent lot matching.

## Notes
- Intraday trades use `pricePerShare * quantity` to compute trade value.
- Executed time falls back to `createdAt` when missing.

## References
- `src/lib/catalyst/performance-metrics.ts`
