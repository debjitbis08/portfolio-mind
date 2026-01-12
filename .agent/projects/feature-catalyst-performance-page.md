# Feature: Catalyst Performance Page

## Status: COMPLETE

**Date:** 2026-01-08
**Goal:** Build a dedicated Catalyst performance page that surfaces intraday trades, latest gain/loss, and current positions.

## Scope
- New `/catalyst/performance` page with performance summary + positions + intraday trades.
- Reuse existing catalyst holdings API for live positions.
- Surface intraday trades (CATALYST portfolio) and compute current P&L using latest prices.

## Plan
1. Add a new SolidJS component for the performance UI.
2. Create an Astro page and navigation link.
3. Extend intraday transactions API to filter by portfolio type.

## Progress
- Added catalyst performance page component and new Astro route.
- Extended intraday transactions API with portfolio type filter.
- Added navigation link for the performance page.
- SSR hydrate: pass initial intraday + holdings data from Astro to avoid empty UI when client JS doesn't fire.
- Switched intraday preload to direct DB queries to avoid auth/fetch issues on SSR.
- Added catalyst-only performance metrics (profit factor, win rate, max drawdown, expectancy).

## Next Steps
- Verify UI against real data and tweak copy/metrics if needed.

## Open Questions
- None.

## References
- `src/pages/api/catalyst/holdings.ts`
- `src/pages/api/intraday-transactions.ts`
- `src/pages/catalyst.astro`
