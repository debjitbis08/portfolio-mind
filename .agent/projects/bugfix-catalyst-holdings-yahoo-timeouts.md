**Goal:** Improve catalyst holdings price fetch resilience when Yahoo Finance times out.

**Status:** Done.

**Notes:**
- Error observed: `ETIMEDOUT` from `yahoo-finance2` in `src/pages/api/catalyst/holdings.ts`.
- Plan: mirror main holdings fallback strategy (Google Finance + technical_data + stale cache).

**Files:**
- `src/pages/api/catalyst/holdings.ts`

**Completed:**
- Added Google Finance fallback for BSE-only symbols and Yahoo timeouts.
- Added technical_data and stale-cache fallbacks for remaining prices.
