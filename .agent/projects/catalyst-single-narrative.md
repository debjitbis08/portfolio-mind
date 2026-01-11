# Catalyst - Single Narrative per Ticker

**Status**: 🟡 In Progress
**Date**: 2026-01-08
**Goal**: Ensure each ticker resolves to a single unified catalyst narrative and one watch signal.

## Context
- UI currently shows multiple catalysts for the same symbol across scans.
- Pass 2 synthesis wasn't always triggered (single-article scans), so older catalysts accumulated.

## Plan
- Ensure Pass 1 inserts only one catalyst per ticker.
- Trigger Pass 2 synthesis whenever multiple articles OR existing catalysts exist.
- Consolidate older catalysts so each ticker has exactly one active entry.

## Files
- `src/lib/catalyst/discovery.ts`

## Progress
- [x] Adjusted Pass 1 to keep only the primary catalyst per ticker.
- [x] Triggered Pass 2 synthesis for single-article scans when existing catalysts exist.
- [x] Always consolidate to one catalyst per ticker after synthesis.

## Notes
- Pass 2 now handles single-article scans to prevent multi-catalyst buildup.
