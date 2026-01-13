# Bugfix - Exclude Catalyst Suggestions from Tier 3

**Status**: ✅ Done
**Date**: 2026-01-13
**Goal**: Prevent catalyst portfolio suggestions from being injected into Tier 3 analysis context.

## Changes
- Filtered suggestion context by `portfolioType` (default: `LONGTERM`).
- Ensured pending/history suggestion context excludes catalyst suggestions.

## Files
- `src/lib/tools/suggestions.ts`

## Notes
- Tier 3 (and Tier 2) both use `getSuggestionsContext`, so this removes catalyst noise from long-term analysis.
