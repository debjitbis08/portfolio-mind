# Docs Root Cleanup

## Status
- Done

## Goals
- Remove verbose root-level markdown docs
- Rewrite and relocate durable documentation under `docs/`
- Keep README links current

## Completed
- Added `docs/catalyst/` with quickstart, architecture, sources, BSE watchlist, and deduplication references
- Added `docs/tools/ticker-search.md` and `docs/maintenance/ticker-corrections.md`
- Removed root docs that were moved/rewritten
- Updated `README.md` to link to catalyst docs
- Added a Catalyst Catcher section at the end of `docs/USER_GUIDE.md`

## Remaining
- None

## Decisions
- Consolidated catalyst-related docs into `docs/catalyst/`
- Kept ticker corrections as a maintenance note with a reminder that `src/lib/symbol-matcher.ts` is the source of truth

## Files Touched
- `docs/catalyst/README.md`
- `docs/catalyst/quickstart.md`
- `docs/catalyst/architecture.md`
- `docs/catalyst/sources.md`
- `docs/catalyst/bse-watchlist.md`
- `docs/catalyst/deduplication.md`
- `docs/tools/ticker-search.md`
- `docs/maintenance/ticker-corrections.md`
- `README.md`
- `docs/USER_GUIDE.md`
- Removed: `BSE_WATCHLIST_INTEGRATION.md`, `CATALYST_ARCHITECTURE_FINAL.md`, `CATALYST_DEDUPLICATION.md`, `CATALYST_QUICKSTART.md`, `CATALYST_SOURCE_INTEGRATION.md`, `SOURCE_REGISTRY_INTEGRATION.md`, `TICKER_SEARCH_TOOL.md`, `TICKER_CORRECTIONS_FOUND.md`, `PHASE1_COMPLETE.md`, `PHASE2_COMPLETE.md`
