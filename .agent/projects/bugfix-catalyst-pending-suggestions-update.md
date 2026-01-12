# Bugfix - Update Pending Catalyst Suggestions

**Status**: ✅ Done
**Date**: 2026-01-08
**Goal**: When catalyst suggestions are regenerated, update existing pending entries instead of inserting new duplicates.

## Changes
- Added pending-suggestion lookup by symbol for catalyst portfolio.
- Updated pending records in place (refreshing fields, createdAt, expiresAt).
- Left insert path unchanged for symbols with no pending suggestion.

## Files
- `src/lib/catalyst/suggestions-runner.ts`

## Notes
- Pending suggestion context is already provided to the LLM in `src/lib/catalyst/catalyst-gemini.ts`.
