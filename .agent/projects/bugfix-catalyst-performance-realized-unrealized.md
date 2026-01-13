# Bugfix: Catalyst Performance Realized vs Unrealized P&L

## Status: COMPLETE

**Date:** 2026-01-08
**Goal:** Include realized P&L from fully closed positions and add a realized vs unrealized breakdown on the catalyst performance page.

## Scope
- Combine realized P&L from closed trades with unrealized P&L from open holdings.
- Add UI cards for realized and unrealized P&L on `/catalyst/performance`.

## Progress
- Compute realized P&L from catalyst performance metrics (gross profit minus gross loss).
- Compute unrealized P&L from current holdings summary.
- Update total P&L to include both realized and unrealized components.
- Add realized/unrealized P&L cards with supporting context.

## References
- `src/components/catalyst/CatalystPerformancePage.tsx`
- `src/lib/catalyst/performance-metrics.ts`
- `src/pages/catalyst/performance.astro`
