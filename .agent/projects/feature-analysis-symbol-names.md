# Feature: Analysis Symbol Names

## Status: DONE

**Date:** 2026-01-08
**Goal:** Ensure analysis overview shows company names for holdings, even when not in watchlist.

## Completed
- Added holdings name lookup from transactions so the analysis overview API returns company names for holdings.

## Files Touched
- /home/debjit/code/portfolio-mind/src/pages/api/analysis/overview.ts

## Notes
- Holdings now prefer transaction stock names, then watchlist names, then symbol fallback.
