# Bugfix: Exclude Delisted Stocks From Data Freshness

## Status: DONE

**Date:** 2026-01-08
**Goal:** Ensure Data Freshness Status analysis ignores delisted symbols.

## Context
- Data Freshness Status currently uses holdings symbols without filtering delisted entries.

## Planned Changes
- Filter out delisted symbols in `checkPortfolioDataFreshness`.

## Progress
- Updated `src/lib/data-freshness.ts` to exclude delisted symbols when building portfolio freshness reports.
- Updated `src/pages/api/holdings.ts` to exclude delisted symbols from holdings listings.

## Next Steps
- Validate dashboard Data Freshness Status response if needed.
