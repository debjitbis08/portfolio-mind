# Bugfix: Catalyst Performance Trades List

## Status: COMPLETE

**Date:** 2026-01-08
**Goal:** Show broker (transactions table) trades on the catalyst performance page alongside intraday trades.

## Scope
- Merge broker and intraday catalyst trades into one list.
- Ensure SSR and client fetch use the combined trade set.

## Progress
- Added shared `getCatalystTrades` helper to merge broker + intraday trades with suggestion links.
- Exposed `/api/catalyst/trades` endpoint.
- Updated catalyst performance page to consume combined trades and adjusted UI copy.

## References
- `src/lib/catalyst/trades.ts`
- `src/pages/api/catalyst/trades.ts`
- `src/pages/catalyst/performance.astro`
- `src/components/catalyst/CatalystPerformancePage.tsx`
