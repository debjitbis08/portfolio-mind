# Bugfix Plan: Catalyst Jump Detection

**Status:** Planning
**Date:** 2026-01-08
**Goal:** Ensure catalyst monitoring catches large end-of-day price jumps (e.g., KRYSTAL) even when the tracker runs after market close.

## Context
- Tracker currently skips price validation when Indian market is closed.
- Monitoring relies on `potential_catalysts.base_price` and `% change` vs base.

## Plan
- Inspect DB for KRYSTAL: `potential_catalysts` row, `watch_criteria`, `base_price`, `base_price_type`, `base_price_recorded_at`, `validation_log`.
- Verify latest price source: `price_cache` / `technical_data` timestamps vs the close where the jump happened.
- Confirm tracker schedule vs market-hours gate; check if runs only after close.
- Evaluate market validator behavior for closed markets (should allow last-close validation when jump already happened).
- Propose changes: allow post-close validation using last close, and/or add an explicit “gap-up/gap-down since last run” check.

## References
- `src/lib/catalyst/tracker.ts`
- `src/lib/db/schema.ts`
