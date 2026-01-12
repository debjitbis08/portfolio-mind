# Bugfix - Market Hours Next Open

**Status**: 🟡 In Progress
**Date**: 2026-01-08
**Goal**: Fix `getNextMarketOpen` so pre-market checks return the same-day open time.

## Context
- Catalyst logs were showing "Market is CLOSED (opens Tue, 13 Jan)" on Monday morning before market open.
- Root cause: `getNextMarketOpen` advanced to tomorrow whenever `isIndianMarketOpen` returned false, including pre-open hours.

## Changes
- Added IST offset constants and trading-day helpers in `src/lib/catalyst/market-hours.ts`.
- Updated `getNextMarketOpen` to return today's open time when it's a trading day but before 9:15 AM IST.

## Files
- `src/lib/catalyst/market-hours.ts`

## Next Steps
- Confirm log output around pre-open hours (e.g., 8:30 AM IST) shows same-day open.
